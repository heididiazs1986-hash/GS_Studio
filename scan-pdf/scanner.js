/* GS Studio — escáner exclusivo para celulares. Todo se procesa en el navegador.
 * La visión (detección de hoja, perspectiva, acabado) vive en engine.js. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const isMobile=(navigator.userAgentData?.mobile===true || /Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|BB10|webOS|Opera Mini|KaiOS/i.test(navigator.userAgent||'') || (navigator.maxTouchPoints>0 && Math.min(screen.width,screen.height)<=820 && matchMedia('(pointer:coarse)').matches));
$('gate').hidden=isMobile;$('scanner').hidden=!isMobile;
if(!isMobile)return;
const Scan=window.GSScan;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const status=s=>{$('status').textContent=s};
const crop=$('cropCanvas'),pen=crop.getContext('2d',{willReadFrequently:true});
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const defaultCorners=()=>[{x:.045,y:.045},{x:.955,y:.045},{x:.955,y:.955},{x:.045,y:.955}];
const STABLE_TICKS=5;           // ≈1,2 s con la hoja quieta antes de la captura automática
const PDF_SIZES={A4:[595.28,841.89],Carta:[612,792],Oficio:[612,936],Legal:[612,1008]};

let stream=null,imageCapture=null,torchOn=false,capturing=false;
let source=null,sourceData=null,corners=null,cornerIndex=-1,grabOffset={x:0,y:0},preset='enhance',busy=false;
let documents=[],queue=[],drag=null,previewVersion=0,previewReady=false,automaticCrop=false,directImportBusy=false;
let cameraDetectionToken=0,liveCorners=null,lastLiveAt=0,wasCameraCapture=false;
let smoothed=null,stableTicks=0,autoCapture=true;
let baseCache={key:'',canvas:null};

/* ───────── imágenes ───────── */
async function canvasFromImage(file,maxDimension=3200){
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
  const pw=picture.width||picture.naturalWidth,ph=picture.height||picture.naturalHeight;
  const scale=Math.min(1,maxDimension/Math.max(pw,ph));
  const w=Math.max(1,Math.round(pw*scale)),h=Math.max(1,Math.round(ph*scale));
  const c=document.createElement('canvas');c.width=w;c.height=h;
  c.getContext('2d',{willReadFrequently:true}).drawImage(picture,0,0,w,h);
  picture.close?.();
  return c;
}
const makeJpeg=(canvas,quality=.9)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('No se pudo generar la imagen.')),'image/jpeg',quality));
function getSourceData(){
  if(!sourceData)sourceData=source.getContext('2d',{willReadFrequently:true}).getImageData(0,0,source.width,source.height);
  return sourceData;
}
function findPaper(image,refine=true){
  const result=Scan.detect(image,{refine});
  return result&&result.confidence>=.3?result.corners:null;
}

