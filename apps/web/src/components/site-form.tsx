'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { buildSite, degreesToMilliDegrees, emptySiteFacts, siteFactsSchema, type Site, type SiteFacts, type Length } from '@property/domain';
import { SitePreview, SiteReview } from './site-preview';

const sections = ['Location', 'Plot details', 'Dimensions & shape', 'Orientation', 'Road access', 'Existing site', 'Review'];
const text = (value: string) => value.trim() ? value : undefined;
function Field({ label, value, change, ...props }: { label: string; value?: string | number; change: (value: string)=>void; maxLength?: number; inputMode?: 'decimal' | 'text' }) {
  return <label>{label}<input {...props} value={value ?? ''} onChange={e=>change(e.target.value)} /></label>;
}
function Measure({ label, value, change }: { label: string; value: Length; change: (value: Length)=>void }) {
  return <div className="measure-row"><Field label={label} value={value.value} change={v=>change({...value,value:v})} inputMode="decimal" maxLength={24} /><label>{label} unit<select value={value.unit} onChange={e=>change({...value,unit:e.target.value as Length['unit']})}><option value="m">metres</option><option value="ft">feet</option></select></label></div>;
}
export function SiteForm({ projectId, revision, site }: { projectId: string; revision: number; site: Site | null }) {
  const router=useRouter();
  const [facts,setFacts]=useState<SiteFacts>(()=>site?.facts ?? emptySiteFacts());
  const [step,setStep]=useState(0), [reason,setReason]=useState(''), [pending,setPending]=useState(false);
  const [error,setError]=useState(''), [saved,setSaved]=useState(''), [conflict,setConflict]=useState(false);
  const [expectedRevision,setRevision]=useState(revision);
  const [north,setNorth]=useState(site?.facts.orientation.northAngleMilliDegrees === undefined ? '' : String(site.facts.orientation.northAngleMilliDegrees/1000));
  const [latitude,setLatitude]=useState(site?.facts.location.latitude === undefined ? '' : String(site.facts.location.latitude));
  const [longitude,setLongitude]=useState(site?.facts.location.longitude === undefined ? '' : String(site.facts.location.longitude));
  function candidate(): SiteFacts {
    return { ...facts, location: { ...facts.location, latitude:latitude.trim() ? Number(latitude) : undefined, longitude:longitude.trim() ? Number(longitude) : undefined },
      orientation:{...facts.orientation,northAngleMilliDegrees:north.trim() ? degreesToMilliDegrees(north) : undefined} };
  }
  let preview: Site | null = null, validation='';
  try { const parsed=siteFactsSchema.safeParse(candidate()); if (parsed.success) preview=buildSite(parsed.data); else validation=parsed.error.issues[0]?.message ?? 'Check your site inputs.'; }
  catch (e) { validation=e instanceof Error ? e.message : 'Check the entered measurements.'; }
  function edit(next: SiteFacts) { setFacts(next); setSaved(''); }
  function chooseShape(kind: string) {
    // Changing shape is explicit; roads/front are cleared because their edges cease to exist.
    const vertexIds=Array.from({length:4},()=>crypto.randomUUID());
    const edges=Array.from({length:4},()=>({id:crypto.randomUUID()}));
    const boundary: SiteFacts['boundary'] = kind === 'RECTANGLE' ? {kind,width:{value:'',unit:'m'},depth:{value:'',unit:'m'},vertexIds,edges}
      : kind === 'POLYGON' ? {kind,unit:'m',vertices:vertexIds.map(id=>({id,x:'',y:''})),edges} : null;
    edit({...facts,boundary,roads:[],orientation:{...facts.orientation,frontEdgeId:undefined}});
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setSaved('');
    if (validation) { setError(validation); return; }
    setPending(true);
    try {
      const response=await fetch(`/api/projects/${projectId}/site`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision,changeReason:reason,site:candidate()})});
      const result=await response.json();
      if (!response.ok) { setConflict(response.status===409); throw new Error(result.error?.issues?.[0]?.message ?? result.error?.message ?? 'Unable to save site.'); }
      setRevision(result.revision); setFacts(result.site.facts); setReason(''); setSaved(`Land & site saved as project version ${result.revision}.`); setConflict(false); router.refresh();
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to save site.'); }
    finally { setPending(false); }
  }
  const boundary=facts.boundary;
  const edgeOptions=boundary?.edges.map((e,i)=>({id:e.id,label:e.label ?? `Edge ${i+1}`})) ?? [];
  return <div className="site-workflow">
    <p className="intro small">Build your land record a section at a time. Leave unknown details blank and save what you know. Site details are private to the project owner.</p>
    <nav className="site-steps" aria-label="Land intake sections">{sections.map((name,i)=><button key={name} type="button" aria-current={step===i ? 'step' : undefined} onClick={()=>setStep(i)}>{i+1}. {name}</button>)}</nav>
    <form onSubmit={save} className="site-editor">
      <fieldset disabled={pending} className="site-fields"><legend>{sections[step]}</legend>
      {step===0 && <div className="field-grid">{([['country','Country'],['region','State / region'],['district','District'],['locality','City / locality'],['postalCode','Postal code'],['address','Address']] as const).map(([key,label])=><Field key={key} label={label} value={facts.location[key]} maxLength={key==='address'?500:key==='postalCode'?30:120} change={v=>edit({...facts,location:{...facts.location,[key]:text(v)}})} />)}
        <Field label="Latitude (degrees, optional)" inputMode="decimal" value={latitude} change={v=>{setLatitude(v);setSaved('');}} /><Field label="Longitude (degrees, optional)" inputMode="decimal" value={longitude} change={v=>{setLongitude(v);setSaved('');}} /><p className="help">Coordinates are optional. No maps or geocoding are used.</p></div>}
      {step===1 && <div className="form-stack"><div className="field-grid"><Field label="Plot number" value={facts.identity.plotNumber} maxLength={120} change={v=>edit({...facts,identity:{...facts.identity,plotNumber:text(v)}})} /><Field label="Survey number" value={facts.identity.surveyNumber} maxLength={120} change={v=>edit({...facts,identity:{...facts.identity,surveyNumber:text(v)}})} /></div>
        {facts.identity.localIdentifiers.map((id,i)=><div className="field-grid" key={id.id}><Field label={`Local identifier ${i+1} label`} value={id.label} maxLength={120} change={v=>edit({...facts,identity:{...facts.identity,localIdentifiers:facts.identity.localIdentifiers.map(x=>x.id===id.id?{...x,label:v}:x)}})} /><Field label={`Local identifier ${i+1} value`} value={id.value} maxLength={120} change={v=>edit({...facts,identity:{...facts.identity,localIdentifiers:facts.identity.localIdentifiers.map(x=>x.id===id.id?{...x,value:v}:x)}})} /><button className="text-button" type="button" onClick={()=>edit({...facts,identity:{...facts.identity,localIdentifiers:facts.identity.localIdentifiers.filter(x=>x.id!==id.id)}})}>Remove identifier {i+1}</button></div>)}
        <button type="button" className="text-button self-start" disabled={facts.identity.localIdentifiers.length>=10} onClick={()=>edit({...facts,identity:{...facts.identity,localIdentifiers:[...facts.identity.localIdentifiers,{id:crypto.randomUUID(),label:'',value:''}]}})}>Add local identifier</button>
        <label>Plot notes<textarea value={facts.identity.notes ?? ''} maxLength={1000} onChange={e=>edit({...facts,identity:{...facts.identity,notes:text(e.target.value)}})} /></label>
        <label><span><input className="inline-check" type="checkbox" checked={facts.declaredArea!==null} onChange={e=>edit({...facts,declaredArea:e.target.checked?{value:'',unit:'m2'}:null})} /> Record an area from your documents</span></label>
        {facts.declaredArea && <div className="measure-row"><Field label="Declared plot area" inputMode="decimal" value={facts.declaredArea.value} change={v=>edit({...facts,declaredArea:{...facts.declaredArea!,value:v}})} /><label>Area unit<select value={facts.declaredArea.unit} onChange={e=>edit({...facts,declaredArea:{...facts.declaredArea!,unit:e.target.value as 'm2'|'ft2'|'yd2'}})}><option value="m2">square metres</option><option value="ft2">square feet</option><option value="yd2">square yards</option></select></label></div>}
        <p className="help">Your declared area is preserved separately from the calculated boundary area.</p></div>}
      {step===2 && <div className="form-stack"><label>Boundary entry<select value={boundary?.kind ?? ''} onChange={e=>chooseShape(e.target.value)}><option value="">Not recorded yet</option><option value="RECTANGLE">Rectangle — width and depth</option><option value="POLYGON">Irregular plot — ordered corner coordinates</option></select></label>
        <p className="help">Changing entry type replaces the boundary and clears road/front-side links. Editing dimensions or coordinates keeps their IDs.</p>
        {boundary?.kind==='RECTANGLE' && <><Measure label="Width" value={boundary.width} change={v=>edit({...facts,boundary:{...boundary,width:v}})} /><Measure label="Depth" value={boundary.depth} change={v=>edit({...facts,boundary:{...boundary,depth:v}})} /><p className="help">Point 1 is the lower-left origin. Edges run along the bottom, right, top, then left. North is entered separately.</p></>}
        {boundary?.kind==='POLYGON' && <><p className="help">Walk around the plot in order. Enter each corner once; the last closes to the first. X runs right and Y runs up from your chosen local origin. Side lengths alone cannot determine an irregular plot. Up to 32 corners; no holes or curves.</p><label>Coordinate unit<select value={boundary.unit} onChange={e=>edit({...facts,boundary:{...boundary,unit:e.target.value as 'm'|'ft'}})}><option value="m">metres</option><option value="ft">feet</option></select></label>
          {boundary.vertices.map((point,i)=><div className="field-grid" key={point.id}><Field label={`Point ${i+1} X (${boundary.unit})`} inputMode="decimal" value={point.x} change={v=>edit({...facts,boundary:{...boundary,vertices:boundary.vertices.map(p=>p.id===point.id?{...p,x:v}:p)}})} /><Field label={`Point ${i+1} Y (${boundary.unit})`} inputMode="decimal" value={point.y} change={v=>edit({...facts,boundary:{...boundary,vertices:boundary.vertices.map(p=>p.id===point.id?{...p,y:v}:p)}})} /></div>)}
          <div className="form-actions"><button type="button" className="button quiet" disabled={boundary.vertices.length>=32} onClick={()=>edit({...facts,boundary:{...boundary,vertices:[...boundary.vertices,{id:crypto.randomUUID(),x:'',y:''}],edges:[...boundary.edges,{id:crypto.randomUUID()}]},roads:[],orientation:{...facts.orientation,frontEdgeId:undefined}})}>Add corner</button><button type="button" className="text-button" disabled={boundary.vertices.length<=3} onClick={()=>edit({...facts,boundary:{...boundary,vertices:boundary.vertices.slice(0,-1),edges:boundary.edges.slice(0,-1)},roads:[],orientation:{...facts.orientation,frontEdgeId:undefined}})}>Remove last corner</button></div><p className="help">Adding/removing corners clears road and front links for review.</p></>}
        {boundary && boundary.edges.map((edge,i)=><Field key={edge.id} label={`Edge ${i+1} label (optional)`} value={edge.label} maxLength={120} change={v=>edit({...facts,boundary:{...boundary,edges:boundary.edges.map(e=>e.id===edge.id?{...e,label:text(v)}:e)}})} />)}
      </div>}
      {step===3 && <div className="form-stack"><Field label="North direction (degrees clockwise from the top of the plan)" inputMode="decimal" value={north} change={v=>{setNorth(v);setSaved('');}} /><p className="help">0° points up, 90° right, 180° down, 270° left. Leave blank if unknown. Facing does not set north.</p>
        <label>Stated plot facing<select value={facts.orientation.facing ?? ''} onChange={e=>edit({...facts,orientation:{...facts.orientation,facing:(e.target.value || undefined) as SiteFacts['orientation']['facing']}})}><option value="">Not recorded</option>{['N','NE','E','SE','S','SW','W','NW'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Front side<select value={facts.orientation.frontEdgeId ?? ''} onChange={e=>edit({...facts,orientation:{...facts.orientation,frontEdgeId:e.target.value || undefined}})}><option value="">Not recorded</option>{edgeOptions.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select></label></div>}
      {step===4 && <div className="form-stack"><p className="help">Record each road beside a boundary edge. Width can remain unknown. Choose at most one primary access.</p>
        {facts.roads.map((road,i)=><div className="road-card form-stack" key={road.id}><h3>Road {i+1}</h3><label>Road {i+1} boundary edge<select value={road.edgeId} onChange={e=>edit({...facts,roads:facts.roads.map(r=>r.id===road.id?{...r,edgeId:e.target.value}:r)})}>{edgeOptions.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
          <div className="field-grid"><Field label={`Road ${i+1} name`} value={road.name} maxLength={120} change={v=>edit({...facts,roads:facts.roads.map(r=>r.id===road.id?{...r,name:text(v)}:r)})} /><Field label={`Road ${i+1} category`} value={road.category} maxLength={120} change={v=>edit({...facts,roads:facts.roads.map(r=>r.id===road.id?{...r,category:text(v)}:r)})} /></div>
          <label><span><input className="inline-check" type="checkbox" checked={road.width!==null} onChange={e=>edit({...facts,roads:facts.roads.map(r=>r.id===road.id?{...r,width:e.target.checked?{value:'',unit:'m'}:null}:r)})} /> Road width is known</span></label>
          {road.width && <Measure label={`Road ${i+1} width`} value={road.width} change={v=>edit({...facts,roads:facts.roads.map(r=>r.id===road.id?{...r,width:v}:r)})} />}
          <label><span><input className="inline-check" type="checkbox" checked={road.primaryAccess} onChange={e=>edit({...facts,roads:facts.roads.map(r=>r.id===road.id?{...r,primaryAccess:e.target.checked}:r)})} /> Primary access</span></label>
          <button type="button" className="text-button self-start" onClick={()=>edit({...facts,roads:facts.roads.filter(r=>r.id!==road.id)})}>Remove road {i+1}</button></div>)}
        <button type="button" className="button quiet self-start" disabled={!edgeOptions.some(e=>!facts.roads.some(r=>r.edgeId===e.id))} onClick={()=>{const edge=edgeOptions.find(e=>!facts.roads.some(r=>r.edgeId===e.id));if(edge) edit({...facts,roads:[...facts.roads,{id:crypto.randomUUID(),edgeId:edge.id,width:null,primaryAccess:false}]});}}>Add adjacent road</button>{!boundary && <p className="help">Enter a boundary first to associate roads with edges.</p>}</div>}
      {step===5 && <div className="form-stack"><label>Current site condition<select value={facts.conditions.status} onChange={e=>edit({...facts,conditions:{...facts.conditions,status:e.target.value as SiteFacts['conditions']['status']}})}><option value="UNKNOWN">Unknown</option><option value="VACANT">Vacant land</option><option value="EXISTING_STRUCTURE">Existing building / structure</option><option value="DEMOLITION_EXPECTED">Demolition expected</option></select></label><label>Site condition notes<textarea maxLength={1000} value={facts.conditions.notes ?? ''} onChange={e=>edit({...facts,conditions:{...facts.conditions,notes:text(e.target.value)}})} /></label><p className="help">This records your observations; it is not a structural assessment.</p></div>}
      {step===6 && (preview ? <SiteReview site={preview} /> : <p className="feedback error">{validation}</p>)}
      </fieldset>
      {step!==6 && preview && <div className="site-live-preview"><SitePreview site={preview} />{preview.derived.discrepancy?.material && <p className="feedback error">Area differs by {preview.derived.discrepancy.percent}%. Review your dimensions and declared area.</p>}</div>}
      <div className="form-actions section-top"><button className="button quiet" type="button" disabled={step===0 || pending} onClick={()=>setStep(step-1)}>Previous section</button><button className="button quiet" type="button" disabled={step===6 || pending} onClick={()=>setStep(step+1)}>Next section</button></div>
      <div className="site-save form-stack"><label>Note for version history<textarea required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="What did you add or change?" /></label>
      <div aria-live="polite">{error && <p className="feedback error" role="alert">{error}</p>}{saved && <p className="feedback success">{saved}</p>}</div>
      {conflict && <button type="button" className="text-button self-start" onClick={()=>window.location.reload()}>Reload saved version (discard this unsaved draft)</button>}
      <button className="button primary self-start" disabled={pending || conflict}>{pending?'Saving…':'Save land & site'}</button><p className="help">Saving creates a project version when the record changes. Unsaved entries stay in this page only. Documents and photographs cannot be uploaded yet.</p></div>
    </form>
  </div>;
}
