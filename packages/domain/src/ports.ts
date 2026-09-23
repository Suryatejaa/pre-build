import type { Principal } from './permissions';
import type { ProjectVersionReference } from './project';

/** Application services receive Principal, never provider cookies or provider user objects. */
export interface AuthenticationProvider {
  authenticate(headers: Headers): Promise<Principal | null>;
}

export interface StoredObject { key: string; size: number; sha256: string }
/** Keys are opaque references, never public URLs or user-provided file paths. Authorization belongs in the caller. */
export interface ObjectStorage {
  put(bytes: Uint8Array): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/** Contract only. Future consumers must enqueue through a transactional outbox after authorization/payment. */
export interface JobRequest<TPayload extends Record<string, unknown>> {
  id: string;
  type: string;
  input: ProjectVersionReference;
  requestedBy: string;
  idempotencyKey: string;
  payload: TPayload;
}
export interface JobQueue {
  enqueue<TPayload extends Record<string, unknown>>(request: JobRequest<TPayload>): Promise<{ jobId: string }>;
}
