import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  detectRequirementConflicts, emptyPropertyRequirements, propertyRequirementsSchema, requirementsCompleteness,
  type PropertyRequirements,
} from '@property/domain';
import { FakeRequirementsAiProvider, requirementsAiResponseSchema } from '@property/services';

const actorId = randomUUID();
const source = randomUUID();
const provenance = (kind: 'DIRECTLY_STATED' | 'AI_INTERPRETED' | 'AI_SUGGESTED_ACCEPTED' | 'MANUALLY_EDITED' = 'DIRECTLY_STATED') => ({
  current: { kind, sourceMessageId: source, actorId, confidence: 'HIGH' as const }, history: [],
});
function completeBrief(): PropertyRequirements {
  return propertyRequirementsSchema.parse({
    ...emptyPropertyRequirements(),
    buildingIntent: { value: { kind: 'RESIDENTIAL', otherDescription: null }, provenance: provenance() },
    buildingScale: { ...emptyPropertyRequirements().buildingScale, floorCount: { value: { exact: 2 }, priority: 'PREFERRED', provenance: provenance() } },
    spaces: [{ id: randomUUID(), type: 'BEDROOM', customName: null, count: { minimum: 3, preferred: 4 }, floor: { kind: 'UNSPECIFIED' }, size: { kind: 'NO_PREFERENCE' }, priority: 'MUST_HAVE', provenance: provenance() }],
    rental: { ...emptyPropertyRequirements().rental, mode: { value: 'OWNER_ONLY', provenance: provenance() } },
  });
}

describe('versioned Property Requirements', () => {
  it('validates the typed residential brief, measurements, scoping, priorities, and extensible spaces', () => {
    const brief = completeBrief();
    brief.spaces.push({ id: randomUUID(), type: 'OTHER', customName: 'Music room', count: { exact: 1 }, floor: { kind: 'PREFERRED_FLOOR', label: 'First floor' }, size: { kind: 'PREFERRED', value: '120', unit: 'ft2' }, priority: 'OPTIONAL', provenance: provenance('AI_INTERPRETED') });
    brief.relationships.push({ id: randomUUID(), kind: 'NEAR', fromSpaceId: brief.spaces[0]!.id, toSpaceId: brief.spaces[1]!.id, floor: null, priority: 'PREFERRED', provenance: provenance() });
    brief.parking.push({ id: randomUUID(), vehicle: 'CAR', count: { exact: 2 }, cover: 'COVERED', evCharging: true, priority: 'MUST_HAVE', provenance: provenance() });
    brief.accessibility.push({ id: randomUUID(), kind: 'STEP_FREE_ENTRANCE', customName: null, floor: { kind: 'ENTIRE_PROPERTY' }, priority: 'MUST_HAVE', provenance: provenance() });
    brief.utilities.push({ id: randomUUID(), kind: 'RAINWATER_HARVESTING', customName: null, priority: 'PREFERRED', provenance: provenance() });
    brief.preferences.push({ id: randomUUID(), kind: 'STYLE', value: 'Contemporary', priority: 'PREFERRED', provenance: provenance() });
    brief.budget = { target: { amount: '7500000', currency: 'INR' }, maximum: { amount: '9000000', currency: 'INR' }, flexibility: 'SOMEWHAT_FLEXIBLE', provenance: provenance() };
    brief.timeline = { desiredStart: '2027-02', desiredCompletion: '2028-12', flexibility: 'FLEXIBLE', urgency: 'NORMAL', provenance: provenance() };
    brief.vaasthuPreference = { value: 'BASIC', provenance: provenance() };
    brief.futureExpansion.push({ id: randomUUID(), kind: 'ADDITIONAL_FLOORS', description: 'Keep an option for one more floor later', priority: 'PREFERRED', provenance: provenance() });
    brief.rental.independentEntrance = { value: true, priority: 'MUST_HAVE', provenance: provenance() };
    expect(propertyRequirementsSchema.parse(brief)).toEqual(brief);
  });

  it('requires only the residential essentials and leaves optional fields non-blocking', () => {
    const missing = requirementsCompleteness(emptyPropertyRequirements());
    expect(missing.complete).toBe(false);
    expect(missing.blockingItems.map(item => item.key)).toEqual(['buildingIntent', 'buildingScale.floorCount', 'spaces', 'rental.mode']);
    const complete = requirementsCompleteness(completeBrief());
    expect(complete.complete).toBe(true);
    expect(complete.items.find(item => item.key === 'budget')?.category).toBe('OPTIONAL');
  });

  it('makes rental access and elderly-related access confirmation conditionally required', () => {
    const brief = completeBrief();
    brief.rental.mode = { value: 'INDEPENDENT_RENTAL_UNIT', provenance: provenance() };
    brief.occupancy.elderlyOccupants = { value: 1, provenance: provenance() };
    const completeness = requirementsCompleteness(brief);
    expect(completeness.blockingItems.map(item => item.key)).toContain('rental.independentEntrance');
    expect(completeness.blockingItems.map(item => item.key)).toContain('accessibility');
    brief.rental.independentEntrance = { value: true, priority: 'PREFERRED', provenance: provenance() };
    brief.occupancy.accessibilityNeedsConfirmed = { value: false, provenance: provenance() };
    expect(requirementsCompleteness(brief).complete).toBe(true);
  });

  it('captures contradictory counts, priorities, budget targets, and later owner statements as conflicts', () => {
    const previous = completeBrief();
    previous.spaces[0]!.count = { exact: 3 };
    const next = structuredClone(previous);
    next.buildingScale.floorCount.value = { exact: 3 };
    next.spaces[0]!.count = { exact: 4 };
    next.spaces.push({ ...next.spaces[0]!, id: randomUUID(), priority: 'AVOID' });
    next.budget = { target: { amount: '100.01', currency: 'USD' }, maximum: { amount: '100.00', currency: 'USD' }, flexibility: 'FIRM', provenance: provenance() };
    const conflicts = detectRequirementConflicts(next, previous, { messageId: randomUUID(), explicitCorrection: false, id: randomUUID });
    expect(conflicts.map(item => item.kind)).toEqual(expect.arrayContaining(['FLOOR_COUNT_CHANGED', 'SPACE_COUNT_CHANGED', 'PRIORITY_CONFLICT', 'BUDGET_TARGET_EXCEEDS_MAXIMUM']));
    expect(conflicts.every(item => item.status === 'OPEN')).toBe(true);
    expect(conflicts.some(item => item.sourceMessageIds.includes(source))).toBe(true);
  });

  it('represents exact/minimum conflicts and currency mismatch without choosing a value', () => {
    const brief = completeBrief();
    brief.spaces[0]!.count = { exact: 3, minimum: 4 };
    brief.budget = { target: { amount: '100', currency: 'USD' }, maximum: { amount: '100', currency: 'INR' }, flexibility: null, provenance: provenance() };
    const parsed = propertyRequirementsSchema.parse(brief);
    const conflicts = detectRequirementConflicts(parsed, null, { messageId: source, explicitCorrection: false, id: randomUUID });
    expect(conflicts.map(item => item.kind)).toContain('COUNT_RANGE_CONFLICT');
    expect(conflicts.map(item => item.kind)).toContain('BUDGET_CURRENCY_MISMATCH');
  });

  it('preserves provenance distinctions including AI interpretation and accepted suggestions', () => {
    const brief = completeBrief();
    brief.spaces[0]!.provenance = provenance('AI_INTERPRETED');
    brief.preferences.push({ id: randomUUID(), kind: 'PRIVACY', value: 'High privacy', priority: 'PREFERRED', provenance: provenance('AI_SUGGESTED_ACCEPTED') });
    expect(propertyRequirementsSchema.parse(brief).spaces[0]!.provenance.current.kind).toBe('AI_INTERPRETED');
    expect(brief.preferences[0]!.provenance.current.kind).toBe('AI_SUGGESTED_ACCEPTED');
  });
});

