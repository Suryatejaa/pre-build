'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { propertyTypeLabel, emptyPropertyRequirements, type PropertyRequirements, type RequirementProvenance, type RequirementsInterviewView } from '@property/domain';

const manualProvenance: RequirementProvenance = { current: { kind: 'MANUALLY_EDITED', sourceMessageId: null, actorId: null, confidence: null }, history: [] };
const spaceTypes: PropertyRequirements['spaces'][number]['type'][] = ['BEDROOM','BATHROOM','LIVING_ROOM','FAMILY_LOUNGE','KITCHEN','DINING','PUJA_ROOM','HOME_OFFICE','STUDY','UTILITY','STORE_ROOM','BALCONY','TERRACE','PARKING','GARAGE','GARDEN','COURTYARD','STAFF_ROOM','RENTAL_UNIT','COMMERCIAL_SPACE','OTHER'];
const priorityLabels = ['MUST_HAVE','PREFERRED','OPTIONAL','AVOID'] as const;
const counts = (value: PropertyRequirements['spaces'][number]['count'], key: 'exact' | 'minimum' | 'maximum' | 'preferred', raw: string) => {
  const parsed = raw.trim() ? Number(raw) : undefined;
  const next = { ...value };
  if (parsed === undefined) delete next[key]; else if (Number.isInteger(parsed) && parsed >= 0) next[key] = parsed;
  return next;
};
const stamp = () => structuredClone(manualProvenance);
const valueField = <T,>(value: T) => ({ value, provenance: stamp() });
const blankSpace = (): PropertyRequirements['spaces'][number] => ({ id: crypto.randomUUID(), type: 'BEDROOM', customName: null, count: {}, floor: { kind: 'UNSPECIFIED' }, size: { kind: 'NO_PREFERENCE' }, priority: 'PREFERRED', provenance: stamp() });
const pretty = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const provenanceLabel = (kind?: string) => ({ DIRECTLY_STATED: 'From your message', AI_INTERPRETED: 'AI interpretation · review', AI_SUGGESTED_ACCEPTED: 'Suggestion you accepted', MANUALLY_EDITED: 'Edited by you', IMPORTED: 'Imported', PROJECT_CONTEXT: 'From Project Details' }[kind ?? ''] ?? 'Not yet specified');
function hasLowConfidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasLowConfidence);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const current = record.current as Record<string, unknown> | undefined;
  if (current?.confidence === 'LOW' && current.kind !== 'MANUALLY_EDITED') return true;
  return Object.entries(record).some(([key, child]) => key !== 'history' && key !== 'current' && hasLowConfidence(child));
}
function countLabel(count: PropertyRequirements['spaces'][number]['count']) {
  if (count.exact !== undefined) return `exactly ${count.exact}`;
  return [count.minimum !== undefined ? `minimum ${count.minimum}` : '', count.maximum !== undefined ? `maximum ${count.maximum}` : '', count.preferred !== undefined ? `prefer ${count.preferred}` : ''].filter(Boolean).join(', ') || 'count not specified';
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="requirements-field">{label}{children}</label>; }
function Select({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: readonly string[]; placeholder?: string }) {
  return <select value={value} onChange={event => onChange(event.target.value)}>{placeholder && <option value="">{placeholder}</option>}{options.map(option => <option key={option} value={option}>{pretty(option)}</option>)}</select>;
}
function BriefView({ requirements }: { requirements: PropertyRequirements }) {
  const evidence = (kind?: string) => <span className={`evidence-tag${kind === 'AI_INTERPRETED' ? ' inferred' : ''}`}>{provenanceLabel(kind)}</span>;
  const hasFloorCount = Object.values(requirements.buildingScale.floorCount.value).some(value => value !== undefined);
  return <div className="brief-sections">
    <section className="brief-section"><h3>Building</h3><p>{requirements.buildingIntent ? propertyTypeLabel(requirements.buildingIntent.value.kind) : 'Not specified'} {requirements.buildingIntent?.value.otherDescription ? `· ${requirements.buildingIntent.value.otherDescription}` : ''}</p>{requirements.buildingIntent && evidence(requirements.buildingIntent.provenance.current.kind)}
      {hasFloorCount ? <><p>{countLabel(requirements.buildingScale.floorCount.value)} floor{requirements.buildingScale.floorCount.value.exact === 1 ? '' : 's'} · {pretty(requirements.buildingScale.floorCount.priority)}</p>{evidence(requirements.buildingScale.floorCount.provenance.current.kind)}</> : <p>Floor count not specified.</p>}
      {requirements.buildingScale.basement && <p>Basement: {requirements.buildingScale.basement.value ? 'requested' : 'not requested'}</p>}
      {requirements.buildingScale.lift && <p>Lift: {requirements.buildingScale.lift.value ? 'requested' : 'not requested'}</p>}
      {requirements.buildingScale.futureAdditionalFloors && <p>Possible future floors: {requirements.buildingScale.futureAdditionalFloors.value}</p>}
      {requirements.buildingScale.terraceUse && <p>Terrace: {requirements.buildingScale.terraceUse.value}</p>}
    </section>
    <section className="brief-section"><h3>Occupancy &amp; access</h3><p>{requirements.occupancy.householdSize ? `${requirements.occupancy.householdSize.value} people expected` : 'Household size not specified'}</p>{requirements.occupancy.elderlyOccupants && <p>{requirements.occupancy.elderlyOccupants.value} elderly occupant(s)</p>}{requirements.occupancy.accessibilityNeedsConfirmed && <p>Accessibility needs: {requirements.occupancy.accessibilityNeedsConfirmed.value ? 'listed below' : 'none stated'}</p>}
      {requirements.accessibility.map(item => <p key={item.id}>{pretty(item.kind)} · {pretty(item.priority)} {evidence(item.provenance.current.kind)}</p>)}
    </section>
    <section className="brief-section"><h3>Spaces</h3>{requirements.spaces.length ? requirements.spaces.map(space => <p key={space.id}>{space.customName ?? pretty(space.type)} · {countLabel(space.count)} · {space.floor.kind === 'UNSPECIFIED' ? 'floor unspecified' : `${pretty(space.floor.kind)} ${'label' in space.floor ? `· ${space.floor.label}` : ''}`} · {pretty(space.priority)} {space.size.kind !== 'NO_PREFERENCE' && 'value' in space.size ? `· ${space.size.value} ${space.size.unit}` : ''}<br />{evidence(space.provenance.current.kind)}</p>) : <p>No spaces added yet.</p>}
      {requirements.relationships.map(item => { const from = requirements.spaces.find(space => space.id === item.fromSpaceId); const to = requirements.spaces.find(space => space.id === item.toSpaceId); return <p key={item.id}>{from?.customName ?? (from ? pretty(from.type) : 'Space')} {pretty(item.kind)} {to?.customName ?? (to ? pretty(to.type) : 'Space')} · {pretty(item.priority)}</p>; })}
    </section>
    <section className="brief-section"><h3>Parking</h3>{requirements.parking.length ? requirements.parking.map(item => <p key={item.id}>{pretty(item.vehicle)} · {countLabel(item.count)}{item.cover ? ` · ${pretty(item.cover)}` : ''}{item.evCharging ? ' · EV charging' : ''} · {pretty(item.priority)}</p>) : <p>No parking preference recorded.</p>}</section>
    <section className="brief-section"><h3>Utilities &amp; preferences</h3>{requirements.utilities.map(item => <p key={item.id}>{item.customName ?? pretty(item.kind)} · {pretty(item.priority)} {evidence(item.provenance.current.kind)}</p>)}{requirements.preferences.map(item => <p key={item.id}>{pretty(item.kind)}: {item.value} · {pretty(item.priority)} {evidence(item.provenance.current.kind)}</p>)}{!requirements.utilities.length && !requirements.preferences.length && <p>None recorded.</p>}</section>
    <section className="brief-section"><h3>Rental &amp; future use</h3><p>{requirements.rental.mode ? pretty(requirements.rental.mode.value) : 'Rental intent not specified'}</p>{requirements.rental.independentEntrance && <p>Independent entrance: {requirements.rental.independentEntrance.value ? 'preferred' : 'not requested'}</p>}{requirements.rental.independentUtilities && <p>Independent utilities: {requirements.rental.independentUtilities.value ? 'preferred' : 'not requested'}</p>}{requirements.futureExpansion.map(item => <p key={item.id}>{item.description} · {pretty(item.priority)}</p>)}</section>
    <section className="brief-section"><h3>Budget, timing &amp; Vaasthu</h3><p>Target budget: {requirements.budget.target ? `${requirements.budget.target.currency} ${requirements.budget.target.amount}` : 'Not specified'}</p><p>Maximum budget: {requirements.budget.maximum ? `${requirements.budget.maximum.currency} ${requirements.budget.maximum.amount}` : 'Not specified'}</p><p>Target dates: {requirements.timeline.desiredStart ?? 'Start not specified'} → {requirements.timeline.desiredCompletion ?? 'Completion not specified'}</p><p>Vaasthu preference: {requirements.vaasthuPreference ? pretty(requirements.vaasthuPreference.value) : 'Not specified'}</p></section>
  </div>;
}

