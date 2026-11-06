/* GS Studio · motor de escaneo.
 * Detecta la hoja, corrige la perspectiva y deja el acabado «tipo escáner».
 * Sin dependencias ni descargas: todo corre en el propio teléfono, también sin conexión.
 *
 * API (window.GSScan):
 *   detect(source,{maxSide,refine,prefer}) -> {corners,confidence} | null   (esquinas normalizadas 0..1: TL,TR,BR,BL)
 *   refine(source,corners)               -> corners afinadas en alta resolución
 *   estimateSize(corners,w,h,limits)     -> {w,h,std}  tamaño de salida con la proporción real de la hoja
 *   warp(imageData,corners,w,h,opts)     -> canvas con la hoja enderezada
 *   enhance(canvas,mode,yieldFn)         -> acabado: 'enhance' | 'color' | 'gray' | 'bw'
 *   snapRatio(w,h)                       -> 'A4' | 'Carta' | 'Oficio' | 'Legal' | null
 *   registerView(video,photo)            -> {x0,y0,w,h,score} | null   ubica el cuadro de video dentro de la foto
 *   mapToPhoto(reg,corners) / polyIoU(a,b)
 */
(function(root){
'use strict';
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const STANDARD={A4:1.4142,Carta:1.2941,Oficio:1.5294,Legal:1.6471};

/* ───────────── utilidades de imagen ───────────── */
function sourceSize(s){return{w:s.videoWidth||s.naturalWidth||s.width,h:s.videoHeight||s.naturalHeight||s.height}}
function grab(source,maxSide){
  const {w:sw,h:sh}=sourceSize(source);
  const k=Math.min(1,maxSide/Math.max(sw,sh));
  const w=Math.max(8,Math.round(sw*k)),h=Math.max(8,Math.round(sh*k));
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const x=c.getContext('2d',{willReadFrequently:true});
  x.drawImage(source,0,0,w,h);
  const data=x.getImageData(0,0,w,h).data;
  c.width=c.height=1;
  return{data,w,h};
}
function luminance(data,n){
  const L=new Uint8Array(n);
  for(let i=0,j=0;i<n;i++,j+=4)L[i]=(data[j]*77+data[j+1]*150+data[j+2]*29)>>8;
  return L;
}
function boxBlur(src,w,h,r){
  const out=new Uint8Array(w*h),tmp=new Uint8Array(w*h),n=2*r+1;
  for(let y=0;y<h;y++){
    const o=y*w;let s=0;
    for(let i=-r;i<=r;i++)s+=src[o+clamp(i,0,w-1)];
    for(let x=0;x<w;x++){
      tmp[o+x]=(s/n+.5)|0;
      s+=src[o+Math.min(w-1,x+r+1)]-src[o+Math.max(0,x-r)];
    }
  }
  for(let x=0;x<w;x++){
    let s=0;
    for(let i=-r;i<=r;i++)s+=tmp[clamp(i,0,h-1)*w+x];
    for(let y=0;y<h;y++){
      out[y*w+x]=(s/n+.5)|0;
      s+=tmp[Math.min(h-1,y+r+1)*w+x]-tmp[Math.max(0,y-r)*w+x];
    }
  }
  return out;
}
function otsu(L,n){
  const hist=new Uint32Array(256);
  for(let i=0;i<n;i++)hist[L[i]]++;
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let wB=0,sB=0,best=-1,thr=128;
  for(let t=0;t<256;t++){
    wB+=hist[t];if(!wB)continue;
    const wF=n-wB;if(!wF)break;
    sB+=t*hist[t];
    const mB=sB/wB,mF=(sum-sB)/wF,between=wB*wF*(mB-mF)*(mB-mF);
    if(between>best){best=between;thr=t}
  }
  return thr;
}
function median(arr){const a=Array.from(arr).sort((x,y)=>x-y);return a.length?a[a.length>>1]:0}
function morph(mask,w,h,r,erode){
  const tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){
    const o=y*w;
    for(let x=0;x<w;x++){
      let v=erode?1:0;
      for(let i=-r;i<=r;i++){
        const m=mask[o+clamp(x+i,0,w-1)];
        if(erode){if(!m){v=0;break}}else if(m){v=1;break}
      }
      tmp[o+x]=v;
    }
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let v=erode?1:0;
    for(let i=-r;i<=r;i++){
      const m=tmp[clamp(y+i,0,h-1)*w+x];
      if(erode){if(!m){v=0;break}}else if(m){v=1;break}
    }
    out[y*w+x]=v;
  }
  return out;
}

/* ───────────── geometría ───────────── */
function polyArea(p){let s=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];s+=p[i].x*q.y-q.x*p[i].y}return s/2}
function convexHull(points){
  const pts=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower=[];
  for(const p of pts){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p)}
  const upper=[];
  for(let i=pts.length-1;i>=0;i--){const p=pts[i];while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p)}
  lower.pop();upper.pop();
  const hull=lower.concat(upper);
  if(polyArea(hull)<0)hull.reverse();   // positivo = horario en pantalla (y hacia abajo)
  return hull;
}
function lineIntersection(p1,p2,p3,p4){
  const d1x=p2.x-p1.x,d1y=p2.y-p1.y,d2x=p4.x-p3.x,d2y=p4.y-p3.y;
  const den=d1x*d2y-d1y*d2x;
  if(Math.abs(den)<1e-9)return null;
  const t=((p3.x-p1.x)*d2y-(p3.y-p1.y)*d2x)/den;
  return{x:p1.x+t*d1x,y:p1.y+t*d1y,t};
}
/* Reduce un polígono convexo a 4 vértices quitando, una a una, la arista cuyo reemplazo agrega menos área. */
function hullToQuad(hull){
  let P=hull.map(p=>({x:p.x,y:p.y}));
  if(P.length<4)return null;
  while(P.length>4){
    const n=P.length;let best=-1,bestArea=Infinity,bestPoint=null;
    for(let i=0;i<n;i++){
      const a=P[(i-1+n)%n],b=P[i],c=P[(i+1)%n],d=P[(i+2)%n];
      const hit=lineIntersection(a,b,d,c),hit2=lineIntersection(d,c,a,b);
      if(!hit||!hit2||hit.t<=1||hit2.t<=1)continue;
      const added=Math.abs(polyArea([b,{x:hit.x,y:hit.y},c]));
      if(added<bestArea){bestArea=added;best=i;bestPoint={x:hit.x,y:hit.y}}
    }
    if(best<0){ // sin intersección válida: se elimina el vértice menos importante
      let worst=0,worstA=Infinity;
      for(let i=0;i<n;i++){
        const a=P[(i-1+n)%n],b=P[i],c=P[(i+1)%n],t=Math.abs(polyArea([a,b,c]));
        if(t<worstA){worstA=t;worst=i}
      }
      P.splice(worst,1);continue;
    }
    const j=(best+1)%n;
    P[best]=bestPoint;P.splice(j,1);
  }
  return P;
}
function orderCorners(q){
  const c=q.reduce((s,p)=>({x:s.x+p.x/4,y:s.y+p.y/4}),{x:0,y:0});
  const s=q.slice().sort((a,b)=>Math.atan2(a.y-c.y,a.x-c.x)-Math.atan2(b.y-c.y,b.x-c.x)); // horario en pantalla
  let start=0,low=Infinity;
  s.forEach((p,i)=>{const v=p.x+p.y;if(v<low){low=v;start=i}});
  return[0,1,2,3].map(i=>s[(start+i)%4]);
}
function isConvexQuad(q){
  for(let i=0;i<4;i++){
    const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4];
    if((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)<=0)return false;
  }
  return true;
}
function cornerAngles(q){
  return q.map((p,i)=>{
    const a=q[(i+3)%4],b=q[(i+1)%4];
    const v1={x:a.x-p.x,y:a.y-p.y},v2={x:b.x-p.x,y:b.y-p.y};
    const cos=(v1.x*v2.x+v1.y*v2.y)/(Math.hypot(v1.x,v1.y)*Math.hypot(v2.x,v2.y)||1);
    return Math.acos(clamp(cos,-1,1))*180/Math.PI;
  });
}

