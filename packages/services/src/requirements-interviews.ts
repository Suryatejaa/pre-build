import { z } from 'zod';
import {
  requirementsWithProjectType, requirementsMatchProjectType, propertyTypeLabel, DomainError, emptyPropertyRequirements, idSchema, interviewCandidateSchema,
  normalizeProjectSnapshot, propertyRequirementsSchema, requirementsCompleteness, detectRequirementConflicts,
  stableJson, withRequirements, type InterviewCandidate, type InterviewMessage, type PropertyRequirements,
  type RequirementProvenance, type RequirementsInterview, type RequirementsInterviewView, type Site, type SiteDiscrepancy,
} from '@property/domain';
import type { RequirementsRepository, RequirementsUnitOfWork } from './repository';
import {
  AiInvalidOutputError, AiUnavailableError, requirementsInterviewSystemPrompt,
  requirementsAiResponseSchema, type RequirementsAiProvider, type RequirementsAiResponse,
} from './requirements-ai';

const startSchema = z.strictObject({ expectedRevision: z.number().int().positive() });
const ownerMessageSchema = z.strictObject({ content: z.string().trim().min(1).max(4000), expectedRevision: z.number().int().positive() });
const briefSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  changeReason: z.string().trim().min(5).max(500),
  requirements: propertyRequirementsSchema,
});
const resolveSchema = z.strictObject({ conflictId: idSchema, resolution: z.string().trim().min(3).max(500), expectedRevision: z.number().int().positive() });
const resolveSiteSchema = z.strictObject({ discrepancyId: idSchema, resolution: z.string().trim().min(3).max(500), expectedRevision: z.number().int().positive() });
const idInputSchema = z.strictObject({ expectedRevision: z.number().int().positive() });

function provenance(kind: RequirementProvenance['current']['kind'], actorId: string | null, sourceMessageId: string | null, confidence: RequirementProvenance['current']['confidence']): RequirementProvenance {
  return { current: { kind, actorId, sourceMessageId, confidence }, history: [] };
}
function priorHistory(old: RequirementProvenance | null | undefined, next: RequirementProvenance): RequirementProvenance {
  return old ? { ...next, history: [...old.history, old.current].slice(-20) } : next;
}
function acceptedSuggestion(fact: { evidence: string }, ownerMessage: string) {
  return fact.evidence !== 'AI_SUGGESTED' || /\b(yes|accept|agreed|go with that|that works|make it so|please do)\b/i.test(ownerMessage);
}
function factProvenance(fact: { evidence: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }, actorId: string, messageId: string, ownerMessage: string): RequirementProvenance {
  const kind = fact.evidence === 'AI_SUGGESTED' && acceptedSuggestion(fact, ownerMessage) ? 'AI_SUGGESTED_ACCEPTED'
    : fact.evidence === 'DIRECTLY_STATED' ? 'DIRECTLY_STATED' : 'AI_INTERPRETED';
  return provenance(kind, actorId, messageId, fact.confidence);
}
function containsLowConfidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsLowConfidence);
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    const source = item.current as Record<string, unknown> | undefined;
    if (source?.confidence === 'LOW' && source.kind !== 'MANUALLY_EDITED') return true;
    return Object.entries(item).some(([key, child]) => key !== 'history' && key !== 'current' && containsLowConfidence(child))
      || (source ? source.confidence === 'LOW' && source.kind !== 'MANUALLY_EDITED' : false);
  }
  return false;
}
function requiredQuestions(requirements: PropertyRequirements) {
  return requirementsCompleteness(requirements).blockingItems.map(item => item.prompt);
}
function candidateWithStatus(candidate: InterviewCandidate): { candidate: InterviewCandidate; status: 'IN_PROGRESS' | 'REVIEW_REQUIRED' } {
  const blockingConflicts = candidate.conflicts.some(conflict => conflict.status === 'OPEN')
    || candidate.siteDiscrepancies.some(discrepancy => discrepancy.status === 'OPEN')
    || containsLowConfidence(candidate.requirements);
  const complete = requirementsCompleteness(candidate.requirements).complete;
  return { candidate, status: complete && !blockingConflicts ? 'REVIEW_REQUIRED' : 'IN_PROGRESS' };
}
function mergeConflicts(existing: InterviewCandidate['conflicts'], detected: InterviewCandidate['conflicts']): InterviewCandidate['conflicts'] {
  const keyOf = (item: InterviewCandidate['conflicts'][number]) => `${item.kind}:${[...item.requirementKeys].sort().join(',')}`;
  const detectedKeys = new Set(detected.map(keyOf));
  const merged = detected.map(item => {
    const old = existing.find(value => keyOf(value) === keyOf(item));
    return old?.status === 'RESOLVED' ? old : old ? { ...item, id: old.id } : item;
  });
  for (const old of existing) if (old.status === 'RESOLVED' && !detectedKeys.has(keyOf(old))) merged.push(old);
  for (const old of existing) if (old.status === 'OPEN' && !detectedKeys.has(keyOf(old))) {
    merged.push({ ...old, status: 'RESOLVED', resolution: 'The owner edited the brief and removed this conflict.' });
  }
  return merged;
}
function makeCandidate(requirements: PropertyRequirements): InterviewCandidate {
  return interviewCandidateSchema.parse({ requirements, questions: requiredQuestions(requirements), conflicts: [], siteDiscrepancies: [], lastAiError: null, lastOwnerMessageId: null });
}
function versionRequirements(project: { currentVersion: { snapshot: unknown } }): PropertyRequirements | null {
  const snapshot = normalizeProjectSnapshot(project.currentVersion.snapshot);
  return snapshot.schemaVersion === 3 ? snapshot.requirements : null;
}
function siteContext(site: Site | null) {
  if (!site) return null;
  const boundary = site.derived.boundary;
  const edgeLabel = (edgeId: string | undefined) => {
    if (!edgeId || !boundary) return undefined;
    const index = boundary.edges.findIndex(edge => edge.id === edgeId);
    if (index < 0) return undefined;
    return boundary.edges[index]?.label ?? `Edge ${index + 1}`;
  };
  return {
    location: { country: site.facts.location.country, region: site.facts.location.region, district: site.facts.location.district, locality: site.facts.location.locality },
    declaredArea: site.facts.declaredArea,
    calculatedArea: site.derived.calculatedArea,
    boundary: boundary ? { kind: site.facts.boundary?.kind ?? null, vertices: boundary.vertices.length, width: site.facts.boundary?.kind === 'RECTANGLE' ? site.facts.boundary.width : null, depth: site.facts.boundary?.kind === 'RECTANGLE' ? site.facts.boundary.depth : null, edges: boundary.edges.map((edge, index) => ({ label: edge.label ?? `Edge ${index + 1}`, length: edge.length })) } : null,
    orientation: { facing: site.facts.orientation.facing, northAngleMilliDegrees: site.facts.orientation.northAngleMilliDegrees, frontEdgeLabel: edgeLabel(site.facts.orientation.frontEdgeId) },
    roads: site.facts.roads.map(road => ({ name: road.name ?? null, category: road.category ?? null, edgeLabel: edgeLabel(road.edgeId) ?? 'Boundary edge not recorded', width: road.width, primaryAccess: road.primaryAccess })),
    condition: { status: site.facts.conditions.status },
  };
}
function canonicalSiteValue(site: Site | null, field: SiteDiscrepancy['field']): string {
  if (!site) return 'No saved Site record';
  switch (field) {
    case 'facing': return site.facts.orientation.facing ?? 'Facing not recorded';
    case 'declaredArea': return site.facts.declaredArea ? `${site.facts.declaredArea.value} ${site.facts.declaredArea.unit}` : 'Declared plot area not recorded';
    case 'calculatedArea': return site.derived.calculatedArea ? `${site.derived.calculatedArea.value} ${site.derived.calculatedArea.unit}` : 'Calculated plot area not available';
    case 'location': return [site.facts.location.locality, site.facts.location.district, site.facts.location.region].filter(Boolean).join(', ') || 'Location not recorded';
    case 'roads': return `${site.facts.roads.length} adjacent road${site.facts.roads.length === 1 ? '' : 's'} recorded`;
    case 'condition': return site.facts.conditions.status;
  }
}
function siteValuesMatch(left: string, right: string) {
  const directions: Record<string, string> = { NORTH: 'N', NORTHEAST: 'NE', EAST: 'E', SOUTHEAST: 'SE', SOUTH: 'S', SOUTHWEST: 'SW', WEST: 'W', NORTHWEST: 'NW' };
  const normalize = (value: string) => {
    const words = value.toLocaleUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).map(word => directions[word] ?? word);
    return words.join(' ').toLocaleLowerCase();
  };
  const a = normalize(left), b = normalize(right);
  return a === b || (a.length > 2 && b.length > 2 && (a.includes(b) || b.includes(a)));
}
function isClearCorrection(ownerMessage: string) { return /\b(actually|instead|change(?: it)? to|make it|correction|replace that)\b/i.test(ownerMessage); }

