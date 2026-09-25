import { z } from 'zod';

/** The project's authoritative high-level type; also used by Requirements. */
export const propertyTypeSchema = z.enum(['RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'OTHER']);
export type PropertyType = z.infer<typeof propertyTypeSchema>;

/** Legacy storage and deprecated create-input compatibility. Historical snapshots are parsed without rewriting their values. */
export const storedPropertyTypeSchema = z.union([propertyTypeSchema, z.literal('RESIDENTIAL_HOUSE')]);
export type StoredPropertyType = z.infer<typeof storedPropertyTypeSchema>;
export function normalizePropertyType(value: StoredPropertyType): PropertyType {
  return value === 'RESIDENTIAL_HOUSE' ? 'RESIDENTIAL' : value;
}
export const propertyTypeLabels: Record<PropertyType, string> = {
  RESIDENTIAL: 'Independent residential house',
  COMMERCIAL: 'Commercial property',
  MIXED_USE: 'Mixed-use property',
  OTHER: 'Other property',
};
export function propertyTypeLabel(value: StoredPropertyType): string {
  return propertyTypeLabels[normalizePropertyType(value)];
}
