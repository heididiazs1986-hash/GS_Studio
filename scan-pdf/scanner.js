/* GS Studio — escáner exclusivo para celulares. Todo se procesa en el navegador. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const isMobile=navigator.userAgentData?.mobile===true || /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent);
$('gate').hidden=isMobile;$('scanner').hidden=!isMobile;
if(!isMobile)return;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const status=s=>{$('status').textContent=s};
const crop=$('cropCanvas'),pen=crop.getContext('2d',{willReadFrequently:true});
let stream=null,source=null,corners=null,cornerIndex=-1,preset='enhance',busy=false;
let documents=[],queue=[],drag=null,previewVersion=0,previewReady=false,automaticCrop=false,directImportBusy=false;
let cameraDetectionToken=0,liveCorners=null,lastLiveAt=0,wasCameraCapture=false;
const defaultCorners=()=>[{x:.045,y:.045},{x:.955,y:.045},{x:.955,y:.955},{x:.045,y:.955}];
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));

async function canvasFromImage(file,maxDimension=2350){
  let picture,objectURL=null;
  if(typeof createImageBitmap==='function')try{picture=await createImageBitmap(file,{imageOrientation:'from-image'})}catch(_){}
  if(!picture){
    objectURL=URL.createObjectURL(file);
    const img=new Image();
    try{
      await new Promise((ok,fail)=>{img.onload=ok;img.onerror=()=>fail(Error('Formato de imagen no compatible'));img.src=objectURL});
      picture=img;
    }finally{URL.revokeObjectURL(objectURL)}
  }
  const scale=Math.min(1,maxDimension/Math.max(picture.width||picture.naturalWidth,picture.height||picture.naturalHeight));
  const w=Math.max(1,Math.round((picture.width||picture.naturalWidth)*scale));
  const h=Math.max(1,Math.round((picture.height||picture.naturalHeight)*scale));
  const c=document.createElement('canvas');c.width=w;c.height=h;
  c.getContext('2d',{willReadFrequently:true}).drawImage(picture,0,0,w,h);
  picture.close?.();
  return c;
}
// Conservative four-edge estimate; users can always correct corners manually.
function detectCorners(image){
  const factor=Math.min(1,320/Math.max(image.width,image.height));
  const c=document.createElement('canvas');
  c.width=Math.max(80,Math.round(image.width*factor));
  c.height=Math.max(80,Math.round(image.height*factor));
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,c.width,c.height);
  const w=c.width,h=c.height,data=ctx.getImageData(0,0,w,h).data;
  const gray=(x,y)=>{const i=4*(y*w+x);return .299*data[i]+.587*data[i+1]+.114*data[i+2]};
  function edge(axis,last){
    const horizontal=axis==='x',long=horizontal?h:w,short=horizontal?w:h,points=[];
    const low=Math.floor(short*(last?.62:.025));
    const high=Math.ceil(short*(last?.975:.38));
    for(let k=Math.ceil(long*.14);k<long*.87;k+=Math.max(3,Math.round(long/22))){
      let best=0,bestAt=-1;
      for(let n=Math.max(3,low);n<Math.min(short-3,high);n++){
        const a=horizontal?gray(n-2,k):gray(k,n-2);
        const b=horizontal?gray(n+2,k):gray(k,n+2);
        if(Math.abs(b-a)>best){best=Math.abs(b-a);bestAt=n}
      }
      if(best>30)points.push([k,bestAt]);
    }
    if(points.length<7)return null;
    const median=points.map(p=>p[1]).sort((a,b)=>a-b)[Math.floor(points.length/2)];
    const inliers=points.filter(p=>Math.abs(p[1]-median)<short*.13);
    if(inliers.length<6)return null;
    const mx=inliers.reduce((a,p)=>a+p[0],0)/inliers.length;
    const my=inliers.reduce((a,p)=>a+p[1],0)/inliers.length;
    const den=inliers.reduce((a,p)=>a+(p[0]-mx)**2,0);
    if(!den)return null;
    const slope=inliers.reduce((a,p)=>a+(p[0]-mx)*(p[1]-my),0)/den;
    return {slope,intercept:my-slope*mx};
  }
  const l=edge('x',false),r=edge('x',true),t=edge('y',false),b=edge('y',true);
  if(!l||!r||!t||!b)return null;
  const intersect=(v,hz)=>{
    const y=(hz.slope*v.intercept+hz.intercept)/(1-hz.slope*v.slope);
    return {x:clamp((v.slope*y+v.intercept)/w,0,1),y:clamp(y/h,0,1)};
  };
  const q=[intersect(l,t),intersect(r,t),intersect(r,b),intersect(l,b)];
  if(q.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
  const area=Math.abs(q.reduce((a,p,i)=>a+p.x*q[(i+1)%4].y-q[(i+1)%4].x*p.y,0))/2;
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  if(area<.25||q.some((p,i)=>cross(p,q[(i+1)%4],q[(i+2)%4])<=0))return null;
  if(distance(q[0],q[1])<.45||distance(q[1],q[2])<.45)return null;
  return q;
}
function detectPaperByContrast(image){
  // Fallback detector for light paper photographed against a darker desk.
  // It is conservative: if the boundary is ambiguous, retain the whole image.
  const c=document.createElement('canvas');
  const scale=Math.min(1,320/Math.max(image.width,image.height));
  c.width=Math.max(80,Math.round(image.width*scale));
  c.height=Math.max(80,Math.round(image.height*scale));
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,c.width,c.height);
  const {width:w,height:h}=c,data=ctx.getImageData(0,0,w,h).data;
  const lum=(x,y)=>{const i=(y*w+x)*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2]};
  function median(a){a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)]}
  const background=[];
  for(let y of [3,Math.floor(h*.07),h-4])for(let x of [3,Math.floor(w*.07),w-4])background.push(lum(x,y));
  const base=median(background);
  const inside=[];
  for(let y of [.32,.45,.58,.7])for(let x of [.28,.4,.58,.7])inside.push(lum(Math.floor(w*x),Math.floor(h*y)));
  const center=median(inside);
  // White/blue paper must be noticeably brighter than the surrounding table.
  const delta=center-base;
  if(delta<23)return null;
  const threshold=base+Math.max(13,delta*.41), left=[],right=[],top=[],bottom=[];
  for(let y=Math.floor(h*.25);y<h*.77;y+=Math.max(3,Math.floor(h/24))){
    const candidates=[];
    for(let x=3;x<w-3;x++)if(lum(x,y)>threshold)candidates.push(x);
    if(candidates.length<w*.3)continue;
    const l=Math.min(...candidates),r=Math.max(...candidates);
    if(r-l>w*.42 && l>w*.015 && r<w*.985){left.push([y,l]);right.push([y,r]);}
  }
  for(let x=Math.floor(w*.28);x<w*.74;x+=Math.max(3,Math.floor(w/24))){
    const candidates=[];
    for(let y=3;y<h-3;y++)if(lum(x,y)>threshold)candidates.push(y);
    if(candidates.length<h*.3)continue;
    const t=Math.min(...candidates),b=Math.max(...candidates);
    if(b-t>h*.42 && t>h*.015 && b<h*.985){top.push([x,t]);bottom.push([x,b]);}
  }
  function fit(points){
    if(points.length<4)return null;
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const mx=xs.reduce((a,x)=>a+x,0)/xs.length,my=ys.reduce((a,y)=>a+y,0)/ys.length;
    const den=xs.reduce((a,x)=>a+(x-mx)**2,0);
    if(!den)return null;
    const slope=points.reduce((a,p)=>a+(p[0]-mx)*(p[1]-my),0)/den;
    return {m:slope,b:my-slope*mx};
  }
  const lines=[fit(left),fit(right),fit(top),fit(bottom)];
  if(lines.some(x=>!x))return null;
  const cross=(vertical,horizontal)=>{
    const y=(horizontal.m*vertical.b+horizontal.b)/(1-horizontal.m*vertical.m);
    return {x:(vertical.m*y+vertical.b)/w,y:y/h};
  };
  const [l,r,t,b]=lines,quad=[cross(l,t),cross(r,t),cross(r,b),cross(l,b)];
  if(quad.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<.005||p.x>.995||p.y<.005||p.y>.995))return null;
  const area=Math.abs(quad.reduce((sum,p,i)=>sum+p.x*quad[(i+1)%4].y-quad[(i+1)%4].x*p.y,0))/2;
  if(area<.26)return null;
  return quad;
}
function findPaper(image){return detectCorners(image)||detectPaperByContrast(image)}
function detectWithEngine(image){
  const detector=window.GSScannerDetector;
  if(detector?.ready){
    const scale=Math.min(1,440/Math.max(image.width,image.height));
    const small=document.createElement('canvas');
    small.width=Math.max(1,Math.round(image.width*scale));
    small.height=Math.max(1,Math.round(image.height*scale));
    try{
      small.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0,small.width,small.height);
      const r=detector.detect(small);
      if(r?.confidence>=.3)return r.corners;
    }finally{small.width=small.height=1}
  }
  return findPaper(image);
}
function cameraGuideCorners(){
  const panel=$('cameraPanel').getBoundingClientRect(),guide=document.querySelector('.camera-outline').getBoundingClientRect();
  const video=$('video'),vw=video.videoWidth,vh=video.videoHeight;
  if(!vw||!vh||!panel.width||!panel.height)return defaultCorners();
  const factor=Math.max(panel.width/vw,panel.height/vh);
  const width=vw*factor,height=vh*factor,ox=(panel.width-width)/2,oy=(panel.height-height)/2;
  const x=x=>clamp(((x-panel.left)-ox)/width,0,1);
  const y=y=>clamp(((y-panel.top)-oy)/height,0,1);
  return [{x:x(guide.left),y:y(guide.top)},{x:x(guide.right),y:y(guide.top)},
    {x:x(guide.right),y:y(guide.bottom)},{x:x(guide.left),y:y(guide.bottom)}];
}
function drawDetectedContour(corners){
  const overlay=$('cameraEdges'),panel=$('cameraPanel'),video=$('video');
  if(!panel.isConnected)return;
  const rect=panel.getBoundingClientRect(),ratio=window.devicePixelRatio||1;
  const w=rect.width,h=rect.height;
  overlay.width=Math.round(w*ratio);overlay.height=Math.round(h*ratio);
  const ctx=overlay.getContext('2d');ctx.scale(ratio,ratio);
  if(!corners||!video.videoWidth)return;
  const factor=Math.max(w/video.videoWidth,h/video.videoHeight);
  const imgW=video.videoWidth*factor,imgH=video.videoHeight*factor;
  const ox=(w-imgW)/2,oy=(h-imgH)/2;
  const pts=corners.map(p=>({x:ox+p.x*imgW,y:oy+p.y*imgH}));
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();
  ctx.lineWidth=4;ctx.strokeStyle='#ff6900';ctx.shadowColor='#101b27';ctx.shadowBlur=8;ctx.stroke();ctx.shadowBlur=0;
  pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.stroke()});
}
function updateCameraDetection(corners){
  const found=Boolean(corners),message=found?'Documento detectado':'Centra la hoja y mantén el teléfono estable';
  if($('cameraHint').textContent!==message)$('cameraHint').textContent=message;
  $('cameraDetection').innerHTML=found?'Bordes<br>detectados':'Buscando<br>bordes…';
  document.querySelector('.camera-outline').classList.toggle('detected',found);
  drawDetectedContour(corners);
}
function runLiveDetection(token){
  const sample=document.createElement('canvas');
  let timer=null;
  const release=()=>{if(timer)clearTimeout(timer);sample.width=sample.height=1};
  function tick(){
    if(token!==cameraDetectionToken||!stream||!$('video').videoWidth){release();return}
    try{
      const video=$('video'),ratio=Math.min(1,390/Math.max(video.videoWidth,video.videoHeight));
      sample.width=Math.max(1,Math.round(video.videoWidth*ratio));
      sample.height=Math.max(1,Math.round(video.videoHeight*ratio));
      sample.getContext('2d',{willReadFrequently:true}).drawImage(video,0,0,sample.width,sample.height);
      const found=detectWithEngine(sample);
      liveCorners=found?found.map(p=>({...p})):null;
      lastLiveAt=found?performance.now():0;
      updateCameraDetection(found);
    }catch(e){console.warn('Detección en vivo:',e)}
    if(token!==cameraDetectionToken||!stream){release();return}
    timer=setTimeout(tick,650);
  }
  tick();
}

function drawCorners(){
  if(!source)return;
  const area=document.querySelector('.edit-surface');
  const maxW=Math.max(250,area.clientWidth||320);
  const scale=Math.min(maxW/source.width,Math.min(innerHeight*.61,690)/source.height,1);
  crop.width=Math.max(1,Math.round(source.width*scale));
  crop.height=Math.max(1,Math.round(source.height*scale));
  pen.drawImage(source,0,0,crop.width,crop.height);
  const coords=corners.map(p=>({x:p.x*crop.width,y:p.y*crop.height}));
  pen.fillStyle='rgba(14,36,60,.30)';pen.fillRect(0,0,crop.width,crop.height);
  pen.save();pen.beginPath();pen.moveTo(coords[0].x,coords[0].y);
  for(let i=1;i<4;i++)pen.lineTo(coords[i].x,coords[i].y);
  pen.closePath();pen.clip();pen.clearRect(0,0,crop.width,crop.height);
  pen.drawImage(source,0,0,crop.width,crop.height);pen.restore();
  pen.strokeStyle='#ff6900';pen.lineWidth=3;pen.beginPath();
  pen.moveTo(coords[0].x,coords[0].y);
  for(let i=1;i<4;i++)pen.lineTo(coords[i].x,coords[i].y);
  pen.closePath();pen.stroke();
  coords.forEach((p,i)=>{
    pen.beginPath();pen.arc(p.x,p.y,10,0,Math.PI*2);
    pen.fillStyle='#fff';pen.fill();pen.strokeStyle='#ff6900';pen.lineWidth=3;pen.stroke();
    pen.fillStyle='#245881';pen.font='bold 12px sans-serif';pen.fillText(String(i+1),p.x+11,p.y-11);
  });
}
const normalized=event=>{
  const rect=crop.getBoundingClientRect();
  return{x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
};
crop.addEventListener('pointerdown',event=>{
  if(!source)return;
  const p=normalized(event);
  cornerIndex=corners.reduce((best,c,i)=>distance(c,p)<distance(corners[best],p)?i:best,0);
  crop.setPointerCapture(event.pointerId);
  event.preventDefault();
});
crop.addEventListener('pointermove',event=>{
  if(cornerIndex<0)return;
  corners[cornerIndex]=normalized(event);drawCorners();
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])
  crop.addEventListener(name,()=>{cornerIndex=-1});
$('resetBounds').onclick=()=>{if(source){corners=defaultCorners();drawCorners();$('quadHint').textContent='Esquinas restablecidas. Ajusta los puntos naranjas.'}};
$('autoBounds').onclick=()=>{
  if(!source)return;
  const result=detectCorners(source);corners=result||defaultCorners();drawCorners();
  $('quadHint').textContent=result?'Bordes estimados. Verifica las cuatro esquinas.':'No se detectó un contorno confiable. Ajusta manualmente los cuatro puntos.';
};
function setFilter(name,update=true){
  preset=name;document.querySelectorAll('[data-filter]').forEach(el=>el.classList.toggle('active',el.dataset.filter===name));
  if(source&&update)refreshPreview();
}
async function refreshPreview(){
 if(!source)return;
 const seq=++previewVersion,photograph=source,quadrilateral=corners.map(p=>({...p})),effect=preset;
 previewReady=false;$('addScan').disabled=true;
 $('previewHint').textContent='Preparando vista previa…';
 try{
  const result=await preparePage(photograph,quadrilateral,effect,850,680000);
  if(seq!==previewVersion||source!==photograph){result.width=result.height=1;return}
  const p=$('previewCanvas');p.width=result.width;p.height=result.height;
  p.getContext('2d').drawImage(result,0,0);
  result.width=result.height=1;previewReady=true;$('addScan').disabled=false;
  $('previewHint').textContent=automaticCrop?'Recorte estimado automáticamente · revisa los bordes':'Recorte aproximado · puedes ajustarlo antes de guardar';
 }catch(e){if(seq===previewVersion){previewReady=false;$('previewHint').textContent='No se pudo preparar la imagen: '+e.message}}
}
$('editCornersBtn').onclick=()=>{
 if(!source)return;
 $('manualPanel').hidden=false;drawCorners();
 $('manualPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
};
$('doneCorners').onclick=()=>{
 if(!source)return;
 $('manualPanel').hidden=true;refreshPreview();
 $('editPanel').scrollIntoView({behavior:'smooth',block:'start'});
};
document.querySelectorAll('[data-filter]').forEach(el=>el.onclick=()=>setFilter(el.dataset.filter));

async function showNext(){
 if(source||busy||!queue.length)return;
 busy=true;
 const file=queue.shift();
 try{
  source=await canvasFromImage(file);
  const detected=findPaper(source);
  automaticCrop=!!detected;corners=detected||defaultCorners();
  setFilter('enhance',false);
  $('editPanel').hidden=false;$('manualPanel').hidden=true;
  $('quadHint').textContent=automaticCrop?'Bordes estimados: revisa los cuatro puntos.':'Si el recorte no es correcto, mueve manualmente los cuatro puntos.';
  await refreshPreview();
  $('editPanel').scrollIntoView({behavior:'smooth',block:'start'});
  status('Revisa el escaneo. Si se ve bien, toca Guardar esta página.');
 }catch(e){source=null;status('No se pudo abrir la imagen: '+e.message)}
 finally{busy=false;if(!source&&queue.length)showNext()}
}
function enqueue(files){
  const accepted=Array.from(files||[]).filter(f=>/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type));
  if(!accepted.length){status('Selecciona fotografías JPG, PNG, WebP o HEIC compatible con tu teléfono.');return;}
  queue.push(...accepted);showNext();
}
// Tecno's native Documents camera has already corrected and cropped the page.
// Import its saved JPEG/PNG directly: NO edge detection, deskew or additional crop.
$('nativeScansInput').addEventListener('change',async event=>{
 const files=Array.from(event.target.files||[]);
 event.target.value='';
 if(!files.length)return;
 if(source||queue.length||busy||directImportBusy){
  status('Termina primero la foto que estás preparando y vuelve a importar los escaneos.');
  return;
 }
 directImportBusy=true;$('nativeScansInput').disabled=true;$('exportBtn').disabled=true;
 let imported=0,failed=0;
 try{
  for(const file of files){
   if(!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) &&
      !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)){
     failed++;continue;
   }
   status('Importando escaneos corregidos: '+(imported+failed+1)+' de '+files.length+'…');
   await nextFrame();
   try{
    // Decode with EXIF orientation and preserve the corrected native scan.
    // Cap pixel dimensions for mobile memory, not the number of pages.
    const image=await canvasFromImage(file,3000);
    let blob;
    try{blob=await new Promise((resolve,reject)=>
       image.toBlob(value=>value?resolve(value):reject(Error('No fue posible preparar la imagen.')),'image/jpeg',.93));
       const url=URL.createObjectURL(blob);
       documents.push({blob,url,w:image.width,h:image.height});
    }finally{image.width=image.height=1}
    imported++;
   }catch(error){failed++;console.warn('No se pudo importar el escaneo:',file.name,error)}
  }
 }finally{
  directImportBusy=false;$('nativeScansInput').disabled=false;
  renderPages();
  status(imported+' página(s) importadas sin recortar.'+
    (failed?' '+failed+' imagen(es) no pudieron abrirse.':'')+
    (imported?' Ordénalas y pulsa Guardar documento PDF.':''));
  if(imported)$('pagesPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
 }
});
$('galleryInput').addEventListener('change',event=>{enqueue(event.target.files);event.target.value=''});
$('cameraFallback').addEventListener('change',event=>{enqueue(event.target.files);event.target.value=''});
function stopCamera(){
  if(stream){stream.getTracks().forEach(track=>track.stop());stream=null}
  $('video').srcObject=null;$('cameraPanel').hidden=true;$('startCamera').disabled=false;
}
$('stopCamera').onclick=stopCamera;
$('startCamera').onclick=async()=>{
  if(!navigator.mediaDevices?.getUserMedia){$('cameraFallback').click();status('Utiliza la cámara del celular para tomar la foto.');return}
  try{
    stopCamera();
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:2560}}});
    $('video').srcObject=stream;await $('video').play();
    $('cameraPanel').hidden=false;$('startCamera').disabled=true;
    $('cameraPageCount').textContent=String(documents.length);
    status('Cámara abierta. Enfoca el papel y pulsa Capturar hoja.');
  }catch(e){
    stopCamera();status('No fue posible abrir la cámara ('+e.message+'). Usa la cámara del dispositivo.');
    $('cameraFallback').click();
  }
};
$('takePhoto').onclick=async()=>{
  if(!stream||!$('video').videoWidth){status('Espera a que aparezca la imagen de la cámara.');return}
  const temp=document.createElement('canvas');
  temp.width=$('video').videoWidth;temp.height=$('video').videoHeight;
  temp.getContext('2d').drawImage($('video'),0,0);
  const photo=await new Promise(resolve=>temp.toBlob(resolve,'image/jpeg',.93));
  temp.width=temp.height=1;stopCamera();
  if(!photo){status('No fue posible capturar la foto.');return}
  queue.push(photo);showNext();
};
function resetPhoto(){
  if(source){source.width=source.height=1}
  source=null;corners=null;cornerIndex=-1;previewReady=false;previewVersion++;
  crop.width=crop.height=1;$('previewCanvas').width=$('previewCanvas').height=1;
  $('manualPanel').hidden=true;$('editPanel').hidden=true;
}
$('discard').onclick=()=>{resetPhoto();status('Foto descartada.');showNext()};
$('retryPhoto').onclick=()=>{resetPhoto();status('Vuelve a tomar la fotografía.');$('startCamera').click();};

// Project a rectangular output to the selected four corners of the source image.
function transformFor(corners,w,h){
  const [tl,tr,br,bl]=corners.map(p=>({x:p.x*w,y:p.y*h}));
  const dx1=tr.x-br.x,dx2=bl.x-br.x,dx3=tl.x-tr.x+br.x-bl.x;
  const dy1=tr.y-br.y,dy2=bl.y-br.y,dy3=tl.y-tr.y+br.y-bl.y;
  let g=0,k=0;
  if(Math.abs(dx3)+Math.abs(dy3)>1e-8){
    const det=dx1*dy2-dx2*dy1;
    if(Math.abs(det)<1e-7)throw Error('Las esquinas no forman una hoja válida.');
    g=(dx3*dy2-dx2*dy3)/det;k=(dx1*dy3-dx3*dy1)/det;
  }
  return{a:tr.x-tl.x+g*tr.x,b:bl.x-tl.x+k*bl.x,c:tl.x,
    d:tr.y-tl.y+g*tr.y,e:bl.y-tl.y+k*bl.y,f:tl.y,g,k};
}
async function preparePage(image,quadrilateral,filter,maxSide=1800,maxPixels=2200000){
  const q=quadrilateral.map(p=>({x:p.x*image.width,y:p.y*image.height}));
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  if(q.some((p,i)=>cross(p,q[(i+1)%4],q[(i+2)%4])<=0))throw Error('Las esquinas están cruzadas. Ajusta los cuatro puntos.');
  const targetW=(distance(q[0],q[1])+distance(q[2],q[3]))/2;
  const targetH=(distance(q[0],q[3])+distance(q[1],q[2]))/2;
  if(targetW<70||targetH<70)throw Error('El área seleccionada es demasiado pequeña.');
  const scale=Math.min(1,maxSide/Math.max(targetW,targetH),Math.sqrt(maxPixels/(targetW*targetH)));
  const w=Math.max(120,Math.round(targetW*scale)),h=Math.max(120,Math.round(targetH*scale));
  const data=image.getContext('2d',{willReadFrequently:true}).getImageData(0,0,image.width,image.height).data;
  const out=document.createElement('canvas');out.width=w;out.height=h;
  const ctx=out.getContext('2d',{willReadFrequently:true});
  const pixels=ctx.createImageData(w,h),dst=pixels.data;
  const m=transformFor(quadrilateral,image.width,image.height);
  for(let y=0;y<h;y++){
    const v=(y+.5)/h;
    for(let x=0;x<w;x++){
      const u=(x+.5)/w,den=m.g*u+m.k*v+1;
      if(Math.abs(den)<1e-8)continue;
      const px=clamp((m.a*u+m.b*v+m.c)/den,0,image.width-1);
      const py=clamp((m.d*u+m.e*v+m.f)/den,0,image.height-1);
      const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
      const x1=Math.min(image.width-1,ix+1),y1=Math.min(image.height-1,iy+1);
      const i00=(iy*image.width+ix)*4,i10=(iy*image.width+x1)*4;
      const i01=(y1*image.width+ix)*4,i11=(y1*image.width+x1)*4;
      const w00=(1-fx)*(1-fy),w10=fx*(1-fy),w01=(1-fx)*fy,w11=fx*fy;
      let R=data[i00]*w00+data[i10]*w10+data[i01]*w01+data[i11]*w11;
      let G=data[i00+1]*w00+data[i10+1]*w10+data[i01+1]*w01+data[i11+1]*w11;
      let B=data[i00+2]*w00+data[i10+2]*w10+data[i01+2]*w01+data[i11+2]*w11;
      if(filter==='enhance'){
        R=clamp((R-128)*1.16+139,0,255);
        G=clamp((G-128)*1.16+139,0,255);
        B=clamp((B-128)*1.16+139,0,255);
      }else if(filter==='gray'||filter==='bw'){
        const gray=.299*R+.587*G+.114*B;
        R=G=B=filter==='bw'?(gray>163?255:0):clamp((gray-128)*1.13+135,0,255);
      }
      const o=(y*w+x)*4;dst[o]=R;dst[o+1]=G;dst[o+2]=B;dst[o+3]=255;
    }
    // Keep the interface responsive while warping larger scans on a phone.
    if(y%96===95)await nextFrame();
  }
  ctx.putImageData(pixels,0,0);return out;
}
const makeJpeg=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('No se pudo generar la imagen.')),'image/jpeg',.89));
$('addScan').onclick=async()=>{
  if(!source||busy||!previewReady)return;
  busy=true;$('addScan').disabled=true;
  status('Corrigiendo perspectiva…');await nextFrame();
  try{
    const processed=await preparePage(source,corners,preset);
    const blob=await makeJpeg(processed),url=URL.createObjectURL(blob);
    documents.push({blob,url,w:processed.width,h:processed.height});
    processed.width=processed.height=1;
    resetPhoto();renderPages();
    status('Página añadida. Escanea otra hoja o genera el PDF.');
  }catch(e){status('No se pudo preparar la página: '+e.message)}
  finally{busy=false;$('addScan').disabled=false;showNext()}
};
async function rotate(index){
  const item=documents[index];if(!item)return;
  const src=await canvasFromImage(item.blob,2200);
  const dest=document.createElement('canvas');dest.width=src.height;dest.height=src.width;
  const context=dest.getContext('2d');context.translate(dest.width,0);context.rotate(Math.PI/2);context.drawImage(src,0,0);
  const blob=await makeJpeg(dest),url=URL.createObjectURL(blob);
  URL.revokeObjectURL(item.url);item.blob=blob;item.url=url;item.w=dest.width;item.h=dest.height;
  src.width=src.height=dest.width=dest.height=1;renderPages();status('Página girada.');
}
function remove(index){
  const [item]=documents.splice(index,1);if(item)URL.revokeObjectURL(item.url);renderPages();
}
function reorder(from,to){
  if(from===to||from<0||to<0||from>=documents.length||to>=documents.length)return;
  const [item]=documents.splice(from,1);documents.splice(to,0,item);
  renderPages();status('Orden de páginas actualizado.');
}
function dragHandler(card,i){
  const handle=card.querySelector('.drag-handle');
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();drag={from:i,to:i,id:event.pointerId,started:false};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    drag.started=true;card.classList.add('dragging');
    document.querySelectorAll('.scan-page.drop-target').forEach(el=>el.classList.remove('drop-target'));
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.scan-page');
    if(target){drag.to=Number(target.dataset.index);if(target!==card)target.classList.add('drop-target')}
    const viewer=document.scrollingElement;
    if(event.clientY>innerHeight-65)viewer.scrollBy(0,14);
    else if(event.clientY<65)viewer.scrollBy(0,-14);
  });
  function end(event){
    if(!drag||drag.id!==event.pointerId)return;
    const {from,to,started}=drag;drag=null;card.classList.remove('dragging');
    document.querySelectorAll('.scan-page.drop-target').forEach(el=>el.classList.remove('drop-target'));
    if(started&&event.type==='pointerup')reorder(from,to);
  }
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
}
function renderPages(){
  const host=$('pages');host.replaceChildren();
  if(!documents.length){const msg=document.createElement('div');msg.className='empty';msg.textContent='Tus páginas aparecerán aquí.';host.append(msg)}
  documents.forEach((item,i)=>{
    const card=document.createElement('div');card.className='scan-page';card.dataset.index=i;
    const img=document.createElement('img');img.src=item.url;img.alt='Miniatura de página '+(i+1);card.append(img);
    const meta=document.createElement('div');meta.className='page-meta';meta.textContent='Página '+(i+1);card.append(meta);
    const actions=document.createElement('div');actions.className='page-actions';
    const handle=document.createElement('button');handle.className='drag-handle';handle.type='button';handle.textContent='↕ Mover';handle.style.touchAction='none';
    const turn=document.createElement('button');turn.type='button';turn.textContent='↻ Girar';turn.onclick=()=>rotate(i).catch(e=>status(e.message));
    const del=document.createElement('button');del.type='button';del.textContent='×';del.className='danger';del.title='Eliminar página';del.onclick=()=>remove(i);
    actions.append(handle,turn,del);card.append(actions);host.append(card);
    dragHandler(card,i);
  });
  $('pageCount').textContent=documents.length+' página(s)';
  $('cameraPageCount').textContent=String(documents.length);
  $('exportBtn').disabled=!documents.length||directImportBusy;
}
function cleanSession(){
  stopCamera();resetPhoto();queue=[];
  for(const p of documents)URL.revokeObjectURL(p.url);
  documents=[];drag=null;busy=false;directImportBusy=false;
  $('nativeScansInput').value='';$('galleryInput').value='';$('cameraFallback').value='';
  renderPages();
}
$('exportBtn').onclick=async()=>{
  if(!documents.length)return;
  if(source||queue.length||busy||directImportBusy){status('Termina de preparar o importar todas las fotografías antes de generar el PDF.');return}
  if(!window.PDFLib){status('Motor PDF no disponible. Comprueba tu conexión.');return}
  $('exportBtn').disabled=true;status('Generando PDF multipágina…');
  try{
    const pdf=await PDFLib.PDFDocument.create();
    for(const page of documents){
      const data=new Uint8Array(await page.blob.arrayBuffer());
      const img=await pdf.embedJpg(data);
      const w=page.w,h=page.h,ratio=72/150;
      const sheet=pdf.addPage([w*ratio,h*ratio]);
      sheet.drawImage(img,{x:0,y:0,width:sheet.getWidth(),height:sheet.getHeight()});
      await nextFrame();
    }
    const data=await pdf.save(),url=URL.createObjectURL(new Blob([data],{type:'application/pdf'}));
    const link=document.createElement('a');link.href=url;
    link.download='GS_Studio_Escaneo_'+new Date().toISOString().slice(0,10)+'.pdf';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    cleanSession();
    status('Descarga iniciada. Se liberaron las imágenes de la sesión. Verifica el PDF descargado.');
  }catch(e){status('No se pudo generar el PDF: '+e.message);$('exportBtn').disabled=false}
};
addEventListener('pagehide',()=>{stopCamera();for(const p of documents)URL.revokeObjectURL(p.url)});
addEventListener('resize',()=>{if(source)drawCorners()});
renderPages();
})();