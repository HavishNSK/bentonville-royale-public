import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { Bots } from '../src/game/Bots.js';
const data = {meta:{bounds:{minX:-50,maxX:50,minZ:-50,maxZ:50}},buildings:[],roads:[],areas:[],pois:[]};
function fixture() {
  const w=new World(data);
  w.addBuilding({id:123456,t:'apartments',mat:'brick',lv:3,h:11,p:[[0,0],[25,0],[25,20],[0,20]]});
  w.finishBuildings();
  const c=w.buildingInteriors()[0].collider;
  return {w,c,p:c.shell.plan};
}
test('upper floors have connected stairs, supported loot and deterministic plans', () => {
  const {w,c,p}=fixture();
  assert.equal(p.levels.length,3);
  assert.equal(p.stairs.length,2);
  for(const s of p.stairs) for(const direction of [1,-1]) {
    let y=direction>0?s.y0:s.y1;
    for(let k=0;k<=60;k++) {
      const t=direction>0?k/60:1-k/60;
      const pos={x:s.x0+(s.x1-s.x0)*t,y,z:s.z0+(s.z1-s.z0)*t};
      const before={...pos};
      w.resolveCircle(pos,.42,1.8);
      assert.ok(Math.hypot(pos.x-before.x,pos.z-before.z)<.01,'partitions clear stair flight');
      y=w.groundHeight(pos.x,pos.z,y,.5);
      assert.ok(Math.abs(y-(s.y0+(s.y1-s.y0)*t))<.08,'continuous ascent/descent');
      assert.ok(w.ceilingAbove(pos.x,pos.z,y)>=y+1.8,'stair headroom');
    }
  }
  for(const spot of p.lootSpots) assert.ok(Math.abs(w.groundHeight(spot.x,spot.z,spot.y,.1)-spot.y)<.1,'loot on floor, not stairs or void');
  assert.equal(fixture().w.interiorHash,w.interiorHash);
});
test('bot routes climb multiple floors and return down without avoiding the stairs', () => {
  const {w,c,p}=fixture(), s=p.stairs[0], last=p.stairs.at(-1);
  const len=Math.hypot(s.x1-s.x0,s.z1-s.z0), ux=(s.x1-s.x0)/len,uz=(s.z1-s.z0)/len;
  const low={x:s.x0-ux,y:s.y0,z:s.z0-uz};
  const high={x:last.x1+ux,y:last.y1,z:last.z1+uz};
  const bots=new Bots({world:w,kits:[]}); bots.spawn(1,()=>.5,{dropPoints:[low]});
  const b=bots.brains[0],a=b.actor;
  a.pos.set(low.x,low.y,low.z); a.gliding=false; a.grounded=true;b.state='wander';b.inB=c;
  for(const target of [high,low]) {
    b.pathN=bots._roomRoute(c,a.pos.x,a.pos.z,a.pos.y,target.x,target.z,target.y,b.path,b.pathK,0);
    b.pathI=0;
    for(let step=0;step<2400 && b.pathI<b.pathN;step++) {
      const i=b.pathI,x=b.path[i*2],z=b.path[i*2+1];
      if(Math.hypot(a.pos.x-x,a.pos.z-z)<.16){b.pathI++;continue;}
      bots.time+=.025;
      bots._steer(b,x,z,3,0);
      bots._move(b,.025);
    }
    assert.equal(b.pathI,b.pathN,'bot reaches every stair waypoint');
    assert.ok(Math.abs(a.pos.y-target.y)<.25,`bot reaches target storey: ${a.pos.y} vs ${target.y}`);
  }
});
test('building membership on upper floors uses that floor partitions', () => {
  const {w,c,p}=fixture();
  const k=p.levels[0].wallMeta.findIndex(m=>m.kind==='wall');
  const W=p.levels[0].walls,x=(W[k*7]+W[k*7+2])/2,z=(W[k*7+1]+W[k*7+3])/2;
  c.shell.plan={...p,levels:p.levels.map(L=>L.i===1?{...L,walls:new Float32Array(0),wallMeta:[]}:L)};
  assert.equal(w.interiorAt(x,z),null,'ground-floor partition blocks membership');
  assert.ok(w.interiorAt(x,z,p.levels[1].y)===c,'open upper floor is inside');
  const bots=new Bots({world:w,kits:[]});
  assert.ok(bots._shellAt(x,z,p.levels[1].y)===c,'upper loot/bot belongs to correct building');
});
test('full bot simulation seeks and opens upper-floor loot', async () => {
  const {Loot}=await import('../src/game/Loot.js');
  const {w,c,p}=fixture(),s=p.stairs[0];
  const len=Math.hypot(s.x1-s.x0,s.z1-s.z0),ux=(s.x1-s.x0)/len,uz=(s.z1-s.z0)/len;
  const loot=new Loot({scene:null,world:w});loot._rng=()=>.5;
  const chest=loot._add('chest',s.x1+ux,s.y1,s.z1+uz,0);
  const bots=new Bots({world:w,kits:[],loot});
  const start={x:s.x0-ux,z:s.z0-uz};bots.spawn(1,()=>.5,{dropPoints:[start]});
  const b=bots.brains[0],a=b.actor;
  a.pos.set(start.x,s.y0,start.z);a.gliding=false;a.grounded=true;b.state='wander';
  for(const mat of ['wood','brick','metal'])a.inventory.mats[mat]=200;
  for(let i=0;i<2400&&!chest.opened;i++)bots.update(.025,{});
  assert.ok(chest.opened,`bot failed to open upstairs chest; state=${b.state}, waypoint=${b.pathI}/${b.pathN}, y=${a.pos.y}`);
  assert.ok(b.indoorLoot>0);
});
test('upper slabs and stairs stop rays without exposing breakable panels', () => {
  const {w,c,p}=fixture(),s=p.stairs[0];
  const spot=p.lootSpots.find(r=>r.level===1);
  const hit=w.raycast(spot.x,spot.y+.5,spot.z,0,-1,0,1);
  assert.ok(hit&&Math.abs(hit.y-spot.y)<.01,'shot meets upper floor');
  assert.equal(w.panelHit(hit),null,'slab is not breakable');
  const x=(s.x0+s.x1)/2,z=(s.z0+s.z1)/2,y=(s.y0+s.y1)/2;
  const stair=w.raycast(x,y+.5,z,0,-1,0,1);
  assert.ok(stair&&Math.abs(stair.y-y)<.01,'shot meets stair surface');
  assert.equal(w.panelHit(stair),null,'stairs are not breakable');
  const pn=p.panels.find(pn=>pn.level===1&&pn.kind==='inner');
  assert.ok(w.breakPanel(c,pn.id));
  assert.equal(c.shell.wallOn[1][pn.wall],0);
  w.restoreAllPanels();
  assert.equal(c.shell.wallOn[1][pn.wall],1);
});
test('stair geometry emits finite merged treads, risers and undersides', async () => {
  const {addStairGeometry}=await import('../src/world/InteriorStairs.js');
  const {c}=fixture(),calls=[];
  addStairGeometry({},c.shell,11,{quad:(...args)=>calls.push(args)});
  assert.ok(calls.length>60&&calls.length<200);
  for(const call of calls){
    for(const vertex of call.slice(1,5))assert.ok(vertex.every(Number.isFinite));
    assert.equal(call.at(-1),11);
    assert.equal(call.at(-2),null);
  }
});
test('big footprints get several spread-out flights; bots use the nearest one', () => {
  const w=new World({meta:{bounds:{minX:-200,maxX:200,minZ:-200,maxZ:200},},buildings:[],roads:[],areas:[],pois:[]});
  w.addBuilding({id:424242,t:'office',mat:'brick',lv:3,h:11,p:[[0,0],[120,0],[120,40],[0,40]]});
  w.finishBuildings();
  const c=w.buildingInteriors()[0].collider,p=c.shell.plan;
  assert.equal(p.levels.length,3);
  const shafts=p.stairs.filter(s=>s.level===0);
  assert.ok(shafts.length>=2,`several flights on a 4800 m2 footprint: ${shafts.length}`);
  assert.equal(p.stairs.length,shafts.length*2,'one flight per shaft per storey');
  for(const L of p.levels.slice(1)) assert.equal(L.holes.length,shafts.length,`level ${L.i}: a hole over every flight`);
  for(let i=0;i<shafts.length;i++) for(let j=i+1;j<shafts.length;j++)
    assert.ok(Math.hypot((shafts[i].x0+shafts[i].x1)/2-(shafts[j].x0+shafts[j].x1)/2,(shafts[i].z0+shafts[i].z1)/2-(shafts[j].z0+shafts[j].z1)/2)>=29.9,'flights spread apart');
  for(const s of p.stairs) {
    let y=s.y0;
    for(let k=0;k<=60;k++) {
      const t=k/60,pos={x:s.x0+(s.x1-s.x0)*t,y,z:s.z0+(s.z1-s.z0)*t},before={...pos};
      w.resolveCircle(pos,.42,1.8);
      assert.ok(Math.hypot(pos.x-before.x,pos.z-before.z)<.02,'partitions clear every flight');
      y=w.groundHeight(pos.x,pos.z,y,.5,w.builtAbove(pos.x,pos.z,y));
      assert.ok(Math.abs(y-(s.y0+(s.y1-s.y0)*t))<.08,'continuous ascent on every flight');
      assert.ok(w.ceilingAbove(pos.x,pos.z,y)>=y+1.8,'headroom on every flight');
    }
  }
  // a bot starting right beside a flight's foot climbs that flight, not the first one in the list
  const far=shafts[shafts.length-1],len=Math.hypot(far.x1-far.x0,far.z1-far.z0),ux=(far.x1-far.x0)/len,uz=(far.z1-far.z0)/len;
  const bots=new Bots({world:w,kits:[]});bots.spawn(1,()=>.5,{dropPoints:[{x:far.x0-ux,z:far.z0-uz}]});
  const b=bots.brains[0];
  b.pathN=bots._roomRoute(c,far.x0-ux*2,far.z0-uz*2,far.y0,far.x1+ux,far.z1+uz,far.y1,b.path,b.pathK,0);
  let climbs=false;
  for(let i=0;i<b.pathN;i++) if(b.pathK[i]===2&&Math.hypot(b.path[i*2]-far.x1,b.path[i*2+1]-far.z1)<.01) climbs=true;
  assert.ok(climbs,'route climbs the nearby flight');
  const again=new World({meta:{bounds:{minX:-200,maxX:200,minZ:-200,maxZ:200}},buildings:[],roads:[],areas:[],pois:[]});
  again.addBuilding({id:424242,t:'office',mat:'brick',lv:3,h:11,p:[[0,0],[120,0],[120,40],[0,40]]});
  again.finishBuildings();
  assert.equal(again.interiorHash,w.interiorHash,'deterministic');
});
