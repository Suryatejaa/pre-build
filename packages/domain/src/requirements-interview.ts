import { z } from 'zod';
import { idSchema } from './project';
import { propertyRequirementsSchema, requirementConflictSchema, type PropertyRequirements, type RequirementCompletenessItem } from './requirements';

export const interviewStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'REVIEW_REQUIRED', 'APPROVED', 'SUPERSEDED']);
export const interviewMessageSchema = z.strictObject({
  id: idSchema,
  interviewId: idSchema,
  role: z.enum(['OWNER', 'ASSISTANT']),
  content: z.string().min(1).max(4000),
  createdAt: z.string().datetime(),
  provider: z.string().max(80).nullable(),
  model: z.string().max(160).nullable(),
});
export const siteDiscrepancySchema = z.strictObject({
  id: idSchema,
  field: z.enum(['facing', 'declaredArea', 'calculatedArea', 'location', 'roads', 'condition']),
  savedValue: z.string().max(240),
  statedValue: z.string().max(240),
  sourceMessageId: idSchema,
  status: z.enum(['OPEN', 'RESOLVED']),
  resolution: z.string().trim().min(1).max(500).nullable(),
});
export const interviewCandidateSchema = z.strictObject({
  requirements: propertyRequirementsSchema,
  questions: z.array(z.string().trim().min(1).max(500)).max(12),
  conflicts: z.array(requirementConflictSchema).max(100),
  siteDiscrepancies: z.array(siteDiscrepancySchema).max(30),
  lastAiError: z.enum(['AI_UNAVAILABLE', 'AI_PROVIDER_FAILED', 'AI_INVALID_OUTPUT']).nullable(),
  lastOwnerMessageId: idSchema.nullable(),
});
export type InterviewStatus = z.infer<typeof interviewStatusSchema>;
export type InterviewMessage = z.infer<typeof interviewMessageSchema>;
export type SiteDiscrepancy = z.infer<typeof siteDiscrepancySchema>;
export type InterviewCandidate = z.infer<typeof interviewCandidateSchema>;
export interface RequirementsInterview {
  id: string;
  projectId: string;
  ownerId: string;
  status: InterviewStatus;
  candidate: InterviewCandidate;
  expectedProjectRevision: number;
  approvedProjectVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: InterviewMessage[];
}
export interface AiRequestRecord {
  id: string;
  interviewId: string;
  provider: string;
  model: string;
  requestType: 'INTERPRET_OWNER_MESSAGE' | 'GENERATE_FOLLOW_UP';
  occurredAt: string;
  succeeded: boolean;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  retryCount: number;
}
export interface RequirementsInterviewView {
  projectId: string;
  projectRevision: number;
  versionId: string;
  status: InterviewStatus;
  siteContext: {
    location: { locality?: string; district?: string; region?: string; country?: string };
    declaredArea: { value: string; unit: string } | null;
    calculatedArea: { value: string; unit: string } | null;
    boundary: { kind: string | null; vertices: number; width: { value: string; unit: string } | null; depth: { value: string; unit: string } | null; edges: { label: string; length: { value: number; unit: 'mm' } }[] } | null;
    orientation: { facing?: string; northAngleMilliDegrees?: number; frontEdgeLabel?: string };
    roads: { name: string | null; category: string | null; edgeLabel: string; width: { value: string; unit: string } | null; primaryAccess: boolean }[];
    condition: { status: string };
  } | null;
  approvedRequirements: PropertyRequirements | null;
  interview: RequirementsInterview | null;
  completeness: { complete: boolean; items: RequirementCompletenessItem[]; blockingItems: RequirementCompletenessItem[] } | null;
}