/* ───────── guía y detección en la cámara ───────── */
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
function drawDetectedContour(found,progress){
  const overlay=$('cameraEdges'),panel=$('cameraPanel'),video=$('video');
  if(!panel.isConnected)return;
  const rect=panel.getBoundingClientRect(),ratio=window.devicePixelRatio||1;
  const w=rect.width,h=rect.height;
  overlay.width=Math.round(w*ratio);overlay.height=Math.round(h*ratio);
  const ctx=overlay.getContext('2d');ctx.scale(ratio,ratio);
  if(!found||!video.videoWidth)return;
  const factor=Math.max(w/video.videoWidth,h/video.videoHeight);
  const imgW=video.videoWidth*factor,imgH=video.videoHeight*factor;
  const ox=(w-imgW)/2,oy=(h-imgH)/2;
  const pts=found.map(p=>({x:ox+p.x*imgW,y:oy+p.y*imgH}));
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();
  ctx.fillStyle='rgba(255,105,0,'+(.10+.14*progress)+')';ctx.fill();
  ctx.lineWidth=4;ctx.strokeStyle='#ff6900';ctx.shadowColor='#101b27';ctx.shadowBlur=8;ctx.stroke();ctx.shadowBlur=0;
  pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.stroke()});
}
function updateCameraDetection(found,progress=0){
  const message=found?(autoCapture?(progress>0?'Mantén firme…':'Hoja detectada'):'Hoja detectada · toca capturar'):'Centra la hoja completa en la pantalla';
  if($('cameraHint').textContent!==message)$('cameraHint').textContent=message;
  $('cameraDetection').innerHTML=found?'Bordes<br>detectados':'Buscando<br>bordes…';
  document.querySelector('.camera-outline').classList.toggle('detected',!!found);
  $('shutterRing').style.setProperty('--p',String(progress));
  drawDetectedContour(found,progress);
}
function runLiveDetection(token){
  const video=$('video');
  let timer=null;
  function tick(){
    if(token!==cameraDetectionToken||!stream||!video.videoWidth){clearTimeout(timer);return}
    let progress=0,shown=null;
    if(!document.hidden&&!capturing)try{
      const result=Scan.detect(video,{maxSide:280});
      const found=result&&result.confidence>=.3?result:null;
      if(found){
        // Se promedian los cuadros para que el contorno no tiemble y se detecta cuándo la hoja se queda quieta.
        const moved=smoothed?Math.max(...found.corners.map((p,i)=>distance(p,smoothed[i]))):1;
        if(!smoothed||moved>.08)smoothed=found.corners.map(p=>({...p}));
        else smoothed=smoothed.map((p,i)=>({x:p.x*.5+found.corners[i].x*.5,y:p.y*.5+found.corners[i].y*.5}));
        stableTicks=moved<.012?stableTicks+1:0;
        liveCorners=smoothed.map(p=>({...p}));lastLiveAt=performance.now();
        shown=smoothed;progress=autoCapture&&found.confidence>=.45?Math.min(1,stableTicks/STABLE_TICKS):0;
        if(progress>=1){updateCameraDetection(shown,1);capture();return}
      }else{smoothed=null;stableTicks=0;liveCorners=null;lastLiveAt=0}
      updateCameraDetection(shown,progress);
    }catch(e){console.warn('Detección en vivo:',e)}
    timer=setTimeout(tick,230);
  }
  tick();
}

