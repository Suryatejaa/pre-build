import type { AiRequestRecord, InterviewMessage, MemberRole, Page, Principal, ProjectMember, ProjectRole, ProjectVersion, PropertyProject, RequirementsInterview } from '@property/domain';

export interface AuthorizedProject { project: PropertyProject; role: ProjectRole }
export interface AuditEntry {
  id: string; projectId: string; projectVersionId: string; actorId: string;
  action: 'PROJECT_CREATED' | 'PROJECT_UPDATED' | 'MEMBER_ASSIGNED' | 'MEMBER_REMOVED' | 'REQUIREMENTS_INTERVIEW_STARTED' | 'REQUIREMENTS_MANUALLY_EDITED' | 'REQUIREMENTS_CONFLICT_RESOLVED' | 'REQUIREMENTS_APPROVED' | 'REQUIREMENTS_INTERVIEW_REOPENED';
  before: unknown; after: unknown; source: 'HUMAN' | 'AI' | 'SYSTEM';
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

export interface RequirementsRepository extends ProjectRepository {
  interview(projectId: string): Promise<RequirementsInterview | null>;
  createInterview(interview: Omit<RequirementsInterview, 'messages'>): Promise<void>;
  saveInterview(interview: Omit<RequirementsInterview, 'messages'>): Promise<void>;
  appendInterviewMessage(message: InterviewMessage): Promise<void>;
  recordAiRequest(request: AiRequestRecord): Promise<void>;
}
export interface RequirementsUnitOfWork {
  read: RequirementsRepository;
  transaction<T>(work: (repository: RequirementsRepository) => Promise<T>): Promise<T>;
}
