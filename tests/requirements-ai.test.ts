import { describe, expect, it, vi } from 'vitest';
import { AiInvalidOutputError } from '@property/services';
import { OpenAiCompatibleRequirementsProvider, configuredRequirementsAiProvider } from '@property/infrastructure/requirements-ai';

const response = { assistantMessage: 'I recorded the requested floors.', extractions: [], followUpQuestions: [], siteClaims: [], explicitCorrection: false };

describe('provider adapter boundary', () => {
  it('sends schema-constrained requests and records provider usage without a live call', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { void url; void init; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }], usage: { prompt_tokens: 50, completion_tokens: 22 } }), { status: 200 }); });
    const provider = new OpenAiCompatibleRequirementsProvider({ endpoint: 'https://ai.example/v1/chat/completions', apiKey: 'test-only-secret', model: 'fake-model' }, fetcher);
    const result = await provider.generateStructured({ systemPrompt: 'safe intake', input: { ownerMessage: 'G+1' }, schemaName: 'requirements_turn', schema: { type: 'object', additionalProperties: false } });
    expect(result.output).toEqual(response);
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 22 });
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(sent.response_format.json_schema).toMatchObject({ name: 'requirements_turn', strict: true, schema: { type: 'object' } });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer test-only-secret' });
  });

  it('rejects malformed model output and reports provider failures with a generic error', async () => {
    const malformed = new OpenAiCompatibleRequirementsProvider({ endpoint: 'https://ai.example/v1', apiKey: 'test', model: 'fake' }, async () => new Response(JSON.stringify({ choices: [{ message: { content: '{bad json' } }] }), { status: 200 }));
    await expect(malformed.generateStructured({ systemPrompt: 'safe', input: {}, schemaName: 'turn', schema: {} })).rejects.toBeInstanceOf(AiInvalidOutputError);
    const unavailable = new OpenAiCompatibleRequirementsProvider({ endpoint: 'https://ai.example/v1', apiKey: 'test', model: 'fake' }, async () => new Response('private provider error body', { status: 500 }));
    await expect(unavailable.generateText({ systemPrompt: 'safe', input: {} })).rejects.toThrow('AI provider request failed.');
  });

  it('skips uncredentialed slots and validates credentialed configuration', () => {
    expect(configuredRequirementsAiProvider({ NODE_ENV: 'test' })).toBeNull();
    expect(configuredRequirementsAiProvider({ NODE_ENV: 'test', AI_PROVIDER_URL: 'https://ai.example/v1' })).toBeNull();
    expect(configuredRequirementsAiProvider({ NODE_ENV: 'test', AI_PROVIDER_URL: 'http://localhost:1234/v1', AI_PROVIDER_API_KEY: 'test', AI_PROVIDER_MODEL: 'fake' })).not.toBeNull();
    expect(() => configuredRequirementsAiProvider({ NODE_ENV: 'production', AI_PROVIDER_URL: 'http://ai.example/v1', AI_PROVIDER_API_KEY: 'test', AI_PROVIDER_MODEL: 'model' })).toThrow('must use HTTPS');
  });
});