/* ───────── ajuste manual de esquinas (con lupa) ───────── */
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
  if(cornerIndex>=0)drawLoupe(coords[cornerIndex]);
}
// Lupa: el dedo tapa la esquina, así que se muestra ampliada en un círculo desplazado.
function drawLoupe(point){
  const r=Math.min(58,crop.width*.2),zoom=3,sw=source.width/crop.width,sh=source.height/crop.height;
  let cx=point.x,cy=point.y-r-34;
  if(cy-r<4)cy=point.y+r+34;
  cx=clamp(cx,r+4,crop.width-r-4);cy=clamp(cy,r+4,crop.height-r-4);
  pen.save();pen.beginPath();pen.arc(cx,cy,r,0,Math.PI*2);pen.clip();
  pen.fillStyle='#fff';pen.fillRect(cx-r,cy-r,r*2,r*2);
  const srcW=(r*2/zoom)*sw,srcH=(r*2/zoom)*sh;
  pen.drawImage(source,point.x*sw-srcW/2,point.y*sh-srcH/2,srcW,srcH,cx-r,cy-r,r*2,r*2);
  pen.restore();
  pen.strokeStyle='#ff6900';pen.lineWidth=3;pen.beginPath();pen.arc(cx,cy,r,0,Math.PI*2);pen.stroke();
  pen.strokeStyle='#ff6900';pen.lineWidth=1.5;pen.beginPath();
  pen.moveTo(cx-10,cy);pen.lineTo(cx+10,cy);pen.moveTo(cx,cy-10);pen.lineTo(cx,cy+10);pen.stroke();
}
const normalized=event=>{
  const rect=crop.getBoundingClientRect();
  return{x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
};
crop.addEventListener('pointerdown',event=>{
  if(!source)return;
  const p=normalized(event);
  cornerIndex=corners.reduce((best,c,i)=>distance(c,p)<distance(corners[best],p)?i:best,0);
  grabOffset={x:corners[cornerIndex].x-p.x,y:corners[cornerIndex].y-p.y}; // la esquina no «salta» bajo el dedo
  crop.setPointerCapture(event.pointerId);
  drawCorners();event.preventDefault();
});
crop.addEventListener('pointermove',event=>{
  if(cornerIndex<0)return;
  const p=normalized(event);
  corners[cornerIndex]={x:clamp(p.x+grabOffset.x,0,1),y:clamp(p.y+grabOffset.y,0,1)};drawCorners();
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])
  crop.addEventListener(name,()=>{if(cornerIndex>=0){cornerIndex=-1;drawCorners()}});
$('resetBounds').onclick=()=>{if(source){corners=defaultCorners();drawCorners();$('quadHint').textContent='Esquinas restablecidas. Ajusta los puntos naranjas.'}};
$('autoBounds').onclick=()=>{
  if(!source)return;
  const result=findPaper(source);corners=result||defaultCorners();drawCorners();
  $('quadHint').textContent=result?'Bordes detectados. Verifica las cuatro esquinas.':'No se detectó un contorno confiable. Ajusta manualmente los cuatro puntos.';
};

/* ───────── vista previa ───────── */
function setFilter(name,update=true){
  preset=name;document.querySelectorAll('[data-filter]').forEach(el=>el.classList.toggle('active',el.dataset.filter===name));
  if(source&&update)refreshPreview();
}
const cornerKey=()=>corners.map(p=>p.x.toFixed(4)+','+p.y.toFixed(4)).join('|')+'@'+source.width+'x'+source.height;
// La perspectiva se calcula una sola vez por recorte; cambiar de filtro solo repite el acabado.
async function previewBase(){
  const key=cornerKey();
  if(baseCache.key===key&&baseCache.canvas)return baseCache.canvas;
  const size=Scan.estimateSize(corners,source.width,source.height,{maxSide:900,maxPixels:700000});
  const canvas=await Scan.warp(getSourceData(),corners,size.w,size.h,{yieldFn:nextFrame});
  if(baseCache.canvas)baseCache.canvas.width=baseCache.canvas.height=1;
  baseCache={key,canvas};
  return canvas;
}
async function refreshPreview(){
 if(!source)return;
 const seq=++previewVersion,photograph=source,effect=preset;
 previewReady=false;$('addScan').disabled=true;
 $('previewHint').textContent='Preparando vista previa…';
 try{
  const base=await previewBase();
  if(seq!==previewVersion||source!==photograph)return;
  const work=document.createElement('canvas');work.width=base.width;work.height=base.height;
  work.getContext('2d',{willReadFrequently:true}).drawImage(base,0,0);
  await Scan.enhance(work,effect,nextFrame);
  if(seq!==previewVersion||source!==photograph){work.width=work.height=1;return}
  const p=$('previewCanvas');p.width=work.width;p.height=work.height;
  p.getContext('2d').drawImage(work,0,0);
  work.width=work.height=1;previewReady=true;$('addScan').disabled=false;
  $('previewHint').textContent=automaticCrop?'Recorte automático · revisa los bordes':'Recorte aproximado · ajusta las esquinas si hace falta';
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
$('turnPhoto').onclick=()=>{
 if(!source)return;
 corners=[corners[3],corners[0],corners[1],corners[2]]; // gira 90° el resultado sin tocar la foto
 if(!$('manualPanel').hidden)drawCorners();
 refreshPreview();
};
document.querySelectorAll('[data-filter]').forEach(el=>el.onclick=()=>setFilter(el.dataset.filter));

async function showNext(){
 if(source||busy||!queue.length)return;
 busy=true;
 const queued=queue.shift(),file=queued?.file||queued;
 try{
  source=await canvasFromImage(file);
  sourceData=null;baseCache={key:'',canvas:null};
  wasCameraCapture=!!queued?.captured;
  status('Detectando bordes…');await nextFrame();
  const detected=findPaper(source);
  // Las esquinas de la guía o del video solo valen si la foto tiene el mismo encuadre que la imagen en vivo.
  const sameFraming=queued?.videoAspect&&Math.abs(source.width/source.height-queued.videoAspect)/queued.videoAspect<.03;
  const fallback=detected?null:(sameFraming?(queued.liveCorners||queued.guideCorners):null);
  automaticCrop=!!detected||!!queued?.liveCorners&&sameFraming&&!detected;
  corners=detected||fallback||defaultCorners();
  setFilter('enhance',false);
  $('editPanel').hidden=false;
  const uncertain=!detected&&!(sameFraming&&queued?.liveCorners);
  $('manualPanel').hidden=!uncertain;
  $('quadHint').textContent=uncertain?'No se vieron los bordes con claridad. Mueve los cuatro puntos a las esquinas de la hoja.':'Bordes detectados: revisa los cuatro puntos.';
  if(uncertain)drawCorners();
  await refreshPreview();
  (uncertain?$('manualPanel'):$('editPanel')).scrollIntoView({behavior:'smooth',block:uncertain?'center':'start'});
  status(uncertain?'Ajusta las cuatro esquinas sobre la hoja y toca Ver resultado corregido.':'Revisa el escaneo. Si se ve bien, toca Guardar esta página.');
 }catch(e){source=null;status('No se pudo abrir la imagen: '+e.message)}
 finally{busy=false;if(!source&&queue.length)showNext()}
}
function enqueue(files){
  const accepted=Array.from(files||[]).filter(f=>/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type)||/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name||''));
  if(!accepted.length){status('Selecciona fotografías JPG, PNG, WebP o HEIC compatible con tu teléfono.');return;}
  queue.push(...accepted.map(file=>({file,captured:false})));showNext();
}

/* ───────── importar escaneos ya recortados por el teléfono ───────── */
const nativePicker=$('nativeScansInput');
nativePicker.addEventListener('click',()=>{
 if(!directImportBusy)status('Selecciona tus escaneos en Galería o Archivos. Puedes elegir varias imágenes.');
});
nativePicker.addEventListener('change',async event=>{
 const files=Array.from(event.target.files||[]);
 event.target.value=''; // Permite seleccionar después el mismo archivo.
 if(!files.length)return;
 if(source||queue.length||busy||directImportBusy){
  status('Termina primero la foto que estás preparando y vuelve a importar los escaneos.');
  return;
 }
 directImportBusy=true;nativePicker.disabled=true;$('exportBtn').disabled=true;
 let imported=0,failed=0;
 const errors=[];
 try{
  for(let i=0;i<files.length;i++){
   const file=files[i],name=file.name||'Imagen '+(i+1);
   status('Importando escaneos: '+(i+1)+' de '+files.length+'…');
   await nextFrame();
   // Algunos gestores de archivos de Android entregan el MIME vacío o genérico.
   if(!(/^image\/(?!svg\+xml)/i.test(file.type||'') ||
         /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/i.test(name))){
    failed++;errors.push(name+': selecciona una fotografía, no un PDF u otro archivo.');continue;
   }
   try{
    if(!file.size)throw Error('El archivo está vacío.');
    const image=await canvasFromImage(file,3000);
    try{
      const blob=await makeJpeg(image,.93);
      await addPage(blob,image.width,image.height,Scan.snapRatio(image.width,image.height));
      imported++;
    }finally{image.width=image.height=1}
   }catch(error){
    failed++;
    console.warn('No se pudo importar el escaneo:',name,error);
    errors.push(name+': '+(error?.message||'formato no compatible.'));
   }
  }
 }catch(error){
  failed++;
  errors.push('Importación interrumpida: '+(error?.message||'error inesperado.'));
 }finally{
  directImportBusy=false;nativePicker.disabled=false;
  renderPages();
  const detail=errors.length?' No se pudieron importar '+failed+': '+errors.slice(0,2).join(' | ')+
   (errors.length>2?' (y '+(errors.length-2)+' más).':'')+
   ' Si tu teléfono guarda HEIC/HEIF y falla, exporta la foto en JPG.':'';
  status(imported+' página(s) importadas sin recortar.'+
    (imported?' Ordénalas y pulsa Guardar documento PDF.':'')+detail);
  if(imported)$('pagesPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
 }
});
$('galleryInput').addEventListener('change',event=>{enqueue(event.target.files);event.target.value=''});
$('cameraFallback').addEventListener('change',event=>{enqueue(event.target.files);event.target.value=''});

/* ───────── cámara ───────── */
function stopCamera(){
  cameraDetectionToken++;liveCorners=null;lastLiveAt=0;smoothed=null;stableTicks=0;capturing=false;
  updateCameraDetection(null,0);
  if(stream){stream.getTracks().forEach(track=>track.stop());stream=null}
  imageCapture=null;torchOn=false;$('torchBtn').classList.remove('on');
  $('video').srcObject=null;$('cameraPanel').hidden=true;$('startCamera').disabled=false;
}
$('stopCamera').onclick=stopCamera;
$('autoBtn').onclick=()=>{
  autoCapture=!autoCapture;stableTicks=0;
  $('autoBtn').classList.toggle('on',autoCapture);
  $('autoBtn').setAttribute('aria-pressed',String(autoCapture));
  $('autoBtn').textContent=autoCapture?'Auto ✓':'Auto';
  updateCameraDetection(null,0);
};
$('torchBtn').onclick=async()=>{
  const track=stream?.getVideoTracks()[0];if(!track)return;
  try{
    torchOn=!torchOn;
    await track.applyConstraints({advanced:[{torch:torchOn}]});
    $('torchBtn').classList.toggle('on',torchOn);
  }catch(e){torchOn=false;$('torchBtn').classList.remove('on');status('Este teléfono no permite encender la linterna desde el navegador.')}
};
$('startCamera').onclick=async()=>{
  if(!navigator.mediaDevices?.getUserMedia){$('cameraFallback').click();status('Utiliza la cámara del celular para tomar la foto.');return}
  try{
    stopCamera();
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:2160},height:{ideal:3840}}});
    const track=stream.getVideoTracks()[0],caps=track.getCapabilities?.()||{};
    $('video').srcObject=stream;await $('video').play();
    $('cameraPanel').hidden=false;$('startCamera').disabled=true;
    $('torchBtn').hidden=!caps.torch;
    if(caps.focusMode?.includes?.('continuous'))track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
    if(typeof ImageCapture==='function')try{imageCapture=new ImageCapture(track)}catch(_){imageCapture=null}
    $('autoBtn').classList.toggle('on',autoCapture);$('autoBtn').textContent=autoCapture?'Auto ✓':'Auto';
    $('cameraPageCount').textContent=String(documents.length);
    const token=++cameraDetectionToken;
    updateCameraDetection(null,0);
    runLiveDetection(token);
    status('Cámara abierta. Enfoca la hoja completa: se captura sola al quedar quieta, o pulsa el botón.');
  }catch(e){
    stopCamera();status('No fue posible abrir la cámara ('+e.message+'). Usa la cámara del dispositivo.');
    $('cameraFallback').click();
  }
};
async function capture(){
  const video=$('video');
  if(!stream||capturing)return;
  if(!video.videoWidth){status('Espera a que aparezca la imagen de la cámara.');return}
  capturing=true;
  const live=liveCorners&&performance.now()-lastLiveAt<1600?liveCorners.map(p=>({...p})):null;
  const guide=cameraGuideCorners(),videoAspect=video.videoWidth/video.videoHeight;
  let photo=null;
  // Si el navegador lo permite se usa la foto completa del sensor (mucho más nítida que un cuadro de video).
  if(imageCapture)try{
    photo=await Promise.race([imageCapture.takePhoto(),new Promise((_,fail)=>setTimeout(()=>fail(Error('tiempo agotado')),3500))]);
  }catch(_){photo=null}
  if(!photo){
    const temp=document.createElement('canvas');
    temp.width=video.videoWidth;temp.height=video.videoHeight;
    temp.getContext('2d').drawImage(video,0,0);
    photo=await makeJpeg(temp,.93).catch(()=>null);
    temp.width=temp.height=1;
  }
  navigator.vibrate?.(25);
  stopCamera();
  if(!photo){status('No fue posible capturar la foto.');return}
  queue.push({file:photo,captured:true,liveCorners:live,guideCorners:guide,videoAspect});showNext();
}
$('takePhoto').onclick=capture;
function resetPhoto(){
  if(source){source.width=source.height=1}
  if(baseCache.canvas)baseCache.canvas.width=baseCache.canvas.height=1;
  baseCache={key:'',canvas:null};sourceData=null;
  wasCameraCapture=false;source=null;corners=null;cornerIndex=-1;previewReady=false;previewVersion++;
  crop.width=crop.height=1;$('previewCanvas').width=$('previewCanvas').height=1;
  $('manualPanel').hidden=true;$('editPanel').hidden=true;
}
$('discard').onclick=()=>{resetPhoto();status('Foto descartada.');showNext()};
$('retryPhoto').onclick=()=>{resetPhoto();status('Vuelve a tomar la fotografía.');$('startCamera').click();};

