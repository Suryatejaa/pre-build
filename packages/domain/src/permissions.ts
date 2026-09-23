import { z } from 'zod';
import { DomainError } from './errors';
import { idSchema } from './project';

export const roleSchema = z.enum(['OWNER', 'CONTRACTOR_VIEWER', 'CONTRACTOR_CONTRIBUTOR', 'PROFESSIONAL']);
export const memberRoleSchema = roleSchema.exclude(['OWNER']);
export const assignMemberSchema = z.strictObject({ userId: idSchema, role: memberRoleSchema });
export type ProjectRole = z.infer<typeof roleSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export type Permission = 'project:read' | 'project:edit' | 'versions:read' | 'members:manage' | 'site:read';
const permissions: Readonly<Record<ProjectRole, readonly Permission[]>> = {
  OWNER: ['project:read', 'project:edit', 'versions:read', 'members:manage', 'site:read'],
  PROFESSIONAL: ['project:read', 'versions:read'],
  CONTRACTOR_VIEWER: ['project:read'],
  CONTRACTOR_CONTRIBUTOR: ['project:read'],
};
export function can(role: ProjectRole, permission: Permission): boolean { return permissions[role].includes(permission); }
export function requirePermission(role: ProjectRole, permission: Permission): void {
  if (!can(role, permission)) throw new DomainError('FORBIDDEN', 'You do not have permission to do this.');
}
export interface Principal { userId: string }
export interface ProjectMember { userId: string; name: string; role: ProjectRole; joinedAt: string }
