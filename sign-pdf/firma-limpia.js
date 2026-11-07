/* GS Studio · firma limpia (misma limpieza que GS Docs v161)
 * Quita automáticamente el fondo de la firma (dibujada, cargada o tomada con la cámara) y deja solo la tinta
 * sobre fondo transparente, para que al pegarla en los formatos tome el color de la hoja.
 *  1. estima el color/luz del papel por zonas (compensa sombras y papel amarillento),
 *  2. convierte lo que es más oscuro que el papel en tinta con borde suave (alfa) conservando el color del bolígrafo,
 *  3. descarta motas, bordes de la hoja y renglones largos,
 *  4. si no encuentra tinta suficiente, deja la imagen original sin tocar.
 * clean(origen,{asCanvas,bias}): origen = data URL o canvas; bias -1..1 (positivo quita más fondo). */
(function(){
  'use strict';
  if(globalThis.__GS_STUDIO_FIRMA__) return; globalThis.__GS_STUDIO_FIRMA__=true;

  const MAXSIDE=1600;
  const loadImg=src=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('imagen no válida'));i.src=src});
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;

  function percentile(arr,n,p){ // p en 0..1 sobre los primeros n valores
    const a=Float32Array.from(arr.subarray(0,n)).sort(); return a[Math.min(n-1,Math.floor(p*(n-1)))];
  }

  async function clean(src,opts){
    opts=opts||{};
    const img=(typeof src==='string')?await loadImg(src):src;
    const fail=()=>opts.asCanvas?null:src;
    const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
    if(!iw||!ih) return fail();
    const sc=Math.min(1,MAXSIDE/Math.max(iw,ih)), W=Math.max(8,Math.round(iw*sc)), H=Math.max(8,Math.round(ih*sc));
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const cx=cv.getContext('2d',{willReadFrequently:true});
    cx.drawImage(img,0,0,W,H);
    const d=cx.getImageData(0,0,W,H), px=d.data, N=W*H;

    // ¿ya viene con transparencia (firma procesada antes)? entonces no hay fondo que quitar
    let transp=0; for(let i=3;i<px.length;i+=4*97) if(px[i]<200) transp++;
    if(transp>(N/97)*0.08) return fail();

    // ── 1. fondo por bloques (percentil 85 por canal) ──
    const B=Math.max(8,Math.round(Math.max(W,H)/36)), bw=Math.ceil(W/B), bh=Math.ceil(H/B);
    const bg=[new Float32Array(bw*bh),new Float32Array(bw*bh),new Float32Array(bw*bh)];
    const buf=new Float32Array(B*B);
    for(let by=0;by<bh;by++)for(let bx=0;bx<bw;bx++){
      for(let c=0;c<3;c++){
        let n=0;
        for(let y=by*B;y<Math.min(H,by*B+B);y++)for(let x=bx*B;x<Math.min(W,bx*B+B);x++)buf[n++]=px[(y*W+x)*4+c];
        bg[c][by*bw+bx]=percentile(buf,n,.85);
      }
    }
    // suavizado 3×3 del mapa de fondo
    for(let c=0;c<3;c++){
      const src2=bg[c],out=new Float32Array(src2.length);
      for(let by=0;by<bh;by++)for(let bx=0;bx<bw;bx++){let s=0,k=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=by+dy,xx=bx+dx;if(yy>=0&&yy<bh&&xx>=0&&xx<bw){s+=src2[yy*bw+xx];k++}}
        out[by*bw+bx]=s/k}
      bg[c]=out;
    }
    const bgAt=(c,x,y)=>{ // interpolación bilineal entre centros de bloque
      const fx=clamp((x+.5)/B-.5,0,bw-1), fy=clamp((y+.5)/B-.5,0,bh-1),x0=fx|0,y0=fy|0,x1=Math.min(bw-1,x0+1),y1=Math.min(bh-1,y0+1),tx=fx-x0,ty=fy-y0,m=bg[c];
      return (m[y0*bw+x0]*(1-tx)+m[y0*bw+x1]*tx)*(1-ty)+(m[y1*bw+x0]*(1-tx)+m[y1*bw+x1]*tx)*ty;
    };

    // ── 2. oscuridad relativa al papel ──
    const norm=new Float32Array(N), ratio=new Float32Array(N*3);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,o=i*4; const br=Math.max(40,bgAt(0,x,y)),bgG=Math.max(40,bgAt(1,x,y)),bb=Math.max(40,bgAt(2,x,y));
      const r=px[o]/br,g=px[o+1]/bgG,b=px[o+2]/bb;
      ratio[i*3]=r;ratio[i*3+1]=g;ratio[i*3+2]=b;
      norm[i]=Math.min(1.2,.299*r+.587*g+.114*b);
    }
    // umbral adaptativo según lo oscura que sea la tinta
    const sample=new Float32Array(Math.ceil(N/7)); let sn=0; for(let i=0;i<N;i+=7) sample[sn++]=norm[i];
    const dark=percentile(sample,sn,.01);
    const bias=clamp(Number(opts.bias)||0,-1,1)*.10;
    const lo=clamp(dark+.12-bias,.22,.62), hi=Math.min(.94,Math.max(lo+.12,lo+.30-bias*.5));
    const alpha=new Float32Array(N);
    for(let i=0;i<N;i++){const t=clamp((hi-norm[i])/(hi-lo),0,1);alpha[i]=t*t*(3-2*t)}

    // ── 3. limpieza de motas, bordes y renglones ──
    const mask=new Uint8Array(N); for(let i=0;i<N;i++) mask[i]=alpha[i]>.35?1:0;
    const label=new Int32Array(N), stack=new Int32Array(N), comps=[0];
    let nl=0;
    for(let s=0;s<N;s++){
      if(!mask[s]||label[s])continue;
      nl++; let sp=0,area=0,x0=W,y0=H,x1=0,y1=0; stack[sp++]=s; label[s]=nl;
      while(sp){const p=stack[--sp],py=(p/W)|0,pxx=p-py*W;area++;
        if(pxx<x0)x0=pxx;if(pxx>x1)x1=pxx;if(py<y0)y0=py;if(py>y1)y1=py;
        for(let dy=-1;dy<=1;dy++){const yy=py+dy;if(yy<0||yy>=H)continue;
          for(let dx=-1;dx<=1;dx++){const xx=pxx+dx;if(xx<0||xx>=W)continue;const q=yy*W+xx;if(mask[q]&&!label[q]){label[q]=nl;stack[sp++]=q}}}}
      comps[nl]={area,x0,y0,x1,y1};
    }
    const drop=new Uint8Array(nl+1); let kept=0, keptArea=0;
    const minArea=Math.max(10,Math.round(N*.00004));
    for(let l=1;l<=nl;l++){
      const c=comps[l],cw=c.x1-c.x0+1,ch=c.y1-c.y0+1,fill=c.area/(cw*ch);
      const touches=(c.x0<=1)+(c.y0<=1)+(c.x1>=W-2)+(c.y1>=H-2);
      let bad=c.area<minArea;
      if(!bad&&cw>W*.40&&ch<H*.025&&fill>.5) bad=true;                        // renglón largo
      if(!bad&&touches>=1&&(cw>W*.9||ch>H*.9)&&fill<.18) bad=true;            // borde de la hoja / sombra
      if(!bad&&touches>=2&&fill<.25&&c.area>N*.01) bad=true;                  // marco
      if(bad)drop[l]=1; else {kept++;keptArea+=c.area}
    }
    // motas aisladas: componentes pequeños lejos de la masa principal de tinta (los puntos de la firma, cerca, se conservan)
    {
      let maxA=0; for(let l=1;l<=nl;l++) if(!drop[l]&&comps[l].area>maxA) maxA=comps[l].area;
      let bx0=W,by0=H,bx1=0,by1=0;
      for(let l=1;l<=nl;l++){const c=comps[l]; if(!drop[l]&&c.area>=maxA*.12){bx0=Math.min(bx0,c.x0);by0=Math.min(by0,c.y0);bx1=Math.max(bx1,c.x1);by1=Math.max(by1,c.y1)}}
      const m=.06*Math.max(W,H); bx0-=m;by0-=m;bx1+=m;by1+=m;
      for(let l=1;l<=nl;l++){const c=comps[l]; if(drop[l]||c.area>=maxA*.12)continue;
        const cx2=(c.x0+c.x1)/2,cy2=(c.y0+c.y1)/2;
        if(c.area<N*.0012&&(cx2<bx0||cx2>bx1||cy2<by0||cy2>by1)){drop[l]=1;kept--;keptArea-=c.area}}
    }
    for(let i=0;i<N;i++){
      if(label[i]&&drop[label[i]]) {alpha[i]=0;continue}
      if(!label[i]&&alpha[i]>0){ // halo suave junto a una mota eliminada
        const py=(i/W)|0,pxx=i-py*W; let near=false;
        for(let dy=-2;dy<=2&&!near;dy++){const yy=py+dy;if(yy<0||yy>=H)continue;for(let dx=-2;dx<=2;dx++){const xx=pxx+dx;if(xx<0||xx>=W)continue;const l=label[yy*W+xx];if(l&&drop[l]){near=true;break}}}
        if(near) alpha[i]=0;
      }
    }
    // ¿hay tinta razonable? si no, se devuelve la imagen original
    if(!kept||keptArea<N*.0004||keptArea>N*.35) { if(opts.debug)opts.debug.fallback={kept,keptArea,N}; return fail(); }

    // ── 4. imagen final: color de tinta conservado, fondo transparente ──
    for(let i=0;i<N;i++){
      const o=i*4,a=alpha[i];
      if(a<=0.004){px[o]=px[o+1]=px[o+2]=0;px[o+3]=0;continue}
      let r=clamp(ratio[i*3],0,1),g=clamp(ratio[i*3+1],0,1),b=clamp(ratio[i*3+2],0,1);
      // la tinta no debe verse pálida: se oscurece hasta un nivel legible conservando el tono
      const lum=.299*r+.587*g+.114*b, target=.32;
      if(lum>target){const f=target/lum;r*=f;g*=f;b*=f}
      px[o]=Math.round(r*255);px[o+1]=Math.round(g*255);px[o+2]=Math.round(b*255);px[o+3]=Math.round(a*255);
    }
    cx.putImageData(d,0,0);
    return opts.asCanvas?cv:cv.toDataURL('image/png');
  }

  globalThis.GS_FIRMA={clean,version:'studio-1'};

  console.info('GS Studio · firma limpia lista');
})();
