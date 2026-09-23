import type { MemberRole, Page, Principal, ProjectMember, ProjectRole, ProjectVersion, PropertyProject } from '@property/domain';

export interface AuthorizedProject { project: PropertyProject; role: ProjectRole }
export interface AuditEntry {
  id: string; projectId: string; projectVersionId: string; actorId: string;
  action: 'PROJECT_CREATED' | 'PROJECT_UPDATED' | 'MEMBER_ASSIGNED' | 'MEMBER_REMOVED';
  before: unknown; after: unknown; source: 'HUMAN';
}
export interface ProjectRepository {
  list(actor: Principal, page: number): Promise<Page<AuthorizedProject>>;
  find(actor: Principal, projectId: string, lock?: boolean): Promise<AuthorizedProject | null>;
  create(project: PropertyProject): Promise<void>;
  appendVersion(project: PropertyProject, expectedRevision: number): Promise<void>;
  versions(projectId: string, page: number): Promise<Page<ProjectVersion>>;
  version(projectId: string, versionId: string): Promise<ProjectVersion | null>;
  members(project: PropertyProject): Promise<ProjectMember[]>;
  userExists(userId: string): Promise<boolean>;
  member(projectId: string, userId: string): Promise<{ role: MemberRole } | null>;
  assignMember(projectId: string, userId: string, role: MemberRole, actorId: string): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}
export interface ProjectUnitOfWork {
  read: ProjectRepository;
  transaction<T>(work: (repository: ProjectRepository) => Promise<T>): Promise<T>;
}
