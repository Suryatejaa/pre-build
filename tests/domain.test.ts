import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assignMemberSchema, can, createProjectSchema, projectSnapshotSchema, requirePermission, updateProjectSchema } from '@property/domain';

describe('canonical project validation', () => {
  it('normalizes names and limits the supported property scope', () => {
    expect(createProjectSchema.parse({ name: '  Our home  ' })).toEqual({ name: 'Our home', propertyType: 'RESIDENTIAL' });
    expect(createProjectSchema.safeParse({ name: 'Office', propertyType: 'INDUSTRIAL' }).success).toBe(false);
  });
  it('rejects unknown fields and forged owner, revision, and AI provenance', () => {
    for (const additional of [{ ownerUserId: randomUUID() }, { source: 'AI' }, { revision: 44 }]) {
      expect(createProjectSchema.safeParse({ name: 'Our home', ...additional }).success).toBe(false);
    }
  });
  it('requires explicit concurrency and a meaningful change reason', () => {
    expect(updateProjectSchema.safeParse({ name: 'New name' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ name: 'New name', expectedRevision: 1, changeReason: '' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ expectedRevision: 1, changeReason: 'No changes' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ expectedRevision: 1.3, name: 'New name', changeReason: 'Rename project' }).success).toBe(false);
  });
  it('rejects unknown snapshot versions and unsupported future data', () => {
    const data = { schemaVersion: 1, projectId: randomUUID(), name: 'House', propertyType: 'RESIDENTIAL_HOUSE', status: 'ACTIVE' };
    expect(projectSnapshotSchema.safeParse(data).success).toBe(true);
    expect(projectSnapshotSchema.safeParse({ ...data, schemaVersion: 2 }).success).toBe(false);
    expect(projectSnapshotSchema.safeParse({ ...data, budget: 25 }).success).toBe(false);
    expect(projectSnapshotSchema.safeParse({ ...data, projectId: 'My House' }).success).toBe(false);
  });
});
describe('project permission matrix', () => {
  it.each(['CONTRACTOR_VIEWER', 'CONTRACTOR_CONTRIBUTOR', 'PROFESSIONAL'] as const)('prevents %s from editing or granting access', role => {
    expect(can(role, 'project:read')).toBe(true);
    expect(() => requirePermission(role, 'project:edit')).toThrow('permission');
    expect(() => requirePermission(role, 'members:manage')).toThrow('permission');
  });
  it('keeps draft history out of contractor access', () => {
    expect(can('CONTRACTOR_CONTRIBUTOR', 'versions:read')).toBe(false);
    expect(can('CONTRACTOR_VIEWER', 'versions:read')).toBe(false);
    expect(can('PROFESSIONAL', 'versions:read')).toBe(true);
    expect(can('OWNER', 'members:manage')).toBe(true);
  });
  it('does not permit granting the owner role through membership assignment', () => {
    expect(assignMemberSchema.safeParse({ userId: randomUUID(), role: 'OWNER' }).success).toBe(false);
  });
});
