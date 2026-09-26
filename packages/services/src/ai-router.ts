import type { AiPipelineStage, AiProviderAttempt, AiRoutingOutcome } from '@property/domain';
import { AiInvalidOutputError, AiProviderError, aiValidationIssues, type AiMetadata, type AiUsage, type RequirementsAiProvider, type StructuredAiRequest, type TextAiRequest } from './requirements-ai';

export interface RoutedAiResult<T> {
  output: T;
  metadata: AiMetadata;
  attempts: AiProviderAttempt[];
  routingOutcome: AiRoutingOutcome;
}
export interface RequirementsAiRouter {
  readonly available: boolean;
  generateStructured<T>(request: StructuredAiRequest, validate: (output: unknown) => T): Promise<RoutedAiResult<T>>;
  generateText(request: TextAiRequest): Promise<RoutedAiResult<string>>;
}
export class AiRoutingError extends Error {
  constructor(public readonly attempts: AiProviderAttempt[], public readonly routingOutcome: AiRoutingOutcome) {
    super('AI provider routing failed.'); this.name = 'AiRoutingError';
  }
}

/** Also bounds response-body reads and adapters which fail to honor cancellation. */
export async function withAiTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new AiProviderError('CONFIGURATION');
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(new AiProviderError('TIMEOUT')); };
    timeout = setTimeout(onAbort, timeoutMs);
    if (parent?.aborted) onAbort(); else parent?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    if (controller.signal.aborted) return await deadline;
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timeout);
    if (onAbort) parent?.removeEventListener('abort', onAbort);
  }
}

const fallbackCodes = new Set(['TIMEOUT', 'CONNECTION', 'RATE_LIMIT', 'UNAVAILABLE', 'INVALID_OUTPUT']);
export function aiUsageTotals(attempts: AiProviderAttempt[]) {
  const sum = (key: 'inputTokens' | 'outputTokens') => attempts.some(attempt => attempt[key] !== null)
    ? attempts.reduce((total, attempt) => total + (attempt[key] ?? 0), 0) : null;
  return { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), retryCount: attempts.reduce((total, attempt) => total + attempt.retryCount, 0) };
}

/** Ordered, request-local routing. One repair per provider, no transient retries or cycling. */
export class AiProviderRouter implements RequirementsAiRouter {
  readonly available: boolean;
  private readonly providers: readonly RequirementsAiProvider[];
  constructor(providers: readonly RequirementsAiProvider[], private readonly options: { timeoutMs?: number; primaryProvider?: string } = {}) {
    if (providers.length > 8 || new Set(providers.map(provider => provider.metadata.provider)).size !== providers.length) throw new AiProviderError('CONFIGURATION');
    this.providers = [...providers];
    this.available = providers.length > 0;
  }
  generateStructured<T>(request: StructuredAiRequest, validate: (output: unknown) => T) {
    return this.route(async (provider, signal, repairOutput, repairIssues, onStage) => {
      const result = await provider.generateStructured({ ...request, repairOutput, repairIssues, signal, onStage });
      try { return { output: validate(result.output), usage: result.usage }; }
      catch (error) { throw new AiInvalidOutputError(result.output, result.usage, 'EXTRACTION_SCHEMA', aiValidationIssues(error)); }
    }, true, request.signal);
  }
  generateText(request: TextAiRequest) {
    return this.route(async (provider, signal, _repairOutput, _repairIssues, onStage) => {
      const result = await provider.generateText({ ...request, signal, onStage });
      if (typeof result.text !== 'string' || !result.text.trim()) throw new AiInvalidOutputError(undefined, result.usage);
      return { output: result.text, usage: result.usage };
    }, false, request.signal);
  }
  private async route<T>(run: (provider: RequirementsAiProvider, signal: AbortSignal, repairOutput: unknown, repairIssues: string[], onStage: (stage: AiPipelineStage) => void) => Promise<{ output: T; usage?: AiUsage }>, repair: boolean, signal?: AbortSignal): Promise<RoutedAiResult<T>> {
    const attempts: AiProviderAttempt[] = [];
    for (const [providerIndex, provider] of this.providers.entries()) {
      let repairOutput: unknown;
      let repairIssues: string[] = [];
      for (let retryCount = 0; retryCount <= (repair ? 1 : 0); retryCount++) {
        const started = Date.now();
        let stage: AiPipelineStage = 'PROVIDER_REQUEST';
        const attempt: AiProviderAttempt = { provider: provider.metadata.provider, model: provider.metadata.model, providerIndex,
          occurredAt: new Date(started).toISOString(), succeeded: false, latencyMs: 0, inputTokens: null, outputTokens: null, retryCount, errorCode: null };
        try {
          const result = await withAiTimeout(child => run(provider, child, repairOutput, repairIssues, next => { stage = next; }), this.options.timeoutMs ?? 60000, signal);
          attempts.push({ ...attempt, succeeded: true, latencyMs: Date.now() - started, inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null });
          return { output: result.output, metadata: { ...provider.metadata }, attempts,
            routingOutcome: providerIndex > 0 || (this.options.primaryProvider !== undefined && provider.metadata.provider !== this.options.primaryProvider) ? 'FALLBACK_USED' : 'PRIMARY_USED' };
        } catch (error) {
          const code = error instanceof AiInvalidOutputError ? 'INVALID_OUTPUT' : error instanceof AiProviderError ? error.code : 'UNKNOWN';
          const usage = error instanceof AiInvalidOutputError ? error.usage : undefined;
          attempts.push({ ...attempt, latencyMs: Date.now() - started, errorCode: code, failureStage: error instanceof AiInvalidOutputError ? error.stage : error instanceof AiProviderError ? error.stage ?? stage : stage, ...(error instanceof AiProviderError && error.httpStatus ? { httpStatus: error.httpStatus } : {}), ...(error instanceof AiInvalidOutputError && error.issues.length ? { validationIssues: error.issues } : {}), inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null });
          if (!fallbackCodes.has(code) || signal?.aborted) throw new AiRoutingError(attempts, 'OPERATOR_ERROR');
          if (repair && retryCount === 0 && error instanceof AiInvalidOutputError) { repairOutput = error.output ?? null; repairIssues = error.issues; continue; }
          break;
        }
      }
    }
    throw new AiRoutingError(attempts, this.available ? 'ALL_PROVIDERS_FAILED' : 'NOT_CONFIGURED');
  }
}
