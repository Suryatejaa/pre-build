import { z } from 'zod';
import { propertyTypeSchema, type PropertyType } from './property-type';

const idSchema = z.uuid();

export const requirementPrioritySchema = z.enum(['MUST_HAVE', 'PREFERRED', 'OPTIONAL', 'AVOID']);
export const provenanceKindSchema = z.enum(['DIRECTLY_STATED', 'AI_INTERPRETED', 'AI_SUGGESTED_ACCEPTED', 'MANUALLY_EDITED', 'IMPORTED', 'PROJECT_CONTEXT']);
export const confidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const provenanceRecordSchema = z.strictObject({
  kind: provenanceKindSchema,
  sourceMessageId: idSchema.nullable(),
  actorId: idSchema.nullable(),
  confidence: confidenceSchema.nullable(),
});
export const provenanceSchema = z.strictObject({ current: provenanceRecordSchema, history: z.array(provenanceRecordSchema).max(20) });
export const countSchema = z.strictObject({
  exact: z.number().int().min(0).max(100).optional(),
  minimum: z.number().int().min(0).max(100).optional(),
  maximum: z.number().int().min(0).max(100).optional(),
  preferred: z.number().int().min(0).max(100).optional(),
});
export const floorScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ENTIRE_PROPERTY') }),
  z.strictObject({ kind: z.literal('SPECIFIC_FLOOR'), label: z.string().trim().min(1).max(40) }),
  z.strictObject({ kind: z.literal('PREFERRED_FLOOR'), label: z.string().trim().min(1).max(40) }),
  z.strictObject({ kind: z.literal('UNSPECIFIED') }),
]);
export const sizeRequirementSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('EXACT'), value: z.string().regex(/^\d+(?:\.\d{1,3})?$/).refine(value => Number(value) > 0), unit: z.enum(['m2', 'ft2', 'yd2']) }),
  z.strictObject({ kind: z.literal('MINIMUM'), value: z.string().regex(/^\d+(?:\.\d{1,3})?$/).refine(value => Number(value) > 0), unit: z.enum(['m2', 'ft2', 'yd2']) }),
  z.strictObject({ kind: z.literal('PREFERRED'), value: z.string().regex(/^\d+(?:\.\d{1,3})?$/).refine(value => Number(value) > 0), unit: z.enum(['m2', 'ft2', 'yd2']) }),
  z.strictObject({ kind: z.literal('NO_PREFERENCE') }),
]);

const fieldValue = <T extends z.ZodType>(value: T) => z.strictObject({ value, provenance: provenanceSchema });
const prioritizedField = <T extends z.ZodType>(value: T) => z.strictObject({ value, priority: requirementPrioritySchema, provenance: provenanceSchema });
const nullableProvenanced = <T extends z.ZodType>(value: T) => fieldValue(value).nullable();

