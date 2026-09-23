import { z } from 'zod';
import {
  assignMemberSchema, createProjectSchema, DomainError, idSchema, paginationSchema,
  projectSnapshotSchema, requirePermission, updateProjectSchema, normalizeProjectSnapshot, buildSite, siteFactsSchema, stableJson,
  type ProjectSnapshot, type ProjectVersion, type ProjectVersionView,
  type Principal, type PropertyProject, type ProjectRole,
} from '@property/domain';
import type { AuthorizedProject, ProjectRepository, ProjectUnitOfWork } from './repository';

export interface ProjectSummary {
  id: string; name: string; propertyType: 'RESIDENTIAL_HOUSE'; status: 'ACTIVE' | 'ARCHIVED';
  revision: number; versionId: string; role: ProjectRole; createdAt: string; updatedAt: string;
}
/** Explicit allowlist: adding private data to a snapshot must never expose it through project listings. */
function summary({ project, role }: AuthorizedProject): ProjectSummary {
  return {
    id: project.id, name: project.currentVersion.snapshot.name,
    propertyType: project.currentVersion.snapshot.propertyType, status: project.currentVersion.snapshot.status,
    revision: project.currentRevision, versionId: project.currentVersion.id, role,
    createdAt: project.createdAt, updatedAt: project.updatedAt,
  };
}
const saveSiteSchema = z.strictObject({ expectedRevision: z.number().int().positive(),
  changeReason: z.string().trim().min(5).max(500), site: siteFactsSchema });
function versionView(version: ProjectVersion, role: ProjectRole): ProjectVersionView {
  if (role === 'OWNER' || version.snapshot.schemaVersion === 1) return version;
  const { schemaVersion, projectId, name, propertyType, status } = version.snapshot;
  return { ...version, snapshot: { schemaVersion, projectId, name, propertyType, status },
    changeReason: 'Project record updated (private site details omitted)', redactedFields: ['site', 'changeReason'] };
}
export class ProjectService {
  constructor(private readonly uow: ProjectUnitOfWork, private readonly id: () => string, private readonly now: () => Date) {}

  private async authorized(repo: ProjectRepository, actor: Principal, projectId: string, lock = false) {
    idSchema.parse(actor.userId);
    idSchema.parse(projectId);
    const value = await repo.find(actor, projectId, lock);
    // Same answer for inaccessible and missing projects, to avoid ID enumeration.
    if (!value) throw new DomainError('NOT_FOUND', 'Project not found.');
    return value;
  }