function mergeCount(previous: PropertyRequirements['spaces'][number]['count'], update: PropertyRequirements['spaces'][number]['count'], correction: boolean) {
  return correction ? update : { ...previous, ...update };
}
function addFact(requirements: PropertyRequirements, response: RequirementsAiResponse, actorId: string, messageId: string, ownerMessage: string, id: () => string) {
  const next = structuredClone(requirements);
  const correction = response.explicitCorrection || isClearCorrection(ownerMessage);
  for (const fact of response.extractions) {
    if (!acceptedSuggestion(fact, ownerMessage)) continue;
    const source = factProvenance(fact, actorId, messageId, ownerMessage);
    switch (fact.category) {
      // The interview cannot change the canonical project type.
      case 'BUILDING_INTENT': break;
      case 'OCCUPANCY': {
        const field = fact.field;
        if (field === 'staffAccommodation' || field === 'accessibilityNeedsConfirmed') {
          if (typeof fact.value !== 'boolean') break;
          next.occupancy[field] = { value: fact.value, provenance: priorHistory(next.occupancy[field]?.provenance, source) };
        } else {
          if (typeof fact.value !== 'number' || (field === 'householdSize' && fact.value < 1)) break;
          next.occupancy[field] = { value: fact.value, provenance: priorHistory(next.occupancy[field]?.provenance, source) };
        }
        break;
      }
      case 'FLOOR_COUNT':
        next.buildingScale.floorCount = { value: mergeCount(next.buildingScale.floorCount.value, fact.count, correction), priority: fact.priority, provenance: priorHistory(next.buildingScale.floorCount.provenance, source) };
        next.buildingScale.priority = fact.priority;
        break;
      case 'SPACE': {
        if (fact.type === 'OTHER' && !fact.customName) break;
        const old = next.spaces.find(space => space.type === fact.type && space.customName === fact.customName);
        const entry = { id: old?.id ?? id(), type: fact.type, customName: fact.customName, count: mergeCount(old?.count ?? {}, fact.count, correction), floor: fact.floor, size: fact.size, priority: fact.priority, provenance: priorHistory(old?.provenance, source) };
        if (old) next.spaces = next.spaces.map(space => space.id === old.id ? entry : space); else next.spaces.push(entry);
        break;
      }
      case 'RELATIONSHIP': {
        const findSpace = (type: typeof fact.fromSpaceType) => next.spaces.find(space => space.type === type);
        const ensureSpace = (type: typeof fact.fromSpaceType) => {
          const present = findSpace(type);
          if (present) return present;
          const space = { id: id(), type, customName: null, count: {}, floor: { kind: 'UNSPECIFIED' as const }, size: { kind: 'NO_PREFERENCE' as const }, priority: 'PREFERRED' as const, provenance: source };
          next.spaces.push(space);
          return space;
        };
        const from = ensureSpace(fact.fromSpaceType), to = ensureSpace(fact.toSpaceType);
        if (from.id === to.id) break;
        const old = next.relationships.find(rel => rel.kind === fact.kind && rel.fromSpaceId === from.id && rel.toSpaceId === to.id);
        const entry = { id: old?.id ?? id(), kind: fact.kind, fromSpaceId: from.id, toSpaceId: to.id, floor: null, priority: fact.priority, provenance: priorHistory(old?.provenance, source) };
        if (old) next.relationships = next.relationships.map(rel => rel.id === old.id ? entry : rel); else next.relationships.push(entry);
        break;
      }
      case 'PARKING': {
        const old = next.parking.find(item => item.vehicle === fact.vehicle);
        const entry = { id: old?.id ?? id(), vehicle: fact.vehicle, count: mergeCount(old?.count ?? {}, fact.count, correction), cover: fact.cover, evCharging: fact.evCharging, priority: fact.priority, provenance: priorHistory(old?.provenance, source) };
        if (old) next.parking = next.parking.map(item => item.id === old.id ? entry : item); else next.parking.push(entry);
        break;
      }
      case 'ACCESSIBILITY': {
        const old = next.accessibility.find(item => item.kind === fact.kind && item.customName === fact.customName);
        const entry = { id: old?.id ?? id(), kind: fact.kind, customName: fact.customName, floor: fact.floor, priority: fact.priority, provenance: priorHistory(old?.provenance, source) };
        if (old) next.accessibility = next.accessibility.map(item => item.id === old.id ? entry : item); else next.accessibility.push(entry);
        break;
      }
      case 'UTILITY': {
        const old = next.utilities.find(item => item.kind === fact.kind && item.customName === fact.customName);
        const entry = { id: old?.id ?? id(), kind: fact.kind, customName: fact.customName, priority: fact.priority, provenance: priorHistory(old?.provenance, source) };
        if (old) next.utilities = next.utilities.map(item => item.id === old.id ? entry : item); else next.utilities.push(entry);
        break;
      }
      case 'RENTAL':
        next.rental = {
          mode: { value: fact.mode, provenance: priorHistory(next.rental.mode?.provenance, source) },
          unitCount: fact.unitCount ? { value: fact.unitCount, provenance: priorHistory(next.rental.unitCount?.provenance, source) } : next.rental.unitCount,
          independentEntrance: fact.independentEntrance === null ? next.rental.independentEntrance : { value: fact.independentEntrance, priority: fact.priority, provenance: priorHistory(next.rental.independentEntrance?.provenance, source) },
          independentUtilities: fact.independentUtilities === null ? next.rental.independentUtilities : { value: fact.independentUtilities, priority: fact.priority, provenance: priorHistory(next.rental.independentUtilities?.provenance, source) },
        };
        break;
      case 'PREFERENCE': {
        const old = next.preferences.find(item => item.kind === fact.kind && item.value.toLowerCase() === fact.value.toLowerCase());
        const entry = { id: old?.id ?? id(), kind: fact.kind, value: fact.value, priority: fact.priority, provenance: priorHistory(old?.provenance, source) };
        if (old) next.preferences = next.preferences.map(item => item.id === old.id ? entry : item); else next.preferences.push(entry);
        break;
      }
      case 'BUDGET':
        next.budget = { target: fact.target ?? next.budget.target, maximum: fact.maximum ?? next.budget.maximum, flexibility: fact.flexibility ?? next.budget.flexibility, provenance: priorHistory(next.budget.provenance, source) };
        break;
      case 'TIMELINE':
        next.timeline = { desiredStart: fact.desiredStart ?? next.timeline.desiredStart, desiredCompletion: fact.desiredCompletion ?? next.timeline.desiredCompletion, flexibility: fact.flexibility ?? next.timeline.flexibility, urgency: fact.urgency ?? next.timeline.urgency, provenance: priorHistory(next.timeline.provenance, source) };
        break;
      case 'VAASHTU': next.vaasthuPreference = { value: fact.level, provenance: priorHistory(next.vaasthuPreference?.provenance, source) }; break;
      case 'FUTURE_EXPANSION': {
        const old = next.futureExpansion.find(item => item.kind === fact.kind && item.description.toLowerCase() === fact.description.toLowerCase());
        if (!old) next.futureExpansion.push({ id: id(), kind: fact.kind, description: fact.description, priority: fact.priority, provenance: source });
        break;
      }
    }
  }
  return propertyRequirementsSchema.parse(next);
}

