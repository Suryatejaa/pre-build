import type { RequirementsAiResponse } from '@property/services';

export const richOwnerMessage = 'I want G+2. Ground floor should have parking for 2 cars, living room, kitchen, dining and one bedroom for my parents. First floor should have 3 bedrooms and a family lounge. Second floor should have a home office and open terrace. I may add a lift later. Vaasthu is important to me.';
const stated = { evidence: 'DIRECTLY_STATED', confidence: 'HIGH' } as const;
const space = (type: Extract<RequirementsAiResponse['extractions'][number], { category: 'SPACE' }>['type'], count: number, floor: string, customName: string | null = null): RequirementsAiResponse['extractions'][number] => ({
  category: 'SPACE', type, customName, count: { exact: count }, floor: { kind: 'SPECIFIC_FLOOR', label: floor }, size: { kind: 'NO_PREFERENCE' }, priority: 'PREFERRED', ...stated,
});
/** Deterministic provider fixture, not a keyword parser or a production fallback. */
export const richExtraction: RequirementsAiResponse = {
  assistantMessage: 'I recorded the requested spaces.', followUpQuestions: [], siteClaims: [], explicitCorrection: false,
  extractions: [
    { category: 'FLOOR_COUNT', count: { exact: 3 }, priority: 'PREFERRED', ...stated },
    { category: 'PARKING', vehicle: 'CAR', count: { exact: 2 }, cover: null, evCharging: null, priority: 'PREFERRED', ...stated },
    space('PARKING', 1, 'Ground floor'), space('LIVING_ROOM', 1, 'Ground floor'), space('KITCHEN', 1, 'Ground floor'), space('DINING', 1, 'Ground floor'),
    space('BEDROOM', 1, 'Ground floor', 'Bedroom for parents'), space('BEDROOM', 3, 'First floor'), space('FAMILY_LOUNGE', 1, 'First floor'),
    space('HOME_OFFICE', 1, 'Second floor'), space('TERRACE', 1, 'Second floor', 'Open terrace'),
    { category: 'FUTURE_EXPANSION', kind: 'LIFT_PROVISION', description: 'Possible future lift provision', priority: 'OPTIONAL', ...stated },
    { category: 'VAASHTU', level: 'STRONG', evidence: 'AI_INTERPRETED', confidence: 'MEDIUM' },
  ],
};
