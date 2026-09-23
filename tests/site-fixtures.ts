import { randomUUID } from 'node:crypto';
import { emptySiteFacts, type SiteFacts } from '@property/domain';
export function rectangleFacts(): SiteFacts {
  return { ...emptySiteFacts(), boundary: { kind: 'RECTANGLE', width: { value: '10', unit: 'm' }, depth: { value: '20', unit: 'm' },
    vertexIds: Array.from({length:4},()=>randomUUID()), edges: Array.from({length:4},()=>({id:randomUUID()})) } };
}
export function polygonFacts(points: [string,string][]): SiteFacts {
  return { ...emptySiteFacts(), boundary: { kind:'POLYGON', unit:'m', vertices:points.map(([x,y])=>({id:randomUUID(),x,y})), edges:points.map(()=>({id:randomUUID()})) } };
}