  async list(actor: Principal, input: unknown = {}) {
    idSchema.parse(actor.userId);
    const { page } = paginationSchema.parse(input);
    const result = await this.uow.read.list(actor, page);
    return { ...result, items: result.items.map(summary) };
  }
  async get(actor: Principal, projectId: string) {
    return summary(await this.authorized(this.uow.read, actor, projectId));
  }
  async create(actor: Principal, input: unknown) {
    idSchema.parse(actor.userId);
    const data = createProjectSchema.parse(input);
    const projectId = this.id();
    const timestamp = this.now().toISOString();
    const project: PropertyProject = {
      id: projectId, ownerUserId: actor.userId, currentRevision: 1, createdAt: timestamp, updatedAt: timestamp,
      currentVersion: {
        id: this.id(), projectId, revision: 1, createdBy: actor.userId, createdAt: timestamp,
        source: 'HUMAN', changeReason: 'Project created',
        snapshot: projectSnapshotSchema.parse({ schemaVersion: 1, projectId, ...data, status: 'ACTIVE' }),
      },
    };
    await this.uow.transaction(async repo => {
      await repo.create(project);
      await repo.audit({ id: this.id(), projectId, projectVersionId: project.currentVersion.id, actorId: actor.userId,
        action: 'PROJECT_CREATED', before: null, after: project.currentVersion.snapshot, source: 'HUMAN' });
    });
    return summary({ project, role: 'OWNER' });
  }
  async update(actor: Principal, projectId: string, input: unknown) {
    const change = updateProjectSchema.parse(input);
    return this.uow.transaction(async repo => {
      const { project, role } = await this.authorized(repo, actor, projectId, true);
      requirePermission(role, 'project:edit');
      if (project.currentRevision !== change.expectedRevision) throw new DomainError('CONFLICT', 'This project changed since you opened it. Reload before saving.');
      const before = project.currentVersion.snapshot;
      const after = projectSnapshotSchema.parse({ ...before, name: change.name ?? before.name, status: change.status ?? before.status });
      if (after.name === before.name && after.status === before.status) return summary({ project, role });
      const updated = await this.commitVersion(repo, actor, project, after, change.changeReason);
      return summary({ project: updated, role });
    });
  }
  private async commitVersion(repo: ProjectRepository, actor: Principal, project: PropertyProject, after: ProjectSnapshot, reason: string) {
    const timestamp = this.now().toISOString();
    const updated: PropertyProject = { ...project, currentRevision: project.currentRevision + 1, updatedAt: timestamp,
      currentVersion: { id: this.id(), projectId: project.id, revision: project.currentRevision + 1, snapshot: after,
        createdAt: timestamp, createdBy: actor.userId, source: 'HUMAN', changeReason: reason } };
    await repo.appendVersion(updated, project.currentRevision);
    await repo.audit({ id: this.id(), projectId: project.id, projectVersionId: updated.currentVersion.id, actorId: actor.userId,
      action: 'PROJECT_UPDATED', before: project.currentVersion.snapshot, after, source: 'HUMAN' });
    return updated;
  }
  async site(actor: Principal, projectId: string) {
    const { project, role } = await this.authorized(this.uow.read, actor, projectId);
    requirePermission(role, 'site:read');
    return { projectId, revision: project.currentRevision, versionId: project.currentVersion.id,
      site: normalizeProjectSnapshot(project.currentVersion.snapshot).site };
  }
  async saveSite(actor: Principal, projectId: string, input: unknown) {
    return this.uow.transaction(async repo => {
      const { project, role } = await this.authorized(repo, actor, projectId, true);
      requirePermission(role, 'project:edit');
      const change = saveSiteSchema.parse(input);
      if (project.currentRevision !== change.expectedRevision) throw new DomainError('CONFLICT', 'This project changed since you opened it. Reload before saving.');
      const before = normalizeProjectSnapshot(project.currentVersion.snapshot);
      const site = buildSite(change.site);
      const updated = stableJson(before.site) === stableJson(site) ? project
        : await this.commitVersion(repo, actor, project, projectSnapshotSchema.parse({ ...before, site }), change.changeReason);
      return { projectId, revision: updated.currentRevision, versionId: updated.currentVersion.id, site };
    });
  }
  async versions(actor: Principal, projectId: string, input: unknown = {}) {
    const { page } = paginationSchema.parse(input);
    const { role } = await this.authorized(this.uow.read, actor, projectId);
    requirePermission(role, 'versions:read');
    const result = await this.uow.read.versions(projectId, page);
    return { ...result, items: result.items.map(version => versionView(version, role)) };
  }
  async version(actor: Principal, projectId: string, versionId: string) {
    idSchema.parse(versionId);
    const { role } = await this.authorized(this.uow.read, actor, projectId);
    requirePermission(role, 'versions:read');
    const version = await this.uow.read.version(projectId, versionId);
    if (!version) throw new DomainError('NOT_FOUND', 'Version not found.');
    return versionView(version, role);
  }
  async members(actor: Principal, projectId: string) {
    const { project, role } = await this.authorized(this.uow.read, actor, projectId);
    requirePermission(role, 'members:manage');
    return this.uow.read.members(project);
  }
  async assignMember(actor: Principal, projectId: string, input: unknown) {
    const member = assignMemberSchema.parse(input);
    return this.uow.transaction(async repo => {
      const { project, role } = await this.authorized(repo, actor, projectId, true);
      requirePermission(role, 'members:manage');
      if (member.userId === project.ownerUserId) throw new DomainError('INVALID_INPUT', 'Project ownership cannot be changed here.');
      if (!await repo.userExists(member.userId)) throw new DomainError('INVALID_INPUT', 'No account matches that account ID.');
      const before = await repo.member(projectId, member.userId);
      if (before?.role === member.role) return;
      await repo.assignMember(projectId, member.userId, member.role, actor.userId);
      await repo.audit({ id: this.id(), projectId, projectVersionId: project.currentVersion.id, actorId: actor.userId,
        action: 'MEMBER_ASSIGNED', before: before ? { userId: member.userId, ...before } : null, after: member, source: 'HUMAN' });
    });
  }
  async removeMember(actor: Principal, projectId: string, userId: string) {
    idSchema.parse(userId);
    return this.uow.transaction(async repo => {
      const { project, role } = await this.authorized(repo, actor, projectId, true);
      requirePermission(role, 'members:manage');
      if (userId === project.ownerUserId) throw new DomainError('INVALID_INPUT', 'The project owner cannot be removed.');
      const before = await repo.member(projectId, userId);
      if (!before) return;
      await repo.removeMember(projectId, userId);
      await repo.audit({ id: this.id(), projectId, projectVersionId: project.currentVersion.id, actorId: actor.userId,
        action: 'MEMBER_REMOVED', before: { userId, ...before }, after: null, source: 'HUMAN' });
    });
  }
}
