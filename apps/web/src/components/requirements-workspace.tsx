'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { propertyTypeLabel, stableJson, emptyPropertyRequirements, type PropertyRequirements, type RequirementProvenance, type RequirementsInterviewView } from '@property/domain';

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
  const floorLabel = (floor: PropertyRequirements['spaces'][number]['floor']) => 'label' in floor ? floor.label : floor.kind === 'ENTIRE_PROPERTY' ? 'Whole property' : 'Floor not specified';
  return <div className="brief-review">
    <section><h3>Building</h3><p>{requirements.buildingIntent ? propertyTypeLabel(requirements.buildingIntent.value.kind) : 'From Project Details'} · {Object.values(requirements.buildingScale.floorCount.value).some(value => value !== undefined) ? `${countLabel(requirements.buildingScale.floorCount.value)} floors` : 'Floor count not yet recorded'}</p></section>
    <section><h3>Spaces</h3>{requirements.spaces.length ? <ul className="brief-facts">{requirements.spaces.map(space => <li key={space.id}><strong>{space.customName ?? pretty(space.type)}</strong><span>{countLabel(space.count)} · {floorLabel(space.floor)}{space.size.kind !== 'NO_PREFERENCE' ? ` · ${pretty(space.size.kind)} ${space.size.value} ${space.size.unit}` : ''}</span><small>{pretty(space.priority)} · {provenanceLabel(space.provenance.current.kind)}</small></li>)}</ul> : <p className="help">No spaces recorded yet.</p>}</section>
    {requirements.parking.length > 0 && <section><h3>Parking</h3>{requirements.parking.map(item => <p key={item.id}>{countLabel(item.count)} {pretty(item.vehicle)}{item.cover ? ` · ${pretty(item.cover)}` : ''}{item.evCharging !== null ? ` · EV charging: ${item.evCharging ? 'yes' : 'no'}` : ''} · {pretty(item.priority)}</p>)}</section>}
    <section><h3>Use &amp; preferences</h3><p>{requirements.rental.mode ? pretty(requirements.rental.mode.value) : 'Rental intent not yet confirmed'}</p>
      {requirements.occupancy.householdSize && <p>{requirements.occupancy.householdSize.value} people expected</p>}
      {requirements.accessibility.map(item => <p key={item.id}>{item.customName ?? pretty(item.kind)} · {pretty(item.priority)}</p>)}
      {requirements.utilities.map(item => <p key={item.id}>{item.customName ?? pretty(item.kind)} · {pretty(item.priority)}</p>)}
      {requirements.preferences.map(item => <p key={item.id}>{item.value} · {pretty(item.priority)}</p>)}
      {requirements.futureExpansion.map(item => <p key={item.id}>{item.description} · {pretty(item.priority)}</p>)}
      {requirements.vaasthuPreference && <p>Vaasthu: {pretty(requirements.vaasthuPreference.value)} preference <small>· {provenanceLabel(requirements.vaasthuPreference.provenance.current.kind)}</small></p>}
      {requirements.budget.target && <p>Target budget: {requirements.budget.target.currency} {requirements.budget.target.amount}</p>}
      {requirements.budget.maximum && <p>Maximum budget: {requirements.budget.maximum.currency} {requirements.budget.maximum.amount}</p>}
      {requirements.timeline.desiredStart && <p>Desired start: {requirements.timeline.desiredStart}</p>}
      {requirements.timeline.desiredCompletion && <p>Desired completion: {requirements.timeline.desiredCompletion}</p>}
    </section>
    {(requirements.relationships.length > 0 || Object.entries(requirements.buildingScale).some(([key,value]) => !['floorCount','priority'].includes(key) && value !== null) || Object.entries(requirements.occupancy).some(([key,value]) => key !== 'householdSize' && value !== null) || requirements.rental.independentEntrance || requirements.rental.independentUtilities || requirements.rental.unitCount || requirements.budget.flexibility || requirements.timeline.flexibility || requirements.timeline.urgency) && <details className="brief-extra-details"><summary>Additional recorded details</summary>
      {requirements.buildingScale.basement && <p>Basement: {requirements.buildingScale.basement.value ? 'requested' : 'not requested'}</p>}
      {requirements.buildingScale.lift && <p>Lift now: {requirements.buildingScale.lift.value ? 'requested' : 'not requested'}</p>}
      {requirements.buildingScale.futureAdditionalFloors && <p>Possible future floors: {requirements.buildingScale.futureAdditionalFloors.value}</p>}
      {requirements.buildingScale.terraceUse && <p>Terrace use: {requirements.buildingScale.terraceUse.value}</p>}
      {requirements.buildingScale.staircaseExpectation && <p>Staircase: {requirements.buildingScale.staircaseExpectation.value}</p>}
      {Object.entries(requirements.occupancy).filter(([key,value]) => key !== 'householdSize' && value !== null).map(([key,value]) => <p key={key}>{key.replace(/([A-Z])/g, ' $1')}: {typeof value!.value === 'boolean' ? value!.value ? 'yes' : 'no' : value!.value}</p>)}
      {requirements.relationships.map(item => { const name = (id: string) => { const space = requirements.spaces.find(space => space.id === id); return space?.customName ?? (space ? pretty(space.type) : 'Space'); }; return <p key={item.id}>{name(item.fromSpaceId)} · {pretty(item.kind)} · {name(item.toSpaceId)} · {pretty(item.priority)}</p>; })}
      {requirements.rental.unitCount && <p>Rental units: {countLabel(requirements.rental.unitCount.value)}</p>}
      {requirements.rental.independentEntrance && <p>Independent rental entrance: {requirements.rental.independentEntrance.value ? 'requested' : 'not requested'}</p>}
      {requirements.rental.independentUtilities && <p>Independent rental utilities: {requirements.rental.independentUtilities.value ? 'requested' : 'not requested'}</p>}
      {requirements.budget.flexibility && <p>Budget flexibility: {pretty(requirements.budget.flexibility)}</p>}
      {requirements.timeline.flexibility && <p>Timeline flexibility: {pretty(requirements.timeline.flexibility)}</p>}
      {requirements.timeline.urgency && <p>Timeline urgency: {pretty(requirements.timeline.urgency)}</p>}
    </details>}
  </div>;
}