/* ───────────── detección de la hoja ───────────── */
function labelComponents(mask,w,h){
  const labels=new Int32Array(w*h),areas=[0];
  const stack=new Int32Array(w*h);
  let next=1;
  for(let s=0;s<w*h;s++){
    if(!mask[s]||labels[s])continue;
    let sp=0,area=0;stack[sp++]=s;labels[s]=next;
    while(sp){
      const p=stack[--sp];area++;
      const x=p%w,y=(p/w)|0;
      if(x>0&&mask[p-1]&&!labels[p-1]){labels[p-1]=next;stack[sp++]=p-1}
      if(x<w-1&&mask[p+1]&&!labels[p+1]){labels[p+1]=next;stack[sp++]=p+1}
      if(y>0&&mask[p-w]&&!labels[p-w]){labels[p-w]=next;stack[sp++]=p-w}
      if(y<h-1&&mask[p+w]&&!labels[p+w]){labels[p+w]=next;stack[sp++]=p+w}
    }
    areas[next++]=area;
  }
  return{labels,areas};
}
function sample(L,w,h,x,y){ // bilineal; null si cae fuera de la imagen
  if(x<0||y<0||x>w-1||y>h-1)return null;
  const x0=x|0,y0=y|0,x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=x-x0,fy=y-y0;
  return(L[y0*w+x0]*(1-fx)+L[y0*w+x1]*fx)*(1-fy)+(L[y1*w+x0]*(1-fx)+L[y1*w+x1]*fx)*fy;
}
/* ¿Cuánto del contorno propuesto tiene el papel más claro por dentro? */
function edgeSupport(q,L,w,h){
  const sides=[];
  for(let i=0;i<4;i++){
    const A=q[i],B=q[(i+1)%4],dx=B.x-A.x,dy=B.y-A.y,len=Math.hypot(dx,dy)||1;
    const nx=dy/len,ny=-dx/len,off=Math.max(3,Math.min(w,h)*.022);
    let pass=0,total=0;
    for(let t=.1;t<=.9001;t+=.04){
      const cx=A.x+dx*t,cy=A.y+dy*t;
      const inside=sample(L,w,h,cx-nx*off,cy-ny*off),outside=sample(L,w,h,cx+nx*off,cy+ny*off);
      total++;
      if(inside===null)continue;
      if(outside===null){pass+=.5;continue}      // el borde coincide con el marco de la foto
      let ok=inside-outside>=7;
      if(!ok){ // bordes suaves (sombra o degradado): se mira también a más distancia
        const i2=sample(L,w,h,cx-nx*off*2,cy-ny*off*2),o2=sample(L,w,h,cx+nx*off*2,cy+ny*off*2);
        ok=i2!==null&&o2!==null&&i2-o2>=9;
      }
      if(ok)pass++;
    }
    sides.push(pass/total);
  }
  return{mean:sides.reduce((a,b)=>a+b,0)/4,min:Math.min(...sides)};
}
/* Mapa de bordes (Sobel): magnitud y orientación de cada píxel con borde claro. */
function buildEdges(L,w,h){
  const mag=new Float32Array(w*h),deg=new Int16Array(w*h).fill(-1),hist=new Uint32Array(256);
  const ang=new Float32Array(w*h);
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      const i=y*w+x;
      const gx=(L[i-w+1]+2*L[i+1]+L[i+w+1])-(L[i-w-1]+2*L[i-1]+L[i+w-1]);
      const gy=(L[i+w-1]+2*L[i+w]+L[i+w+1])-(L[i-w-1]+2*L[i-w]+L[i-w+1]);
      const m=Math.hypot(gx,gy)/4;mag[i]=m;ang[i]=Math.atan2(gy,gx);hist[Math.min(255,m|0)]++;
    }
  }
  const total=(w-2)*(h-2);let acc=0,p92=0;
  for(let v=0;v<256;v++){acc+=hist[v];if(acc>=total*.92){p92=v;break}}
  const T=clamp(p92*.35,4,11);
  const pts=[];
  for(let i=0;i<w*h;i++){
    if(mag[i]>=T){
      let d=(ang[i]*180/Math.PI)%180;if(d<0)d+=180;
      deg[i]=Math.round(d)%180;pts.push(i);
    }
  }
  return{mag,deg,ang,T,pts};
}
const angDiff180=(a,b)=>{const d=Math.abs(a-b)%180;return d>90?180-d:d};
/* ¿Qué parte del contorno propuesto coincide con bordes reales y con la orientación correcta? */
function coverage(q,ctx){
  const {w,h,deg}=ctx,sides=[];
  for(let i=0;i<4;i++){
    const A=q[i],B=q[(i+1)%4],dx=B.x-A.x,dy=B.y-A.y,len=Math.hypot(dx,dy)||1;
    let nd=(Math.atan2(-dx,dy)*180/Math.PI)%180;if(nd<0)nd+=180;
    const steps=Math.max(8,Math.round(len/2));let hit=0,total=0;
    for(let s=0;s<steps;s++){
      const t=.04+.92*(s+.5)/steps,cx=Math.round(A.x+dx*t),cy=Math.round(A.y+dy*t);
      total++;
      let found=false;
      for(let yy=Math.max(0,cy-2);yy<=Math.min(h-1,cy+2)&&!found;yy++)
        for(let xx=Math.max(0,cx-2);xx<=Math.min(w-1,cx+2);xx++){
          const d=deg[yy*w+xx];
          if(d>=0&&angDiff180(d,nd)<=24){found=true;break}
        }
      if(found)hit++;
    }
    sides.push(hit/total);
  }
  return{mean:sides.reduce((a,b)=>a+b,0)/4,min:Math.min(...sides)};
}
/* Puntuación común para candidatos de cualquier origen (máscara de papel o líneas de borde). */
function scoreQuad(ctx,q,opts){
  const R=(why,x)=>{if(ctx.why)ctx.why.push(why+(x?':'+x:''));return null};
  const {w,h,L}=ctx,area=polyArea(q),frac=area/(w*h);
  if(area<=0||frac<.10||frac>.985)return R('frac',frac.toFixed(2));
  if(!isConvexQuad(q))return R('convex');
  if(cornerAngles(q).some(a=>a<45||a>135))return R('angles');
  const len=[dist(q[0],q[1]),dist(q[1],q[2]),dist(q[2],q[3]),dist(q[3],q[0])];
  if(len[0]/len[2]>2.6||len[2]/len[0]>2.6||len[1]/len[3]>2.6||len[3]/len[1]>2.6)return R('ratio');
  let solidFactor=1;
  if(opts.hullArea){
    if(opts.hullArea/area<.82)return null;
    const solidity=opts.compArea/opts.hullArea;
    if(solidity<.62)return null;
    solidFactor=Math.min(1,solidity/.9);
  }
  const bright=edgeSupport(q,L,w,h);
  if(bright.mean<(opts.loose?.70:.5)||bright.min<(opts.loose?.55:.22))return R('bright',bright.mean.toFixed(2)+'/'+bright.min.toFixed(2));
  const cov=coverage(q,ctx);
  if(cov.mean<.45||cov.min<.22)return R('cov',cov.mean.toFixed(2)+'/'+cov.min.toFixed(2));
  const margin=Math.max(1.5,Math.min(w,h)*.01);
  let touching=0;
  for(const p of q)if(p.x<margin||p.y<margin||p.x>w-margin||p.y>h-margin)touching++;
  const touchFactor=[1,.92,.7,.2,.1][touching];
  const quality=Math.sqrt(bright.mean*cov.mean);
  return{score:Math.pow(quality,1.5)*(.55+.45*Math.min(1,frac/.45))*solidFactor*touchFactor,cov:cov.mean,bright:bright.mean};
}
/* Candidatos por máscara: regiones claras conectadas → casco convexo → 4 vértices. */
function candidatesFromMask(mask,ctx,out){
  const {w,h}=ctx;
  const opened=morph(morph(mask,w,h,2,true),w,h,2,false);
  const {labels,areas}=labelComponents(opened,w,h);
  const minArea=w*h*.08;
  const order=[];
  for(let i=1;i<areas.length;i++)if(areas[i]>=minArea)order.push(i);
  order.sort((a,b)=>areas[b]-areas[a]);
  for(const id of order.slice(0,3)){
    const rowMin=new Int32Array(h).fill(-1),rowMax=new Int32Array(h).fill(-1);
    for(let y=0;y<h;y++){
      const o=y*w;
      for(let x=0;x<w;x++)if(labels[o+x]===id){rowMin[y]=x;break}
      if(rowMin[y]<0)continue;
      for(let x=w-1;x>=0;x--)if(labels[o+x]===id){rowMax[y]=x;break}
    }
    const pts=[];
    for(let y=0;y<h;y++)if(rowMin[y]>=0){
      pts.push({x:rowMin[y],y},{x:rowMin[y],y:y+1},{x:rowMax[y]+1,y},{x:rowMax[y]+1,y:y+1});
    }
    if(pts.length<8)continue;
    const hull=convexHull(pts);
    if(hull.length<4)continue;
    const quad=hullToQuad(hull);
    if(!quad||quad.length!==4)continue;
    const ordered=orderCorners(quad);
    const res=scoreQuad(ctx,ordered,{hullArea:Math.abs(polyArea(hull)),compArea:areas[id]});
    if(res)out.push({quad:ordered,score:res.score,source:'mask'});
  }
}
/* Candidatos por líneas: transformada de Hough orientada sobre los bordes; se prueban
 * combinaciones de dos pares de rectas casi paralelas. No depende de que el papel sea más claro. */