/* ───────── páginas del documento ───────── */
async function makeThumb(blob,rot){
  const src=await canvasFromImage(blob,420);
  const turned=rot%180!==0,c=document.createElement('canvas');
  c.width=turned?src.height:src.width;c.height=turned?src.width:src.height;
  const x=c.getContext('2d');x.translate(c.width/2,c.height/2);x.rotate(rot*Math.PI/180);x.drawImage(src,-src.width/2,-src.height/2);
  src.width=src.height=1;
  const thumb=await makeJpeg(c,.8);c.width=c.height=1;
  return URL.createObjectURL(thumb);
}
async function addPage(blob,w,h,std){
  const item={blob,w,h,std:std||null,rot:0,thumb:await makeThumb(blob,0)};
  documents.push(item);return item;
}
$('addScan').onclick=async()=>{
  if(!source||busy||!previewReady)return;
  busy=true;$('addScan').disabled=true;
  const reopenCamera=wasCameraCapture&&$('quickMode').checked;
  status('Generando página en alta calidad…');await nextFrame();
  try{
    // Resolución final: ≈210 ppp en una hoja A4, con la proporción real de la hoja.
    const size=Scan.estimateSize(corners,source.width,source.height,{maxSide:2480,maxPixels:4300000});
    const page=await Scan.warp(getSourceData(),corners,size.w,size.h,{yieldFn:nextFrame});
    await Scan.enhance(page,preset,nextFrame);
    const blob=await makeJpeg(page,.9);
    await addPage(blob,page.width,page.height,size.std);
    page.width=page.height=1;
    resetPhoto();renderPages();
    status('Página añadida. Escanea otra hoja o genera el PDF.');
  }catch(e){status('No se pudo preparar la página: '+e.message)}
  finally{
    busy=false;$('addScan').disabled=false;
    if(queue.length)showNext();
    else if(reopenCamera&&!source)$('startCamera').click();
  }
};
async function rotate(index){
  const item=documents[index];if(!item)return;
  item.rot=(item.rot+90)%360;           // el giro se aplica en el PDF: sin recomprimir la imagen
  const old=item.thumb;item.thumb=await makeThumb(item.blob,item.rot);URL.revokeObjectURL(old);
  renderPages();status('Página girada.');
}
function remove(index){
  const [item]=documents.splice(index,1);if(item)URL.revokeObjectURL(item.thumb);renderPages();
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
    const img=document.createElement('img');img.src=item.thumb;img.alt='Miniatura de página '+(i+1);card.append(img);
    const meta=document.createElement('div');meta.className='page-meta';meta.textContent='Página '+(i+1)+(item.std?' · '+item.std:'');card.append(meta);
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
  for(const p of documents)URL.revokeObjectURL(p.thumb);
  documents=[];drag=null;busy=false;directImportBusy=false;
  $('nativeScansInput').value='';$('galleryInput').value='';$('cameraFallback').value='';
  renderPages();
}

