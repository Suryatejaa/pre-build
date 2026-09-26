import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiProviderRouter, parseRequirementsExtraction, requirementsAiResponseSchema } from '@property/services';
import { configuredRequirementsAiProvider, SarvamRequirementsProvider } from '@property/infrastructure/requirements-ai';
import { richExtraction, richOwnerMessage } from './requirements-rich-fixture';

const request = { systemPrompt: 'Strict requirements intake', input: { ownerMessage: richOwnerMessage, propertyType: 'RESIDENTIAL' }, schemaName: 'requirements_turn', schema: z.toJSONSchema(requirementsAiResponseSchema) };
const response = (output: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 661, completion_tokens: 1500 } }));
afterEach(() => { vi.useRealTimers(); });

describe('rich-message reliability', () => {
  it('reproduces the old 20-second deadline with the exact message and allows the same 35-second response under the corrected finite default', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 35000)); return response(richExtraction); });
    const old = new AiProviderRouter([new SarvamRequirementsProvider({ apiKey: 'test', timeoutMs: 20000 }, fetcher)], { timeoutMs: 20000 });
    const rejected = expect(old.generateStructured(request, parseRequirementsExtraction)).rejects.toMatchObject({ attempts: [{ failureStage: 'PROVIDER_REQUEST', errorCode: 'TIMEOUT', retryCount: 0 }] });
    await vi.advanceTimersByTimeAsync(20001); await rejected;
    const current = configuredRequirementsAiProvider({ SARVAM_API_KEY: 'test' }, fetcher)!;
    const pending = current.generateStructured(request, parseRequirementsExtraction);
    await vi.advanceTimersByTimeAsync(35001);
    expect((await pending).output.response.extractions).toEqual(richExtraction.extractions);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('still aborts at the finite default deadline', async () => {
    vi.useFakeTimers();
    const provider = configuredRequirementsAiProvider({ SARVAM_API_KEY: 'test' }, async () => new Promise<Response>(() => {}))!;
    const rejected = expect(provider.generateStructured(request, parseRequirementsExtraction)).rejects.toMatchObject({ attempts: [{ latencyMs: 60000, errorCode: 'TIMEOUT' }] });
    await vi.advanceTimersByTimeAsync(60001); await rejected;
  });

  it('preserves valid facts when cosmetic assistant text is unusable', () => {
    const result = parseRequirementsExtraction({ ...richExtraction, assistantMessage: null, followUpQuestions: ['x'.repeat(900)] });
    expect(result.response.extractions).toEqual(richExtraction.extractions);
    expect(result.textRecovered).toBe(true);
    expect(() => requirementsAiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('never relaxes extraction fields or unknown-field rejection to recover prose', () => {
    expect(() => parseRequirementsExtraction({ ...richExtraction, assistantMessage: null, hidden: 'spoof' })).toThrow();
    expect(() => parseRequirementsExtraction({ ...richExtraction, extractions: [{ category: 'FLOOR_COUNT', count: { exact: 'three' } }] })).toThrow();
  });

  it('distinguishes malformed JSON from schema failures and supplies safe field-specific repair feedback', async () => {
    const calls: RequestInit[] = [];
    const fetcher = vi.fn(async (_url, init) => { calls.push(init!); return response({ ...richExtraction, extractions: [{ ...richExtraction.extractions[0], count: { exact: 'secret-invalid-value' } }] }); });
    const router = new AiProviderRouter([new SarvamRequirementsProvider({ apiKey: 'test' }, fetcher)]);
    const error = await router.generateStructured(request, parseRequirementsExtraction).catch(error => error);
    expect(error.attempts).toHaveLength(2);
    expect(error.attempts[1]).toMatchObject({ retryCount: 1, failureStage: 'EXTRACTION_SCHEMA', validationIssues: ['extractions.0.count.exact:invalid_type'] });
    expect(JSON.stringify(error.attempts)).not.toContain('secret-invalid-value');
    expect(String(calls[1]?.body)).toContain('extractions.0.count.exact:invalid_type');
    const malformed = new AiProviderRouter([new SarvamRequirementsProvider({ apiKey: 'test' }, async () => new Response(JSON.stringify({ choices: [{ message: { content: '{bad' } }] })))]);
    await expect(malformed.generateStructured(request, parseRequirementsExtraction)).rejects.toMatchObject({ attempts: [{ failureStage: 'JSON_PARSE' }, { failureStage: 'JSON_PARSE' }] });
  });
});