function addSiteDiscrepancies(existing: SiteDiscrepancy[], claims: RequirementsAiResponse['siteClaims'], site: Site | null, messageId: string, id: () => string) {
  const result = [...existing];
  for (const claim of claims) {
    const savedValue = canonicalSiteValue(site, claim.field);
    if (siteValuesMatch(savedValue, claim.value) || result.some(item => item.status === 'OPEN' && item.field === claim.field && item.statedValue === claim.value)) continue;
    result.push({ id: id(), field: claim.field, savedValue, statedValue: claim.value, sourceMessageId: messageId, status: 'OPEN', resolution: null });
  }
  return result;
}

function removeProvenance(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeProvenance);
  if (value && typeof value === 'object') {
    const copy = { ...(value as Record<string, unknown>) };
    delete copy.provenance;
    return Object.fromEntries(Object.entries(copy).map(([key, child]) => [key, removeProvenance(child)]));
  }
  return value;
}
function preserveManualProvenance(nextValue: unknown, previousValue: unknown, actorId: string): unknown {
  if (Array.isArray(nextValue)) {
    const previous = Array.isArray(previousValue) ? previousValue : [];
    return nextValue.map(value => {
      const object = value as Record<string, unknown>;
      const old = object && typeof object.id === 'string' ? previous.find(item => (item as Record<string, unknown>).id === object.id) : undefined;
      return preserveManualProvenance(value, old, actorId);
    });
  }
  if (!nextValue || typeof nextValue !== 'object') return nextValue;
  const next = nextValue as Record<string, unknown>;
  const old = previousValue && typeof previousValue === 'object' ? previousValue as Record<string, unknown> : {};
  const nextProvenance = next.provenance as RequirementProvenance | null | undefined;
  const oldProvenance = old.provenance as RequirementProvenance | null | undefined;
  if (nextProvenance && typeof nextProvenance === 'object') {
    const changed = stableJson(removeProvenance(next)) !== stableJson(removeProvenance(old));
    const current = provenance('MANUALLY_EDITED', actorId, oldProvenance?.current.sourceMessageId ?? null, null);
    next.provenance = changed ? priorHistory(oldProvenance, current) : oldProvenance ?? current;
  }
  for (const [key, child] of Object.entries(next)) if (key !== 'provenance') next[key] = preserveManualProvenance(child, old[key], actorId);
  return next;
}