/* ───────── PDF ───────── */
// Tamaño de hoja real en el PDF: A4, Carta, Oficio o Legal si la proporción coincide; si no, se ajusta a A4.
function pageBox(item){
  const portrait=item.h>=item.w,std=item.std&&PDF_SIZES[item.std];
  if(std)return portrait?std:[std[1],std[0]];
  const long=Math.max(item.w,item.h),short=Math.min(item.w,item.h);
  const k=Math.min(841.89/long,595.28/short);
  return[item.w*k,item.h*k];
}
function loadScript(src){
  return new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>fail(Error('No se pudo cargar el motor PDF'));document.head.append(s)});
}
async function ensurePdfEngine(){
  if(window.PDFLib)return true;
  try{await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js')}catch(_){}
  return !!window.PDFLib;
}
$('exportBtn').onclick=async()=>{
  if(!documents.length)return;
  if(source||queue.length||busy||directImportBusy){status('Termina de preparar o importar todas las fotografías antes de generar el PDF.');return}
  $('exportBtn').disabled=true;status('Generando PDF multipágina…');
  if(!await ensurePdfEngine()){status('Motor PDF no disponible. Comprueba tu conexión.');$('exportBtn').disabled=false;return}
  try{
    const pdf=await PDFLib.PDFDocument.create();
    pdf.setTitle('Escaneo GS Studio');pdf.setCreator('GS Studio');pdf.setProducer('GS Studio');
    for(const page of documents){
      const data=new Uint8Array(await page.blob.arrayBuffer());
      const img=await pdf.embedJpg(data);
      const [pw,ph]=pageBox(page);
      const sheet=pdf.addPage([pw,ph]);
      sheet.drawImage(img,{x:0,y:0,width:pw,height:ph});
      if(page.rot)sheet.setRotation(PDFLib.degrees(page.rot));
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
addEventListener('pagehide',()=>{stopCamera();for(const p of documents)URL.revokeObjectURL(p.thumb)});
addEventListener('resize',()=>{if(source&&!$('manualPanel').hidden)drawCorners()});
renderPages();
})();
