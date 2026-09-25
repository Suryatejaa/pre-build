import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createProjectSchema, emptyPropertyRequirements, normalizeProjectSnapshot, projectSnapshotSchema,
  propertyTypeLabel, propertyTypeSchema, requirementsCompleteness, requirementsMatchProjectType, requirementsWithProjectType,
} from '@property/domain';

describe('canonical property types and legacy snapshots', () => {
  it.each(propertyTypeSchema.options)('accepts %s across creation and requirements context', propertyType => {
    expect(propertyTypeSchema.parse(propertyType)).toBe(propertyType);
    expect(createProjectSchema.parse({ name: 'New project', propertyType }).propertyType).toBe(propertyType);
    const empty = emptyPropertyRequirements();
    const requirements = requirementsWithProjectType(empty, propertyType);
    expect(empty.buildingIntent).toBeNull();
    expect(requirements.buildingIntent).toMatchObject({ value: { kind: propertyType }, provenance: { current: { kind: 'PROJECT_CONTEXT', actorId: null, sourceMessageId: null } } });
    expect(requirementsCompleteness(requirements).blockingItems.map(item => item.key)).not.toContain('buildingIntent');
    expect(propertyTypeLabel(propertyType)).not.toBe(propertyType);
  });
  it('rejects unsupported values and keeps the legacy create alias out of the canonical enum', () => {
    for (const value of ['INDUSTRIAL', 'RESIDENTIAL_HOUSE', '', null, 3]) expect(propertyTypeSchema.safeParse(value).success).toBe(false);
    expect(createProjectSchema.parse({ name: 'Old API client', propertyType: 'RESIDENTIAL_HOUSE' }).propertyType).toBe('RESIDENTIAL');
  });
  it.each([1, 2, 3])('reads legacy V%s unchanged and normalizes only the application representation', schemaVersion => {
    const stored = { schemaVersion, projectId: randomUUID(), name: 'Historical home', propertyType: 'RESIDENTIAL_HOUSE', status: 'ACTIVE',
      ...(schemaVersion >= 2 ? { site: null } : {}), ...(schemaVersion === 3 ? { requirements: emptyPropertyRequirements() } : {}) };
    const original = JSON.stringify(stored);
    expect(projectSnapshotSchema.parse(stored)).toEqual(stored);
    expect(normalizeProjectSnapshot(stored).propertyType).toBe('RESIDENTIAL');
    expect(JSON.stringify(stored)).toBe(original);
    expect(propertyTypeLabel('RESIDENTIAL_HOUSE')).toBe('Independent residential house');
  });
  it('derives a new draft type without altering the previous brief or inventing other requirements', () => {
    const previous = requirementsWithProjectType(emptyPropertyRequirements(), 'RESIDENTIAL');
    const before = structuredClone(previous);
    const next = requirementsWithProjectType(previous, 'MIXED_USE');
    expect(previous).toEqual(before);
    expect(requirementsMatchProjectType(previous, 'MIXED_USE')).toBe(false);
    expect(requirementsMatchProjectType(next, 'MIXED_USE')).toBe(true);
    expect({ ...next, buildingIntent: null }).toEqual({ ...previous, buildingIntent: null });
    expect(requirementsCompleteness(next).blockingItems.map(item => item.key)).toContain('buildingIntent.support');
  });
});