function BriefEditor({ requirements, changeReason, setChangeReason, onChange, onSave, saving, disabled }: { requirements: PropertyRequirements; changeReason: string; setChangeReason: (value: string) => void; onChange: (change: (current: PropertyRequirements) => PropertyRequirements) => void; onSave: (event: FormEvent<HTMLFormElement>) => void; saving: boolean; disabled: boolean }) {
  const updateSpace = (id: string, change: (space: PropertyRequirements['spaces'][number]) => PropertyRequirements['spaces'][number]) => onChange(current => ({ ...current, spaces: current.spaces.map(space => space.id === id ? change(space) : space) }));
  return <details className="brief-editor" open>
    <summary>Edit Project Brief</summary>
    <form className="form-stack" onSubmit={onSave}>
      <div className="requirements-group"><h3>Building &amp; occupancy</h3><div className="field-grid">
        <div><span className="label">Property type · from Project Details</span><p>{requirements.buildingIntent ? propertyTypeLabel(requirements.buildingIntent.value.kind) : 'See Project Details'}</p><p className="help">Change property type in Project Details, then reopen this brief for review.</p></div>
        <Field label="Exact floor count"><input inputMode="numeric" value={requirements.buildingScale.floorCount.value.exact ?? ''} onChange={event => onChange(current => ({ ...current, buildingScale: { ...current.buildingScale, floorCount: { ...current.buildingScale.floorCount, value: counts(current.buildingScale.floorCount.value, 'exact', event.target.value) } } }))} /></Field>
        <Field label="Minimum floors"><input inputMode="numeric" value={requirements.buildingScale.floorCount.value.minimum ?? ''} onChange={event => onChange(current => ({ ...current, buildingScale: { ...current.buildingScale, floorCount: { ...current.buildingScale.floorCount, value: counts(current.buildingScale.floorCount.value, 'minimum', event.target.value) } } }))} /></Field>
        <Field label="Preferred floors"><input inputMode="numeric" value={requirements.buildingScale.floorCount.value.preferred ?? ''} onChange={event => onChange(current => ({ ...current, buildingScale: { ...current.buildingScale, floorCount: { ...current.buildingScale.floorCount, value: counts(current.buildingScale.floorCount.value, 'preferred', event.target.value) } } }))} /></Field>
        <Field label="Preferred additional floors in future"><input inputMode="numeric" value={requirements.buildingScale.futureAdditionalFloors?.value ?? ''} onChange={event => onChange(current => ({ ...current, buildingScale: { ...current.buildingScale, futureAdditionalFloors: event.target.value.trim() ? valueField(Number(event.target.value)) : null } }))} /></Field>
        <Field label="Household size (optional)"><input inputMode="numeric" value={requirements.occupancy.householdSize?.value ?? ''} onChange={event => onChange(current => ({ ...current, occupancy: { ...current.occupancy, householdSize: event.target.value.trim() ? { value: Number(event.target.value), provenance: current.occupancy.householdSize?.provenance ?? stamp() } : null } }))} /></Field>
        <Field label="Adults (optional)"><input inputMode="numeric" value={requirements.occupancy.adults?.value ?? ''} onChange={event => onChange(current => ({ ...current, occupancy: { ...current.occupancy, adults: event.target.value.trim() ? { value: Number(event.target.value), provenance: current.occupancy.adults?.provenance ?? stamp() } : null } }))} /></Field>
        <Field label="Children (optional)"><input inputMode="numeric" value={requirements.occupancy.children?.value ?? ''} onChange={event => onChange(current => ({ ...current, occupancy: { ...current.occupancy, children: event.target.value.trim() ? { value: Number(event.target.value), provenance: current.occupancy.children?.provenance ?? stamp() } : null } }))} /></Field>
        <Field label="Elderly occupants (optional)"><input inputMode="numeric" value={requirements.occupancy.elderlyOccupants?.value ?? ''} onChange={event => onChange(current => ({ ...current, occupancy: { ...current.occupancy, elderlyOccupants: event.target.value.trim() ? { value: Number(event.target.value), provenance: current.occupancy.elderlyOccupants?.provenance ?? stamp() } : null } }))} /></Field>
        <Field label="Expected guests (optional)"><input inputMode="numeric" value={requirements.occupancy.expectedGuests?.value ?? ''} onChange={event => onChange(current => ({ ...current, occupancy: { ...current.occupancy, expectedGuests: event.target.value.trim() ? { value: Number(event.target.value), provenance: current.occupancy.expectedGuests?.provenance ?? stamp() } : null } }))} /></Field>
        <Field label="Rental intent"><Select value={requirements.rental.mode?.value ?? ''} placeholder="Choose rental intent" options={['OWNER_ONLY','RENTAL_FLOOR','INDEPENDENT_RENTAL_UNIT','MULTIPLE_UNITS']} onChange={value => onChange(current => ({ ...current, rental: { ...current.rental, mode: value ? { value: value as NonNullable<PropertyRequirements['rental']['mode']>['value'], provenance: current.rental.mode?.provenance ?? stamp() } : null } }))} /></Field>
        <Field label="Vaasthu preference"><Select value={requirements.vaasthuPreference?.value ?? ''} placeholder="No preference recorded" options={['NONE','BASIC','STRONG','STRICT']} onChange={value => onChange(current => ({ ...current, vaasthuPreference: value ? { value: value as NonNullable<PropertyRequirements['vaasthuPreference']>['value'], provenance: current.vaasthuPreference?.provenance ?? stamp() } : null }))} /></Field>
        <Field label="Terrace use (optional)"><input value={requirements.buildingScale.terraceUse?.value ?? ''} onChange={event => onChange(current => ({ ...current, buildingScale: { ...current.buildingScale, terraceUse: event.target.value.trim() ? { value: event.target.value, provenance: current.buildingScale.terraceUse?.provenance ?? stamp() } : null } }))} /></Field>
        <Field label="Staircase expectation (optional)"><input value={requirements.buildingScale.staircaseExpectation?.value ?? ''} onChange={event => onChange(current => ({ ...current, buildingScale: { ...current.buildingScale, staircaseExpectation: event.target.value.trim() ? { value: event.target.value, provenance: current.buildingScale.staircaseExpectation?.provenance ?? stamp() } : null } }))} /></Field>
      </div><div className="field-grid"><label><span>Basement</span><Select value={requirements.buildingScale.basement?.value === true ? 'YES' : requirements.buildingScale.basement?.value === false ? 'NO' : ''} placeholder="Not specified" options={['YES','NO']} onChange={value => onChange(current => ({ ...current, buildingScale: { ...current.buildingScale, basement: value ? valueField(value === 'YES') : null } }))} /></label><label><span>Lift</span><Select value={requirements.buildingScale.lift?.value === true ? 'YES' : requirements.buildingScale.lift?.value === false ? 'NO' : ''} placeholder="Not specified" options={['YES','NO']} onChange={value => onChange(current => ({ ...current, buildingScale: { ...current.buildingScale, lift: value ? valueField(value === 'YES') : null } }))} /></label></div></div>

      <div className="requirements-group"><div className="section-heading"><h3>Spaces</h3><button type="button" className="text-button" onClick={() => onChange(current => ({ ...current, spaces: [...current.spaces, blankSpace()] }))}>Add a space</button></div>
        {requirements.spaces.map((space, index) => <fieldset className="requirements-row" key={space.id}><legend>Space {index + 1}</legend><div className="field-grid">
          <Field label="Type"><Select value={space.type} options={spaceTypes} onChange={value => updateSpace(space.id, item => ({ ...item, type: value as typeof item.type }))} /></Field>
          {space.type === 'OTHER' && <Field label="Custom space name"><input value={space.customName ?? ''} onChange={event => updateSpace(space.id, item => ({ ...item, customName: event.target.value || null }))} /></Field>}
          <Field label="Exact count"><input inputMode="numeric" value={space.count.exact ?? ''} onChange={event => updateSpace(space.id, item => ({ ...item, count: counts(item.count, 'exact', event.target.value) }))} /></Field>
          <Field label="Minimum count"><input inputMode="numeric" value={space.count.minimum ?? ''} onChange={event => updateSpace(space.id, item => ({ ...item, count: counts(item.count, 'minimum', event.target.value) }))} /></Field>
          <Field label="Maximum count"><input inputMode="numeric" value={space.count.maximum ?? ''} onChange={event => updateSpace(space.id, item => ({ ...item, count: counts(item.count, 'maximum', event.target.value) }))} /></Field>
          <Field label="Preferred count"><input inputMode="numeric" value={space.count.preferred ?? ''} onChange={event => updateSpace(space.id, item => ({ ...item, count: counts(item.count, 'preferred', event.target.value) }))} /></Field>
          <Field label="Floor scope"><Select value={space.floor.kind} options={['ENTIRE_PROPERTY','SPECIFIC_FLOOR','PREFERRED_FLOOR','UNSPECIFIED']} onChange={value => updateSpace(space.id, item => ({ ...item, floor: value === 'SPECIFIC_FLOOR' || value === 'PREFERRED_FLOOR' ? { kind: value, label: 'Ground floor' } : { kind: value as 'ENTIRE_PROPERTY' | 'UNSPECIFIED' } }))} /></Field>
          {(space.floor.kind === 'SPECIFIC_FLOOR' || space.floor.kind === 'PREFERRED_FLOOR') && <Field label="Floor name"><input value={space.floor.label} onChange={event => updateSpace(space.id, item => ({ ...item, floor: { ...item.floor, label: event.target.value } }))} /></Field>}
          <Field label="Priority"><Select value={space.priority} options={priorityLabels} onChange={value => updateSpace(space.id, item => ({ ...item, priority: value as typeof item.priority }))} /></Field>
          <Field label="Size preference"><Select value={space.size.kind} options={['NO_PREFERENCE','EXACT','MINIMUM','PREFERRED']} onChange={value => updateSpace(space.id, item => ({ ...item, size: value === 'NO_PREFERENCE' ? { kind: 'NO_PREFERENCE' } : { kind: value as 'EXACT' | 'MINIMUM' | 'PREFERRED', value: '1', unit: 'm2' } }))} /></Field>
          {space.size.kind !== 'NO_PREFERENCE' && <><Field label="Size"><input inputMode="decimal" value={space.size.value} onChange={event => updateSpace(space.id, item => item.size.kind === 'NO_PREFERENCE' ? item : ({ ...item, size: { ...item.size, value: event.target.value } }))} /></Field><Field label="Size unit"><Select value={space.size.unit} options={['m2','ft2','yd2']} onChange={value => updateSpace(space.id, item => item.size.kind === 'NO_PREFERENCE' ? item : ({ ...item, size: { ...item.size, unit: value as 'm2' | 'ft2' | 'yd2' } }))} /></Field></>}
        </div><button type="button" className="text-button danger" onClick={() => onChange(current => ({ ...current, spaces: current.spaces.filter(item => item.id !== space.id), relationships: current.relationships.filter(item => item.fromSpaceId !== space.id && item.toSpaceId !== space.id) }))}>Remove space</button></fieldset>)}
        {!requirements.spaces.length && <p className="help">Add at least one requested space to complete the brief.</p>}
      </div>

      <div className="requirements-group"><div className="section-heading"><h3>Parking</h3><button type="button" className="text-button" onClick={() => onChange(current => ({ ...current, parking: [...current.parking, { id: crypto.randomUUID(), vehicle: 'CAR', count: {}, cover: null, evCharging: null, priority: 'PREFERRED', provenance: stamp() }] }))}>Add parking</button></div>
        {requirements.parking.map(item => <div className="requirements-row" key={item.id}><div className="field-grid"><Field label="Vehicle"><Select value={item.vehicle} options={['CAR','TWO_WHEELER','VISITOR_CAR','VISITOR_TWO_WHEELER']} onChange={value => onChange(current => ({ ...current, parking: current.parking.map(row => row.id === item.id ? { ...row, vehicle: value as typeof row.vehicle } : row) }))} /></Field><Field label="Exact count"><input inputMode="numeric" value={item.count.exact ?? ''} onChange={event => onChange(current => ({ ...current, parking: current.parking.map(row => row.id === item.id ? { ...row, count: counts(row.count, 'exact', event.target.value) } : row) }))} /></Field><Field label="Covered/open"><Select value={item.cover ?? ''} placeholder="No preference" options={['COVERED','OPEN','NO_PREFERENCE']} onChange={value => onChange(current => ({ ...current, parking: current.parking.map(row => row.id === item.id ? { ...row, cover: (value || null) as typeof row.cover } : row) }))} /></Field><Field label="Priority"><Select value={item.priority} options={priorityLabels} onChange={value => onChange(current => ({ ...current, parking: current.parking.map(row => row.id === item.id ? { ...row, priority: value as typeof row.priority } : row) }))} /></Field></div><button type="button" className="text-button danger" onClick={() => onChange(current => ({ ...current, parking: current.parking.filter(row => row.id !== item.id) }))}>Remove parking requirement</button></div>)}
      </div>

      <div className="requirements-group"><h3>Rental access</h3><div className="field-grid"><Field label="Independent entrance"><Select value={requirements.rental.independentEntrance?.value === true ? 'YES' : requirements.rental.independentEntrance?.value === false ? 'NO' : ''} placeholder="Not specified" options={['YES','NO']} onChange={value => onChange(current => ({ ...current, rental: { ...current.rental, independentEntrance: value ? { value: value === 'YES', priority: 'PREFERRED', provenance: current.rental.independentEntrance?.provenance ?? stamp() } : null } }))} /></Field><Field label="Independent utilities"><Select value={requirements.rental.independentUtilities?.value === true ? 'YES' : requirements.rental.independentUtilities?.value === false ? 'NO' : ''} placeholder="Not specified" options={['YES','NO']} onChange={value => onChange(current => ({ ...current, rental: { ...current.rental, independentUtilities: value ? { value: value === 'YES', priority: 'PREFERRED', provenance: current.rental.independentUtilities?.provenance ?? stamp() } : null } }))} /></Field></div></div>

      <div className="requirements-group"><div className="section-heading"><h3>Relationships</h3><button type="button" className="text-button" disabled={requirements.spaces.length < 2} onClick={() => onChange(current => ({ ...current, relationships: [...current.relationships, { id: crypto.randomUUID(), kind: 'NEAR', fromSpaceId: current.spaces[0]!.id, toSpaceId: current.spaces[1]!.id, floor: null, priority: 'PREFERRED', provenance: stamp() }] }))}>Add relationship</button></div>{requirements.relationships.map(item => <div className="requirements-row" key={item.id}><div className="field-grid"><Field label="Relationship"><Select value={item.kind} options={['NEAR','ATTACHED','ON_FLOOR','INDEPENDENT_ACCESS','NOT_DIRECTLY_FACING','SEPARATE_FROM']} onChange={value => onChange(current => ({ ...current, relationships: current.relationships.map(row => row.id === item.id ? { ...row, kind: value as typeof row.kind } : row) }))} /></Field><Field label="First space"><Select value={item.fromSpaceId} options={requirements.spaces.map(space => space.id)} onChange={value => onChange(current => ({ ...current, relationships: current.relationships.map(row => row.id === item.id ? { ...row, fromSpaceId: value } : row) }))} /></Field><Field label="Second space"><Select value={item.toSpaceId} options={requirements.spaces.map(space => space.id)} onChange={value => onChange(current => ({ ...current, relationships: current.relationships.map(row => row.id === item.id ? { ...row, toSpaceId: value } : row) }))} /></Field><Field label="Priority"><Select value={item.priority} options={priorityLabels} onChange={value => onChange(current => ({ ...current, relationships: current.relationships.map(row => row.id === item.id ? { ...row, priority: value as typeof row.priority } : row) }))} /></Field></div><button type="button" className="text-button danger" onClick={() => onChange(current => ({ ...current, relationships: current.relationships.filter(row => row.id !== item.id) }))}>Remove relationship</button></div>)}</div>

      <div className="requirements-group"><div className="section-heading"><h3>Accessibility</h3><button type="button" className="text-button" onClick={() => onChange(current => ({ ...current, accessibility: [...current.accessibility, { id: crypto.randomUUID(), kind: 'STEP_FREE_ENTRANCE', customName: null, floor: { kind: 'ENTIRE_PROPERTY' }, priority: 'PREFERRED', provenance: stamp() }] }))}>Add access need</button></div><Field label="Have accessibility needs been considered?"><Select value={requirements.occupancy.accessibilityNeedsConfirmed?.value === true ? 'YES' : requirements.occupancy.accessibilityNeedsConfirmed?.value === false ? 'NO' : ''} placeholder="Not yet confirmed" options={['YES','NO']} onChange={value => onChange(current => ({ ...current, occupancy: { ...current.occupancy, accessibilityNeedsConfirmed: value ? { value: value === 'YES', provenance: current.occupancy.accessibilityNeedsConfirmed?.provenance ?? stamp() } : null } }))} /></Field>{requirements.accessibility.map(item => <div className="requirements-row" key={item.id}><div className="field-grid"><Field label="Need"><Select value={item.kind} options={['STEP_FREE_ENTRANCE','GROUND_FLOOR_BEDROOM','ACCESSIBLE_BATHROOM','LIFT','WIDER_CIRCULATION','ELDERLY_FRIENDLY_BEDROOM','OTHER']} onChange={value => onChange(current => ({ ...current, accessibility: current.accessibility.map(row => row.id === item.id ? { ...row, kind: value as typeof row.kind } : row) }))} /></Field><Field label="Priority"><Select value={item.priority} options={priorityLabels} onChange={value => onChange(current => ({ ...current, accessibility: current.accessibility.map(row => row.id === item.id ? { ...row, priority: value as typeof row.priority } : row) }))} /></Field></div><button type="button" className="text-button danger" onClick={() => onChange(current => ({ ...current, accessibility: current.accessibility.filter(row => row.id !== item.id) }))}>Remove access need</button></div>)}</div>

      <div className="requirements-group"><div className="section-heading"><h3>Utilities, style &amp; expansion</h3><button type="button" className="text-button" onClick={() => onChange(current => ({ ...current, utilities: [...current.utilities, { id: crypto.randomUUID(), kind: 'SOLAR', customName: null, priority: 'PREFERRED', provenance: stamp() }] }))}>Add utility</button></div>{requirements.utilities.map(item => <div className="field-grid requirements-row" key={item.id}><Field label="Utility"><Select value={item.kind} options={['SOLAR','INVERTER_BATTERY','EV_CHARGING','RAINWATER_HARVESTING','BOREWELL','MUNICIPAL_WATER','UNDERGROUND_TANK','OVERHEAD_TANK','SEPTIC','SEWER','GENERATOR','SMART_HOME','OTHER']} onChange={value => onChange(current => ({ ...current, utilities: current.utilities.map(row => row.id === item.id ? { ...row, kind: value as typeof row.kind } : row) }))} /></Field><Field label="Priority"><Select value={item.priority} options={priorityLabels} onChange={value => onChange(current => ({ ...current, utilities: current.utilities.map(row => row.id === item.id ? { ...row, priority: value as typeof row.priority } : row) }))} /></Field></div>)}<div className="field-grid"><Field label="Style / preference"><input value={requirements.preferences[0]?.value ?? ''} onChange={event => onChange(current => ({ ...current, preferences: current.preferences.length ? current.preferences.map((item,index) => index === 0 ? { ...item, value: event.target.value } : item) : event.target.value ? [{ id: crypto.randomUUID(), kind: 'STYLE', value: event.target.value, priority: 'PREFERRED', provenance: stamp() }] : [] }))} /></Field><Field label="Future expansion note"><input value={requirements.futureExpansion[0]?.description ?? ''} onChange={event => onChange(current => ({ ...current, futureExpansion: current.futureExpansion.length ? current.futureExpansion.map((item,index) => index === 0 ? { ...item, description: event.target.value } : item) : event.target.value ? [{ id: crypto.randomUUID(), kind: 'OTHER', description: event.target.value, priority: 'PREFERRED', provenance: stamp() }] : [] }))} /></Field></div></div>

      <div className="requirements-group"><h3>Budget &amp; timeline (optional)</h3><div className="field-grid">
        <Field label="Target amount"><input inputMode="decimal" value={requirements.budget.target?.amount ?? ''} onChange={event => onChange(current => ({ ...current, budget: { ...current.budget, target: event.target.value ? { amount: event.target.value, currency: current.budget.target?.currency ?? current.budget.maximum?.currency ?? 'INR' } : null, provenance: current.budget.provenance ?? stamp() } }))} /></Field>
        <Field label="Maximum amount"><input inputMode="decimal" value={requirements.budget.maximum?.amount ?? ''} onChange={event => onChange(current => ({ ...current, budget: { ...current.budget, maximum: event.target.value ? { amount: event.target.value, currency: current.budget.maximum?.currency ?? current.budget.target?.currency ?? 'INR' } : null, provenance: current.budget.provenance ?? stamp() } }))} /></Field>
        <Field label="Currency"><input maxLength={3} value={requirements.budget.target?.currency ?? requirements.budget.maximum?.currency ?? 'INR'} onChange={event => onChange(current => ({ ...current, budget: { ...current.budget, target: current.budget.target ? { ...current.budget.target, currency: event.target.value.toUpperCase() } : null, maximum: current.budget.maximum ? { ...current.budget.maximum, currency: event.target.value.toUpperCase() } : null } }))} /></Field>
        <Field label="Desired start month"><input type="month" value={requirements.timeline.desiredStart ?? ''} onChange={event => onChange(current => ({ ...current, timeline: { ...current.timeline, desiredStart: event.target.value || null, provenance: current.timeline.provenance ?? stamp() } }))} /></Field>
        <Field label="Desired completion month"><input type="month" value={requirements.timeline.desiredCompletion ?? ''} onChange={event => onChange(current => ({ ...current, timeline: { ...current.timeline, desiredCompletion: event.target.value || null, provenance: current.timeline.provenance ?? stamp() } }))} /></Field>
      </div></div>

      <p className="help">Manual edits are recorded in the brief’s provenance. Measurements always include units. This brief records what you want; it does not test design or construction feasibility.</p>
      <Field label="Note for this brief edit"><textarea required minLength={5} maxLength={500} value={changeReason} onChange={event => setChangeReason(event.target.value)} /></Field>
      <button className="button quiet self-start" disabled={disabled || saving}>{saving ? 'Saving…' : 'Save Project Brief'}</button>
    </form>
  </details>;
}