export class RequirementsInterviewService {
  constructor(
    private readonly uow: RequirementsUnitOfWork,
    private readonly aiProvider: RequirementsAiProvider | null,
    private readonly id: () => string,
    private readonly now: () => Date,
  ) {}

  private async authorized(repo: RequirementsRepository, actor: { userId: string }, projectId: string, lock = false) {
    idSchema.parse(actor.userId); idSchema.parse(projectId);
    const authorized = await repo.find(actor, projectId, lock);
    if (!authorized) throw new DomainError('NOT_FOUND', 'Project not found.');
    if (authorized.role !== 'OWNER') throw new DomainError('FORBIDDEN', 'Only the project owner can manage requirements.');
    return authorized.project;
  }
  private view(project: { id: string; currentRevision: number; currentVersion: { id: string; snapshot: unknown } }, interview: RequirementsInterview | null): RequirementsInterviewView {
    const snapshot = normalizeProjectSnapshot(project.currentVersion.snapshot);
    const reqs = snapshot.schemaVersion === 3 ? snapshot.requirements : null;
    const site = snapshot.site;
    // Older open drafts may not yet have copied the known type. Derive it in the view;
    // approved interviews and snapshots remain exactly as recorded.
    const isDraft = interview !== null && !['APPROVED', 'SUPERSEDED'].includes(interview.status);
    if (isDraft && interview && !interview.candidate.requirements.buildingIntent) {
      const requirements = requirementsWithProjectType(interview.candidate.requirements, snapshot.propertyType);
      interview = { ...interview, candidate: { ...interview.candidate, requirements, questions: requiredQuestions(requirements) } };
    }
    const propertyTypeMismatch = {
      approved: reqs !== null && !requirementsMatchProjectType(reqs, snapshot.propertyType),
      draft: isDraft && interview !== null && !requirementsMatchProjectType(interview.candidate.requirements, snapshot.propertyType),
    };
    const activeRequirements = isDraft && interview ? interview.candidate.requirements : reqs;
    const completeness = activeRequirements ? requirementsCompleteness(activeRequirements) : null;
    if (completeness && (isDraft ? propertyTypeMismatch.draft : propertyTypeMismatch.approved)) {
      const item = { key: 'buildingIntent.projectMismatch', category: 'REQUIRED' as const, complete: false,
        prompt: 'The brief uses a different property type. Start a fresh requirements draft and review it against Project Details.' };
      completeness.items.push(item); completeness.blockingItems.push(item); completeness.complete = false;
    }
    return { projectId: project.id, projectRevision: project.currentRevision, versionId: project.currentVersion.id,
      propertyType: snapshot.propertyType, propertyTypeMismatch,
      status: interview?.status ?? 'NOT_STARTED', siteContext: siteContext(site), approvedRequirements: reqs,
      interview, completeness };
  }
  async get(actor: { userId: string }, projectId: string): Promise<RequirementsInterviewView> {
    const project = await this.authorized(this.uow.read, actor, projectId);
    const interview = await this.uow.read.interview(projectId);
    return this.view(project, interview);
  }
  async start(actor: { userId: string }, projectId: string, input: unknown): Promise<RequirementsInterviewView> {
    const request = startSchema.parse(input);
    return this.uow.transaction(async repo => {
      const project = await this.authorized(repo, actor, projectId, true);
      if (project.currentRevision !== request.expectedRevision) throw new DomainError('CONFLICT', 'The project changed. Refresh the Requirements page before continuing.');
      const current = await repo.interview(projectId);
      if (current && current.status !== 'APPROVED' && current.status !== 'SUPERSEDED') {
        if (current.expectedProjectRevision === project.currentRevision
          && (!current.candidate.requirements.buildingIntent || requirementsMatchProjectType(current.candidate.requirements, normalizeProjectSnapshot(project.currentVersion.snapshot).propertyType))) return this.view(project, current);
        const stale = { ...current, status: 'SUPERSEDED' as const, updatedAt: this.now().toISOString() };
        await repo.saveInterview(stale);
      }
      const wasReopen = current?.status === 'APPROVED' || current?.status === 'SUPERSEDED';
      const carryDraft = current !== null && current.status !== 'APPROVED';
      const baseRequirements = carryDraft && current ? current.candidate.requirements : versionRequirements(project) ?? emptyPropertyRequirements();
      const currentSnapshot = normalizeProjectSnapshot(project.currentVersion.snapshot);
      let draftCandidate = makeCandidate(baseRequirements);
      if (carryDraft && current) {
        const site = currentSnapshot.site;
        const siteDiscrepancies = current.candidate.siteDiscrepancies.map(item => item.status === 'OPEN' && siteValuesMatch(canonicalSiteValue(site, item.field), item.statedValue)
          ? { ...item, status: 'RESOLVED' as const, resolution: 'The saved Site record now matches the owner statement.' }
          : item);
        draftCandidate = interviewCandidateSchema.parse({ ...current.candidate, siteDiscrepancies, lastAiError: null });
      }
      const requirements = requirementsWithProjectType(draftCandidate.requirements, currentSnapshot.propertyType);
      draftCandidate = { ...draftCandidate, requirements, questions: requiredQuestions(requirements) };
      const next = candidateWithStatus(draftCandidate);
      const candidate = next.candidate;
      const timestamp = this.now().toISOString();
      const interview: Omit<RequirementsInterview, 'messages'> = { id: this.id(), projectId, ownerId: actor.userId,
        status: next.status, candidate, expectedProjectRevision: project.currentRevision, approvedProjectVersionId: null,
        createdAt: timestamp, updatedAt: timestamp };
      await repo.createInterview(interview);
      const message: InterviewMessage = { id: this.id(), interviewId: interview.id, role: 'ASSISTANT',
        content: `Project type: ${propertyTypeLabel(currentSnapshot.propertyType)}, from Project Details. ` + (carryDraft ? 'A fresh interview is open with your current requirements draft carried forward. Review the updated saved Site context, then tell me what you would like to change.'
          : wasReopen ? 'A new requirements draft is open, starting from the latest approved brief. Tell me what you would like to change.'
          : 'Tell me what you want to build. I’ll turn your requests into a structured brief and ask about missing details. You can edit the brief manually at any time.'),
        createdAt: timestamp, provider: null, model: null };
      await repo.appendInterviewMessage(message);
      await repo.audit({ id: this.id(), projectId, projectVersionId: project.currentVersion.id, actorId: actor.userId,
        action: wasReopen ? 'REQUIREMENTS_INTERVIEW_REOPENED' : 'REQUIREMENTS_INTERVIEW_STARTED', before: current?.id ?? null, after: { interviewId: interview.id }, source: 'HUMAN' });
      return this.view(project, { ...interview, messages: [message] });
    });
  }
  async editBrief(actor: { userId: string }, projectId: string, input: unknown): Promise<RequirementsInterviewView> {
    const request = briefSchema.parse(input);
    return this.uow.transaction(async repo => {
      const project = await this.authorized(repo, actor, projectId, true);
      if (project.currentRevision !== request.expectedRevision) throw new DomainError('CONFLICT', 'The project changed. Refresh the Requirements page before saving.');
      const interview = await repo.interview(projectId);
      if (!interview || interview.status === 'APPROVED' || interview.status === 'SUPERSEDED') throw new DomainError('CONFLICT', 'Start a new requirements interview before editing this brief.');
      if (interview.expectedProjectRevision !== project.currentRevision) throw new DomainError('CONFLICT', 'The project changed during this interview. Start a fresh draft with the current Site data.');
      const before = interview.candidate.requirements;
      const propertyType = normalizeProjectSnapshot(project.currentVersion.snapshot).propertyType;
      if (request.requirements.buildingIntent && !requirementsMatchProjectType(request.requirements, propertyType)) {
        throw new DomainError('INVALID_INPUT', 'Property type comes from Project Details. Change it there, then start a fresh requirements draft.');
      }
      const requirements = requirementsWithProjectType(propertyRequirementsSchema.parse(preserveManualProvenance(request.requirements, before, actor.userId)), propertyType);
      const detected = detectRequirementConflicts(requirements, before, { messageId: null, explicitCorrection: true, id: this.id });
      const conflicts = mergeConflicts(interview.candidate.conflicts, detected);
      const candidate = interviewCandidateSchema.parse({ ...interview.candidate, requirements, questions: requiredQuestions(requirements), conflicts, lastAiError: null });
      const state = candidateWithStatus(candidate);
      const updated = { ...interview, candidate: state.candidate, status: state.status, updatedAt: this.now().toISOString(), expectedProjectRevision: project.currentRevision };
      await repo.saveInterview(updated);
      if (stableJson(before) !== stableJson(requirements)) await repo.audit({ id: this.id(), projectId, projectVersionId: project.currentVersion.id, actorId: actor.userId,
        action: 'REQUIREMENTS_MANUALLY_EDITED', before: { interviewId: interview.id, requirements: before }, after: { interviewId: interview.id, requirements, reason: request.changeReason }, source: 'HUMAN' });
      return this.view(project, { ...updated, messages: interview.messages });
    });
  }
  async resolveConflict(actor: { userId: string }, projectId: string, input: unknown): Promise<RequirementsInterviewView> {
    const request = resolveSchema.parse(input);
    return this.uow.transaction(async repo => {
      const project = await this.authorized(repo, actor, projectId, true);
      if (project.currentRevision !== request.expectedRevision) throw new DomainError('CONFLICT', 'The project changed. Refresh the Requirements page before continuing.');
      const interview = await repo.interview(projectId);
      if (!interview || interview.status === 'APPROVED' || interview.status === 'SUPERSEDED') throw new DomainError('CONFLICT', 'There is no open interview to update.');
      if (interview.expectedProjectRevision !== project.currentRevision) throw new DomainError('CONFLICT', 'The project changed during this interview. Start a fresh draft before resolving conflicts.');
      const conflict = interview.candidate.conflicts.find(item => item.id === request.conflictId && item.status === 'OPEN');
      if (!conflict) throw new DomainError('NOT_FOUND', 'Open conflict not found.');
      const candidate = { ...interview.candidate, conflicts: interview.candidate.conflicts.map(item => item.id === conflict.id ? { ...item, status: 'RESOLVED' as const, resolution: request.resolution } : item) };
      const state = candidateWithStatus(interviewCandidateSchema.parse(candidate));
      const updated = { ...interview, candidate: state.candidate, status: state.status, updatedAt: this.now().toISOString() };
      await repo.saveInterview(updated);
      await repo.audit({ id: this.id(), projectId, projectVersionId: project.currentVersion.id, actorId: actor.userId,
        action: 'REQUIREMENTS_CONFLICT_RESOLVED', before: conflict, after: { resolution: request.resolution }, source: 'HUMAN' });
      return this.view(project, { ...updated, messages: interview.messages });
    });
  }
  async resolveSiteDiscrepancy(actor: { userId: string }, projectId: string, input: unknown): Promise<RequirementsInterviewView> {
    const request = resolveSiteSchema.parse(input);
    return this.uow.transaction(async repo => {
      const project = await this.authorized(repo, actor, projectId, true);
      if (project.currentRevision !== request.expectedRevision) throw new DomainError('CONFLICT', 'The project changed. Refresh the Requirements page before continuing.');
      const interview = await repo.interview(projectId);
      if (!interview || interview.status === 'APPROVED' || interview.status === 'SUPERSEDED') throw new DomainError('CONFLICT', 'There is no open interview to update.');
      if (interview.expectedProjectRevision !== project.currentRevision) throw new DomainError('CONFLICT', 'The project changed during this interview. Start a fresh draft before resolving Site differences.');
      const discrepancy = interview.candidate.siteDiscrepancies.find(item => item.id === request.discrepancyId && item.status === 'OPEN');
      if (!discrepancy) throw new DomainError('NOT_FOUND', 'Open Site discrepancy not found.');
      const candidate = { ...interview.candidate, siteDiscrepancies: interview.candidate.siteDiscrepancies.map(item => item.id === discrepancy.id ? { ...item, status: 'RESOLVED' as const, resolution: request.resolution } : item) };
      const state = candidateWithStatus(interviewCandidateSchema.parse(candidate));
      const updated = { ...interview, candidate: state.candidate, status: state.status, updatedAt: this.now().toISOString() };
      await repo.saveInterview(updated);
      await repo.audit({ id: this.id(), projectId, projectVersionId: project.currentVersion.id, actorId: actor.userId,
        action: 'REQUIREMENTS_CONFLICT_RESOLVED', before: discrepancy, after: { resolution: request.resolution, siteUnchanged: true }, source: 'HUMAN' });
      return this.view(project, { ...updated, messages: interview.messages });
    });
  }

