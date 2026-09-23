export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT' | 'PAYLOAD_TOO_LARGE';
export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); this.name = 'DomainError'; }
}
