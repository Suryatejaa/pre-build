import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiInvalidOutputError, AiProviderError, AiProviderRouter, AiRoutingError, aiUsageTotals, requirementsAiResponseSchema, type RequirementsAiProvider, type StructuredAiRequest } from '@property/services';
import { configuredRequirementsAiProvider, SarvamRequirementsProvider } from '@property/infrastructure/requirements-ai';

const output = { assistantMessage: 'Please describe the spaces you need.', extractions: [], followUpQuestions: [], siteClaims: [], explicitCorrection: false };
const request: StructuredAiRequest = { systemPrompt: 'Safe intake', input: { propertyType: 'RESIDENTIAL', ownerMessage: 'Three bedrooms.' }, schemaName: 'requirements_turn', schema: z.toJSONSchema(requirementsAiResponseSchema) };
const validate = (value: unknown) => requirementsAiResponseSchema.parse(value);
function provider(name: string, code?: ConstructorParameters<typeof AiProviderError>[0]) {
  return { metadata: { provider: name, model: `${name}-model` },
    generateStructured: vi.fn(async (_request: StructuredAiRequest) => { void _request; if (code) throw new AiProviderError(code); return { output, usage: { inputTokens: 3, outputTokens: 0 } }; }),
    generateText: vi.fn(async () => ({ text: 'A follow-up.' })),
  };
}
function json(content: unknown = output) { return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 7 } })); }
afterEach(() => { vi.useRealTimers(); });