describe('structured AI boundary', () => {
  it('accepts typed extractions but rejects malformed and unsupported values', () => {
    const valid = { assistantMessage: 'I recorded that.', extractions: [{ category: 'FLOOR_COUNT', count: { exact: 2 }, priority: 'PREFERRED', evidence: 'DIRECTLY_STATED', confidence: 'HIGH' }], followUpQuestions: [], siteClaims: [], explicitCorrection: false };
    expect(requirementsAiResponseSchema.safeParse(valid).success).toBe(true);
    expect(requirementsAiResponseSchema.safeParse({ ...valid, extra: 'untrusted' }).success).toBe(false);
    expect(requirementsAiResponseSchema.safeParse({ ...valid, extractions: [{ category: 'SPACE', type: 'BALLROOM', count: {}, floor: { kind: 'UNSPECIFIED' }, size: { kind: 'NO_PREFERENCE' }, priority: 'PREFERRED', customName: null, evidence: 'DIRECTLY_STATED', confidence: 'HIGH' }] }).success).toBe(false);
  });

  it('provides deterministic fake extraction without calling a live model', async () => {
    const provider = new FakeRequirementsAiProvider();
    const result = await provider.generateStructured({ systemPrompt: 'test', input: { ownerMessage: 'I want a residential home with G+1, 3 bedrooms and 2 cars.' }, schemaName: 'test', schema: {} });
    const parsed = requirementsAiResponseSchema.parse(result.output);
    expect(parsed.extractions.map(item => item.category)).toEqual(expect.arrayContaining(['BUILDING_INTENT', 'FLOOR_COUNT', 'SPACE', 'PARKING']));
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
  });
});