function houghLines(ctx,maxLines){
  const {w,h,ang,pts}=ctx,diag=Math.ceil(Math.hypot(w,h)),R=2*diag+1,NB=180;
  const cosT=new Float32Array(NB+2),sinT=new Float32Array(NB+2);
  for(let k=-1;k<=NB;k++){cosT[k+1]=Math.cos(k*Math.PI/NB);sinT[k+1]=Math.sin(k*Math.PI/NB)}
  const acc=new Float32Array(NB*R);
  for(const i of pts){
    const x=i%w,y=(i/w)|0;
    let a=ang[i]%Math.PI;if(a<0)a+=Math.PI;
    const b=Math.round(a*NB/Math.PI);
    for(let db=-1;db<=1;db++){
      let k=b+db;
      let rho=x*cosT[k+1]+y*sinT[k+1];
      if(k<0){k+=NB;rho=-rho}else if(k>=NB){k-=NB;rho=-rho}
      acc[k*R+Math.round(rho)+diag]+=db===0?1:.5;
    }
  }
  const sm=new Float32Array(NB*R);
  for(let k=0;k<NB;k++)for(let r=1;r<R-1;r++)sm[k*R+r]=acc[k*R+r-1]+acc[k*R+r]+acc[k*R+r+1];
  const minVotes=Math.max(18,Math.min(w,h)*.1),lines=[];
  for(let n=0;n<maxLines;n++){
    let best=minVotes,bk=-1,br=-1;
    for(let k=0;k<NB;k++){const o=k*R;for(let r=1;r<R-1;r++)if(sm[o+r]>best){best=sm[o+r];bk=k;br=r}}
    if(bk<0)break;
    lines.push({phi:bk*Math.PI/NB,rho:br-diag,votes:best});
    for(let dk=-8;dk<=8;dk++){
      let k=bk+dk,sign=1;
      if(k<0){k+=NB;sign=-1}else if(k>=NB){k-=NB;sign=-1}
      const rr=sign>0?br:2*diag-br;
      for(let r=Math.max(1,rr-7);r<=Math.min(R-2,rr+7);r++)sm[k*R+r]=0;
    }
  }
  return lines;
}
function lineGap(a,b){ // (diferencia de ángulo en rad, separación aproximada en px)
  let dphi=b.phi-a.phi,rb=b.rho;
  if(dphi>Math.PI/2){dphi-=Math.PI;rb=-rb}else if(dphi<-Math.PI/2){dphi+=Math.PI;rb=-rb}
  return{dphi,gap:Math.abs(rb-a.rho)};
}
function intersect(a,b){
  const det=Math.sin(b.phi-a.phi);
  if(Math.abs(det)<.3)return null;
  return{x:(a.rho*Math.sin(b.phi)-b.rho*Math.sin(a.phi))/det,y:(b.rho*Math.cos(a.phi)-a.rho*Math.cos(b.phi))/det};
}
function candidatesFromLines(ctx,out){
  const {w,h}=ctx,lines=houghLines(ctx,26);
  if(lines.length<4)return;
  const minGap=Math.min(w,h)*.18,maxTilt=22*Math.PI/180,pairs=[];
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const g=lineGap(lines[i],lines[j]);
    if(Math.abs(g.dphi)<=maxTilt&&g.gap>=minGap)pairs.push([i,j,(lines[i].phi+lines[j].phi)/2]);
  }
  const slack=.03;
  for(let a=0;a<pairs.length;a++)for(let b=a+1;b<pairs.length;b++){
    const P=pairs[a],Q=pairs[b];
    if(P[0]===Q[0]||P[0]===Q[1]||P[1]===Q[0]||P[1]===Q[1])continue;
    const cross=Math.abs(Math.sin(lines[P[0]].phi-lines[Q[0]].phi));
    if(cross<.75)continue;               // los grupos deben ser casi perpendiculares (≥ ~49°)
    const L1=lines[P[0]],L2=lines[P[1]],M1=lines[Q[0]],M2=lines[Q[1]];
    const c=[intersect(L1,M1),intersect(L1,M2),intersect(L2,M2),intersect(L2,M1)];
    if(c.some(p=>!p||p.x<-w*slack||p.x>w*(1+slack)||p.y<-h*slack||p.y>h*(1+slack)))continue;
    const quad=orderCorners(c.map(p=>({x:clamp(p.x,0,w),y:clamp(p.y,0,h)})));
    const res=scoreQuad(ctx,quad,{loose:true});
    if(res)out.push({quad,score:res.score,source:'lines'});
  }
}