describe('ordered provider router (no live requests)', () => {
  it('uses Sarvam success without calling a fallback and preserves zero-token usage', async () => {
    const sarvam = new SarvamRequirementsProvider({ apiKey: 'test-only' }, vi.fn(async () => json()));
    const fallback = provider('fallback-a');
    const result = await new AiProviderRouter([sarvam, fallback]).generateStructured(request, validate);
    expect(result.metadata).toEqual({ provider: 'sarvam', model: 'sarvam-105b' });
    expect(result.routingOutcome).toBe('PRIMARY_USED');
    expect(result.attempts).toMatchObject([{ provider: 'sarvam', succeeded: true, inputTokens: 5, outputTokens: 7, retryCount: 0, errorCode: null }]);
    expect(fallback.generateStructured).not.toHaveBeenCalled();
    const zero = await new AiProviderRouter([fallback]).generateStructured(request, validate);
    expect(aiUsageTotals(zero.attempts)).toEqual({ inputTokens: 3, outputTokens: 0, retryCount: 0 });
  });

  it.each([['5xx', 503, 'UNAVAILABLE'], ['rate limit', 429, 'RATE_LIMIT'], ['gateway timeout', 504, 'TIMEOUT']] as const)('falls back after Sarvam %s and identifies the provider that served', async (_, status, code) => {
    const sarvam = new SarvamRequirementsProvider({ apiKey: 'test-only' }, vi.fn(async () => new Response('sensitive diagnostics', { status })));
    const fallback = provider('fallback-a');
    const result = await new AiProviderRouter([sarvam, fallback]).generateStructured(request, validate);
    expect(fallback.generateStructured).toHaveBeenCalledTimes(1);
    expect(result.metadata).toEqual(fallback.metadata);
    expect(result.routingOutcome).toBe('FALLBACK_USED');
    expect(result.attempts.map(attempt => attempt.errorCode)).toEqual([code, null]);
    expect(JSON.stringify(result)).not.toMatch(/test-only|sensitive diagnostics/);
  });

  it('falls back on connection failure without propagating the raw error', async () => {
    const sarvam = new SarvamRequirementsProvider({ apiKey: 'test-only' }, vi.fn(async () => { throw new Error('secret network details'); }));
    const result = await new AiProviderRouter([sarvam, provider('fallback-a')]).generateStructured(request, validate);
    expect(result.attempts[0]?.errorCode).toBe('CONNECTION');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('aborts a hung Sarvam request and uses the fallback within a finite deadline', async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const sarvam = new SarvamRequirementsProvider({ apiKey: 'test-only', timeoutMs: 25 }, vi.fn(async (_url, init) => { receivedSignal = init?.signal ?? undefined; return new Promise<Response>(() => {}); }));
    const fallback = provider('fallback-a');
    const pending = new AiProviderRouter([sarvam, fallback], { timeoutMs: 25 }).generateStructured(request, validate);
    await vi.advanceTimersByTimeAsync(26);
    const result = await pending;
    expect(receivedSignal?.aborted).toBe(true);
    expect(result.attempts[0]?.errorCode).toBe('TIMEOUT');
    expect(result.metadata.provider).toBe('fallback-a');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also bounds hung response-body reads', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start() {} })));
    const sarvam = new SarvamRequirementsProvider({ apiKey: 'test-only', timeoutMs: 25 }, fetcher);
    const pending = new AiProviderRouter([sarvam, provider('fallback-a')], { timeoutMs: 25 }).generateStructured(request, validate);
    await vi.advanceTimersByTimeAsync(26);
    expect((await pending).attempts[0]?.errorCode).toBe('TIMEOUT');
  });

  it.each(['invalid JSON', 'invalid schema'])('repairs %s once on Sarvam, then falls back with a fresh request', async kind => {
    const fetcher = vi.fn(async () => kind === 'invalid JSON'
      ? new Response(JSON.stringify({ choices: [{ message: { content: '{not json' } }], usage: { prompt_tokens: 5, completion_tokens: 7 } }))
      : json({ ...output, extractions: [{ category: 'SITE_GEOMETRY', area: 123 }] }));
    const fallback = provider('fallback-a');
    const result = await new AiProviderRouter([new SarvamRequirementsProvider({ apiKey: 'test' }, fetcher), fallback]).generateStructured(request, validate);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.attempts.map(attempt => attempt.errorCode)).toEqual(['INVALID_OUTPUT', 'INVALID_OUTPUT', null]);
    expect(result.attempts.map(attempt => attempt.retryCount)).toEqual([0, 1, 0]);
    expect(fallback.generateStructured.mock.calls[0]?.[0].repairOutput).toBeUndefined();
    expect(aiUsageTotals(result.attempts)).toEqual({ inputTokens: 13, outputTokens: 14, retryCount: 1 });
  });

  it('uses a successful bounded repair without falling back', async () => {
    const primary = provider('sarvam');
    primary.generateStructured.mockRejectedValueOnce(new AiInvalidOutputError('{bad', { inputTokens: 2 }));
    const fallback = provider('fallback-a');
    const result = await new AiProviderRouter([primary, fallback]).generateStructured(request, validate);
    expect(primary.generateStructured.mock.calls[1]?.[0].repairOutput).toBe('{bad');
    expect(fallback.generateStructured).not.toHaveBeenCalled();
    expect(result.attempts).toHaveLength(2);
  });

  it('uses the second configured fallback after the first fails', async () => {
    const result = await new AiProviderRouter([provider('sarvam', 'UNAVAILABLE'), provider('fallback-a', 'RATE_LIMIT'), provider('fallback-b')]).generateStructured(request, validate);
    expect(result.metadata.provider).toBe('fallback-b');
    expect(result.attempts.map(attempt => attempt.provider)).toEqual(['sarvam', 'fallback-a', 'fallback-b']);
  });

  it('bounds all failed providers and returns only safe diagnostics', async () => {
    const providers = [provider('sarvam', 'TIMEOUT'), provider('fallback-a', 'CONNECTION'), provider('fallback-b', 'UNAVAILABLE')];
    await expect(new AiProviderRouter(providers).generateStructured(request, validate)).rejects.toMatchObject({ routingOutcome: 'ALL_PROVIDERS_FAILED', attempts: [{ errorCode: 'TIMEOUT' }, { errorCode: 'CONNECTION' }, { errorCode: 'UNAVAILABLE' }] });
    for (const candidate of providers) expect(candidate.generateStructured).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 400, 404, 422])('stops on operator/request error HTTP %s without hiding it with fallback', async status => {
    const fallback = provider('fallback-a');
    const sarvam = new SarvamRequirementsProvider({ apiKey: 'test' }, async () => new Response('secret', { status }));
    await expect(new AiProviderRouter([sarvam, fallback]).generateStructured(request, validate)).rejects.toMatchObject({ routingOutcome: 'OPERATOR_ERROR', attempts: [{ errorCode: status === 401 || status === 403 ? 'AUTHENTICATION' : 'INVALID_REQUEST' }] });
    expect(fallback.generateStructured).not.toHaveBeenCalled();
  });

  it.each(['content_filter', 'refusal'])('does not repair or fall back after a %s response', async kind => {
    const fallback = provider('fallback-a');
    const sarvam = new SarvamRequirementsProvider({ apiKey: 'test' }, async () => new Response(JSON.stringify({ choices: [{ finish_reason: kind === 'content_filter' ? kind : 'stop', message: { content: null, refusal: kind === 'refusal' ? 'Request declined.' : null } }] })));
    await expect(new AiProviderRouter([sarvam, fallback]).generateStructured(request, validate)).rejects.toMatchObject({ routingOutcome: 'OPERATOR_ERROR', attempts: [{ errorCode: 'INVALID_REQUEST' }] });
    expect(fallback.generateStructured).not.toHaveBeenCalled();
  });

  it('does not fall back for schema-valid unsupported intent or conflicting requirements', async () => {
    const primary = provider('sarvam');
    primary.generateStructured.mockResolvedValue({ output: { ...output, extractions: [
      { category: 'BUILDING_INTENT', value: 'COMMERCIAL', otherDescription: null, evidence: 'DIRECTLY_STATED', confidence: 'HIGH' },
      { category: 'FLOOR_COUNT', count: { minimum: 4, maximum: 2 }, priority: 'PREFERRED', evidence: 'DIRECTLY_STATED', confidence: 'HIGH' },
    ] } as typeof output, usage: { inputTokens: 3, outputTokens: 0 } });
    const fallback = provider('fallback-a');
    const result = await new AiProviderRouter([primary, fallback]).generateStructured(request, validate);
    expect(result.output.extractions).toHaveLength(2);
    expect(fallback.generateStructured).not.toHaveBeenCalled();
  });

  it('rejects spoofed metadata and unsafe categories under the exact requirements schema', async () => {
    const spoof = { ...output, provider: 'sarvam', model: 'spoof', extractions: [{ category: 'PERSIST_PROJECT', snapshot: {} }] };
    const malicious: RequirementsAiProvider = { ...provider('fallback-a'), generateStructured: vi.fn(async () => ({ output: spoof })) };
    await expect(new AiProviderRouter([malicious]).generateStructured(request, validate)).rejects.toBeInstanceOf(AiRoutingError);
    expect(malicious.generateStructured).toHaveBeenCalledTimes(2);
  });

  it('keeps request-local provider metadata during concurrent calls', async () => {
    const primary: RequirementsAiProvider = { ...provider('sarvam'), async generateStructured(req) {
      if (req.input === 'fail') throw new AiProviderError('UNAVAILABLE');
      return { output };
    } };
    const router = new AiProviderRouter([primary, provider('fallback-a')]);
    const [first, second] = await Promise.all([router.generateStructured({ ...request, input: 'fail' }, validate), router.generateStructured(request, validate)]);
    expect(first.metadata.provider).toBe('fallback-a'); expect(second.metadata.provider).toBe('sarvam');
    expect(second.attempts).toHaveLength(1);
  });

  it('returns NOT_CONFIGURED without any provider call', async () => {
    const router = new AiProviderRouter([]);
    expect(router.available).toBe(false);
    await expect(router.generateStructured(request, validate)).rejects.toMatchObject({ attempts: [], routingOutcome: 'NOT_CONFIGURED' });
  });
});

