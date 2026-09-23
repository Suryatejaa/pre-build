import { displayArea, ratioDecimal, sitePreviewModel, type Site } from '@property/domain';

export function SitePreview({ site }: { site: Site }) {
  const preview = sitePreviewModel(site);
  if (!preview) return <p className="help">Add a boundary to see your site preview.</p>;
  return <figure className="site-preview"><svg viewBox="0 0 500 390" role="img" aria-label="Site boundary with dimensions, north direction and access edges">
    <polygon points={preview.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="#eef2e6" stroke="#49634c" strokeWidth="2" />
    {preview.edges.map((edge,i)=><g key={edge.id}>
      <line x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} stroke={edge.road ? '#477a9a' : '#49634c'} strokeWidth={edge.road || edge.front ? 6 : 2} strokeDasharray={edge.front ? '10 4' : undefined} />
      <text x={(edge.from.x+edge.to.x)/2} y={(edge.from.y+edge.to.y)/2-10} textAnchor="middle" fontSize="11" fill="#263b33">{edge.label ?? `Edge ${i+1}`} · {ratioDecimal(BigInt(edge.length.value),1000n,3)} m{edge.primaryAccess ? ' · entry' : ''}</text>
      <circle cx={edge.from.x} cy={edge.from.y} r="3" fill="#263b33" />
    </g>)}
    {preview.north ? <g transform="translate(450 45)"><line x1="0" y1="0" x2={preview.north.x} y2={preview.north.y} stroke="#263b33" strokeWidth="2" /><circle cx={preview.north.x} cy={preview.north.y} r="3" fill="#263b33" /><text x={preview.north.x} y={preview.north.y-8} fontSize="12" textAnchor="middle">N</text></g> : <text x="335" y="30" fontSize="11">North not recorded</text>}
  </svg><figcaption>Blue: road · Dashed: front side. Edge lengths are rounded to the nearest millimetre. A record of your inputs, not a surveyed plan.</figcaption></figure>;
}
export function SiteReview({ site }: { site: Site }) {
  const { facts, derived } = site;
  return <div className="site-review"><SitePreview site={site} />
    <dl className="definition-list">
      <div><dt>Plot / survey number</dt><dd>{facts.identity.plotNumber ?? 'Not recorded'} / {facts.identity.surveyNumber ?? 'Not recorded'}</dd></div>
      {facts.identity.localIdentifiers.map(id=><div key={id.id}><dt>{id.label}</dt><dd>{id.value}</dd></div>)}
      <div><dt>Location</dt><dd>{[facts.location.address, facts.location.locality, facts.location.district, facts.location.region, facts.location.postalCode, facts.location.country].filter(Boolean).join(', ') || 'Not recorded'}</dd></div>
      {(facts.location.latitude !== undefined || facts.location.longitude !== undefined) && <div><dt>Coordinates (degrees)</dt><dd>Latitude: {facts.location.latitude ?? 'Not recorded'}; longitude: {facts.location.longitude ?? 'Not recorded'}</dd></div>}
      <div><dt>Declared / document area</dt><dd>{facts.declaredArea ? `${facts.declaredArea.value} ${facts.declaredArea.unit}` : 'Not recorded'}</dd></div>
      <div><dt>Calculated boundary area</dt><dd>{derived.calculatedArea ? `${displayArea(derived.calculatedArea)} m² / ${displayArea(derived.calculatedArea,'ft2')} ft²` : 'Boundary not recorded'}</dd></div>
      <div><dt>North direction / stated facing</dt><dd>{facts.orientation.northAngleMilliDegrees === undefined ? 'North not recorded' : `${facts.orientation.northAngleMilliDegrees/1000}° clockwise from the top of the plan`}; facing: {facts.orientation.facing ?? 'Not recorded'}</dd></div>
      <div><dt>Front side</dt><dd>{derived.boundary?.edges.find(e=>e.id===facts.orientation.frontEdgeId)?.label ?? (facts.orientation.frontEdgeId ? `Edge ${(derived.boundary?.edges.findIndex(e=>e.id===facts.orientation.frontEdgeId) ?? -1)+1}` : 'Not recorded')}</dd></div>
      <div><dt>Existing site</dt><dd>{facts.conditions.status.replaceAll('_',' ').toLowerCase()}{facts.conditions.notes && ` — ${facts.conditions.notes}`}</dd></div>
      {facts.identity.notes && <div><dt>Plot notes</dt><dd>{facts.identity.notes}</dd></div>}
    </dl>
    {derived.discrepancy && <p className={`feedback ${derived.discrepancy.material ? 'error' : 'success'}`} role="status">Calculated area differs from your declared area by {derived.discrepancy.percent}%. {derived.discrepancy.material ? 'This exceeds the 2% review threshold. Check dimensions and document area; neither value has been replaced.' : 'Both values remain recorded separately.'}</p>}
    <h3>Road access</h3>{facts.roads.length ? <ul>{facts.roads.map(road=><li key={road.id}>{road.name ?? 'Unnamed road'} · Edge {(derived.boundary?.edges.findIndex(e=>e.id===road.edgeId) ?? -1)+1} · {road.width ? `${road.width.value} ${road.width.unit} wide` : 'Width not recorded'}{road.category && ` · ${road.category}`}{road.primaryAccess && ' · Primary access'}</li>)}</ul> : <p className="help">No road relationships recorded.</p>}
    {facts.boundary?.kind === 'RECTANGLE' && <p className="help">Entered rectangle: {facts.boundary.width.value} {facts.boundary.width.unit} × {facts.boundary.depth.value} {facts.boundary.depth.unit}.</p>}
    {facts.boundary?.kind === 'POLYGON' && <details><summary>Entered boundary coordinates ({facts.boundary.unit})</summary><ol>{facts.boundary.vertices.map((point,i)=><li key={point.id}>Point {i+1}: x {point.x}, y {point.y}</li>)}</ol></details>}
  </div>;
}