/* ¿La hoja se sale del cuadro? Si junto a un lado del contorno que está cerca del marco de la imagen
 * el papel sigue igual de claro por fuera, el borde es falso (línea de la tabla) o la hoja no cabe. */
function cutSides(q,L,w,h){
  const out=[];
  for(let i=0;i<4;i++){
    const A=q[i],B=q[(i+1)%4],dx=B.x-A.x,dy=B.y-A.y,len=Math.hypot(dx,dy)||1,nx=dy/len,ny=-dx/len;
    const mx=(A.x+B.x)/2,my=(A.y+B.y)/2;
    let room=0;while(room<w+h&&sample(L,w,h,mx+nx*(room+1),my+ny*(room+1))!==null)room++;
    const lim=Math.min(room,Math.min(w,h)*.12);
    if(room<3){out.push(i);continue}                   // el contorno toca el marco de la imagen
    let si=0,so=0,n=0;
    for(let t=.15;t<=.8501;t+=.14)for(const f of[.35,.7,1]){
      const cx=A.x+dx*t,cy=A.y+dy*t,o=Math.max(2,lim*f);
      const a=sample(L,w,h,cx-nx*o,cy-ny*o),b=sample(L,w,h,cx+nx*o,cy+ny*o);
      if(a===null||b===null)continue;
      si+=a;so+=b;n++;
    }
    if(n&&so>=si*.86)out.push(i);   // por fuera casi tan claro como por dentro: el papel sigue
  }
  return out;
}
function detect(source,opts){
  opts=opts||{};
  try{
    const g=grab(source,opts.maxSide||300),{w,h}=g,n=w*h;
    const raw=luminance(g.data,n),L=boxBlur(raw,w,h,1);
    const edges=buildEdges(L,w,h),ctx={L,w,h,deg:edges.deg,ang:edges.ang,pts:edges.pts};
    if(opts.debug)ctx.why=[];
    // Saturación aproximada: el papel blanco casi no tiene color, una mesa de madera sí.
    const chroma=new Uint8Array(n);
    for(let i=0,j=0;i<n;i++,j+=4){
      const r=g.data[j],gg=g.data[j+1],b=g.data[j+2];
      chroma[i]=Math.max(r,gg,b)-Math.min(r,gg,b);
    }
    const centre=[],centreChroma=[],border=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;
      if(x>w*.3&&x<w*.7&&y>h*.3&&y<h*.7){centre.push(L[i]);centreChroma.push(chroma[i])}
      else if(x<w*.06||x>w*.94||y<h*.06||y>h*.94)border.push(L[i]);
    }
    const t0=otsu(L,n),mc=median(centre),mb=median(border);
    const chromaLimit=clamp(median(centreChroma)*2+14,28,70);
    const thresholds=[t0,mc*.84,(mc+mb)/2,t0-14,t0+14].map(v=>Math.round(clamp(v,25,235)));
    const unique=[];
    for(const t of thresholds)if(!unique.some(u=>Math.abs(u-t)<5))unique.push(t);
    const found=[];
    for(const t of unique){
      const plain=new Uint8Array(n),coloured=new Uint8Array(n);
      for(let i=0;i<n;i++){
        if(L[i]>t){plain[i]=1;if(chroma[i]<chromaLimit)coloured[i]=1}
      }
      candidatesFromMask(plain,ctx,found);
      candidatesFromMask(coloured,ctx,found);
    }
    candidatesFromLines(ctx,found);
    if(!found.length)return opts.debug?{dbg:[],info:{why:ctx.why.slice(0,12),T:edges.T,pts:edges.pts.length,lines:houghLines(ctx,26).map(l=>[Math.round(l.phi*180/Math.PI),Math.round(l.rho),Math.round(l.votes)]),thr:unique}}:null;
    // Histéresis: en la cámara en vivo, el resultado anterior pesa un poco para que el contorno no salte
    // entre candidatos casi empatados (p. ej. una línea interna de la tabla vs. el borde real del papel).
    if(opts.prefer&&opts.prefer.length===4){
      for(const f of found){
        const d=Math.max(...f.quad.map((p,i)=>Math.hypot(p.x/w-opts.prefer[i].x,p.y/h-opts.prefer[i].y)));
        if(d<.09)f.score*=1+.35*(1-d/.09);
      }
    }
    found.sort((a,b)=>b.score-a.score);
    let best=found[0];
    if(best.source==='lines'){ // una región de papel bien formada pesa más que líneas sueltas
      const m=found.find(f=>f.source==='mask');
      if(m&&m.score>=.5){
        const ra=polyArea(best.quad)/polyArea(m.quad);
        // líneas que recortan una región de papel limpia (borde interno) o que abarcan mucho más
        // que ella (estampado de la mesa) se descartan; si son parecidas, manda el puntaje
        if(ra<.93||ra>1.35)best=m;
      }
    }
    if(best.score<.2&&!opts.debug)return null;
    let corners=best.quad.map(p=>({x:clamp(p.x/w,0,1),y:clamp(p.y/h,0,1)}));
    let confidence=clamp(best.score/.65,0,1);
    if(best.source==='lines'&&!found.some(f=>f.source==='mask'&&f.score>=.5))confidence=Math.min(confidence,.6);
    if(opts.refine)corners=refine(source,corners);
    const dbg=opts.debug?found.slice(0,8).map(f=>({s:f.score,src:f.source,q:f.quad.map(p=>({x:p.x/w,y:p.y/h}))})):undefined;
    const cut=cutSides(best.quad,L,w,h);
    return{corners,confidence,source:best.source,dbg,cut};
  }catch(error){
    console.warn('GS Studio: detección no disponible',error);
    return null;
  }
}

