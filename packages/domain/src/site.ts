import { z } from 'zod';
import { areaSchema, areaMm2, coordinateMm, decimalSchema, lengthMm, lengthSchema, ratioDecimal } from './measurements';

const uuid = z.uuid();
const short = z.string().trim().min(1).max(120);
const notes = z.string().trim().max(1000);
const edgeInput = z.strictObject({ id: uuid, label: short.optional() });
const rectangle = z.strictObject({ kind: z.literal('RECTANGLE'), width: lengthSchema, depth: lengthSchema,
  vertexIds: z.array(uuid).length(4), edges: z.array(edgeInput).length(4) });
const polygon = z.strictObject({ kind: z.literal('POLYGON'), unit: z.enum(['m', 'ft']),
  vertices: z.array(z.strictObject({ id: uuid, x: decimalSchema, y: decimalSchema })).min(3).max(32),
  edges: z.array(edgeInput).min(3).max(32) });
const factsShape = z.strictObject({
  identity: z.strictObject({ plotNumber: short.optional(), surveyNumber: short.optional(),
    localIdentifiers: z.array(z.strictObject({ id: uuid, label: short, value: short })).max(10), notes: notes.optional() }),
  location: z.strictObject({ country: short.optional(), region: short.optional(), district: short.optional(), locality: short.optional(),
    postalCode: z.string().trim().max(30).optional(), address: z.string().trim().max(500).optional(),
    latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }),
  boundary: z.discriminatedUnion('kind', [rectangle, polygon]).nullable(),
  declaredArea: areaSchema.nullable(),
  orientation: z.strictObject({ northAngleMilliDegrees: z.number().int().min(0).max(359999).optional(),
    facing: z.enum(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']).optional(), frontEdgeId: uuid.optional() }),
  roads: z.array(z.strictObject({ id: uuid, edgeId: uuid, width: lengthSchema.nullable(), name: short.optional(),
    category: short.optional(), primaryAccess: z.boolean() })).max(32),
  conditions: z.strictObject({ status: z.enum(['UNKNOWN', 'VACANT', 'EXISTING_STRUCTURE', 'DEMOLITION_EXPECTED']), notes: notes.optional() }),
});
export type SiteFacts = z.infer<typeof factsShape>;
export interface SitePoint { id: string; x: number; y: number }
export interface CanonicalBoundary {
  coordinateSystem: 'LOCAL_CARTESIAN'; unit: 'mm'; closure: 'LAST_TO_FIRST'; winding: 'CCW' | 'CW';
  vertices: SitePoint[];
  edges: { id: string; fromVertexId: string; toVertexId: string; length: { value: number; unit: 'mm' }; lengthSquaredMm2: string; label?: string }[];
}
export interface SiteAnalysis {
  calculatorVersion: 1; boundary: CanonicalBoundary | null;
  calculatedArea: { value: string; unit: 'mm2' } | null;
  discrepancy: { differenceMm2: string; percent: string; material: boolean; thresholdPercent: 2 } | null;
}
function cross(a: SitePoint, b: SitePoint, c: SitePoint): bigint {
  return BigInt(b.x - a.x) * BigInt(c.y - a.y) - BigInt(b.y - a.y) * BigInt(c.x - a.x);
}
function onSegment(a: SitePoint, b: SitePoint, c: SitePoint) {
  return cross(a, b, c) === 0n && c.x >= Math.min(a.x,b.x) && c.x <= Math.max(a.x,b.x) && c.y >= Math.min(a.y,b.y) && c.y <= Math.max(a.y,b.y);
}
function intersects(a: SitePoint, b: SitePoint, c: SitePoint, d: SitePoint) {
  const abC = cross(a,b,c), abD = cross(a,b,d), cdA = cross(c,d,a), cdB = cross(c,d,b);
  return (abC * abD < 0n && cdA * cdB < 0n) || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
}
function integerSqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
function unique(values: string[], message: string) { if (new Set(values).size !== values.length) throw new Error(message); }
function calculate(facts: SiteFacts): SiteAnalysis {
  unique(facts.identity.localIdentifiers.map(v => v.id), 'Local identifier IDs must be unique.');
  unique(facts.roads.map(v => v.id), 'Road IDs must be unique.');
  unique(facts.roads.map(v => v.edgeId), 'Use one road relationship per boundary edge.');
  if (facts.roads.filter(v => v.primaryAccess).length > 1) throw new Error('Choose at most one primary road access.');
  for (const road of facts.roads) if (road.width) lengthMm(road.width);
  const input = facts.boundary;
  if (!input) {
    if (facts.roads.length || facts.orientation.frontEdgeId) throw new Error('Add a boundary before choosing roads or a front edge.');
    return { calculatorVersion: 1, boundary: null, calculatedArea: null, discrepancy: null };
  }
  let vertices: SitePoint[];
  if (input.kind === 'RECTANGLE') {
    const w = lengthMm(input.width), h = lengthMm(input.depth);
    vertices = [[0,0], [w,0], [w,h], [0,h]].map(([x,y], i) => ({ id: input.vertexIds[i]!, x: x!, y: y! }));
  } else vertices = input.vertices.map(p => ({ id: p.id, x: coordinateMm(p.x, input.unit), y: coordinateMm(p.y, input.unit) }));
  if (vertices.length !== input.edges.length) throw new Error('Each boundary point must have one outgoing edge.');
  unique([...vertices.map(p => p.id), ...input.edges.map(e => e.id)], 'Boundary point and edge IDs must be unique.');
  unique(vertices.map(p => `${p.x},${p.y}`), 'Boundary points must be distinct after millimetre rounding. Do not repeat the first point.');
  const edgeIds = new Set(input.edges.map(e => e.id));
  if (facts.orientation.frontEdgeId && !edgeIds.has(facts.orientation.frontEdgeId)) throw new Error('The front side must reference a boundary edge.');
  if (facts.roads.some(r => !edgeIds.has(r.edgeId))) throw new Error('Roads must reference existing boundary edges.');
  let twiceArea = 0n;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!, b = vertices[(i+1)%vertices.length]!, c = vertices[(i+2)%vertices.length]!;
    if (cross(a,b,c) === 0n) throw new Error('Consecutive edges must not overlap or form redundant straight-line points.');
    twiceArea += BigInt(a.x)*BigInt(b.y) - BigInt(a.y)*BigInt(b.x);
    for (let j = i+1; j < vertices.length; j++) {
      if (j === i+1 || (i === 0 && j === vertices.length-1)) continue;
      if (intersects(a,b,vertices[j]!,vertices[(j+1)%vertices.length]!)) throw new Error('Boundary edges must not cross or touch other edges.');
    }
  }
  if (twiceArea === 0n) throw new Error('The plot must enclose a positive area.');
  const absolute = twiceArea < 0n ? -twiceArea : twiceArea;
  const boundary: CanonicalBoundary = { coordinateSystem: 'LOCAL_CARTESIAN', unit: 'mm', closure: 'LAST_TO_FIRST', winding: twiceArea > 0n ? 'CCW' : 'CW', vertices,
    edges: input.edges.map((e,i) => {
      const a=vertices[i]!, b=vertices[(i+1)%vertices.length]!;
      const squared = BigInt(b.x-a.x)**2n + BigInt(b.y-a.y)**2n;
      const floor = integerSqrt(squared);
      const nearest = squared * 4n >= (2n*floor+1n)**2n ? floor+1n : floor;
      return { ...e, fromVertexId: a.id, toVertexId: b.id, length: { value: Number(nearest), unit: 'mm' }, lengthSquaredMm2: squared.toString() };
    }) };
  let discrepancy: SiteAnalysis['discrepancy'] = null;
  if (facts.declaredArea) {
    const declared = areaMm2(facts.declaredArea);
    const delta = absolute * declared.d - declared.n * 2n;
    const absDelta = delta < 0n ? -delta : delta;
    discrepancy = { differenceMm2: ratioDecimal(delta, 2n * declared.d, 8), percent: ratioDecimal(delta * 100n, 2n * declared.n, 2),
      material: absDelta * 100n > 2n * declared.n * 2n, thresholdPercent: 2 };
  }
  return { calculatorVersion: 1, boundary, calculatedArea: { value: ratioDecimal(absolute, 2n, 1), unit: 'mm2' }, discrepancy };
}
export const siteFactsSchema = factsShape.superRefine((facts, ctx) => {
  try { calculate(facts); } catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid site geometry.' }); }
});
export interface Site { siteSchemaVersion: 1; facts: SiteFacts; derived: SiteAnalysis }
export function buildSite(input: unknown): Site {
  const facts = siteFactsSchema.parse(input);
  return { siteSchemaVersion: 1, facts, derived: calculate(facts) };
}
// Readers verify stored derived data against its declared deterministic calculator version.
export const siteSchema = z.strictObject({ siteSchemaVersion: z.literal(1), facts: siteFactsSchema, derived: z.unknown() })
  .transform((value, ctx): Site => {
    const site = buildSite(value.facts);
    if (stableJson(value.derived) !== stableJson(site.derived)) ctx.addIssue({ code: 'custom', message: 'Stored site calculations do not match the recorded inputs.' });
    return site;
  });
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function emptySiteFacts(): SiteFacts {
  return { identity: { localIdentifiers: [] }, location: {}, boundary: null, declaredArea: null, orientation: {}, roads: [], conditions: { status: 'UNKNOWN' } };
}
/** Drawing coordinates are presentation-only; canonical geometry always remains in mm. */
export function sitePreviewModel(site: Site) {
  const boundary = site.derived.boundary;
  if (!boundary) return null;
  const xs=boundary.vertices.map(p=>p.x), ys=boundary.vertices.map(p=>p.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  const scale=Math.min(340/(maxX-minX), 240/(maxY-minY));
  const points=boundary.vertices.map(p=>({ id:p.id, x:80+(p.x-minX)*scale, y:310-(p.y-minY)*scale }));
  const angle=site.facts.orientation.northAngleMilliDegrees;
  return { points, edges: boundary.edges.map((e,i)=>({ ...e, from:points[i]!, to:points[(i+1)%points.length]!,
    road: site.facts.roads.some(r=>r.edgeId===e.id), primaryAccess: site.facts.roads.some(r=>r.edgeId===e.id && r.primaryAccess), front:e.id===site.facts.orientation.frontEdgeId })),
    north: angle === undefined ? null : { x: Math.sin(angle/1000*Math.PI/180)*28, y:-Math.cos(angle/1000*Math.PI/180)*28 } };
}
