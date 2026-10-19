/* GS Studio — visual signature editor. Source PDFs and signatures stay in memory. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const status=(s,error=false)=>{$('status').textContent=s;$('status').classList.toggle('error',error)};
const note=s=>{$('modalStatus').textContent=s};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const sheet=$('sheet'),layer=$('stampLayer'),viewer=$('viewer');
let original=null,viewDoc=null,documentName='',currentPage=0,zoom=1,renderTicket=0;
let stamps=[],selectedId=null,nextId=1,placing=false,asset=null,signatureMode='draw',stageFile=null;
let drawActive=false,cropSource=null,cropBox=null,cropGesture=null,signatureInk=false;
let observer=null,thumbTickets=new Map();
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const draw=$('drawPad'),pen=draw.getContext('2d',{willReadFrequently:true});
pen.strokeStyle='#163d66';pen.lineWidth=4;pen.lineJoin='round';pen.lineCap='round';
function releaseSignatureCandidate(){cropSource=null;cropBox=null;stageFile=null;$('processCanvas').width=1;$('processCanvas').height=1}
function resetAll(){
  original=null;const previous=viewDoc;viewDoc=null;previous?.destroy()?.catch?.(()=>{});
  documentName='';currentPage=0;zoom=1;renderTicket++;
  stamps=[];selectedId=null;nextId=1;placing=false;asset=null;
  observer?.disconnect();observer=null;thumbTickets.clear();
  $('thumbs').replaceChildren();layer.replaceChildren();
  $('pdfCanvas').width=1;$('pdfCanvas').height=1;
  sheet.style.width='1px';sheet.style.height='1px';
  $('file').value='';$('workspace').hidden=true;$('uploadPanel').hidden=false;
  $('placeButton').disabled=true;$('removeAll').disabled=true;$('saveBtn').disabled=true;
  $('signatureExample').replaceChildren();
  const text=document.createElement('span');text.className='hint';text.textContent='Prepara tu firma para comenzar';
  $('signatureExample').append(text);
}
const readFile=file=>new Promise((resolve,reject)=>{
  if(!file){resolve(null);return;}
  if(!/\.pdf$/i.test(file.name) && file.type!=='application/pdf'){reject(Error('Selecciona un archivo PDF.'));return;}
  file.arrayBuffer().then(b=>resolve(new Uint8Array(b))).catch(reject);
});
async function loadDocument(file){
  if(!file)return;
  status('Abriendo documento…');
  try{
    const buffer=await readFile(file);
    if(!buffer||!buffer.length)throw Error('El archivo está vacío.');
    const pdf=await pdfjsLib.getDocument({data:buffer.slice()}).promise;
    resetAll();original=buffer;viewDoc=pdf;documentName=file.name;
    $('uploadPanel').hidden=true;$('workspace').hidden=false;
    $('docTitle').textContent=documentName;
    $('pageLabel').textContent='1/'+pdf.numPages;
    $('zoomValue').textContent='100%';
    createThumbnails();await showPage(0);
    status(pdf.numPages+' páginas. Prepara tu firma y colócala donde corresponda.');
  }catch(e){status('No se pudo abrir el PDF: '+e.message,true)}
}
$('file').addEventListener('change',e=>{loadDocument(e.target.files?.[0]);e.target.value=''});
const upload=$('uploadZone');
upload.addEventListener('dragover',e=>{e.preventDefault();upload.style.borderColor='#ff6900'});
upload.addEventListener('dragleave',()=>upload.style.borderColor='');
upload.addEventListener('drop',e=>{e.preventDefault();upload.style.borderColor='';loadDocument(e.dataTransfer.files?.[0])});
function createThumbnails(){
  observer?.disconnect();$('thumbs').replaceChildren();thumbTickets.clear();
  observer='IntersectionObserver' in window?new IntersectionObserver(entries=>{
    for(const x of entries)if(x.isIntersecting){observer.unobserve(x.target);paintThumbnail(Number(x.target.dataset.index),x.target.querySelector('canvas'))}
  },{root:$('thumbs'),rootMargin:'350px'}):null;
  for(let i=0;i<viewDoc.numPages;i++){
    const button=document.createElement('button');button.className='thumb';button.type='button';button.dataset.index=i;
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=130;button.append(canvas);
    const label=document.createElement('span');label.textContent='Página '+(i+1);button.append(label);
    button.onclick=()=>showPage(i);
    $('thumbs').append(button);
    if(observer)observer.observe(button);else if(i<10)paintThumbnail(i,canvas);
  }
}
async function paintThumbnail(index,canvas){
  const version=viewDoc;
  try{
    const page=await version.getPage(index+1);
    if(viewDoc!==version||!canvas.isConnected)return;
    const vp=page.getViewport({scale:1}),ratio=Math.min(130/vp.width,170/vp.height);
    const renderVp=page.getViewport({scale:ratio});
    canvas.width=Math.max(1,Math.round(renderVp.width));
    canvas.height=Math.max(1,Math.round(renderVp.height));
    await page.render({canvasContext:canvas.getContext('2d'),viewport:renderVp}).promise;
  }catch(e){console.warn('Miniatura no disponible',e)}
}
async function showPage(index){
  if(!viewDoc||index<0||index>=viewDoc.numPages)return;
  const ticket=++renderTicket,oldIndex=currentPage;
  currentPage=index;selectedId=null;placing=false;layer.classList.remove('placing');
  const oldWidth=Math.max(sheet.offsetWidth,1),oldHeight=Math.max(sheet.offsetHeight,1);
  const midX=(viewer.scrollLeft+viewer.clientWidth/2)/oldWidth,midY=(viewer.scrollTop+viewer.clientHeight/2)/oldHeight;
  try{
    const page=await viewDoc.getPage(index+1);
    if(ticket!==renderTicket)return;
    const normal=page.getViewport({scale:1});
    const base=Math.min(1.12,Math.max(.25,(viewer.clientWidth-55)/normal.width));
    const vp=page.getViewport({scale:base*zoom});
    const temp=document.createElement('canvas');
    temp.width=Math.max(1,Math.ceil(vp.width));temp.height=Math.max(1,Math.ceil(vp.height));
    await page.render({canvasContext:temp.getContext('2d'),viewport:vp}).promise;
    if(ticket!==renderTicket)return;
    const canvas=$('pdfCanvas');canvas.width=temp.width;canvas.height=temp.height;
    canvas.getContext('2d').drawImage(temp,0,0);
    sheet.style.width=temp.width+'px';sheet.style.height=temp.height+'px';
    layer.style.width=temp.width+'px';layer.style.height=temp.height+'px';
    $('pageLabel').textContent=(index+1)+'/'+viewDoc.numPages;
    $('zoomValue').textContent=Math.round(zoom*100)+'%';
    $('previousPage').disabled=index===0;$('nextPage').disabled=index===viewDoc.numPages-1;
    [...$('thumbs').children].forEach((c,i)=>c.classList.toggle('active',i===index));
    renderStamps();
    if(oldIndex!==index){viewer.scrollLeft=0;viewer.scrollTop=0}
    else{viewer.scrollLeft=Math.max(0,midX*temp.width-viewer.clientWidth/2);viewer.scrollTop=Math.max(0,midY*temp.height-viewer.clientHeight/2)}
  }catch(e){if(ticket===renderTicket)status('No fue posible mostrar la página: '+e.message,true)}
}
$('previousPage').onclick=()=>showPage(currentPage-1);
$('nextPage').onclick=()=>showPage(currentPage+1);
$('zoomIn').onclick=()=>{zoom=clamp(Math.round((zoom+.25)*100)/100,.5,3);showPage(currentPage)};
$('zoomOut').onclick=()=>{zoom=clamp(Math.round((zoom-.25)*100)/100,.5,3);showPage(currentPage)};
const selected=()=>stamps.find(s=>s.id===selectedId);
function updateButtons(){
  $('placeButton').disabled=!viewDoc||!asset;
  $('removeAll').disabled=!stamps.length;
  $('saveBtn').disabled=!viewDoc||!stamps.length;
}
function relativePoint(e){
  const r=layer.getBoundingClientRect();
  return{x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)};
}
function newStamp(point){
  if(!asset)return;
  const desiredWidth=Math.min(.36,Math.max(.18,185/layer.offsetWidth));
  let w=desiredWidth,h=w*layer.offsetWidth*asset.height/(asset.width*Math.max(1,layer.offsetHeight));
  if(h>.2){const scale=.2/h;w*=scale;h*=scale}
  const id=nextId++;
  const item={id,page:currentPage,sign:asset,x:clamp(point.x-w/2,0,1-w),y:clamp(point.y-h/2,0,1-h),w,h};
  stamps.push(item);selectedId=id;placing=false;layer.classList.remove('placing');
  renderStamps();updateButtons();status('Firma colocada. Muévela o arrastra su esquina para ajustar el tamaño.');
}
layer.addEventListener('pointerdown',e=>{
  if(e.target.closest('.stamp'))return;
  if(placing&&asset)newStamp(relativePoint(e));
  else{selectedId=null;renderStamps()}
});
$('placeButton').onclick=()=>{
  if(!viewDoc||!asset)return;
  placing=true;selectedId=null;layer.classList.add('placing');renderStamps();
  status('Toca o haz clic donde irá la firma en la página '+(currentPage+1)+'.');
  viewer.scrollIntoView({behavior:'smooth',block:'nearest'});
};
function renderStamps(){
  layer.replaceChildren();
  for(const item of stamps.filter(s=>s.page===currentPage)){
    const node=document.createElement('div');node.className='stamp'+(item.id===selectedId?' selected':'');
    node.style.left=item.x*100+'%';node.style.top=item.y*100+'%';
    node.style.width=item.w*100+'%';node.style.height=item.h*100+'%';
    node.dataset.id=String(item.id);
    const picture=document.createElement('img');picture.src=item.sign.dataUrl;picture.alt='Firma colocada';picture.draggable=false;node.append(picture);
    if(item.id===selectedId){
      const actions=document.createElement('div');actions.className='stamp-actions';
      const duplicate=document.createElement('button');duplicate.type='button';duplicate.textContent='Duplicar';
      duplicate.onclick=e=>{e.stopPropagation();const next={...item,id:nextId++,x:clamp(item.x+.035,0,1-item.w),y:clamp(item.y+.035,0,1-item.h)};stamps.push(next);selectedId=next.id;renderStamps();updateButtons()};
      const remove=document.createElement('button');remove.type='button';remove.textContent='Eliminar';
      remove.onclick=e=>{e.stopPropagation();stamps=stamps.filter(s=>s.id!==item.id);selectedId=null;renderStamps();updateButtons()};
      actions.onpointerdown=e=>e.stopPropagation();
      actions.append(duplicate,remove);node.append(actions);
      const grip=document.createElement('div');grip.className='grip';grip.title='Cambiar tamaño';node.append(grip);
    }
    node.addEventListener('pointerdown',e=>{
      if(e.target.closest('.stamp-actions'))return;
      e.stopPropagation();e.preventDefault();
      const resizing=e.target.classList.contains('grip');
      selectedId=item.id;placing=false;layer.classList.remove('placing');
      if(!node.classList.contains('selected')){renderStamps();return}
      const start=relativePoint(e);
      const baseline={x:item.x,y:item.y,w:item.w,h:item.h};
      node.setPointerCapture(e.pointerId);
      const move=event=>{
        const current=relativePoint(event),dx=current.x-start.x,dy=current.y-start.y;
        if(resizing){
          let width=clamp(baseline.w+dx,.035,1-baseline.x);
          let height=width*layer.offsetWidth*item.sign.height/(item.sign.width*Math.max(1,layer.offsetHeight));
          if(height>1-baseline.y){height=1-baseline.y;width=height*layer.offsetHeight*item.sign.width/(item.sign.height*Math.max(1,layer.offsetWidth))}
          item.w=width;item.h=height;node.style.width=width*100+'%';node.style.height=height*100+'%';
        }else{
          item.x=clamp(baseline.x+dx,0,1-item.w);
          item.y=clamp(baseline.y+dy,0,1-item.h);
          node.style.left=item.x*100+'%';node.style.top=item.y*100+'%';
        }
      };
      const stop=()=>{
        node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',stop);
        node.removeEventListener('pointercancel',stop);renderStamps();
      };
      node.addEventListener('pointermove',move);node.addEventListener('pointerup',stop,{once:true});
      node.addEventListener('pointercancel',stop,{once:true});
    });
    layer.append(node);
  }
}
$('removeAll').onclick=()=>{
  if(!stamps.length)return;
  if(!confirm('¿Quitar todas las firmas colocadas en este documento?'))return;
  stamps=[];selectedId=null;renderStamps();updateButtons();
  status('Se quitaron las firmas. El PDF original no se modificó.');
};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('modal').hidden){closeModal();return}
  if(e.key==='Escape'&&placing){placing=false;layer.classList.remove('placing');status('Colocación cancelada')}
  if(e.key==='Escape'&&selectedId!==null){selectedId=null;renderStamps()}
  if((e.key==='Delete'||e.key==='Backspace')&&selectedId!==null&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){
    stamps=stamps.filter(s=>s.id!==selectedId);selectedId=null;renderStamps();updateButtons()
  }
});
// ---- Signature preparation
function openModal(){
  $('modal').hidden=false;signatureMode='draw';setTab('draw');
  clearDrawing();releaseSignatureCandidate();
  $('signaturePreview').removeAttribute('src');note('Dibuja tu firma o carga una imagen. Nada se conserva después de cerrar la sesión.');
}
function closeModal(){$('modal').hidden=true;releaseSignatureCandidate()}
$('prepareButton').onclick=openModal;
$('signatureExample').onclick=openModal;
$('closeModal').onclick=closeModal;
$('cancelModal').onclick=closeModal;
function setTab(name){
  signatureMode=name;
  $('drawSection').hidden=name!=='draw';$('imageSection').hidden=name==='draw';
  for(const tab of ['draw','upload','camera'])$(tab+'Tab').classList.toggle('active',tab===name);
  $('imageLabel').textContent=name==='camera'?'Fotografiar una firma sobre papel':'Seleccionar imagen JPG o PNG de la firma';
  if(name==='camera')$('photoFile').click();
  else if(name==='upload')$('signatureFile').click();
}
$('drawTab').onclick=()=>setTab('draw');
$('uploadTab').onclick=()=>setTab('upload');
$('cameraTab').onclick=()=>setTab('camera');
$('imageLabel').onclick=e=>{if(signatureMode==='camera'){e.preventDefault();$('photoFile').click()}};
function clearDrawing(){
  pen.clearRect(0,0,draw.width,draw.height);signatureInk=false;
  if(signatureMode==='draw')$('signaturePreview').removeAttribute('src');
}
$('resetDraw').onclick=clearDrawing;
function padPoint(e){
  const r=draw.getBoundingClientRect();
  return{x:(e.clientX-r.left)*draw.width/r.width,y:(e.clientY-r.top)*draw.height/r.height};
}
draw.addEventListener('pointerdown',e=>{
  e.preventDefault();drawActive=true;draw.setPointerCapture(e.pointerId);
  const p=padPoint(e);pen.beginPath();pen.moveTo(p.x,p.y);pen.lineTo(p.x+.1,p.y+.1);pen.stroke();signatureInk=true;
});
draw.addEventListener('pointermove',e=>{
  if(!drawActive)return;const p=padPoint(e);pen.lineTo(p.x,p.y);pen.stroke();
});
for(const action of ['pointerup','pointercancel'])draw.addEventListener(action,()=>{
  if(drawActive){drawActive=false;previewCandidate()}
});
function boundsOfInk(canvas,useAlpha=true){
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
  // A clear neutral background is not part of an uploaded signature.
  for(let y=0;y<canvas.height;y+=2)for(let x=0;x<canvas.width;x+=2){
    const i=(y*canvas.width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2],alpha=pixels[i+3];
    const black=alpha>35&&(useAlpha?alpha>35:Math.min(r,g,b)<175);
    if(black){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
  }
  if(maxX<minX)return null;
  const pad=Math.max(4,Math.round(Math.min(canvas.width,canvas.height)*.035));
  return{x:clamp(minX-pad,0,canvas.width-1),y:clamp(minY-pad,0,canvas.height-1),
    w:Math.min(canvas.width,Math.max(1,maxX-minX+pad*2)),h:Math.min(canvas.height,Math.max(1,maxY-minY+pad*2))};
}
function cropCanvas(source,rect,removeWhite=false){
  const crop=document.createElement('canvas');crop.width=Math.max(1,Math.round(rect.w));crop.height=Math.max(1,Math.round(rect.h));
  const ctx=crop.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(source,rect.x,rect.y,rect.w,rect.h,0,0,crop.width,crop.height);
  if(removeWhite){
    const pixels=ctx.getImageData(0,0,crop.width,crop.height),data=pixels.data,tolerance=Number($('whiteSensitivity').value);
    for(let i=0;i<data.length;i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];
      const lowest=Math.min(r,g,b),highest=Math.max(r,g,b);
      if(highest-lowest<48){
        const threshold=255-tolerance,fade=clamp((255-lowest)/Math.max(1,tolerance),0,1);
        if(lowest>=threshold)data[i+3]=Math.round(data[i+3]*fade);
      }
    }
    ctx.putImageData(pixels,0,0);
  }
  return crop;
}
function candidateCanvas(){
  if(signatureMode==='draw'){
    if(!signatureInk)return null;
    const rect=boundsOfInk(draw,true);return rect?cropCanvas(draw,rect):null;
  }
  if(!cropSource||!cropBox)return null;
  return cropCanvas(cropSource,cropBox,$('transparentBg').checked);
}
function previewCandidate(){
  try{
    const result=candidateCanvas();if(!result){$('signaturePreview').removeAttribute('src');return}
    $('signaturePreview').src=result.toDataURL('image/png');
    result.width=result.height=1;
  }catch(e){note('No fue posible preparar la vista previa: '+e.message)}
}
async function openImage(file){
  if(!file)return;
  if(!/^image\/(png|jpeg|webp)$/i.test(file.type)){note('Usa una imagen JPG, PNG o WebP.');return}
  const url=URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(Error('No se pudo leer la fotografía'));image.src=url});
    const factor=Math.min(1,1500/Math.max(image.naturalWidth,image.naturalHeight));
    cropSource=document.createElement('canvas');
    cropSource.width=Math.max(1,Math.round(image.naturalWidth*factor));
    cropSource.height=Math.max(1,Math.round(image.naturalHeight*factor));
    cropSource.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0,cropSource.width,cropSource.height);
    cropBox=boundsOfInk(cropSource,false)||{x:0,y:0,w:cropSource.width,h:cropSource.height};
    $('processCanvas').hidden=false;$('imageControls').hidden=false;
    paintImageCrop();previewCandidate();note('Ajusta el rectángulo de recorte si hace falta y confirma la firma.');
  }catch(e){note(e.message)}
  finally{URL.revokeObjectURL(url)}
}
$('signatureFile').addEventListener('change',e=>{openImage(e.target.files[0]);e.target.value=''});
$('photoFile').addEventListener('change',e=>{openImage(e.target.files[0]);e.target.value=''});
function paintImageCrop(){
  if(!cropSource||!cropBox)return;
  const c=$('processCanvas'),ctx=c.getContext('2d');
  c.width=cropSource.width;c.height=cropSource.height;
  ctx.drawImage(cropSource,0,0);
  const q=cropBox;ctx.fillStyle='#1a2e4659';
  ctx.fillRect(0,0,c.width,q.y);ctx.fillRect(0,q.y,q.x,q.h);
  ctx.fillRect(q.x+q.w,q.y,c.width-q.x-q.w,q.h);ctx.fillRect(0,q.y+q.h,c.width,c.height-q.y-q.h);
  ctx.strokeStyle='#ff6900';ctx.lineWidth=Math.max(2,c.width/400);
  ctx.strokeRect(q.x,q.y,q.w,q.h);
  for(const [x,y] of [[q.x,q.y],[q.x+q.w,q.y],[q.x,q.y+q.h],[q.x+q.w,q.y+q.h]]){
    ctx.fillStyle='#fff';ctx.fillRect(x-7,y-7,14,14);ctx.strokeRect(x-7,y-7,14,14);
  }
}
const cropPoint=e=>{
  const c=$('processCanvas'),rect=c.getBoundingClientRect();
  return{x:clamp((e.clientX-rect.left)*c.width/rect.width,0,c.width),y:clamp((e.clientY-rect.top)*c.height/rect.height,0,c.height)};
};
$('processCanvas').addEventListener('pointerdown',e=>{
  if(!cropSource||!cropBox)return;e.preventDefault();
  const p=cropPoint(e),q=cropBox;
  const within=p.x>=q.x&&p.x<=q.x+q.w&&p.y>=q.y&&p.y<=q.y+q.h;
  cropGesture={p,rect:{...q},mode:within?'move':'new'};
  $('processCanvas').setPointerCapture(e.pointerId);
});
$('processCanvas').addEventListener('pointermove',e=>{
  if(!cropGesture)return;
  const p=cropPoint(e),origin=cropGesture.p,initial=cropGesture.rect;
  if(cropGesture.mode==='move'){
    cropBox={...initial,x:clamp(initial.x+p.x-origin.x,0,cropSource.width-initial.w),y:clamp(initial.y+p.y-origin.y,0,cropSource.height-initial.h)};
  }else{
    const x=Math.min(origin.x,p.x),y=Math.min(origin.y,p.y);
    cropBox={x,y,w:Math.max(5,Math.abs(p.x-origin.x)),h:Math.max(5,Math.abs(p.y-origin.y))};
  }
  paintImageCrop();
});
for(const n of ['pointerup','pointercancel'])$('processCanvas').addEventListener(n,()=>{if(cropGesture){cropGesture=null;previewCandidate()}});
$('transparentBg').onchange=previewCandidate;
$('whiteSensitivity').oninput=previewCandidate;
$('autoCrop').onclick=()=>{
  if(!cropSource)return;
  cropBox=boundsOfInk(cropSource,false)||{x:0,y:0,w:cropSource.width,h:cropSource.height};
  paintImageCrop();previewCandidate();
};
$('applySignature').onclick=()=>{
  const cv=candidateCanvas();
  if(!cv){note(signatureMode==='draw'?'Primero dibuja tu firma.':'Primero carga una foto de tu firma.');return}
  if(cv.width<10||cv.height<5){note('El recorte es demasiado pequeño.');return}
  const dataUrl=cv.toDataURL('image/png');
  asset={dataUrl,width:cv.width,height:cv.height};
  cv.width=cv.height=1;closeModal();
  $('signatureExample').replaceChildren();
  const img=document.createElement('img');img.src=asset.dataUrl;img.alt='Tu firma preparada';$('signatureExample').append(img);
  $('placeButton').disabled=false;
  status('Firma preparada. Pulsa «Colocar firma» y señala su ubicación sobre el PDF.');
  updateButtons();
};
async function savePdf(){
  if(!original||!stamps.length||!viewDoc){status('Coloca por lo menos una firma antes de guardar.',true);return}
  const button=$('saveBtn');button.disabled=true;status('Guardando firmas en las páginas correspondientes…');
  try{
    const out=await PDFLib.PDFDocument.load(original,{updateMetadata:false});
    const cache=new Map();
    for(const item of stamps){
      let image=cache.get(item.sign.dataUrl);
      if(!image){
        const b64=item.sign.dataUrl.split(',')[1],binary=atob(b64);
        const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
        image=await out.embedPng(bytes);cache.set(item.sign.dataUrl,image);
      }
      const pg=out.getPage(item.page);
      const pdfPage=await viewDoc.getPage(item.page+1);
      const viewport=pdfPage.getViewport({scale:1});
      const p0=viewport.convertToPdfPoint(item.x*viewport.width,(item.y+item.h)*viewport.height);
      const pr=viewport.convertToPdfPoint((item.x+item.w)*viewport.width,(item.y+item.h)*viewport.height);
      const pt=viewport.convertToPdfPoint(item.x*viewport.width,item.y*viewport.height);
      const width=Math.hypot(pr[0]-p0[0],pr[1]-p0[1]);
      const height=Math.hypot(pt[0]-p0[0],pt[1]-p0[1]);
      const degrees=Math.atan2(pr[1]-p0[1],pr[0]-p0[0])*180/Math.PI;
      if(!(width>0&&height>0))throw Error('Hay una firma con tamaño inválido.');
      pg.drawImage(image,{x:p0[0],y:p0[1],width,height,rotate:PDFLib.degrees(degrees)});
    }
    const bytes=await out.save({useObjectStreams:false});
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const link=document.createElement('a');link.href=url;
    link.download='GS_Studio_firmado_'+new Date().toISOString().slice(0,10)+'.pdf';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    resetAll();status('Descarga iniciada. Tu sesión y las firmas se liberaron. Abre el PDF descargado para comprobarlo.');
  }catch(e){status('No se pudo generar el PDF firmado: '+e.message,true);button.disabled=false}
}
$('saveBtn').onclick=savePdf;
resetAll();status('Abre un PDF para comenzar.');
})();