export const spaceTypeSchema = z.enum([
  'BEDROOM', 'BATHROOM', 'LIVING_ROOM', 'FAMILY_LOUNGE', 'KITCHEN', 'DINING', 'PUJA_ROOM', 'HOME_OFFICE',
  'STUDY', 'UTILITY', 'STORE_ROOM', 'BALCONY', 'TERRACE', 'PARKING', 'GARAGE', 'GARDEN', 'COURTYARD',
  'STAFF_ROOM', 'RENTAL_UNIT', 'COMMERCIAL_SPACE', 'OTHER',
]);
export const spaceRequirementSchema = z.strictObject({
  id: idSchema,
  type: spaceTypeSchema,
  customName: z.string().trim().min(1).max(80).nullable(),
  count: countSchema,
  floor: floorScopeSchema,
  size: sizeRequirementSchema,
  priority: requirementPrioritySchema,
  provenance: provenanceSchema,
});
export const relationshipKindSchema = z.enum(['NEAR', 'ATTACHED', 'ON_FLOOR', 'INDEPENDENT_ACCESS', 'NOT_DIRECTLY_FACING', 'SEPARATE_FROM']);
export const spaceRelationshipSchema = z.strictObject({
  id: idSchema,
  kind: relationshipKindSchema,
  fromSpaceId: idSchema,
  toSpaceId: idSchema,
  floor: floorScopeSchema.nullable(),
  priority: requirementPrioritySchema,
  provenance: provenanceSchema,
});
export const parkingNeedSchema = z.strictObject({
  id: idSchema,
  vehicle: z.enum(['CAR', 'TWO_WHEELER', 'VISITOR_CAR', 'VISITOR_TWO_WHEELER']),
  count: countSchema,
  cover: z.enum(['COVERED', 'OPEN', 'NO_PREFERENCE']).nullable(),
  evCharging: z.boolean().nullable(),
  priority: requirementPrioritySchema,
  provenance: provenanceSchema,
});
export const accessibilityNeedSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['STEP_FREE_ENTRANCE', 'GROUND_FLOOR_BEDROOM', 'ACCESSIBLE_BATHROOM', 'LIFT', 'WIDER_CIRCULATION', 'ELDERLY_FRIENDLY_BEDROOM', 'OTHER']),
  customName: z.string().trim().min(1).max(80).nullable(),
  floor: floorScopeSchema,
  priority: requirementPrioritySchema,
  provenance: provenanceSchema,
});
export const utilityNeedSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['SOLAR', 'INVERTER_BATTERY', 'EV_CHARGING', 'RAINWATER_HARVESTING', 'BOREWELL', 'MUNICIPAL_WATER', 'UNDERGROUND_TANK', 'OVERHEAD_TANK', 'SEPTIC', 'SEWER', 'GENERATOR', 'SMART_HOME', 'OTHER']),
  customName: z.string().trim().min(1).max(80).nullable(),
  priority: requirementPrioritySchema,
  provenance: provenanceSchema,
});
export const preferenceSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['STYLE', 'LOW_MAINTENANCE', 'NATURAL_LIGHT', 'VENTILATION', 'PRIVACY', 'OPEN_PLAN', 'OTHER']),
  value: z.string().trim().min(1).max(160),
  priority: requirementPrioritySchema,
  provenance: provenanceSchema,
});
export const moneySchema = z.strictObject({
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export const budgetIntentSchema = z.strictObject({
  target: moneySchema.nullable(),
  maximum: moneySchema.nullable(),
  flexibility: z.enum(['FLEXIBLE', 'SOMEWHAT_FLEXIBLE', 'FIRM']).nullable(),
  provenance: provenanceSchema.nullable(),
});
export const timelineIntentSchema = z.strictObject({
  desiredStart: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable(),
  desiredCompletion: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable(),
  flexibility: z.enum(['FLEXIBLE', 'SOMEWHAT_FLEXIBLE', 'FIRM']).nullable(),
  urgency: z.enum(['LOW', 'NORMAL', 'HIGH']).nullable(),
  provenance: provenanceSchema.nullable(),
});
export const expansionNeedSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['ADDITIONAL_FLOORS', 'RENTAL_CONVERSION', 'ROOM_EXPANSION', 'LIFT_PROVISION', 'ADDITIONAL_PARKING', 'OTHER']),
  description: z.string().trim().min(1).max(240),
  priority: requirementPrioritySchema,
  provenance: provenanceSchema,
});

