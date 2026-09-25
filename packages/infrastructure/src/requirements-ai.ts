import type { RequirementsAiProvider, StructuredAiRequest, TextAiRequest } from '@property/services';
import { AiInvalidOutputError, AiUnavailableError } from '@property/services';

export interface AiProviderConfig { endpoint: string; apiKey: string; model: string; timeoutMs?: number }

/** Adapter for APIs that implement the OpenAI Chat Completions JSON-schema response format. */
export class OpenAiCompatibleRequirementsProvider implements RequirementsAiProvider {
  readonly metadata: { provider: string; model: string };
  constructor(private readonly config: AiProviderConfig, private readonly fetcher: typeof fetch = fetch) {
    this.metadata = { provider: 'openai-compatible', model: config.model };
  }
  private async complete(messages: { role: 'system' | 'user'; content: string }[], format?: { name: string; schema: Record<string, unknown> }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 20000);
    try {
      const response = await this.fetcher(this.config.endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, messages, ...(format ? { response_format: { type: 'json_schema', json_schema: { name: format.name, strict: true, schema: format.schema } } } : {}) }),
      });
      if (!response.ok) throw new Error('AI provider request failed.');
      const body = await response.json() as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new AiInvalidOutputError(content);
      return { content, usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens } };
    } finally { clearTimeout(timeout); }
  }
  async generateStructured(request: StructuredAiRequest) {
    if (!this.config.apiKey.trim() || !this.config.endpoint.trim() || !this.config.model.trim()) throw new AiUnavailableError();
    const repair = request.repairOutput === undefined ? '' : `\nThe previous output was invalid. Correct it to match the schema. Invalid output: ${JSON.stringify(request.repairOutput).slice(0, 12000)}`;
    const result = await this.complete([
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: `${JSON.stringify(request.input)}${repair}` },
    ], { name: request.schemaName, schema: request.schema });
    try { return { output: JSON.parse(result.content) as unknown, usage: result.usage }; }
    catch { throw new AiInvalidOutputError(result.content); }
  }
  async generateText(request: TextAiRequest) {
    if (!this.config.apiKey.trim() || !this.config.endpoint.trim() || !this.config.model.trim()) throw new AiUnavailableError();
    const result = await this.complete([{ role: 'system', content: request.systemPrompt }, { role: 'user', content: JSON.stringify(request.input) }]);
    return { text: result.content, usage: result.usage };
  }
}

export function configuredRequirementsAiProvider(environment: NodeJS.ProcessEnv = process.env): RequirementsAiProvider | null {
  const endpoint = environment.AI_PROVIDER_URL?.trim();
  const apiKey = environment.AI_PROVIDER_API_KEY?.trim();
  const model = environment.AI_PROVIDER_MODEL?.trim();
  if (!endpoint && !apiKey && !model) return null;
  if (!endpoint || !apiKey || !model) throw new Error('Configure AI_PROVIDER_URL, AI_PROVIDER_API_KEY, and AI_PROVIDER_MODEL together.');
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:' && environment.NODE_ENV === 'production') throw new Error('AI_PROVIDER_URL must use HTTPS in production.');
  return new OpenAiCompatibleRequirementsProvider({ endpoint: parsed.toString(), apiKey, model });
}