/* ───────────── afinado de bordes en alta resolución ───────────── */
function fitLine(points,minInliers){
  let pts=points;
  if(pts.length<minInliers)return null;
  let line=null;
  for(let iter=0;iter<4;iter++){
    const mx=pts.reduce((s,p)=>s+p.x,0)/pts.length,my=pts.reduce((s,p)=>s+p.y,0)/pts.length;
    let sxx=0,syy=0,sxy=0;
    for(const p of pts){sxx+=(p.x-mx)**2;syy+=(p.y-my)**2;sxy+=(p.x-mx)*(p.y-my)}
    const ang=.5*Math.atan2(2*sxy,sxx-syy);
    line={x:mx,y:my,dx:Math.cos(ang),dy:Math.sin(ang)};
    const res=pts.map(p=>Math.abs((p.x-line.x)*line.dy-(p.y-line.y)*line.dx));
    const limit=Math.max(1.2,median(res)*2.2);
    const keep=pts.filter((p,i)=>res[i]<=limit);
    if(keep.length<minInliers)return iter===0?null:{line,count:pts.length};
    if(keep.length===pts.length)break;
    pts=keep;
  }
  return{line,count:pts.length};
}
function refine(source,corners){
  try{
    const g=grab(source,900),{w,h}=g;
    const L=boxBlur(luminance(g.data,w*h),w,h,1);
    const P=corners.map(p=>({x:p.x*w,y:p.y*h}));
    const win=Math.max(5,Math.min(w,h)*.035);
    const fitted=[];
    for(let i=0;i<4;i++){
      const A=P[i],B=P[(i+1)%4],dx=B.x-A.x,dy=B.y-A.y,len=Math.hypot(dx,dy)||1;
      const nx=dy/len,ny=-dx/len,N=Math.max(14,Math.round(len/12)),pts=[];
      for(let s=0;s<N;s++){
        const t=.08+.84*(s+.5)/N,cx=A.x+dx*t,cy=A.y+dy*t;
        let best=0,bestK=null;
        for(let k=-win;k<=win;k+=.5){
          const a=sample(L,w,h,cx+nx*(k-2.2),cy+ny*(k-2.2)),b=sample(L,w,h,cx+nx*(k+2.2),cy+ny*(k+2.2));
          if(a===null||b===null)continue;
          if(a-b>best){best=a-b;bestK=k}
        }
        if(bestK!==null&&best>=10)pts.push({x:cx+nx*bestK,y:cy+ny*bestK});
      }
      const f=fitLine(pts,Math.max(7,Math.round(N*.4)));
      fitted.push(f?f.line:{x:A.x,y:A.y,dx:dx/len,dy:dy/len});
    }
    const refined=[];
    for(let i=0;i<4;i++){
      const prev=fitted[(i+3)%4],next=fitted[i];
      const hit=lineIntersection({x:prev.x,y:prev.y},{x:prev.x+prev.dx,y:prev.y+prev.dy},{x:next.x,y:next.y},{x:next.x+next.dx,y:next.y+next.dy});
      if(!hit||dist(hit,P[i])>win*1.8){refined.push(P[i]);continue}
      refined.push({x:clamp(hit.x,0,w),y:clamp(hit.y,0,h)});
    }
    const before=polyArea(P),after=polyArea(refined);
    if(!isConvexQuad(refined)||after<before*.85||after>before*1.18)return corners;
    return refined.map(p=>({x:p.x/w,y:p.y/h}));
  }catch(error){
    console.warn('GS Studio: no se pudo afinar',error);
    return corners;
  }
}

