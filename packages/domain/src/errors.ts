export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT' | 'PAYLOAD_TOO_LARGE' | 'AI_UNAVAILABLE' | 'AI_PROVIDER_FAILED' | 'AI_INVALID_OUTPUT';
const domainErrorBrand = Symbol.for('property-foundation.DomainError');
const domainErrorCodes = new Set<ErrorCode>(['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INVALID_INPUT', 'PAYLOAD_TOO_LARGE', 'AI_UNAVAILABLE', 'AI_PROVIDER_FAILED', 'AI_INVALID_OUTPUT']);

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    Object.defineProperty(this, domainErrorBrand, { value: true });
  }
}

/** Recognize domain errors created by another copy of the domain module. */
export function isDomainError(error: unknown): error is DomainError {
  if (typeof error !== 'object' || error === null) return false;
  try {
    const code = Reflect.get(error, 'code');
    return Reflect.get(error, domainErrorBrand) === true
      && typeof code === 'string'
      && domainErrorCodes.has(code as ErrorCode)
      && typeof Reflect.get(error, 'message') === 'string';
  } catch {
    return false;
  }
}