function BriefEditor({ requirements, changeReason, setChangeReason, onChange, onSave, saving, disabled }: { requirements: PropertyRequirements; changeReason: string; setChangeReason: (value: string) => void; onChange: (change: (current: PropertyRequirements) => PropertyRequirements) => void; onSave: (event: FormEvent<HTMLFormElement>) => void; saving: boolean; disabled: boolean }) {
  const updateSpace = (id: string, change: (space: PropertyRequirements['spaces'][number]) => PropertyRequirements['spaces'][number]) => onChange(current => ({ ...current, spaces: current.spaces.map(space => space.id === id ? change(space) : space) }));
  return <div className="brief-editor">
    <form id="requirements-editor-form" className="form-stack" onSubmit={onSave}>
      <fieldset disabled={disabled || saving} className="editor-fields">
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
          <Field label="Space label (optional)"><input value={space.customName ?? ''} onChange={event => updateSpace(space.id, item => ({ ...item, customName: event.target.value || null }))} /></Field>
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
      </fieldset>
    </form>
  </div>;
}

export function RequirementsWorkspace({ projectId, initial }: { projectId: string; initial: RequirementsInterviewView }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const savedRequirements = state.interview?.candidate.requirements ?? state.approvedRequirements ?? emptyPropertyRequirements();
  const [requirements, setRequirements] = useState<PropertyRequirements>(() => initial.interview?.candidate.requirements ?? initial.approvedRequirements ?? emptyPropertyRequirements());
  const [message, setMessage] = useState('');
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(null);
  const [changeReason, setChangeReason] = useState('Owner corrected requirements brief');
  const [pending, setPending] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const inFlight = useRef(false);
  const editorActive = useRef(false);
  const editorBaseRef = useRef(requirements);
  const [editorBase, setEditorBase] = useState(requirements);
  const [editing, setEditing] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [draftOutdated, setDraftOutdated] = useState(false);
  const [error, setError] = useState('');
  const [turnError, setTurnError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [mobile, setMobile] = useState(false);
  const [panel, setPanel] = useState<'conversation' | 'brief'>('conversation');
  const [conflictResolution, setConflictResolution] = useState<Record<string, string>>({});
  const [discrepancyResolution, setDiscrepancyResolution] = useState<Record<string, string>>({});
  const isOpen = Boolean(state.interview && ['IN_PROGRESS','REVIEW_REQUIRED'].includes(state.interview.status));
  const stale = state.propertyTypeMismatch.draft || Boolean(state.interview && state.interview.status !== 'APPROVED' && state.interview.status !== 'SUPERSEDED' && state.interview.expectedProjectRevision !== state.projectRevision);
  const candidate = state.interview?.candidate;
  const openConflicts = candidate?.conflicts.filter(item => item.status === 'OPEN') ?? [];
  const openDiscrepancies = candidate?.siteDiscrepancies.filter(item => item.status === 'OPEN') ?? [];
  const dirty = editing && stableJson(requirements) !== stableJson(editorBase);
  const canApprove = isOpen && !stale && state.status === 'REVIEW_REQUIRED' && state.completeness?.complete && !openConflicts.length && !openDiscrepancies.length && !hasLowConfidence(savedRequirements);
  const essential = state.completeness?.items.filter(item => item.category === 'REQUIRED' || item.category === 'CONDITIONALLY_REQUIRED') ?? [];
  const recovery = turnError ?? (candidate?.lastAiError ? candidate.lastAiError === 'AI_UNAVAILABLE'
    ? state.aiAvailability === 'AVAILABLE' ? 'AI is now available. Your message is saved; retry or edit the brief manually.' : 'AI is not configured. Your message is saved and manual editing is available.'
    : 'This turn could not be processed. Your message is saved; retry or edit the brief manually.' : null);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (editing) document.getElementById('brief-heading')?.focus();
  }, [editing]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);

  function applyState(next: RequirementsInterviewView) {
    setState(next);
    const saved = next.interview?.candidate.requirements ?? next.approvedRequirements ?? emptyPropertyRequirements();
    if (editorActive.current) setDraftOutdated(stableJson(saved) !== stableJson(editorBaseRef.current));
    else setRequirements(saved);
    router.refresh();
  }
  async function refresh() {
    const response = await fetch(`/api/projects/${projectId}/requirements`, { cache: 'no-store' });
    if (!response.ok) return false;
    applyState(await response.json() as RequirementsInterviewView); return true;
  }
  async function post(url: string, body: unknown, method = 'POST', ai = false) {
    if (inFlight.current) return false;
    inFlight.current = true; setPending(true); setAiPending(ai); setError(''); setNotice('');
    if (ai) setTurnError(null);
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        if (ai && ['AI_UNAVAILABLE','AI_PROVIDER_FAILED','AI_INVALID_OUTPUT'].includes(result.error?.code)) {
          setTurnError(result.error.code === 'AI_UNAVAILABLE' ? 'AI is not configured. Your message is saved and manual editing is available.' : 'This turn could not be processed. Your message is saved; retry or edit the brief manually.');
          if (await refresh().catch(() => false)) setOptimisticMessage(null);
          return false;
        }
        await refresh().catch(() => false);
        throw new Error(result.error?.message ?? 'Unable to save the Project Brief.');
      }
      applyState(result as RequirementsInterviewView); setTurnError(null); setOptimisticMessage(null);
      return true;
    } catch (reason) {
      if (ai) setTurnError('We could not confirm the result. Your message is kept here. Check the connection and reload before retrying; manual editing is available.');
      else setError(reason instanceof Error ? reason.message : 'Unable to reach the Requirements service.');
      return false;
    } finally { inFlight.current = false; setPending(false); setAiPending(false); }
  }
  async function start() {
    await post(`/api/projects/${projectId}/requirements/interview`, { action: 'start', expectedRevision: state.projectRevision });
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = message.trim(); if (!content || inFlight.current) return;
    setOptimisticMessage(content); setMessage('');
    await post(`/api/projects/${projectId}/requirements/interview`, { action: 'message', content, expectedRevision: state.projectRevision }, 'POST', true);
  }
  async function retry() { await post(`/api/projects/${projectId}/requirements/interview`, { action: 'retry', expectedRevision: state.projectRevision }, 'POST', true); }
  function beginEdit() {
    editorBaseRef.current = structuredClone(savedRequirements); setEditorBase(editorBaseRef.current); setRequirements(structuredClone(savedRequirements));
    editorActive.current = true; setEditing(true); setDraftOutdated(false); setDiscardPrompt(false); setError(''); setNotice('');
  }
  function finishEdit() { editorActive.current = false; setEditing(false); setDiscardPrompt(false); setDraftOutdated(false); setRequirements(savedRequirements); setError(''); }
  function cancelEdit() { if (dirty) setDiscardPrompt(true); else finishEdit(); }
  async function saveBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stale || draftOutdated) { setError('The saved brief changed. Keep your edits for reference or cancel and reopen the latest brief before saving.'); return; }
    const ok = await post(`/api/projects/${projectId}/requirements`, { expectedRevision: state.projectRevision, changeReason, requirements }, 'PATCH');
    if (ok) { editorActive.current = false; setEditing(false); setDiscardPrompt(false); setNotice('Project Brief saved.'); }
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

  return <div className="requirements-workspace">
    <div className="requirements-tabs" role="tablist" aria-label="Requirements workspace">
      {(['conversation','brief'] as const).map(name => <button key={name} id={`requirements-${name}-tab`} role="tab" aria-controls={`requirements-${name}-panel`} aria-selected={panel === name} tabIndex={panel === name ? 0 : -1} onClick={() => setPanel(name)} onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 'conversation' : event.key === 'End' ? 'brief' : name === 'conversation' ? 'brief' : 'conversation';
        setPanel(next); document.getElementById(`requirements-${next}-tab`)?.focus();
      }}>{name === 'conversation' ? 'Conversation' : 'Project Brief'}{name === 'brief' && dirty ? ' · Unsaved' : ''}</button>)}
    </div>
    <div className="requirements-layout">
    <section id="requirements-conversation-panel" hidden={mobile && panel !== 'conversation'} role={mobile ? 'tabpanel' : undefined} className="requirements-conversation form-panel" aria-labelledby={mobile ? 'requirements-conversation-tab' : 'conversation-heading'}>
      <div className="section-heading"><div><p className="eyebrow">OWNER INTERVIEW</p><h2 id="conversation-heading">Conversation</h2></div><span className={`status${state.status === 'APPROVED' ? '' : ' muted'}`}>{pretty(state.status)}</span></div>
      <p className="help section-top">Tell us about the floors, spaces and features you need. Project type: {propertyTypeLabel(state.propertyType)}.</p>
      {!recovery && <p className="help">{state.aiAvailability === 'NOT_CONFIGURED' ? 'AI is not configured. Manual editing is available.' : 'AI assistance is available. You can edit the brief yourself at any time.'}</p>}
      {state.propertyType !== 'RESIDENTIAL' && <p className="feedback">Requirements can be recorded for this property type. The current residential workflow cannot approve this brief.</p>}
      {state.propertyTypeMismatch.approved && <p className="feedback error" role="alert">The approved brief uses a different property type from Project Details. It remains preserved in history. Start a new requirements revision to review it.</p>}
      {state.propertyTypeMismatch.draft && <p className="feedback error" role="alert">This draft uses an older property type. Start a fresh requirements draft.</p>}
      {!state.interview || state.status === 'APPROVED' || state.status === 'SUPERSEDED' ? <div className="start-interview"><p>{state.status === 'APPROVED' ? `Approved in project version ${state.interview?.expectedProjectRevision}.` : 'Start an interview or complete the brief manually.'}</p><button className="button primary" disabled={pending} onClick={start}>{state.status === 'APPROVED' ? 'Start a new requirements revision' : 'Start requirements interview'}</button></div> : <>
        <ol className="conversation-messages" aria-label="Interview messages">{state.interview.messages.map(item => <li key={item.id} className={`conversation-message ${item.role.toLowerCase()}`}><span className="message-role">{item.role === 'OWNER' ? 'You' : 'Assistant'}</span><p>{item.content}</p>{item.role === 'ASSISTANT' && item.provider && <span className="message-meta">{item.provider} · {item.model}</span>}</li>)}
          {optimisticMessage && <li className="conversation-message owner"><span className="message-role">You</span><p>{optimisticMessage}</p></li>}
          {aiPending && <li className="conversation-message processing" role="status"><span className="processing-dot" aria-hidden="true" /><p>Reading your requirements and updating the brief…</p><small>You can view the Project Brief while the assistant works.</small></li>}
        </ol>
        {stale && <div className="feedback error stale-draft"><p>This draft used an older project version. Start fresh to review the current project and Site context.</p><button type="button" className="button quiet" disabled={pending} onClick={start}>Start fresh requirements draft</button></div>}
        {recovery && !aiPending && <div className="ai-recovery" role="alert"><p>{recovery}</p><div className="form-actions"><button type="button" className="button quiet" disabled={pending || stale || Boolean(optimisticMessage)} onClick={retry}>Retry assistant</button><button type="button" className="text-button" onClick={() => { setPanel('brief'); if (!editing) beginEdit(); }}>Review &amp; edit brief</button></div></div>}
        <form className="message-compose" onSubmit={send}><label htmlFor="owner-message">Your requirements</label><textarea id="owner-message" maxLength={4000} value={message} onChange={event => setMessage(event.target.value)} placeholder="For example: three floors, with a bedroom for my parents on the ground floor." disabled={pending || stale} /><div className="form-actions"><button className="button primary" disabled={pending || stale || !message.trim()}>{aiPending ? 'Processing…' : 'Send message'}</button><span className="help">Your approved brief stays under your control.</span></div></form>
      </>}
    </section>
    <aside id="requirements-brief-panel" hidden={mobile && panel !== 'brief'} role={mobile ? 'tabpanel' : undefined} className="requirements-brief form-panel" aria-labelledby={mobile ? 'requirements-brief-tab' : 'brief-heading'}>
      <div className="section-heading"><div><p className="eyebrow">{editing ? 'MANUAL EDIT' : 'STRUCTURED REVIEW'}</p><h2 id="brief-heading" tabIndex={-1}>{editing ? 'Edit Project Brief' : 'Project Brief'}</h2></div>{!editing && state.completeness && <span className={`status${state.completeness.complete ? '' : ' muted'}`}>{state.completeness.complete ? 'Ready to review' : `${state.completeness.blockingItems.length} needed`}</span>}</div>
      {editing ? <>
        <div className="editor-actions"><button type="submit" form="requirements-editor-form" className="button primary" disabled={pending || stale || draftOutdated}>{pending && !aiPending ? 'Saving…' : 'Save Project Brief'}</button><button type="button" className="button quiet" disabled={pending && !aiPending} onClick={cancelEdit}>{dirty ? 'Cancel' : 'Done'}</button><span className="help">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span></div>
        {discardPrompt && <div className="discard-prompt" role="alert"><p>Discard your unsaved changes? Nothing has been saved.</p><div className="form-actions"><button type="button" className="button quiet" onClick={() => setDiscardPrompt(false)}>Keep editing</button><button type="button" className="text-button danger" onClick={finishEdit}>Discard changes</button></div></div>}
        {draftOutdated && <p className="feedback" role="status">The saved brief changed while you were editing. Your edits are kept here. Cancel and reopen the latest brief before saving.</p>}
        <BriefEditor requirements={requirements} changeReason={changeReason} setChangeReason={setChangeReason} onChange={edit} onSave={saveBrief} saving={pending && !aiPending} disabled={stale} />
      </> : <>
        {isOpen && <button type="button" className="button quiet review-edit-button" disabled={stale} onClick={beginEdit}>Review &amp; edit brief</button>}
        <BriefView requirements={savedRequirements} />
        {state.completeness && <section className="completeness-card"><h3>Essential details</h3><progress max={Math.max(essential.length, 1)} value={essential.filter(item => item.complete).length} aria-label="Essential brief details completed" /><p>{essential.filter(item => item.complete).length} of {essential.length} recorded. Optional details do not block approval.</p></section>}
        {candidate?.questions.length ? <section className="question-list"><h3>Next details</h3><ul>{candidate.questions.slice(0, 2).map((question,index) => <li key={`${index}-${question}`}>{question}</li>)}</ul></section> : null}
        {openConflicts.length > 0 && <section className="conflict-list"><h3>Conflicts to resolve</h3>{openConflicts.map(conflict => <div className="conflict-card" key={conflict.id}><p>{conflict.explanation}</p><Field label="Resolution note"><input value={conflictResolution[conflict.id] ?? ''} onChange={event => setConflictResolution(current => ({ ...current, [conflict.id]: event.target.value }))} placeholder="Optional note" /></Field><button className="button quiet" disabled={pending || stale} onClick={() => resolveConflict(conflict.id)}>Use current brief values</button></div>)}</section>}
        {openDiscrepancies.length > 0 && <section className="conflict-list"><h3>Saved Site differences</h3>{openDiscrepancies.map(item => <div className="conflict-card" key={item.id}><p>Your message says <strong>{item.statedValue}</strong>. Saved Site says <strong>{item.savedValue}</strong>.</p><Field label="Resolution note"><input value={discrepancyResolution[item.id] ?? ''} onChange={event => setDiscrepancyResolution(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Optional note" /></Field><button className="button quiet" disabled={pending || stale} onClick={() => resolveDiscrepancy(item.id)}>Keep saved Site record</button></div>)}</section>}
        {state.siteContext && <details className="site-context"><summary>Saved Site context</summary><p>{state.siteContext.location.locality ?? 'Location not recorded'} · {state.siteContext.orientation.facing ? `${state.siteContext.orientation.facing} facing` : 'Facing not recorded'}</p><a href={`/projects/${projectId}/site`}>Review saved Site</a></details>}
        {canApprove && <div className="approve-brief"><p>Approve this reviewed brief to save a new project version.</p><button className="button primary" disabled={pending} onClick={approve}>Approve Project Brief</button></div>}
        {isOpen && !canApprove && <p className="help approval-hint">Approval becomes available after required details and blocking issues are resolved.</p>}
      </>}
      <div aria-live="polite">{error && <p className="feedback error" role="alert">{error}</p>}{notice && <p className="feedback success">{notice}</p>}</div>
    </aside>
    </div>
  </div>;
}