export const propertyRequirementsSchema = z.strictObject({
  requirementsSchemaVersion: z.literal(1),
  buildingIntent: nullableProvenanced(z.strictObject({ kind: propertyTypeSchema, otherDescription: z.string().trim().min(1).max(120).nullable() })),
  occupancy: z.strictObject({
    householdSize: nullableProvenanced(z.number().int().min(1).max(100)),
    adults: nullableProvenanced(z.number().int().min(0).max(100)),
    children: nullableProvenanced(z.number().int().min(0).max(100)),
    elderlyOccupants: nullableProvenanced(z.number().int().min(0).max(100)),
    expectedGuests: nullableProvenanced(z.number().int().min(0).max(100)),
    staffAccommodation: nullableProvenanced(z.boolean()),
    accessibilityNeedsConfirmed: nullableProvenanced(z.boolean()),
  }),
  buildingScale: z.strictObject({
    floorCount: prioritizedField(countSchema).superRefine((field, ctx) => {
      for (const key of ['exact', 'minimum', 'maximum', 'preferred'] as const) if (field.value[key] === 0) ctx.addIssue({ code: 'custom', path: ['value', key], message: 'A building must have at least one floor.' });
    }),
    basement: nullableProvenanced(z.boolean()),
    terraceUse: nullableProvenanced(z.string().trim().min(1).max(160)),
    futureAdditionalFloors: nullableProvenanced(z.number().int().min(0).max(30)),
    lift: nullableProvenanced(z.boolean()),
    staircaseExpectation: nullableProvenanced(z.string().trim().min(1).max(160)),
    priority: requirementPrioritySchema,
  }),
  spaces: z.array(spaceRequirementSchema).max(100),
  relationships: z.array(spaceRelationshipSchema).max(200),
  parking: z.array(parkingNeedSchema).max(20),
  accessibility: z.array(accessibilityNeedSchema).max(50),
  utilities: z.array(utilityNeedSchema).max(50),
  rental: z.strictObject({
    mode: nullableProvenanced(z.enum(['OWNER_ONLY', 'RENTAL_FLOOR', 'INDEPENDENT_RENTAL_UNIT', 'MULTIPLE_UNITS'])),
    unitCount: fieldValue(countSchema).nullable(),
    independentEntrance: prioritizedField(z.boolean()).nullable(),
    independentUtilities: prioritizedField(z.boolean()).nullable(),
  }),
  preferences: z.array(preferenceSchema).max(100),
  budget: budgetIntentSchema,
  timeline: timelineIntentSchema,
  vaasthuPreference: nullableProvenanced(z.enum(['NONE', 'BASIC', 'STRONG', 'STRICT'])),
  futureExpansion: z.array(expansionNeedSchema).max(50),
});
export type PropertyRequirements = z.infer<typeof propertyRequirementsSchema>;
export type RequirementProvenance = z.infer<typeof provenanceSchema>;
export type RequirementPriority = z.infer<typeof requirementPrioritySchema>;

export function emptyPropertyRequirements(): PropertyRequirements {
  const emptyProvenance: RequirementProvenance = { current: { kind: 'MANUALLY_EDITED', sourceMessageId: null, actorId: null, confidence: null }, history: [] };
  return {
    requirementsSchemaVersion: 1,
    buildingIntent: null,
    occupancy: { householdSize: null, adults: null, children: null, elderlyOccupants: null, expectedGuests: null, staffAccommodation: null, accessibilityNeedsConfirmed: null },
    buildingScale: { floorCount: { value: {}, priority: 'PREFERRED', provenance: emptyProvenance }, basement: null, terraceUse: null, futureAdditionalFloors: null, lift: null, staircaseExpectation: null, priority: 'PREFERRED' },
    spaces: [], relationships: [], parking: [], accessibility: [], utilities: [],
    rental: { mode: null, unitCount: null, independentEntrance: null, independentUtilities: null },
    preferences: [], budget: { target: null, maximum: null, flexibility: null, provenance: null },
    timeline: { desiredStart: null, desiredCompletion: null, flexibility: null, urgency: null, provenance: null },
    vaasthuPreference: null, futureExpansion: [],
  };
}

