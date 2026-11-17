// Low-poly room props and readable room plaques share the existing merged building material,
// chunk distance culling and frustum culling. No textures, per-prop meshes or per-frame work.
import { toWorld } from './interiors/layout.js';

// Original 3x5 block alphabet: bit 14 is the top-left pixel. Unsupported characters are blank.
const GLYPHS = {
  A:'010101111101101', B:'110101110101110', C:'011100100100011', D:'110101101101110',
  E:'111100110100111', F:'111100110100100', G:'011100101101011', H:'101101111101101',
  I:'111010010010111', J:'001001001101010', K:'101101110101101', L:'100100100100111',
  M:'101111111101101', N:'101111111111101', O:'010101101101010', P:'110101110100100',
  Q:'010101101111011', R:'110101110101101', S:'011100010001110', T:'111010010010010',
  U:'101101101101111', V:'101101101101010', W:'101101111111101', X:'101101010101101',
  Y:'101101010010010', Z:'111001010100111', '0':'111101101101111', '1':'010110010010111',
  '2':'110001010100111', '3':'110001010001110', '4':'101101111001001', '5':'111100110001110',
  '6':'011100111101111', '7':'111001010010010', '8':'111101111101111', '9':'111101111001110',
  '-':'000000111000000', '&':'010101010101011',
};
const linear = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const rgb = hex => [linear((hex>>16 & 255)/255),linear((hex>>8 & 255)/255),linear((hex & 255)/255)];

function box(chunk,F,a0,b0,a1,b1,y0,y1,color,h,quad) {
  const P = (a,b,y) => { const [x,z] = toWorld(F,a,b); return [x,y,z]; };
  const A=P(a0,b0,y0), B=P(a1,b0,y0), C=P(a1,b1,y0), D=P(a0,b1,y0);
  const E=P(a0,b0,y1), G=P(a1,b0,y1), H=P(a1,b1,y1), I=P(a0,b1,y1);
  const col=rgb(color);
  for (const [p,n] of [ [[A,B,G,E],[-F.vx,0,-F.vz]], [[B,C,H,G],[F.ux,0,F.uz]], [[C,D,I,H],[F.vx,0,F.vz]], [[D,A,E,I],[-F.ux,0,-F.uz]], [[E,G,H,I],[0,1,0]] ]) {
    quad(chunk,...p,...n,...col,null,h);
  }
}

function prop(chunk,plan,shell,p,h,quad) {
  const {a0,b0,a1,b1,height,color,kind}=p;
  const y=p.y-shell.floor+0.06, w=a1-a0,d=b1-b0;
  const B=(a,b,c,e,lo,hi,col=color) => box(chunk,plan.frame,a,b,c,e,y+lo,y+hi,col,h,quad);
  if (['table','desk','workbench','bench'].includes(kind)) {
    B(a0,b0,a1,b1,height-0.12,height);
    for (const a of [a0,a1-0.1]) for (const b of [b0,b1-0.1]) B(a,b,a+0.1,b+0.1,0,height-0.12,0x5f5147);
  } else if (kind === 'bed') {
    B(a0,b0,a1,b1,0,height,0x876a4c);
    B(a0+0.06,b0+0.06,a1-0.06,b1-0.06,height-0.08,height+0.12,color);
    B(a0+0.14,b0+0.12,a1-0.14,b0+Math.min(0.5,d/3),height+0.12,height+0.2,0xe9dfc9);
  } else if (kind === 'sofa') {
    B(a0,b0,a1,b1,0,height*0.5);
    B(a0,b0,a1,b0+0.16,height*0.5,height);
    B(a0,b0,a0+0.15,b1,height*0.5,height*0.8);
    B(a1-0.15,b0,a1,b1,height*0.5,height*0.8);
  } else if (kind === 'shelf') {
    B(a0,b0,a0+0.1,b1,0,height); B(a1-0.1,b0,a1,b1,0,height);
    for (let k=0;k<4;k++) B(a0,b0,a1,b1,k*height/3,k*height/3+0.07);
  } else {
    B(a0,b0,a1,b1,0,height);
    if (kind === 'counter' || kind === 'sink') B(a0-0.03,b0-0.03,a1+0.03,b1+0.03,height,height+0.05,0xe5dfce);
    if (kind === 'planter') B(a0+0.12,b0+0.12,a1-0.12,b1-0.12,height,height+0.25,0x4f7844);
    if (kind === 'safe') B(a0+w*0.2,b1+0.005,a1-w*0.2,b1+0.025,height*0.3,height*0.7,0xaab2ac);
  }
}

function plaque(chunk,shell,s,h,quad) {
  const tx=s.nz,tz=-s.nx, y=s.y-shell.floor;
  const P=(u,v,offset) => [s.x+tx*u+s.nx*offset,y+v,s.z+tz*u+s.nz*offset];
  const Q=(u0,v0,u1,v1,col,offset) => quad(chunk,P(u0,v0,offset),P(u1,v0,offset),P(u1,v1,offset),P(u0,v1,offset),s.nx,0,s.nz,...rgb(col),null,h);
  Q(-s.width/2,-s.height/2,s.width/2,s.height/2,0x332c42,0);
  const unit=Math.min((s.width-0.1)/(s.text.length*4),0.034);
  const left=-s.text.length*4*unit/2;
  for (let c=0;c<s.text.length;c++) {
    const glyph=GLYPHS[s.text[c]];
    if (!glyph) continue;
    for (let row=0;row<5;row++) for (let col=0;col<3;col++) {
      if (glyph[row*3+col] !== '1') continue;
      const u=left+(c*4+col)*unit, v=(1.5-row)*unit;
      Q(u,v,u+unit*0.88,v+unit*0.88,0xffe4a1,0.008);
    }
  }
}

/** api is the existing {quad} WorldMeshes builder; all y values are relative to shell.floor. */
export function addFurnishingGeometry(chunk,shell,h,{quad}) {
  const plan=shell.plan;
  if (!plan) return;
  for (const p of plan.furniture || []) prop(chunk,plan,shell,p,h,quad);
  for (const s of plan.signs || []) plaque(chunk,shell,s,h,quad);
}
