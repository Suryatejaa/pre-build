import { z } from 'zod';
import { propertyTypeSchema, storedPropertyTypeSchema, normalizePropertyType, type StoredPropertyType } from './property-type';
import { siteSchema, type Site } from './site';
import { propertyRequirementsSchema, type PropertyRequirements } from './requirements';

export const idSchema = z.uuid();
export const projectNameSchema = z.string().trim().min(2, 'Use at least 2 characters.').max(120);
export const projectStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const createProjectSchema = z.strictObject({
  name: projectNameSchema,
  // Retain the original create API spelling as a deprecated input alias.
  propertyType: storedPropertyTypeSchema.transform(normalizePropertyType).default('RESIDENTIAL'),
});
export const updateProjectSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  name: projectNameSchema.optional(),
  status: projectStatusSchema.optional(),
  propertyType: propertyTypeSchema.optional(),
  changeReason: z.string().trim().min(5, 'Briefly explain this change (at least 5 characters).').max(500),
}).refine(value => value.name !== undefined || value.status !== undefined || value.propertyType !== undefined, 'Provide a project change.');

/** Canonical versioned data. Extend through explicit schema migrations, never opaque AI blobs. */
export const projectSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: idSchema,
  name: projectNameSchema,
  propertyType: storedPropertyTypeSchema,
  status: projectStatusSchema,
});
export const projectSnapshotV2Schema = projectSnapshotV1Schema.extend({ schemaVersion: z.literal(2), site: siteSchema.nullable() });
export const projectSnapshotV3Schema = projectSnapshotV2Schema.extend({ schemaVersion: z.literal(3), requirements: propertyRequirementsSchema });
export const projectSnapshotSchema = z.union([projectSnapshotV1Schema, projectSnapshotV2Schema, projectSnapshotV3Schema]);
/** Read-time normalization only. Stored V1 history and metadata-only writes remain V1. */
export function normalizeProjectSnapshot(input: unknown) {
  const snapshot = projectSnapshotSchema.parse(input);
  const current = { ...snapshot, propertyType: normalizePropertyType(snapshot.propertyType) };
  return current.schemaVersion === 1 ? { ...current, schemaVersion: 2 as const, site: null } : current;
}
/** Explicitly creates the first requirements-bearing snapshot; historical snapshots stay unchanged. */
export function withRequirements(input: unknown, requirements: PropertyRequirements) {
  const snapshot = normalizeProjectSnapshot(input);
  return projectSnapshotV3Schema.parse({ ...snapshot, schemaVersion: 3, requirements });
}
export interface ProjectVersionView extends Omit<ProjectVersion, 'snapshot'> {
  snapshot: { schemaVersion: 1 | 2 | 3; projectId: string; name: string; propertyType: StoredPropertyType; status: 'ACTIVE' | 'ARCHIVED'; site?: Site | null; requirements?: PropertyRequirements };
  redactedFields?: string[];
}
export const paginationSchema = z.strictObject({ page: z.coerce.number().int().min(1).max(10000).default(1) });
export const PAGE_SIZE = 20;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;
export type ChangeSource = 'HUMAN' | 'AI' | 'SYSTEM';

export interface ProjectVersion {
  id: string;
  projectId: string;
  revision: number;
  snapshot: ProjectSnapshot;
  createdBy: string;
  createdAt: string;
  source: ChangeSource;
  changeReason: string;
}
export interface PropertyProject {
  id: string;
  ownerUserId: string;
  currentRevision: number;
  currentVersion: ProjectVersion;
  createdAt: string;
  updatedAt: string;
}
export interface Page<T> { items: T[]; nextPage: number | null }

/** A stable reference for future artifacts/jobs; no geometry or generation implementation. */
export interface ProjectVersionReference { projectId: string; projectVersionId: string; schemaVersion: number }