export type CompletenessClass = 'REQUIRED' | 'CONDITIONALLY_REQUIRED' | 'OPTIONAL' | 'NOT_APPLICABLE';
export interface RequirementCompletenessItem { key: string; category: CompletenessClass; complete: boolean; prompt: string }
export function requirementsCompleteness(requirements: PropertyRequirements) {
  const floorCountSet = Object.values(requirements.buildingScale.floorCount.value).some(value => value !== undefined);
  const hasRequestedSpace = (space: PropertyRequirements['spaces'][number]) => {
    const { exact, minimum, maximum, preferred } = space.count;
    return [exact, minimum, maximum, preferred].some(value => value !== undefined && value > 0);
  };
  const items: RequirementCompletenessItem[] = [
    { key: 'buildingIntent', category: 'REQUIRED', complete: requirements.buildingIntent !== null, prompt: requirements.buildingIntent ? 'Property type recorded in the project.' : 'What kind of building do you want?' },
    { key: 'buildingScale.floorCount', category: 'REQUIRED', complete: floorCountSet, prompt: 'How many floors should the building have?' },
    { key: 'spaces', category: 'REQUIRED', complete: requirements.spaces.length > 0 && requirements.spaces.every(space => Object.keys(space.count).length > 0 && hasRequestedSpace(space)), prompt: 'Which spaces do you need, and how many?' },
    { key: 'rental.mode', category: 'REQUIRED', complete: requirements.rental.mode !== null, prompt: 'Will this be owner-only, or include a rental unit or floor?' },
    { key: 'occupancy.householdSize', category: 'OPTIONAL', complete: requirements.occupancy.householdSize !== null, prompt: 'How many people will use the home? You can skip this.' },
    { key: 'parking', category: 'OPTIONAL', complete: true, prompt: 'How much vehicle parking would you like?' },
    { key: 'accessibility', category: requirements.occupancy.elderlyOccupants?.value && requirements.occupancy.elderlyOccupants.value > 0 ? 'CONDITIONALLY_REQUIRED' : 'OPTIONAL', complete: requirements.occupancy.accessibilityNeedsConfirmed !== null, prompt: 'Does anyone need step-free access or a ground-floor bedroom?' },
    { key: 'budget', category: 'OPTIONAL', complete: requirements.budget.target !== null || requirements.budget.maximum !== null, prompt: 'Do you have a target or maximum construction budget? You can skip this.' },
    { key: 'timeline', category: 'OPTIONAL', complete: requirements.timeline.desiredStart !== null || requirements.timeline.desiredCompletion !== null, prompt: 'Do you have a desired start or completion month? You can skip this.' },
    { key: 'vaasthuPreference', category: 'OPTIONAL', complete: requirements.vaasthuPreference !== null, prompt: 'Do you have a Vaasthu preference? You can skip this.' },
  ];
  if (requirements.rental.mode && requirements.rental.mode.value !== 'OWNER_ONLY') {
    items.push({ key: 'rental.independentEntrance', category: 'CONDITIONALLY_REQUIRED', complete: requirements.rental.independentEntrance !== null, prompt: 'Should the rental area have an independent entrance?' });
  }
  const unsupportedIntent = requirements.buildingIntent !== null && requirements.buildingIntent.value.kind !== 'RESIDENTIAL';
  const blockingItems = items.filter(item => item.category === 'REQUIRED' || item.category === 'CONDITIONALLY_REQUIRED').filter(item => !item.complete);
  if (unsupportedIntent) blockingItems.push({ key: 'buildingIntent.support', category: 'REQUIRED', complete: false, prompt: 'This project type is recorded but is outside the currently supported residential workflow.' });
  return { complete: blockingItems.length === 0, items, blockingItems };
}

