import { z } from 'zod';

/** Future storage ingestion result, never accepted from a browser as proof of upload or safety. */
export const siteAttachmentSchema = z.strictObject({
  id: z.uuid(), projectId: z.uuid(), projectVersionId: z.uuid(), objectKey: z.uuid(),
  originalFilename: z.string().min(1).max(255).refine(v => !/[\x00-\x1f/\\]/.test(v), 'Use a filename without paths or control characters.'),
  detectedMimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  category: z.enum(['SALE_DEED', 'SURVEY_SKETCH', 'LAYOUT_DOCUMENT', 'SITE_PHOTOGRAPH', 'OTHER']),
  uploadedBy: z.uuid(), uploadedAt: z.iso.datetime(),
  safetyStatus: z.literal('UNSCANNED'),
});
export type SiteAttachment = z.infer<typeof siteAttachmentSchema>;
/** Metadata contract only; no upload, file verification or authorization bypass is implied. */
export interface SiteAttachmentRepository {
  listForVersion(projectId: string, projectVersionId: string): Promise<SiteAttachment[]>;
}