  async sendMessage(actor: { userId: string }, projectId: string, input: unknown): Promise<RequirementsInterviewView> {
    const request = ownerMessageSchema.parse(input);
    const persisted = await this.uow.transaction(async repo => {
      const project = await this.authorized(repo, actor, projectId, true);
      if (project.currentRevision !== request.expectedRevision) throw new DomainError('CONFLICT', 'The project changed. Refresh the Requirements page before sending another message.');
      const interview = await repo.interview(projectId);
      if (!interview || interview.status === 'APPROVED' || interview.status === 'SUPERSEDED') throw new DomainError('CONFLICT', 'Start or reopen a requirements interview before sending a message.');
      if (interview.expectedProjectRevision !== project.currentRevision) throw new DomainError('CONFLICT', 'The project changed during this interview. Start a fresh draft with the current Site data.');
      const timestamp = this.now().toISOString();
      const message: InterviewMessage = { id: this.id(), interviewId: interview.id, role: 'OWNER', content: request.content, createdAt: timestamp, provider: null, model: null };
      const candidate = interviewCandidateSchema.parse({ ...interview.candidate, lastOwnerMessageId: message.id, lastAiError: null });
      const updated = { ...interview, candidate, status: 'IN_PROGRESS' as const, updatedAt: timestamp };
      await repo.appendInterviewMessage(message); await repo.saveInterview(updated);
      return { project, interview: { ...updated, messages: [...interview.messages, message] }, message };
    });
    return this.generateReply(actor.userId, projectId, persisted.interview, persisted.project);
  }
  async retry(actor: { userId: string }, projectId: string, input: unknown): Promise<RequirementsInterviewView> {
    const request = idInputSchema.parse(input);
    const { project, interview } = await this.uow.transaction(async repo => {
      const project = await this.authorized(repo, actor, projectId, true);
      if (project.currentRevision !== request.expectedRevision) throw new DomainError('CONFLICT', 'The project changed. Refresh the Requirements page before retrying.');
      const interview = await repo.interview(projectId);
      if (!interview || !interview.candidate.lastOwnerMessageId || interview.status === 'APPROVED' || interview.status === 'SUPERSEDED') throw new DomainError('CONFLICT', 'There is no saved owner message to retry.');
      if (interview.expectedProjectRevision !== project.currentRevision) throw new DomainError('CONFLICT', 'The project changed during this interview. Start a fresh draft before retrying.');
      return { project, interview };
    });
    return this.generateReply(actor.userId, projectId, interview, project);
  }
  private async generateReply(actorId: string, projectId: string, interview: RequirementsInterview, project: { id: string; currentRevision: number; currentVersion: { id: string; snapshot: unknown } }) {
    const ownerMessage = interview.messages.find(message => message.id === interview.candidate.lastOwnerMessageId);
    if (!ownerMessage) throw new DomainError('CONFLICT', 'The saved owner message is unavailable.');
    const snapshot = normalizeProjectSnapshot(project.currentVersion.snapshot);
    const site = snapshot.site;
    if (!this.aiProvider) return this.persistAiFailure(actorId, projectId, interview, project, new AiUnavailableError(), 0, 0, 0, 0);
    const startTime = Date.now();
    let retries = 0, inputTokens = 0, outputTokens = 0, rawOutput: unknown;
    try {
      const requestBase = {
        systemPrompt: requirementsInterviewSystemPrompt,
        input: { propertyType: snapshot.propertyType, ownerMessage: ownerMessage.content, currentCandidate: requirementsWithProjectType(interview.candidate.requirements, snapshot.propertyType), siteContext: siteContext(site), recentMessages: interview.messages.slice(-5).map(message => ({ role: message.role, content: message.content })) },
        schemaName: 'property_requirements_interview_turn',
        schema: z.toJSONSchema(requirementsAiResponseSchema) as Record<string, unknown>,
      };
      let result = await this.aiProvider.generateStructured(requestBase);
      rawOutput = result.output; inputTokens += result.usage?.inputTokens ?? 0; outputTokens += result.usage?.outputTokens ?? 0;
      let parsed = requirementsAiResponseSchema.safeParse(result.output);
      if (!parsed.success) {
        retries = 1;
        result = await this.aiProvider.generateStructured({ ...requestBase, repairOutput: rawOutput });
        rawOutput = result.output; inputTokens += result.usage?.inputTokens ?? 0; outputTokens += result.usage?.outputTokens ?? 0;
        parsed = requirementsAiResponseSchema.safeParse(result.output);
      }
      if (!parsed.success) throw new AiInvalidOutputError(rawOutput);
      const generated = parsed.data;
      return this.uow.transaction(async repo => {
        const currentProject = await this.authorized(repo, { userId: actorId }, projectId, true);
        if (currentProject.currentRevision !== interview.expectedProjectRevision) throw new DomainError('CONFLICT', 'The project changed while the assistant was working. Refresh the Requirements page.');
        const current = await repo.interview(projectId);
        if (!current || current.id !== interview.id || current.candidate.lastOwnerMessageId !== ownerMessage.id) throw new DomainError('CONFLICT', 'A newer message was submitted. Refresh the Requirements page.');
        const requirements = requirementsWithProjectType(addFact(current.candidate.requirements, generated, actorId, ownerMessage.id, ownerMessage.content, this.id), snapshot.propertyType);
        const detected = detectRequirementConflicts(requirements, current.candidate.requirements, { messageId: ownerMessage.id, explicitCorrection: generated.explicitCorrection || isClearCorrection(ownerMessage.content), id: this.id });
        const conflicts = mergeConflicts(current.candidate.conflicts, detected);
        const siteDiscrepancies = addSiteDiscrepancies(current.candidate.siteDiscrepancies, generated.siteClaims, site, ownerMessage.id, this.id);
        const lowQuestions = containsLowConfidence(requirements) ? ['Please confirm any low-confidence details in the Project Brief before approval.'] : [];
        // Follow-ups come from deterministic missing fields; provider questions must not
        // re-ask known canonical context or claim unsupported planning completeness.
        const questions = [...new Set([...requiredQuestions(requirements), ...lowQuestions])].slice(0, 12);
        const candidate = interviewCandidateSchema.parse({ ...current.candidate, requirements, conflicts, siteDiscrepancies, questions, lastAiError: null });
        const state = candidateWithStatus(candidate);
        const timestamp = this.now().toISOString();
        const assistantMessage: InterviewMessage = { id: this.id(), interviewId: current.id, role: 'ASSISTANT', content: generated.extractions.some(fact => fact.category === 'BUILDING_INTENT' && fact.value !== snapshot.propertyType)
          ? `The project type is ${propertyTypeLabel(snapshot.propertyType)}. To change it, update Project Details and start a fresh requirements draft. Other details from this message have been recorded.` : generated.assistantMessage, createdAt: timestamp, provider: this.aiProvider!.metadata.provider, model: this.aiProvider!.metadata.model };
        const updated = { ...current, candidate: state.candidate, status: state.status, updatedAt: timestamp };
        await repo.appendInterviewMessage(assistantMessage); await repo.saveInterview(updated);
        await repo.recordAiRequest({ id: this.id(), interviewId: current.id, provider: this.aiProvider!.metadata.provider, model: this.aiProvider!.metadata.model,
          requestType: 'INTERPRET_OWNER_MESSAGE', occurredAt: timestamp, succeeded: true, latencyMs: Date.now() - startTime,
          inputTokens: inputTokens || null, outputTokens: outputTokens || null, retryCount: retries });
        return this.view(currentProject, { ...updated, messages: [...current.messages, assistantMessage] });
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'CONFLICT') throw error;
      return this.persistAiFailure(actorId, projectId, interview, project, error, Date.now() - startTime, inputTokens, outputTokens, retries);
    }
  }
  private async persistAiFailure(actorId: string, projectId: string, interview: RequirementsInterview, _project: { id: string; currentRevision: number; currentVersion: { id: string; snapshot: unknown } }, error: unknown, latencyMs: number, inputTokens: number, outputTokens: number, retryCount: number): Promise<never> {
    let code: InterviewCandidate['lastAiError'] = 'AI_PROVIDER_FAILED';
    if (error instanceof AiUnavailableError) code = 'AI_UNAVAILABLE';
    else if (error instanceof AiInvalidOutputError || error instanceof z.ZodError) code = 'AI_INVALID_OUTPUT';
    const provider = this.aiProvider?.metadata.provider ?? 'unconfigured';
    const model = this.aiProvider?.metadata.model ?? 'unconfigured';
    await this.uow.transaction(async repo => {
      await this.authorized(repo, { userId: actorId }, projectId, true);
      const current = await repo.interview(projectId);
      if (!current || current.id !== interview.id || current.candidate.lastOwnerMessageId !== interview.candidate.lastOwnerMessageId) throw new DomainError('CONFLICT', 'A newer message was submitted. Refresh the Requirements page.');
      const candidate = interviewCandidateSchema.parse({ ...current.candidate, lastAiError: code });
      const updated = { ...current, candidate, status: 'IN_PROGRESS' as const, updatedAt: this.now().toISOString() };
      await repo.saveInterview(updated);
      await repo.recordAiRequest({ id: this.id(), interviewId: current.id, provider, model, requestType: 'INTERPRET_OWNER_MESSAGE', occurredAt: this.now().toISOString(), succeeded: false, latencyMs, inputTokens: inputTokens || null, outputTokens: outputTokens || null, retryCount });
    });
    if (code === 'AI_UNAVAILABLE') throw new DomainError('AI_UNAVAILABLE', 'AI is not configured. Your message is saved; edit the Project Brief manually or retry later.');
    if (code === 'AI_INVALID_OUTPUT') throw new DomainError('AI_INVALID_OUTPUT', 'The assistant returned unusable structured data. Your message is saved; retry or edit the brief manually.');
    throw new DomainError('AI_PROVIDER_FAILED', 'The assistant is temporarily unavailable. Your message is saved; retry or edit the brief manually.');
  }

  async approve(actor: { userId: string }, projectId: string, input: unknown): Promise<RequirementsInterviewView> {
    const request = idInputSchema.parse(input);
    return this.uow.transaction(async repo => {
      const project = await this.authorized(repo, actor, projectId, true);
      if (project.currentRevision !== request.expectedRevision) throw new DomainError('CONFLICT', 'This project changed since you reviewed the brief. Reload before approving.');
      const interview = await repo.interview(projectId);
      if (!interview || interview.status === 'APPROVED' || interview.status === 'SUPERSEDED') throw new DomainError('CONFLICT', 'There is no open requirements brief to approve.');
      if (interview.expectedProjectRevision !== project.currentRevision) throw new DomainError('CONFLICT', 'The project changed during this interview. Start a fresh requirements revision with the current Site data.');
      if (!requirementsMatchProjectType(interview.candidate.requirements, normalizeProjectSnapshot(project.currentVersion.snapshot).propertyType)) {
        throw new DomainError('CONFLICT', 'The brief does not match the project property type. Start a fresh requirements draft and review it before approval.');
      }
      const completeness = requirementsCompleteness(interview.candidate.requirements);
      if (!completeness.complete) throw new DomainError('INVALID_INPUT', 'Complete the required Project Brief fields before approval.');
      if (interview.candidate.conflicts.some(item => item.status === 'OPEN')) throw new DomainError('CONFLICT', 'Resolve all blocking requirement conflicts before approval.');
      const currentContradictions = detectRequirementConflicts(interview.candidate.requirements, null, { messageId: null, explicitCorrection: true, id: this.id });
      if (currentContradictions.length > 0) throw new DomainError('CONFLICT', 'Edit contradictory counts, priorities, or budget values before approval.');
      if (interview.candidate.siteDiscrepancies.some(item => item.status === 'OPEN')) throw new DomainError('CONFLICT', 'Review the saved Site information and resolve its discrepancies before approval.');
      if (containsLowConfidence(interview.candidate.requirements)) throw new DomainError('CONFLICT', 'Confirm or manually edit low-confidence requirements before approval.');
      const snapshot = withRequirements(project.currentVersion.snapshot, interview.candidate.requirements);
      const revision = project.currentRevision + 1, timestamp = this.now().toISOString();
      const hasAiOrigin = interview.messages.some(message => message.role === 'ASSISTANT' && message.provider !== null);
      const updatedProject = { ...project, currentRevision: revision, updatedAt: timestamp, currentVersion: {
        id: this.id(), projectId, revision, snapshot, createdBy: actor.userId, createdAt: timestamp,
        source: hasAiOrigin ? 'AI' as const : 'HUMAN' as const, changeReason: 'Owner approved Property Requirements brief',
      } };
      await repo.appendVersion(updatedProject, project.currentRevision);
      await repo.audit({ id: this.id(), projectId, projectVersionId: updatedProject.currentVersion.id, actorId: actor.userId,
        action: 'REQUIREMENTS_APPROVED', before: project.currentVersion.snapshot, after: snapshot, source: hasAiOrigin ? 'AI' : 'HUMAN' });
      const approved = { ...interview, status: 'APPROVED' as const, expectedProjectRevision: revision, approvedProjectVersionId: updatedProject.currentVersion.id, updatedAt: timestamp };
      await repo.saveInterview(approved);
      return this.view(updatedProject, { ...approved, messages: interview.messages });
    });
  }
}