export function RequirementsWorkspace({ projectId, initial }: { projectId: string; initial: RequirementsInterviewView }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [requirements, setRequirements] = useState<PropertyRequirements>(() => initial.interview?.candidate.requirements ?? initial.approvedRequirements ?? emptyPropertyRequirements());
  const [message, setMessage] = useState('');
  const [changeReason, setChangeReason] = useState('Owner corrected requirements brief');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflictResolution, setConflictResolution] = useState<Record<string, string>>({});
  const [discrepancyResolution, setDiscrepancyResolution] = useState<Record<string, string>>({});
  const isOpen = Boolean(state.interview && ['IN_PROGRESS','REVIEW_REQUIRED'].includes(state.interview.status));
  const activeRequirements = state.interview?.candidate.requirements ?? state.approvedRequirements ?? requirements;
  const stale = state.propertyTypeMismatch.draft || Boolean(state.interview && state.interview.status !== 'APPROVED' && state.interview.status !== 'SUPERSEDED' && state.interview.expectedProjectRevision !== state.projectRevision);
  const candidate = state.interview?.candidate;
  const openConflicts = candidate?.conflicts.filter(item => item.status === 'OPEN') ?? [];
  const openDiscrepancies = candidate?.siteDiscrepancies.filter(item => item.status === 'OPEN') ?? [];
  const lowConfidence = hasLowConfidence(activeRequirements);
  const canApprove = isOpen && !stale && state.status === 'REVIEW_REQUIRED' && state.completeness?.complete && !openConflicts.length && !openDiscrepancies.length && !lowConfidence;

  function applyState(next: RequirementsInterviewView) {
    setState(next);
    setRequirements(next.interview?.candidate.requirements ?? next.approvedRequirements ?? emptyPropertyRequirements());
    router.refresh();
  }
  async function refresh() {
    const response = await fetch(`/api/projects/${projectId}/requirements`, { cache: 'no-store' });
    if (response.ok) applyState(await response.json() as RequirementsInterviewView);
  }
  async function post(url: string, body: unknown, method = 'POST') {
    setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        await refresh();
        throw new Error(result.error?.message ?? 'Unable to save the Project Brief.');
      }
      applyState(result as RequirementsInterviewView);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reach the Requirements service.');
      return false;
    } finally { setPending(false); }
  }
  async function start() {
    await post(`/api/projects/${projectId}/requirements/interview`, { action: 'start', expectedRevision: state.projectRevision });
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = message.trim(); if (!content) return;
    setMessage('');
    await post(`/api/projects/${projectId}/requirements/interview`, { action: 'message', content, expectedRevision: state.projectRevision });
  }
  async function retry() { await post(`/api/projects/${projectId}/requirements/interview`, { action: 'retry', expectedRevision: state.projectRevision }); }
  async function saveBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stale) { setError('The Site or project changed during this interview. Start a fresh draft to use the current project version.'); return; }
    const ok = await post(`/api/projects/${projectId}/requirements`, { expectedRevision: state.projectRevision, changeReason, requirements }, 'PATCH');
    if (ok) setNotice('Project Brief saved.');
  }
  async function resolveConflict(conflictId: string) {
    await post(`/api/projects/${projectId}/requirements/conflicts`, { conflictId, resolution: conflictResolution[conflictId]?.trim() || 'Owner confirms the current values in the Project Brief.', expectedRevision: state.projectRevision });
  }
  async function resolveDiscrepancy(discrepancyId: string) {
    await post(`/api/projects/${projectId}/requirements/site-discrepancies`, { discrepancyId, resolution: discrepancyResolution[discrepancyId]?.trim() || 'Owner confirms the saved Site record remains authoritative.', expectedRevision: state.projectRevision });
  }
  async function approve() {
    const ok = await post(`/api/projects/${projectId}/requirements/approve`, { expectedRevision: state.projectRevision });
    if (ok) setNotice('Project Requirements approved and saved as a new project version.');
  }
  function edit(change: (current: PropertyRequirements) => PropertyRequirements) { setRequirements(current => change(structuredClone(current))); setNotice(''); }

  return <div className="requirements-layout">
    <section className="requirements-conversation form-panel" aria-labelledby="conversation-heading">
      <div className="section-heading"><div><p className="eyebrow">OWNER INTERVIEW</p><h2 id="conversation-heading">Conversation</h2></div><span className={`status${state.status === 'APPROVED' ? '' : ' muted'}`}>{pretty(state.status)}</span></div>
      <p className="help section-top">Describe spaces, floors, accessibility, parking, privacy, budget intent, or other requirements in your own words. Saved Site facts are used as context and are not copied into this brief.</p>
      <p className="help section-top">Project type: {propertyTypeLabel(state.propertyType)} · from Project Details.</p>
      {state.propertyType !== 'RESIDENTIAL' && <p className="feedback">Requirements can be recorded for this property type. Advanced planning support is limited, and the current residential workflow cannot approve this brief.</p>}
      {state.propertyTypeMismatch.approved && <p className="feedback error" role="alert">The approved brief uses a different property type from Project Details. It remains preserved in history. Start a new requirements revision and review the carried-forward details.</p>}
      {state.propertyTypeMismatch.draft && <p className="feedback error" role="alert">This draft’s property type differs from Project Details. Start a fresh requirements draft to review the current project type.</p>}
      {!state.interview || state.status === 'APPROVED' || state.status === 'SUPERSEDED' ? <div className="start-interview"><p>{state.status === 'APPROVED' ? `Approved in project version ${state.interview?.expectedProjectRevision}.` : state.status === 'SUPERSEDED' ? 'The project changed during this draft. Start fresh using the current project and Site record.' : 'Start a structured interview or complete the Project Brief manually.'}</p><button className="button primary" disabled={pending} onClick={start}>{state.status === 'APPROVED' ? 'Start a new requirements revision' : 'Start requirements interview'}</button></div> : <>
        <ol className="conversation-messages" aria-label="Interview messages">{state.interview.messages.map(item => <li key={item.id} className={`conversation-message ${item.role.toLowerCase()}`}><span className="message-role">{item.role === 'OWNER' ? 'You' : 'Assistant'}</span><p>{item.content}</p>{item.role === 'ASSISTANT' && item.provider && <span className="message-meta">{item.provider} · {item.model}</span>}</li>)}</ol>
        {stale && <div className="feedback error stale-draft"><p>This draft used an older project version. Your candidate will carry forward when you start fresh with the latest project type and Site information.</p><button type="button" className="button quiet" disabled={pending} onClick={start}>Start fresh requirements draft</button></div>}
        {candidate?.lastAiError && <div className="ai-recovery"><p className="feedback error">{candidate.lastAiError === 'AI_UNAVAILABLE' ? 'AI is not configured. Your message is saved; you can edit the structured brief manually.' : 'The assistant could not process this turn. Your message is saved and the brief is still editable.'}</p><button type="button" className="button quiet" disabled={pending || stale} onClick={retry}>Retry assistant</button></div>}
        <form className="message-compose" onSubmit={send}><label htmlFor="owner-message">Your requirements</label><textarea id="owner-message" maxLength={4000} value={message} onChange={event => setMessage(event.target.value)} placeholder="For example: G+1, three bedrooms, and a ground-floor bedroom for my parents." disabled={pending || stale} /><div className="form-actions"><button className="button primary" disabled={pending || stale || !message.trim()}>{pending ? 'Working…' : 'Send message'}</button><span className="help">The transcript provides context; your approved brief is structured project data.</span></div></form>
      </>}
      <div aria-live="polite">{error && <p className="feedback error" role="alert">{error}</p>}{notice && <p className="feedback success">{notice}</p>}</div>
    </section>

    <aside className="requirements-brief form-panel" aria-labelledby="brief-heading">
      <div className="section-heading"><div><p className="eyebrow">STRUCTURED REVIEW</p><h2 id="brief-heading">Project Brief</h2></div>{state.completeness && <span className={`status${state.completeness.complete ? '' : ' muted'}`}>{state.completeness.complete ? 'Ready to review' : `${state.completeness.blockingItems.length} required`}</span>}</div>
      {state.siteContext && <section className="site-context"><h3>Saved Site context</h3><p>{state.siteContext.location.locality ?? 'Location not recorded'} · {state.siteContext.orientation.facing ? `${state.siteContext.orientation.facing} facing` : 'Facing not recorded'} · {state.siteContext.roads.length} road(s) recorded</p><p className="help">Site data stays in the Land &amp; Site record. <a href={`/projects/${projectId}/site`}>Review saved Site</a></p></section>}
      <BriefView requirements={isOpen ? requirements : activeRequirements} />
      {state.completeness && <section className="completeness-card"><h3>Completeness</h3>{state.completeness.items.filter(item => item.category !== 'OPTIONAL' && item.category !== 'NOT_APPLICABLE').map(item => <p key={item.key} className={item.complete ? 'complete-item' : 'missing-item'}>{item.complete ? '✓' : '○'} {item.prompt}</p>)}{state.completeness.items.filter(item => item.category === 'OPTIONAL').length > 0 && <p className="help">Optional fields do not block approval.</p>}</section>}
      {candidate?.questions.length ? <section className="question-list"><h3>Follow-up questions</h3><ul>{candidate.questions.map((question,index) => <li key={`${index}-${question}`}>{question}</li>)}</ul></section> : null}
      {openConflicts.length > 0 && <section className="conflict-list"><h3>Conflicts to resolve</h3>{openConflicts.map(conflict => <div className="conflict-card" key={conflict.id}><p>{conflict.explanation}</p><Field label="Resolution note"><input value={conflictResolution[conflict.id] ?? ''} onChange={event => setConflictResolution(current => ({ ...current, [conflict.id]: event.target.value }))} placeholder="Optional note" /></Field><button className="button quiet" disabled={pending || stale} onClick={() => resolveConflict(conflict.id)}>Use current brief values</button></div>)}</section>}
      {openDiscrepancies.length > 0 && <section className="conflict-list"><h3>Saved Site differences</h3>{openDiscrepancies.map(item => <div className="conflict-card" key={item.id}><p>Your message says <strong>{item.statedValue}</strong>. Saved Site says <strong>{item.savedValue}</strong>.</p><p className="help">The interview cannot change Site data. Update the saved Site record separately if it is incorrect.</p><Field label="Resolution note"><input value={discrepancyResolution[item.id] ?? ''} onChange={event => setDiscrepancyResolution(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Optional note" /></Field><button className="button quiet" disabled={pending || stale} onClick={() => resolveDiscrepancy(item.id)}>Keep saved Site record</button></div>)}</section>}
      {isOpen && <BriefEditor requirements={requirements} changeReason={changeReason} setChangeReason={setChangeReason} onChange={edit} onSave={saveBrief} saving={pending} disabled={stale} />}
      {canApprove && <div className="approve-brief"><p>Review the structured brief above, then approve it to save a new immutable project version.</p><button className="button primary" disabled={pending} onClick={approve}>{pending ? 'Approving…' : 'Approve Project Brief'}</button></div>}
      {isOpen && !canApprove && <p className="help approval-hint">Approval becomes available after required details, low-confidence interpretations, and blocking conflicts are resolved.</p>}
    </aside>
  </div>;
}