/* ───────────── tamaño real de la hoja (corrige la perspectiva) ───────────── */
function snapRatio(w,h){
  const r=Math.max(w,h)/Math.min(w,h);
  let best=null,bestErr=.035;
  for(const name of Object.keys(STANDARD)){
    const err=Math.abs(r-STANDARD[name])/STANDARD[name];
    if(err<bestErr){bestErr=err;best=name}
  }
  return best;
}
function estimateRatio(q,w,h){
  // Zhang & He: proporción de un rectángulo visto en perspectiva, con el punto principal al centro.
  const m=[q[0],q[1],q[3],q[2]].map(p=>[p.x*w-w/2,p.y*h-h/2,1]);  // TL, TR, BL, BR
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const [m1,m2,m3,m4]=m;
  const k2=dot(cross(m1,m4),m3)/dot(cross(m2,m4),m3);
  const k3=dot(cross(m1,m4),m2)/dot(cross(m3,m4),m2);
  const n2=m2.map((v,i)=>k2*v-m1[i]),n3=m3.map((v,i)=>k3*v-m1[i]);
  if(![k2,k3].every(Number.isFinite)||Math.abs(n2[2]*n3[2])<1e-6)return null;
  const f2=-(n2[0]*n3[0]+n2[1]*n3[1])/(n2[2]*n3[2]);
  const longSide=Math.max(w,h);
  if(!(f2>0)||Math.sqrt(f2)<longSide*.35||Math.sqrt(f2)>longSide*5)return null;
  const wide=(n2[0]**2+n2[1]**2)/f2+n2[2]**2,tall=(n3[0]**2+n3[1]**2)/f2+n3[2]**2;
  const ratio=Math.sqrt(wide/tall);
  return Number.isFinite(ratio)&&ratio>.3&&ratio<3.5?ratio:null;
}
function estimateSize(corners,imgW,imgH,limits){
  limits=limits||{};
  const maxSide=limits.maxSide||2400,maxPixels=limits.maxPixels||4300000;
  const q=corners.map(p=>({x:p.x*imgW,y:p.y*imgH}));
  const W0=(dist(q[0],q[1])+dist(q[3],q[2]))/2,H0=(dist(q[0],q[3])+dist(q[1],q[2]))/2;
  if(W0<40||H0<40)throw Error('El área seleccionada es demasiado pequeña.');
  let ratio=estimateRatio(corners,imgW,imgH)||W0/H0;
  // Si la corrección de perspectiva difiere muchísimo de las longitudes visibles, se mezclan por prudencia.
  const naive=W0/H0;
  if(ratio/naive>1.6||ratio/naive<1/1.6)ratio=Math.sqrt(ratio*naive);
  const std=snapRatio(ratio,1);
  if(std){
    const target=STANDARD[std];
    ratio=ratio>=1?target:1/target;
  }
  const area=W0*H0;
  let w=Math.sqrt(area*ratio),h=w/ratio;
  const scale=Math.min(1,maxSide/Math.max(w,h),Math.sqrt(maxPixels/(w*h)));
  w=Math.max(120,Math.round(w*scale));h=Math.max(120,Math.round(h*scale));
  return{w,h,std};
}

/* ───────────── corrección de perspectiva ───────────── */
function homography(corners,w,h){
  const [tl,tr,br,bl]=corners.map(p=>({x:p.x*w,y:p.y*h}));
  const dx1=tr.x-br.x,dx2=bl.x-br.x,dx3=tl.x-tr.x+br.x-bl.x;
  const dy1=tr.y-br.y,dy2=bl.y-br.y,dy3=tl.y-tr.y+br.y-bl.y;
  let g=0,k=0;
  if(Math.abs(dx3)+Math.abs(dy3)>1e-8){
    const det=dx1*dy2-dx2*dy1;
    if(Math.abs(det)<1e-7)throw Error('Las esquinas no forman una hoja válida.');
    g=(dx3*dy2-dx2*dy3)/det;k=(dx1*dy3-dx3*dy1)/det;
  }
  return{a:tr.x-tl.x+g*tr.x,b:bl.x-tl.x+k*bl.x,c:tl.x,d:tr.y-tl.y+g*tr.y,e:bl.y-tl.y+k*bl.y,f:tl.y,g,k};
}
function insetCorners(corners,amount){
  const c=corners.reduce((s,p)=>({x:s.x+p.x/4,y:s.y+p.y/4}),{x:0,y:0});
  return corners.map(p=>({x:p.x+(c.x-p.x)*amount,y:p.y+(c.y-p.y)*amount}));
}
/* src: ImageData completo de la foto. Devuelve un canvas w×h con la hoja de frente. */
async function warp(src,corners,w,h,opts){
  opts=opts||{};
  const q=corners.map(p=>({x:p.x*src.width,y:p.y*src.height}));
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  if(q.some((p,i)=>cross(p,q[(i+1)%4],q[(i+2)%4])<=0))throw Error('Las esquinas están cruzadas. Ajusta los cuatro puntos.');
  const m=homography(insetCorners(corners,opts.inset??.003),src.width,src.height);
  const out=document.createElement('canvas');out.width=w;out.height=h;
  const ctx=out.getContext('2d',{willReadFrequently:true});
  const pixels=ctx.createImageData(w,h),dst=pixels.data,s=src.data,sw=src.width,sh=src.height;
  for(let y=0;y<h;y++){
    const v=(y+.5)/h;
    for(let x=0;x<w;x++){
      const u=(x+.5)/w,den=m.g*u+m.k*v+1,o=(y*w+x)*4;
      if(Math.abs(den)<1e-8){dst[o]=dst[o+1]=dst[o+2]=255;dst[o+3]=255;continue}
      let px=(m.a*u+m.b*v+m.c)/den,py=(m.d*u+m.e*v+m.f)/den;
      px=px<0?0:px>sw-1?sw-1:px;py=py<0?0:py>sh-1?sh-1:py;
      const ix=px|0,iy=py|0,fx=px-ix,fy=py-iy,x1=ix+1<sw?ix+1:ix,y1=iy+1<sh?iy+1:iy;
      const i00=(iy*sw+ix)*4,i10=(iy*sw+x1)*4,i01=(y1*sw+ix)*4,i11=(y1*sw+x1)*4;
      const w00=(1-fx)*(1-fy),w10=fx*(1-fy),w01=(1-fx)*fy,w11=fx*fy;
      dst[o]=s[i00]*w00+s[i10]*w10+s[i01]*w01+s[i11]*w11;
      dst[o+1]=s[i00+1]*w00+s[i10+1]*w10+s[i01+1]*w01+s[i11+1]*w11;
      dst[o+2]=s[i00+2]*w00+s[i10+2]*w10+s[i01+2]*w01+s[i11+2]*w11;
      dst[o+3]=255;
    }
    if(opts.yieldFn&&y%80===79)await opts.yieldFn();
  }
  ctx.putImageData(pixels,0,0);
  return out;
}

