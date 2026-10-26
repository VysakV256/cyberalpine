'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Terrain = require('./terrain.cjs');
const universe = JSON.parse(fs.readFileSync(path.join(__dirname,'../Content/Data/universe.json'),'utf8'));
const close = (a,b,e=1e-8) => assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=e,`${a} != ${b}`);
// Native reader contract: flat dataset homes, nested world settings, lake carve.
function nativeField(x,z,withLakes=true) {
  let height=universe.world.baseline,gx=0,gz=0;
  const terms=universe.datasets.map(d=>({...d,center:d.anchor}));
  if(withLakes)terms.push(...universe.lakes.map(l=>({...l,relief:-l.depth})));
  for(const d of terms) {
    const dx=x-d.center.x,dz=z-d.center.z,q=(dx*dx+dz*dz)/(d.radius*d.radius);
    if(q>=1)continue;const a=1-q;
    height+=d.relief*a*a*a;gx+=-6*d.relief*a*a*dx/(d.radius*d.radius);gz+=-6*d.relief*a*a*dz/(d.radius*d.radius);
  }
  return {height,gradient:{x:gx,z:gz}};
}
function boundary(lake,angle,clearance=0) {
  let lo=0,hi=lake.radius;
  for(let i=0;i<18;i++){
    const mid=(lo+hi)/2,h=nativeField(lake.center.x+Math.cos(angle)*mid,lake.center.z+Math.sin(angle)*mid).height;
    if(h<lake.waterLevel-clearance)lo=mid;else hi=mid;
  }
  return lo;
}

test('flat native homes and browser homes describe identical real-data geometry',()=>{
  assert.ok(universe.datasets.length>=6);
  for(const d of universe.datasets) {
    const browser=universe.world.terrain.datasets.find(b=>b.id===d.id);
    assert.ok(browser);assert.deepEqual(d.anchor,browser.anchor);
    close(d.radius,browser.radius);close(d.relief,browser.relief);
    assert.equal(d.recordCount,d.records.length);assert.equal(d.fixture,false);
    for(const [dx,dz]of[[0,0],[.2*d.radius,.3*d.radius],[.85*d.radius,0]]){
      const x=d.anchor.x+dx,z=d.anchor.z+dz,a=nativeField(x,z,false),b=Terrain.field(universe.world.terrain,x,z);
      close(a.height,b.height);close(a.gradient.x,b.gradient.x);close(a.gradient.z,b.gradient.z);
    }
  }
});

test('all supplied flow polylines resolve to real homes; native drainage remains downhill',()=>{
  const ids=new Set(universe.datasets.map(d=>d.id));let drainage=0,transfers=0;
  for(const flow of universe.flows) {
    assert.ok(ids.has(flow.from)&&ids.has(flow.to));assert.ok(flow.points.length>=2);
    for(let i=0;i<flow.points.length;i++){
      const p=flow.points[i];assert.ok(Math.abs(p.x)<=universe.extent&&Math.abs(p.z)<=universe.extent);
      close(p.y,nativeField(p.x,p.z).height);
      if(flow.kind==='simulated-drainage'&&i)assert.ok(p.y<flow.points[i-1].y);
    }
    if(flow.kind==='simulated-drainage'){drainage++;assert.equal(flow.from,flow.to);}
    else{transfers++;assert.equal(flow.relationship,'declared deterministic derivation');assert.equal(flow.gravitySupported,false);}
  }
  assert.ok(drainage>=1);assert.equal(transfers,3);
});

test('lake floor, shoreline, gradients and boat clearance agree with the shared manifest',()=>{
  for(const l of universe.lakes){
    const atCenter=nativeField(l.center.x,l.center.z);
    close(atCenter.height,universe.baseline-l.depth);assert.ok(atCenter.height<l.waterLevel-.25);
    let safe=l.radius;
    for(let i=0;i<32;i++){
      const angle=i*2*Math.PI/32,r=boundary(l,angle);
      close(nativeField(l.center.x+Math.cos(angle)*r,l.center.z+Math.sin(angle)*r).height,l.waterLevel,1e-4);
      safe=Math.min(safe,boundary(l,angle,.25));
    }
    safe-=1.6;assert.ok(safe>2);
    const docked={x:l.center.x+safe*.55,z:l.center.z-1.5};
    assert.ok(Math.hypot(docked.x-l.center.x,docked.z-l.center.z)<safe);
    for(let i=0;i<128;i++){
      const a=i*2*Math.PI/128,x=l.center.x+Math.cos(a)*safe,z=l.center.z+Math.sin(a)*safe,f=nativeField(x,z),e=1e-4;
      assert.ok(f.height<l.waterLevel-.25);
      close(f.gradient.x,(nativeField(x+e,z).height-nativeField(x-e,z).height)/(2*e),1e-7);
      close(f.gradient.z,(nativeField(x,z+e).height-nativeField(x,z-e).height)/(2*e),1e-7);
    }
  }
});
