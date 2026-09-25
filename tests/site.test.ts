import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { areaMm2, buildSite, coordinateMm, degreesToMilliDegrees, displayArea, emptySiteFacts, lengthMm, normalizeProjectSnapshot,
  projectSnapshotSchema, siteAttachmentSchema, siteFactsSchema, sitePreviewModel, siteSchema } from '@property/domain';
import { polygonFacts, rectangleFacts } from './site-fixtures';

describe('exact measurement conversion',()=>{
  it('converts decimal feet/metres with a documented mm rounding boundary',()=>{
    expect(lengthMm({value:'1',unit:'ft'})).toBe(305);
    expect(lengthMm({value:'30',unit:'ft'})).toBe(9144);
    expect(lengthMm({value:'0.0005',unit:'m'})).toBe(1);
    expect(coordinateMm('-0.0005','m')).toBe(-1);
    expect(lengthMm({value:'9.144',unit:'m'})).toBe(9144);
    expect(lengthMm({value:'10.001',unit:'m'})).toBe(10001);
  });
  it('converts area using exact rational factors',()=>{
    const yards=areaMm2({value:'100',unit:'yd2'}), feet=areaMm2({value:'900',unit:'ft2'});
    expect(yards.n*feet.d).toBe(feet.n*yards.d);
    expect(displayArea({value:'10000000000',unit:'mm2'})).toBe('10000');
    expect(displayArea({value:'9290304',unit:'mm2'},'ft2')).toBe('100');
  });
  it.each(['0','-1','NaN','1e3','Infinity','0.000001','10001'])('rejects invalid or unrepresentable dimension %s',value=>{
    expect(()=>lengthMm({value,unit:'m'})).toThrow();
  });
  it('preserves source precision instead of repeatedly converting stored geometry',()=>{
    const facts=rectangleFacts(); if(facts.boundary?.kind!=='RECTANGLE') throw new Error('Fixture');
    facts.boundary.width={value:'1.234567',unit:'ft'};
    const site=buildSite(facts);
    expect(site.facts.boundary).toEqual(facts.boundary);
    expect(site.derived.boundary?.vertices[1]?.x).toBe(376);
    expect(siteSchema.parse(JSON.parse(JSON.stringify(site)))).toEqual(site);
  });
});
describe('canonical site geometry',()=>{
  it('builds ordered closed rectangular edges and exact area with stable IDs',()=>{
    const facts=rectangleFacts(), site=buildSite(facts), boundary=site.derived.boundary!;
    expect(boundary.vertices.map(({x,y})=>[x,y])).toEqual([[0,0],[10000,0],[10000,20000],[0,20000]]);
    expect(boundary.edges[3]?.toVertexId).toBe(boundary.vertices[0]?.id);
    expect(boundary.edges.map(e=>e.id)).toEqual(facts.boundary!.edges.map(e=>e.id));
    expect(site.derived.calculatedArea).toEqual({value:'200000000',unit:'mm2'});
    expect(boundary.edges.map(e=>e.length.value)).toEqual([10000,20000,10000,20000]);
  });
  it('supports irregular quadrilaterals and preserves winding',()=>{
    const points:[string,string][]=[['0','0'],['10','0'],['8','6'],['0','5']];
    const site=buildSite(polygonFacts(points));
    expect(displayArea(site.derived.calculatedArea!)).toBe('50');
    expect(site.derived.boundary?.winding).toBe('CCW');
    expect(buildSite(polygonFacts([...points].reverse())).derived.calculatedArea).toEqual(site.derived.calculatedArea);
    expect(buildSite(polygonFacts([...points].reverse())).derived.boundary?.winding).toBe('CW');
  });
  it('supports a simple concave polygon and half-square-mm area',()=>{
    expect(displayArea(buildSite(polygonFacts([['0','0'],['4','0'],['4','4'],['2','2'],['0','4']])).derived.calculatedArea!)).toBe('12');
    expect(buildSite(polygonFacts([['0','0'],['0.001','0'],['0','0.001']])).derived.calculatedArea?.value).toBe('0.5');
  });
  it.each([
    [['0','0'],['10','10'],['0','10'],['10','0']],
    [['0','0'],['10','0'],['10','0'],['0','10']],
    [['0','0'],['5','0'],['10','0']],
    [['0','0'],['10','0'],['0','10'],['0','0']],
    [['0','0'],['0.0001','0'],['0','10']],
    [['0','0'],['10','0'],['5','5'],['5','0'],['0','5']],
  ] as [string,string][][])('rejects crossed, repeated, touching, collinear or collapsed boundaries %j',(...points)=>{
    expect(()=>buildSite(polygonFacts(points as [string,string][]))).toThrow();
  });
  it('rejects too few points, mismatched edges and duplicate stable IDs',()=>{
    expect(()=>buildSite(polygonFacts([['0','0'],['1','1']]))).toThrow();
    const facts=rectangleFacts();facts.boundary!.edges[1]!.id=facts.boundary!.edges[0]!.id;
    expect(()=>buildSite(facts)).toThrow('unique');
    const irregular=polygonFacts([['0','0'],['1','0'],['0','1']]);irregular.boundary!.edges.pop();
    expect(()=>buildSite(irregular)).toThrow();
  });
  it('keeps declared area intact and flags only discrepancies greater than 2%',()=>{
    const facts=rectangleFacts();facts.declaredArea={value:'100',unit:'m2'};
    const site=buildSite(facts);
    expect(site.facts.declaredArea).toEqual(facts.declaredArea);
    expect(site.derived.discrepancy).toMatchObject({percent:'100',material:true});
    if(facts.boundary?.kind!=='RECTANGLE') throw new Error('Fixture');
    facts.boundary.depth.value='10.2';
    expect(buildSite(facts).derived.discrepancy?.material).toBe(false);
    facts.boundary.depth.value='10.201';
    expect(buildSite(facts).derived.discrepancy?.material).toBe(true);
    facts.boundary.depth.value='9.7';
    expect(buildSite(facts).derived.discrepancy).toMatchObject({percent:'-3',material:true});
  });
  it('supports multiple roads, one primary access, and front-edge references',()=>{
    const facts=rectangleFacts();facts.roads=facts.boundary!.edges.slice(0,2).map((edge,i)=>({id:randomUUID(),edgeId:edge.id,width:{value:'30',unit:'ft'},primaryAccess:i===0}));
    facts.orientation.frontEdgeId=facts.roads[0]!.edgeId;
    expect(buildSite(facts).facts.roads).toHaveLength(2);
    facts.roads[1]!.primaryAccess=true;expect(()=>buildSite(facts)).toThrow('at most one');
    facts.roads[1]!.primaryAccess=false;facts.roads[1]!.edgeId=randomUUID();expect(()=>buildSite(facts)).toThrow('existing boundary');
    facts.roads=[];facts.orientation.frontEdgeId=randomUUID();expect(()=>buildSite(facts)).toThrow('front side');
  });
  it('validates coordinates, optional location, north and independent stated facing',()=>{
    const facts=emptySiteFacts();facts.identity.plotNumber='12/A';facts.identity.surveyNumber='Survey B–7';facts.orientation.facing='E';
    expect(buildSite(facts).facts.orientation.northAngleMilliDegrees).toBeUndefined();
    facts.location.latitude=91;expect(siteFactsSchema.safeParse(facts).success).toBe(false);
    facts.location.latitude=17.4;facts.location.longitude=-181;expect(siteFactsSchema.safeParse(facts).success).toBe(false);
    facts.location.longitude=78.4;expect(buildSite(facts).derived.boundary).toBeNull();
    expect(degreesToMilliDegrees('12.345')).toBe(12345);
    for(const value of ['360','-1','bad','359.9999']) expect(()=>degreesToMilliDegrees(value)).toThrow();
  });
  it('creates deterministic preview inputs from canonical points, roads, north and front',()=>{
    const facts=rectangleFacts();facts.orientation={northAngleMilliDegrees:90000,frontEdgeId:facts.boundary!.edges[0]!.id};
    facts.roads=[{id:randomUUID(),edgeId:facts.boundary!.edges[0]!.id,width:null,primaryAccess:true}];
    const site=buildSite(facts), preview=sitePreviewModel(site)!;
    expect(preview.north?.x).toBeCloseTo(28);expect(preview.north?.y).toBeCloseTo(0);
    expect(preview.edges[0]).toMatchObject({front:true,road:true,primaryAccess:true});
    expect(preview.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).toBe(true);
    expect(sitePreviewModel(site)).toEqual(preview);
    expect(sitePreviewModel(buildSite(emptySiteFacts()))).toBeNull();
  });
  it('rejects forged derived data and accepts persisted JSON key reordering',()=>{
    const site=buildSite(rectangleFacts());
    expect(siteSchema.safeParse({...site,derived:{...site.derived,calculatedArea:{value:'1',unit:'mm2'}}}).success).toBe(false);
    expect(siteSchema.parse({derived:site.derived,facts:site.facts,siteSchemaVersion:1})).toEqual(site);
  });
});
describe('snapshot evolution and attachment contracts',()=>{
  it('normalizes V1 only in memory, retains V1 parsing and rejects unsupported versions',()=>{
    const v1={schemaVersion:1,projectId:randomUUID(),name:'Old project',propertyType:'RESIDENTIAL_HOUSE',status:'ACTIVE'};
    const before=JSON.stringify(v1);
    expect(normalizeProjectSnapshot(v1)).toEqual({...v1,propertyType:'RESIDENTIAL',schemaVersion:2,site:null});
    expect(JSON.stringify(v1)).toBe(before);
    expect(projectSnapshotSchema.parse(v1)).toEqual(v1);
    expect(projectSnapshotSchema.safeParse({...v1,schemaVersion:3}).success).toBe(false);
    expect(projectSnapshotSchema.safeParse({...v1,schemaVersion:2,site:buildSite(rectangleFacts())}).success).toBe(true);
    expect(projectSnapshotSchema.safeParse({...v1,site:null}).success).toBe(false);
  });
  it('requires complete attachment provenance and rejects paths or claims of safety',()=>{
    const metadata={id:randomUUID(),projectId:randomUUID(),projectVersionId:randomUUID(),objectKey:randomUUID(),originalFilename:'survey.pdf',detectedMimeType:'application/pdf',sizeBytes:10,sha256:'a'.repeat(64),category:'SURVEY_SKETCH',uploadedBy:randomUUID(),uploadedAt:new Date().toISOString(),safetyStatus:'UNSCANNED'};
    expect(siteAttachmentSchema.safeParse(metadata).success).toBe(true);
    for(const change of [{originalFilename:'../secret'}, {objectKey:'/tmp/file'}, {detectedMimeType:'text/html'}, {safetyStatus:'CLEAN'}, {uploadedBy:undefined}, {sizeBytes:0}]) expect(siteAttachmentSchema.safeParse({...metadata,...change}).success).toBe(false);
  });
});