/* ───────────── acabado de imagen ───────────── */
function sharpen(d,w,h,amount,monochrome){
  const s=new Uint8ClampedArray(d),stride=w*4;
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      const i=y*stride+x*4;
      const chans=monochrome?1:3;
      for(let c=0;c<chans;c++){
        const j=i+c,v=s[j],avg=(s[j-4]+s[j+4]+s[j-stride]+s[j+stride])*.25;
        d[j]=v+amount*(v-avg);
      }
      if(monochrome)d[i+1]=d[i+2]=d[i];
    }
  }
}
function blockBackground(d,w,h){
  // Estima el «blanco del papel» en cada zona: así se eliminan sombras y degradados de luz.
  const B=Math.max(14,Math.round(Math.max(w,h)/46)),gw=Math.ceil(w/B),gh=Math.ceil(h/B);
  const hist=new Uint32Array(gw*gh*3*64);
  for(let y=0;y<h;y++){
    const by=((y/B)|0)*gw;
    for(let x=0;x<w;x++){
      const o=(by+((x/B)|0))*192,i=(y*w+x)*4;
      hist[o+(d[i]>>2)]++;hist[o+64+(d[i+1]>>2)]++;hist[o+128+(d[i+2]>>2)]++;
    }
  }
  const grid=[new Float32Array(gw*gh),new Float32Array(gw*gh),new Float32Array(gw*gh)];
  for(let by=0;by<gh;by++)for(let bx=0;bx<gw;bx++){
    const pixels=(Math.min(B,w-bx*B))*(Math.min(B,h-by*B)),need=Math.max(1,pixels*.12),b=by*gw+bx;
    for(let c=0;c<3;c++){
      let acc=0,bin=63;
      for(;bin>0;bin--){acc+=hist[b*192+c*64+bin];if(acc>=need)break}
      grid[c][b]=bin*4+3;
    }
  }
  // Una zona oscura grande (foto, sello) no debe «blanquearse»: se limita respecto al papel típico.
  for(let c=0;c<3;c++){
    const typical=median(grid[c]),floor=typical*.55;
    for(let i=0;i<grid[c].length;i++)if(grid[c][i]<floor)grid[c][i]=floor;
    // dilatación 3×3 y suavizado para cubrir la tinta y evitar escalones
    const dil=new Float32Array(gw*gh);
    for(let by=0;by<gh;by++)for(let bx=0;bx<gw;bx++){
      let m=0;
      for(let yy=Math.max(0,by-1);yy<=Math.min(gh-1,by+1);yy++)for(let xx=Math.max(0,bx-1);xx<=Math.min(gw-1,bx+1);xx++)m=Math.max(m,grid[c][yy*gw+xx]);
      dil[by*gw+bx]=m;
    }
    let cur=dil;
    for(let pass=0;pass<2;pass++){
      const sm=new Float32Array(gw*gh);
      for(let by=0;by<gh;by++)for(let bx=0;bx<gw;bx++){
        let s=0,n=0;
        for(let yy=Math.max(0,by-1);yy<=Math.min(gh-1,by+1);yy++)for(let xx=Math.max(0,bx-1);xx<=Math.min(gw-1,bx+1);xx++){s+=cur[yy*gw+xx];n++}
        sm[by*gw+bx]=s/n;
      }
      cur=sm;
    }
    grid[c]=cur;
  }
  return{grid,gw,gh,B};
}
const smooth=(e0,e1,x)=>{const t=clamp((x-e0)/(e1-e0),0,1);return t*t*(3-2*t)};
async function enhance(canvas,mode,yieldFn){
  const w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d',{willReadFrequently:true});
  const img=ctx.getImageData(0,0,w,h),d=img.data;
  if(mode==='color'){
    for(let i=0;i<d.length;i+=4){d[i]=(d[i]-128)*1.06+130;d[i+1]=(d[i+1]-128)*1.06+130;d[i+2]=(d[i+2]-128)*1.06+130}
    sharpen(d,w,h,.35,false);
    ctx.putImageData(img,0,0);return;
  }
  const bg=blockBackground(d,w,h),{grid,gw,gh,B}=bg;
  // Curva de niveles: negros más profundos, blancos limpios.
  const lut=new Uint8Array(256);
  for(let v=0;v<256;v++){
    const t=clamp((v/255-.14)/(.95-.14),0,1);
    lut[v]=Math.round(255*Math.pow(t,1.18));
  }
  const x0=new Uint16Array(w),x1=new Uint16Array(w),xw=new Float32Array(w);
  for(let x=0;x<w;x++){
    const g=clamp((x+.5)/B-.5,0,gw-1),a=g|0;
    x0[x]=a;x1[x]=Math.min(gw-1,a+1);xw[x]=g-a;
  }
  const rowBg=new Float32Array(gw*3),keep=.85;
  for(let y=0;y<h;y++){
    const g=clamp((y+.5)/B-.5,0,gh-1),a=g|0,b=Math.min(gh-1,a+1),f=g-a;
    for(let c=0;c<3;c++)for(let bx=0;bx<gw;bx++)rowBg[bx*3+c]=grid[c][a*gw+bx]*(1-f)+grid[c][b*gw+bx]*f;
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4,a0=x0[x]*3,a1=x1[x]*3,t=xw[x],u=1-t;
      const bR=rowBg[a0]*u+rowBg[a1]*t,bG=rowBg[a0+1]*u+rowBg[a1+1]*t,bB=rowBg[a0+2]*u+rowBg[a1+2]*t;
      const bL=.299*bR+.587*bG+.114*bB;
      if(mode==='enhance'){
        const eR=keep*bR+(1-keep)*bL,eG=keep*bG+(1-keep)*bL,eB=keep*bB+(1-keep)*bL;
        let r=d[i]*255/eR,g2=d[i+1]*255/eG,b2=d[i+2]*255/eB;
        d[i]=lut[r>255?255:r|0];d[i+1]=lut[g2>255?255:g2|0];d[i+2]=lut[b2>255?255:b2|0];
      }else{
        const lum=.299*d[i]+.587*d[i+1]+.114*d[i+2],ratio=lum/bL;
        const out=mode==='bw'?255*smooth(.69,.87,ratio):lut[ratio>=1?255:(ratio*255)|0];
        d[i]=d[i+1]=d[i+2]=out;
      }
    }
    if(yieldFn&&y%64===63)await yieldFn();
  }
  if(mode==='enhance')sharpen(d,w,h,.5,false);
  else if(mode==='gray')sharpen(d,w,h,.5,true);
  ctx.putImageData(img,0,0);
}


