// Stair treads and floor slab undersides share the world chunk material (no new draw calls).
import { FLOOR_THICKNESS } from './interiors/storeys.js';
export function addStairGeometry(chunk,shell,h,{quad}) {
  for(const s of shell.plan.stairs) {
    const dx=s.x1-s.x0,dz=s.z1-s.z0,len=Math.hypot(dx,dz),nx=-dz/len,nz=dx/len;
    const n=Math.ceil((s.y1-s.y0)/.16), ybase=shell.floor;
    const pt=(t,side,y)=>[s.x0+dx*t+nx*s.w/2*side,y-ybase,s.z0+dz*t+nz*s.w/2*side];
    const col=[.39,.32,.24];
    for(let i=0;i<n;i++) {
      const t0=i/n,t1=(i+1)/n, y0=s.y0+(s.y1-s.y0)*t0,y1=s.y0+(s.y1-s.y0)*t1;
      quad(chunk,pt(t0,-1,y1),pt(t1,-1,y1),pt(t1,1,y1),pt(t0,1,y1),0,1,0,...col,null,h);
      quad(chunk,pt(t0,-1,y0),pt(t0,1,y0),pt(t0,1,y1),pt(t0,-1,y1),-dx/len,0,-dz/len,...col,null,h);
    }
    const A=pt(0,-1,s.y0-FLOOR_THICKNESS),B=pt(1,-1,s.y1-FLOOR_THICKNESS),C=pt(1,1,s.y1-FLOOR_THICKNESS),D=pt(0,1,s.y0-FLOOR_THICKNESS);
    quad(chunk,A,D,C,B,0,-1,0,...col,null,h);
    for(const side of [-1,1])quad(chunk,pt(0,side,s.y0-FLOOR_THICKNESS),pt(1,side,s.y1-FLOOR_THICKNESS),pt(1,side,s.y1),pt(0,side,s.y0),nx*side,0,nz*side,...col,null,h);
  }
}