export const requirementConflictSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['FLOOR_COUNT_CHANGED', 'SPACE_COUNT_CHANGED', 'COUNT_RANGE_CONFLICT', 'PRIORITY_CONFLICT', 'BUDGET_TARGET_EXCEEDS_MAXIMUM', 'BUDGET_CURRENCY_MISMATCH', 'SITE_FACT_DISCREPANCY']),
  requirementKeys: z.array(z.string().min(1).max(160)).min(1).max(20),
  sourceMessageIds: z.array(idSchema).max(20),
  explanation: z.string().trim().min(1).max(500),
  status: z.enum(['OPEN', 'RESOLVED']),
  resolution: z.string().trim().min(1).max(500).nullable(),
});
export type RequirementConflict = z.infer<typeof requirementConflictSchema>;
export function detectRequirementConflicts(current: PropertyRequirements, previous: PropertyRequirements | null, options: {
  messageId: string | null; explicitCorrection: boolean; id: () => string;
}): RequirementConflict[] {
  const conflicts: RequirementConflict[] = [];
  const push = (kind: RequirementConflict['kind'], keys: string[], sourceMessageIds: (string | null)[], explanation: string) => {
    const ids = [...new Set(sourceMessageIds.filter((id): id is string => id !== null))];
    conflicts.push({ id: options.id(), kind, requirementKeys: keys, sourceMessageIds: ids, explanation, status: 'OPEN', resolution: null });
  };
  const previousFloor = previous?.buildingScale.floorCount.value.exact;
  const nextFloor = current.buildingScale.floorCount.value.exact;
  if (!options.explicitCorrection && previousFloor !== undefined && nextFloor !== undefined && previousFloor !== nextFloor) {
    push('FLOOR_COUNT_CHANGED', ['buildingScale.floorCount'], [previous?.buildingScale.floorCount.provenance.current.sourceMessageId ?? null, options.messageId], 'The floor count changed between owner statements. Confirm which count is intended.');
  }
  const countSpecs: { key: string; count: z.infer<typeof countSchema> }[] = [
    { key: 'buildingScale.floorCount', count: current.buildingScale.floorCount.value },
    ...current.spaces.map(space => ({ key: `spaces.${space.id}.count`, count: space.count })),
    ...current.parking.map(item => ({ key: `parking.${item.id}.count`, count: item.count })),
  ];
  for (const item of countSpecs) {
    const { exact, minimum, maximum } = item.count;
    if ((minimum !== undefined && maximum !== undefined && minimum > maximum)
      || (exact !== undefined && ((minimum !== undefined && exact < minimum) || (maximum !== undefined && exact > maximum)))) {
      push('COUNT_RANGE_CONFLICT', [item.key], [options.messageId], 'The exact count and stated minimum/maximum do not agree. Edit the count range before approval.');
    }
  }
  if (!options.explicitCorrection && previous) {
    for (const space of current.spaces) {
      const before = previous.spaces.find(item => item.type === space.type && item.customName === space.customName);
      const oldExact = before?.count.exact;
      if (before && oldExact !== undefined && space.count.exact !== undefined && oldExact !== space.count.exact) {
        push('SPACE_COUNT_CHANGED', [`spaces.${space.id}.count`], [before.provenance.current.sourceMessageId, options.messageId], `The requested count for ${space.customName ?? space.type.toLowerCase().replaceAll('_', ' ')} changed from ${oldExact} to ${space.count.exact}. Confirm the intended count.`);
      }
    }
  }
  const byNeed = new Map<string, RequirementPriority[]>();
  for (const item of [...current.spaces, ...current.parking, ...current.accessibility, ...current.utilities, ...current.preferences, ...current.futureExpansion]) {
    const record = item as { type?: string; customName?: string | null; vehicle?: string; kind?: string; priority: RequirementPriority };
    const key = record.type ? String(record.type === 'OTHER' ? record.customName : record.type) : record.vehicle ?? record.kind ?? 'other';
    byNeed.set(key, [...(byNeed.get(key) ?? []), item.priority]);
  }
  for (const [key, priorities] of byNeed) if (priorities.includes('MUST_HAVE') && priorities.includes('AVOID')) {
    push('PRIORITY_CONFLICT', [`requirements.${key}.priority`], [options.messageId], `“${key}” is marked both MUST_HAVE and AVOID.`);
  }
  const target = current.budget.target, maximum = current.budget.maximum;
  const minorUnits = (amount: string) => {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole!) * 100n + BigInt((fraction + '00').slice(0, 2));
  };
  if (target && maximum && target.currency !== maximum.currency) {
    push('BUDGET_CURRENCY_MISMATCH', ['budget.target', 'budget.maximum'], [current.budget.provenance?.current.sourceMessageId ?? null, options.messageId], 'The target and maximum budgets use different currencies. Use one currency or remove one amount.');
  } else if (target && maximum && minorUnits(target.amount) > minorUnits(maximum.amount)) {
    push('BUDGET_TARGET_EXCEEDS_MAXIMUM', ['budget.target', 'budget.maximum'], [current.budget.provenance?.current.sourceMessageId ?? null, options.messageId], 'The target budget is higher than the stated maximum. Confirm or edit the amounts.');
  }
  return conflicts;
}

/** Derive only the high-level type for a working draft. Never call on stored approved history. */
export function requirementsWithProjectType(requirements: PropertyRequirements, propertyType: PropertyType): PropertyRequirements {
  const previous = requirements.buildingIntent;
  if (previous?.value.kind === propertyType && previous.provenance.current.kind === 'PROJECT_CONTEXT') return requirements;
  return { ...requirements, buildingIntent: {
    value: { kind: propertyType, otherDescription: previous?.value.kind === propertyType ? previous.value.otherDescription : null },
    provenance: {
      current: { kind: 'PROJECT_CONTEXT', actorId: null, sourceMessageId: null, confidence: 'HIGH' },
      history: previous ? [...previous.provenance.history, previous.provenance.current].slice(-20) : [],
    },
  } };
}
export function requirementsMatchProjectType(requirements: PropertyRequirements, propertyType: PropertyType): boolean {
  return requirements.buildingIntent?.value.kind === propertyType;
}