/* ───────────── foto vs. vista previa ─────────────
 * La foto del sensor suele abarcar más escena que el video de la vista previa. registerView ubica el
 * cuadro de video dentro de la foto (escala + desplazamiento, correlación cruzada normalizada) para poder
 * trasladar a la foto el contorno que la persona vio en pantalla. Devuelve null si no hay coincidencia fiable. */
function toGray(src,W,H){
  const c=document.createElement('canvas');c.width=W;c.height=H;
  const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0,W,H);
  const d=x.getImageData(0,0,W,H).data,g=new Float32Array(W*H);
  for(let i=0,j=0;i<g.length;i++,j+=4)g[i]=d[j]*.299+d[j+1]*.587+d[j+2]*.114;
  c.width=c.height=1;return g;
}
function registerView(view,photo,opts){
  opts=opts||{};
  try{
    const vs=sourceSize(view),ps=sourceSize(photo);
    if(!vs.w||!vs.h||!ps.w||!ps.h)return null;
    const va=vs.w/vs.h,pa=ps.w/ps.h,W=opts.width||110,H=Math.max(8,Math.round(W/pa));
    const P=toGray(photo,W,H),S1=new Float64Array((W+1)*(H+1)),S2=new Float64Array((W+1)*(H+1));
    for(let y=0;y<H;y++){let r1=0,r2=0;for(let x=0;x<W;x++){const v=P[y*W+x];r1+=v;r2+=v*v;S1[(y+1)*(W+1)+x+1]=S1[y*(W+1)+x+1]+r1;S2[(y+1)*(W+1)+x+1]=S2[y*(W+1)+x+1]+r2}}
    const win=(x,y,w,h)=>{const a=y*(W+1)+x,b=y*(W+1)+x+w,c=(y+h)*(W+1)+x,d=(y+h)*(W+1)+x+w,n=w*h;
      const m=(S1[d]-S1[b]-S1[c]+S1[a])/n,v=(S2[d]-S2[b]-S2[c]+S2[a])/n-m*m;return Math.sqrt(Math.max(v,1e-6))};
    const smax=Math.min(1.04,va/pa*1.04);
    let best={score:-1};
    const evalAt=(T,tw,th,ox,oy)=>{
      let dot=0;
      for(let j=0;j<th;j++){const po=(oy+j)*W+ox,to=j*tw;for(let i=0;i<tw;i++)dot+=T[to+i]*P[po+i]}
      return dot/(win(ox,oy,tw,th)*tw*th);
    };
    for(let s=smax;s>=.28;s*=.93){
      let tw=Math.min(W,Math.round(s*W)),th=Math.round(tw/va);
      if(th>H){th=H;tw=Math.min(W,Math.round(th*va))}
      if(tw<16||th<16)break;
      const T=toGray(view,tw,th);let m=0;for(const v of T)m+=v;m/=T.length;
      let sd=0;for(let i=0;i<T.length;i++){T[i]-=m;sd+=T[i]*T[i]}
      sd=Math.sqrt(sd/T.length)||1;for(let i=0;i<T.length;i++)T[i]/=sd;
      let loc={score:-1};
      for(let oy=0;oy<=H-th;oy+=2)for(let ox=0;ox<=W-tw;ox+=2){const sc=evalAt(T,tw,th,ox,oy);if(sc>loc.score)loc={score:sc,ox,oy}}
      if(loc.score<0)continue;
      for(let oy=Math.max(0,loc.oy-2);oy<=Math.min(H-th,loc.oy+2);oy++)for(let ox=Math.max(0,loc.ox-2);ox<=Math.min(W-tw,loc.ox+2);ox++){const sc=evalAt(T,tw,th,ox,oy);if(sc>loc.score)loc={score:sc,ox,oy}}
      if(loc.score>best.score)best={score:loc.score,ox:loc.ox,oy:loc.oy,tw,th};
    }
    if(best.score<(opts.minScore||.5))return null;
    return{score:best.score,x0:best.ox/W,y0:best.oy/H,w:best.tw/W,h:best.th/H,
      identity:Math.abs(best.tw/W-1)<.03&&Math.abs(best.th/H-1)<.03};
  }catch(error){console.warn('GS Studio: no se pudo ubicar la vista previa en la foto',error);return null}
}
const mapToPhoto=(reg,pts)=>pts.map(p=>({x:clamp(reg.x0+p.x*reg.w,0,1),y:clamp(reg.y0+p.y*reg.h,0,1)}));
/* Qué tanto se parecen dos contornos (0..1), comparados sobre una cuadrícula. */
function polyIoU(a,b,n){
  n=n||64;
  const inside=(q,x,y)=>{let sign=0;for(let i=0;i<4;i++){const A=q[i],B=q[(i+1)%4],c=(B.x-A.x)*(y-A.y)-(B.y-A.y)*(x-A.x);if(c!==0){const sg=c>0?1:-1;if(sign&&sg!==sign)return false;sign=sg}}return true};
  let i1=0,u=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const px=(x+.5)/n,py=(y+.5)/n,A=inside(a,px,py),B=inside(b,px,py);if(A&&B)i1++;if(A||B)u++}
  return u?i1/u:0;
}

root.GSScan={detect,refine,estimateSize,warp,enhance,snapRatio,STANDARD,isConvexQuad,polyArea,orderCorners,registerView,mapToPhoto,polyIoU};
})(window);