describe('environment-driven provider configuration', () => {
  it('uses Sarvam with only its key, the verified contract and unchanged application schema', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => { void _url; void _init; return json(); });
    const router = configuredRequirementsAiProvider({ SARVAM_API_KEY: 'test-only' }, fetcher)!;
    await router.generateStructured(request, validate);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.sarvam.ai/v1/chat/completions');
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'api-subscription-key': 'test-only' });
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: 'sarvam-105b', reasoning_effort: null, stream: false, max_tokens: 4096 });
    expect(body.response_format.json_schema.schema).toEqual(request.schema);
    expect(body.messages[1].content).toContain('RESIDENTIAL');
  });

  it('allows configured fallback when Sarvam key is missing and records fallback use', async () => {
    const router = configuredRequirementsAiProvider({ SARVAM_MODEL: 'sarvam-105b', AI_FALLBACK_A_URL: 'https://a.example/chat', AI_FALLBACK_A_API_KEY: 'test', AI_FALLBACK_A_MODEL: 'a-model', AI_FALLBACK_B_MODEL: 'unused' }, async () => json())!;
    const result = await router.generateStructured(request, validate);
    expect(result.metadata).toEqual({ provider: 'fallback-a', model: 'a-model' });
    expect(result.routingOutcome).toBe('FALLBACK_USED');
  });

  it('allows a deployment with no credentials, even when optional model/URL fields are populated', () => {
    expect(configuredRequirementsAiProvider({ SARVAM_MODEL: 'sarvam-105b', AI_FALLBACK_A_URL: 'https://a.example/chat', AI_FALLBACK_A_MODEL: 'unused' })).toBeNull();
  });

  it('honors explicit ordering and opt-out of credentialed providers', async () => {
    const result = await configuredRequirementsAiProvider({ SARVAM_API_KEY: 'test', AI_FALLBACK_A_URL: 'https://a.example/chat', AI_FALLBACK_A_API_KEY: 'test', AI_FALLBACK_A_MODEL: 'a-model', AI_PROVIDER_ORDER: 'fallback-a' }, async () => json())!.generateStructured(request, validate);
    expect(result.metadata.provider).toBe('fallback-a');
    expect(result.routingOutcome).toBe('PRIMARY_USED');
  });

  it.each([{ AI_PROVIDER_ORDER: 'sarvam,sarvam' }, { AI_PROVIDER_ORDER: 'unknown' }, { AI_PROVIDER_TIMEOUT_MS: 'Infinity' }, { SARVAM_API_KEY: 'test', SARVAM_MODEL: 'guessed-model' }, { AI_FALLBACK_A_API_KEY: 'test' }])('rejects invalid credentialed/operator configuration without disclosing its values', environment => {
    expect(() => configuredRequirementsAiProvider(environment)).toThrow();
  });
});
