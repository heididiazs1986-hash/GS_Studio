(()=>{'use strict';
const $=id=>document.getElementById(id);
let original=null,viewDoc=null,doc=null,selectedPage=0,mode='select',items=[],selected=null,gesture=null,deskew={},zoom=1,renderVersion=0,samplingColor=false,inlineEditor=null,pageOrder=[],selectedPages=new Set(),pageOrderHistory=[];
const sheet=$('sheet'),overlay=$('overlay'),status=s=>{$('status').textContent=s};
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
$('textSettings').style.display='none';
const current=()=>items.filter(x=>x.page===selectedPage);
const pdfColor=hex=>PDFLib.rgb(...[1,3,5].map(j=>parseInt((/^#[0-9a-f]{6}$/i.test(hex||'')?hex:'#ffffff').slice(j,j+2),16)/255));
function showFrameSettings(){$('coverFrameOptions').hidden=!$('coverFrame').checked}
function applyWhiteoutStyle(item,node){
 const show=!!item.frame;node.style.backgroundColor=item.color||'#ffffff';
 node.classList.toggle('has-frame',show);
 node.style.border=show?(Math.max(.5,Number(item.borderWidth)||1.5)*$('pageCanvas').width/Math.max(1,doc.getPage(selectedPage).getWidth()))+'px solid '+(item.borderColor||'#245881'):'none';
}

function updateBulkToolbar(){
 const count=selectedPages.size,total=pageOrder.length,chosen=count>0;
 $('selectedCount').textContent=count+' de '+total+' seleccionada(s)';
 $('selectAllPages').checked=total>0&&count===total;
 $('selectAllPages').indeterminate=count>0&&count<total;
 $('selectAllPages').disabled=!total;
 $('moveSelectedFirst').disabled=!chosen;
 $('moveSelectedLast').disabled=!chosen;
 $('moveSelectedTo').disabled=!chosen;
 $('deleteSelected').disabled=!chosen;
 $('clearSelected').disabled=!chosen;
 $('undoPageOperation').disabled=!pageOrderHistory.length;
 $('bulkTargetNumber').disabled=!chosen;
 $('bulkTargetNumber').max=String(Math.max(1,total-count+1));
 const currentTarget=Number($('bulkTargetNumber').value);
 if(!Number.isInteger(currentTarget)||currentTarget<1||currentTarget>total-count+1)
   $('bulkTargetNumber').value='1';
}
function renderThumbs(){
 $('thumbs').replaceChildren();
 if(window.__gsThumbnailObserver)window.__gsThumbnailObserver.disconnect();
 const version=viewDoc;
 const observer='IntersectionObserver' in window ? new IntersectionObserver(entries=>{
  for(const entry of entries){
   if(!entry.isIntersecting)continue;
   const btn=entry.target;observer.unobserve(btn);
   (async()=>{
    const i=Number(btn.dataset.index),p=await version.getPage(i+1),vp=p.getViewport({scale:.16});
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.ceil(vp.width));c.height=Math.max(1,Math.ceil(vp.height));
    await p.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    if(version===viewDoc&&btn.isConnected)btn.prepend(c);
   })().catch(err=>console.warn('Miniatura no disponible',err));
  }
 },{root:$('thumbs').parentElement,rootMargin:'140px'}):null;
 window.__gsThumbnailObserver=observer;
 pageOrder.forEach((originalIndex,position)=>{
  const wrap=document.createElement('div');wrap.className='thumb-row';
  const checkbox=document.createElement('input');
  checkbox.type='checkbox';checkbox.className='page-checkbox';
  checkbox.checked=selectedPages.has(originalIndex);
  checkbox.setAttribute('aria-label','Seleccionar página '+(position+1));
  checkbox.onchange=()=>{
    if(checkbox.checked)selectedPages.add(originalIndex);else selectedPages.delete(originalIndex);
    wrap.classList.toggle('marked',checkbox.checked);updateBulkToolbar();
  };
  wrap.classList.toggle('marked',checkbox.checked);
  const btn=document.createElement('button');
  btn.type='button';btn.className='thumb';
  btn.dataset.index=String(originalIndex);
  btn.title='Abrir página '+(position+1);
  btn.classList.toggle('active',originalIndex===selectedPage);
  const caption=document.createElement('span');
  caption.textContent='Página '+(position+1)+(position!==originalIndex?' · original '+(originalIndex+1):'');
  btn.append(caption);
  btn.onclick=()=>showPage(originalIndex);
  wrap.append(checkbox,btn);$('thumbs').append(wrap);
  if(observer)observer.observe(btn);
  else if(position<9){
    (async()=>{
      try{
       const p=await version.getPage(originalIndex+1),vp=p.getViewport({scale:.16});
       const c=document.createElement('canvas');
       c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
       await p.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
       if(version===viewDoc&&btn.isConnected)btn.prepend(c);
      }catch(e){console.warn('Miniatura no disponible',e)}
    })();
  }
 });
 updateBulkToolbar();
}
function rememberPageOperation(){
 pageOrderHistory.push([...pageOrder]);
 if(pageOrderHistory.length>25)pageOrderHistory.shift();
}
function moveSelectedTo(position){
 if(!selectedPages.size)return;
 const block=pageOrder.filter(index=>selectedPages.has(index));
 const others=pageOrder.filter(index=>!selectedPages.has(index));
 const destination=Math.max(0,Math.min(others.length,position));
 const updated=[...others.slice(0,destination),...block,...others.slice(destination)];
 if(updated.every((value,i)=>pageOrder[i]===value))return;
 rememberPageOperation();pageOrder=updated;renderThumbs();
 status(block.length+' página(s) trasladadas a partir de la posición '+(destination+1)+'.');
}
$('selectAllPages').onchange=e=>{
 selectedPages=e.target.checked?new Set(pageOrder):new Set();
 renderThumbs();
};
$('clearSelected').onclick=()=>{selectedPages.clear();renderThumbs()};
$('moveSelectedFirst').onclick=()=>moveSelectedTo(0);
$('moveSelectedLast').onclick=()=>moveSelectedTo(pageOrder.length-selectedPages.size);
$('moveSelectedTo').onclick=()=>{
 const value=Number($('bulkTargetNumber').value),maximum=pageOrder.length-selectedPages.size+1;
 if(!Number.isInteger(value)||value<1||value>maximum){
  status('La posición debe estar entre 1 y '+maximum+'.');return;
 }
 moveSelectedTo(value-1);
};
$('deleteSelected').onclick=()=>{
 if(!selectedPages.size)return;
 if(selectedPages.size>=pageOrder.length){status('Debe quedar al menos una página en el PDF.');return}
 if(!confirm('¿Eliminar '+selectedPages.size+' página(s) de la copia que vas a generar? El archivo original no se modificará.'))return;
 const oldPosition=pageOrder.indexOf(selectedPage);
 rememberPageOperation();
 pageOrder=pageOrder.filter(index=>!selectedPages.has(index));
 const deleted=selectedPages.size;selectedPages.clear();
 renderThumbs();
 if(!pageOrder.includes(selectedPage))showPage(pageOrder[Math.max(0,Math.min(oldPosition,pageOrder.length-1))]);
 else showPage(selectedPage);
 status(deleted+' página(s) eliminadas de la copia. Puedes deshacer esta operación.');
};
$('undoPageOperation').onclick=()=>{
 if(!pageOrderHistory.length)return;
 pageOrder=pageOrderHistory.pop();
 selectedPages.clear();renderThumbs();
 showPage(pageOrder.includes(selectedPage)?selectedPage:pageOrder[0]);
 status('Se recuperó el orden y las páginas de la operación anterior.');
};
function switchToSelect(){
 mode='select';
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode==='select'));
}
function refreshSideSettings(){
 const coverActive=mode==='whiteout'||selected?.kind==='whiteout';
 const textActive=mode==='text'||selected?.kind==='text';
 const markActive=mode==='check'||mode==='cross'||selected?.kind==='mark';
 $('coverSettings').style.display=coverActive?'block':'none';
 $('textSettings').style.display=textActive?'block':'none';
 $('markSettings').style.display=markActive?'block':'none';
 if(selected?.kind==='whiteout'){
  $('coverColor').value=selected.color||'#ffffff';
  $('coverFrame').checked=!!selected.frame;
  $('coverBorderColor').value=selected.borderColor||'#245881';
  $('coverBorderWidth').value=String(selected.borderWidth||1.5);
  showFrameSettings();
 }
 if(selected?.kind==='mark'){
  $('markColor').value=selected.color||'#245881';
  $('markStroke').value=String(selected.stroke||3);
  $('markSize').value=String(selected.size||25);
 }
}
const svgNamespace='http://www.w3.org/2000/svg';
function makeMarkSvg(item){
 const svg=document.createElementNS(svgNamespace,'svg');
 svg.setAttribute('viewBox','0 0 100 100');
 svg.setAttribute('aria-label',item.markType==='check'?'Marca de verificación':'Marca de cruz');
 svg.setAttribute('role','img');
 const path=document.createElementNS(svgNamespace,'path');
 path.setAttribute('d',item.markType==='check'?'M 13 53 L 41 79 L 89 19':'M 18 18 L 82 82 M 82 18 L 18 82');
 path.setAttribute('fill','none');
 path.setAttribute('stroke',item.color||'#245881');
 path.setAttribute('stroke-width',String(Math.max(3,Math.min(24,(Number(item.stroke)||3)/(Number(item.size)||25)*100))));
 path.setAttribute('stroke-linecap','round');
 path.setAttribute('stroke-linejoin','round');
 svg.append(path);return svg;
}
function deskewScale(w,h,angle){
 const a=Math.abs(Number(angle)||0)*Math.PI/180;
 return Math.min(w/(Math.abs(w*Math.cos(a))+Math.abs(h*Math.sin(a))),h/(Math.abs(h*Math.cos(a))+Math.abs(w*Math.sin(a))));
}
function updateDeskewPreview(){
 const c=$('pageCanvas'),angle=Number(deskew[selectedPage]||0);
 c.style.transform='rotate('+angle+'deg) scale('+deskewScale(c.width,c.height,angle)+')';
 c.style.transformOrigin='center center';
}
function add(item){items.push(item);selected=item;renderItems();$('save').disabled=false}
function finishInlineText(cancel=false){
 if(!inlineEditor)return;
 const {field,item,before}=inlineEditor;inlineEditor=null;
 const dimensions=field.getBoundingClientRect();
 const area=overlay.getBoundingClientRect();
 if(!cancel){
  item.w=Math.max(.05,Math.min(1-item.x,dimensions.width/Math.max(1,area.width)));
  item.h=Math.max(.025,Math.min(1-item.y,dimensions.height/Math.max(1,area.height)));
 }
 item.text=cancel?before:field.value;
 field.remove();
 if(!String(item.text||'').trim())items=items.filter(x=>x!==item);
 selected=null;switchToSelect();
 renderItems();
 status('Texto colocado. Puedes seleccionarlo, moverlo o volver a editarlo.');
}
function openInlineText(item){
 if(inlineEditor){if(inlineEditor.item===item)return;finishInlineText()}
 const field=document.createElement('textarea');
 field.className='edit-inline-text';field.setAttribute('aria-label','Editar texto directamente en el PDF');
 field.value=item.text||'';field.placeholder='Escribe aquí';
 const area=overlay.getBoundingClientRect();
 field.style.left=(item.x*100)+'%';field.style.top=(item.y*100)+'%';
 field.style.width=(item.w*100)+'%';field.style.height=Math.max(42,item.h*area.height)+'px';
 field.style.fontSize=Math.max(12,item.size*area.width/item.baseWidth)+'px';
 field.style.lineHeight='1.25';
 field.onpointerdown=e=>e.stopPropagation();
 field.oninput=()=>{
  item.text=field.value;
  field.style.height='auto';
  field.style.height=Math.max(42,field.scrollHeight+6)+'px';
  item.h=Math.min(1-item.y,parseFloat(field.style.height)/Math.max(1,area.height));
 };
 field.onkeydown=e=>{
  if(e.key==='Escape'){e.preventDefault();finishInlineText(true)}
  else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();finishInlineText()}
 };
 field.onblur=()=>finishInlineText();
 inlineEditor={field,item,before:item.text||''};
 overlay.append(field);field.focus();field.select();
 status('Escribe directamente en la página. Haz clic fuera para dejar el texto colocado.');
}
function xy(e){const r=overlay.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
async function loadFile(file){
 if(!file)return;
 try{
  original=new Uint8Array(await file.arrayBuffer());
  doc=await PDFLib.PDFDocument.load(original.slice());
  viewDoc=await pdfjsLib.getDocument({data:original.slice()}).promise;
  items=[];selected=null;selectedPage=0;deskew={};zoom=1;
  pageOrder=Array.from({length:viewDoc.numPages},(_,i)=>i);
  selectedPages=new Set();pageOrderHistory=[];
  renderThumbs();
  await showPage(pageOrder[0]);$('save').disabled=false;status(viewDoc.numPages+' página(s). Puedes editar y seleccionar varias páginas para organizarlas.');
 }catch(e){status('No se pudo abrir el PDF: '+e.message)}
}
async function showPage(index){
 if(!doc||!pageOrder.includes(index))return;
 const version=++renderVersion;
 if(inlineEditor)finishInlineText();
 const previousPage=selectedPage;
 selectedPage=index;selected=null;
 $('deskewAngle').disabled=false;$('deskewReset').disabled=false;
 $('deskewAngle').value=String(deskew[index]||0);$('deskewValue').textContent=(deskew[index]||0)+'°';
 const viewer=document.querySelector('.viewer');
 const oldWidth=Math.max(1,sheet.offsetWidth),oldHeight=Math.max(1,sheet.offsetHeight);
 const focusX=(viewer.scrollLeft+viewer.clientWidth/2)/oldWidth;
 const focusY=(viewer.scrollTop+viewer.clientHeight/2)/oldHeight;
 try{
  const page=await viewDoc.getPage(index+1);
  if(version!==renderVersion)return;
  const vp=page.getViewport({scale:1});
  const scale=Math.min(1.2,900/vp.width)*zoom;
  const viewport=page.getViewport({scale});
  // Paint into a new canvas. Replacing the current canvas only when rendering
  // finishes avoids races between repeated zoom clicks on the same PDF page.
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.ceil(viewport.width));
  canvas.height=Math.max(1,Math.ceil(viewport.height));
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  if(version!==renderVersion)return;
  const previousCanvas=$('pageCanvas');
  canvas.id='pageCanvas';
  previousCanvas.replaceWith(canvas);
  sheet.style.width=canvas.width+'px';sheet.style.height=canvas.height+'px';
  canvas.style.width=canvas.width+'px';canvas.style.height=canvas.height+'px';
  updateDeskewPreview();
  $('zoomValue').textContent=Math.round(zoom*100)+'%';
  $('thumbs').querySelectorAll('.thumb').forEach(btn=>btn.classList.toggle('active',Number(btn.dataset.index)===index));
  renderItems();
  // Keep the same document area near the center while zooming.
  if(index===previousPage){
   viewer.scrollLeft=Math.max(0,Math.round(focusX*canvas.width-viewer.clientWidth/2));
   viewer.scrollTop=Math.max(0,Math.round(focusY*canvas.height-viewer.clientHeight/2));
  }else{viewer.scrollLeft=0;viewer.scrollTop=0}
 }catch(error){
  if(version===renderVersion)status('No se pudo actualizar la vista: '+error.message);
 }
}
function renderItems(){
 overlay.replaceChildren();
 refreshSideSettings();
 for(const item of current()){
  const node=document.createElement('div');
  node.className='edit-item '+item.kind+(item===selected?' selected':'');
  node.style.left=item.x*100+'%';node.style.top=item.y*100+'%';
  node.style.width=item.w*100+'%';node.style.height=item.h*100+'%';
  node.dataset.itemId=String(items.indexOf(item));
  if(item.kind==='whiteout')applyWhiteoutStyle(item,node);
  if(item.kind==='whiteout' && mode!=='select')node.style.pointerEvents='none';
  if(item.kind==='text'){
   node.textContent=item.text;node.style.color='#182433';
   node.style.fontSize=Math.max(7,item.size*overlay.getBoundingClientRect().width/item.baseWidth)+'px';
   node.style.lineHeight='1.25';
  }
  if(item.kind==='mark')node.append(makeMarkSvg(item));
  node.onpointerdown=e=>{
    if(item.kind==='text'&&mode==='text'){e.stopPropagation();openInlineText(item);return}
    if(mode!=='select'&&item.kind!=='whiteout')return;
    if(e.target.closest('.whiteout-toolbar,.whiteout-handle,.mark-resize-handle'))return;
    e.stopPropagation();e.preventDefault();
    selected=item;
    if(mode!=='select')switchToSelect();
    renderItems();
    const active=[...overlay.querySelectorAll('.edit-item')].find(el=>el.dataset.itemId===String(items.indexOf(item)));
    gesture={item,at:xy(e),x:item.x,y:item.y,node:active,kind:'move'};
    overlay.setPointerCapture(e.pointerId);
  };
  if(item.kind==='text')node.ondblclick=e=>{e.stopPropagation();openInlineText(item)};
  if(item.kind==='text'&&selected===item){
   const bar=document.createElement('div');bar.className='whiteout-toolbar text-toolbar';
   const edit=document.createElement('button');edit.type='button';edit.textContent='Editar texto';
   edit.onclick=e=>{e.stopPropagation();openInlineText(item)};
   const del=document.createElement('button');del.type='button';del.textContent='Eliminar';
   del.onclick=e=>{e.stopPropagation();items=items.filter(x=>x!==item);selected=null;renderItems()};
   bar.onpointerdown=e=>e.stopPropagation();bar.append(edit,del);node.append(bar);
  }
  if(item.kind==='whiteout'&&selected===item){
   const toolbar=document.createElement('div');toolbar.className='whiteout-toolbar';
   if(item.x>.55){toolbar.style.left='auto';toolbar.style.right='0'}
   toolbar.onpointerdown=e=>e.stopPropagation();
   const label=(title,control)=>{
     const wrapper=document.createElement('label');wrapper.className='cover-inline-label';
     wrapper.append(document.createTextNode(title),control);toolbar.append(wrapper);
   };
   const color=document.createElement('input');color.type='color';color.value=item.color||'#ffffff';
   color.title='Color del fondo';color.setAttribute('aria-label','Color de la cobertura');
   color.oninput=e=>{item.color=e.target.value;applyWhiteoutStyle(item,node);$('coverColor').value=item.color};
   label('Fondo',color);
   const toggleFrame=document.createElement('button');toggleFrame.type='button';toggleFrame.className='frame-toggle';
   toggleFrame.textContent=item.frame?'☑ Marco':'☐ Marco';
   toggleFrame.title='Mostrar u ocultar el marco en el PDF';
   toggleFrame.onclick=e=>{e.stopPropagation();item.frame=!item.frame;renderItems()};
   toolbar.append(toggleFrame);
   const borderColor=document.createElement('input');borderColor.type='color';
   borderColor.value=item.borderColor||'#245881';borderColor.disabled=!item.frame;
   borderColor.title='Color del marco';borderColor.setAttribute('aria-label','Color del marco');
   borderColor.oninput=e=>{item.borderColor=e.target.value;applyWhiteoutStyle(item,node);$('coverBorderColor').value=item.borderColor};
   label('Borde',borderColor);
   const width=document.createElement('input');width.type='number';width.className='cover-inline-width';
   width.min='.5';width.max='6';width.step='.5';width.value=String(item.borderWidth||1.5);
   width.disabled=!item.frame;width.title='Grosor del marco en puntos';
   width.onchange=e=>{
     item.borderWidth=Math.max(.5,Math.min(6,Number(e.target.value)||1.5));
     e.target.value=String(item.borderWidth);$('coverBorderWidth').value=e.target.value;
     applyWhiteoutStyle(item,node);
   };
   label('Grosor',width);
   const copy=document.createElement('button');copy.type='button';copy.textContent='Duplicar';
   copy.onclick=e=>{e.stopPropagation();add({...item,x:Math.min(1-item.w,item.x+.02),y:Math.min(1-item.h,item.y+.02)})};
   const remove=document.createElement('button');remove.type='button';remove.textContent='Eliminar';
   remove.onclick=e=>{e.stopPropagation();items=items.filter(x=>x!==item);selected=null;renderItems()};
   toolbar.append(copy,remove);node.append(toolbar);
   const handle=document.createElement('span');handle.className='whiteout-handle';handle.title='Cambiar tamaño de la cobertura';
   handle.onpointerdown=e=>{
     e.stopPropagation();e.preventDefault();
     gesture={item,at:xy(e),w:item.w,h:item.h,node,kind:'resize'};
     overlay.setPointerCapture(e.pointerId);
   };
   node.append(handle);
  }
  if(item.kind==='mark'&&selected===item){
   const bar=document.createElement('div');bar.className='whiteout-toolbar text-toolbar';
   bar.onpointerdown=e=>e.stopPropagation();
   const copy=document.createElement('button');copy.type='button';copy.textContent='Duplicar';
   copy.onclick=e=>{e.stopPropagation();add({...item,x:Math.min(1-item.w,item.x+.02),y:Math.min(1-item.h,item.y+.02)})};
   const remove=document.createElement('button');remove.type='button';remove.textContent='Eliminar';
   remove.onclick=e=>{e.stopPropagation();items=items.filter(x=>x!==item);selected=null;renderItems()};
   bar.append(copy,remove);node.append(bar);
   const handle=document.createElement('span');handle.className='mark-resize-handle';handle.title='Arrastra para cambiar tamaño';
   handle.onpointerdown=e=>{
     e.stopPropagation();e.preventDefault();
     gesture={item,at:xy(e),w:item.w,h:item.h,node,kind:'mark-resize'};
     overlay.setPointerCapture(e.pointerId);
   };
   node.append(handle);
  }
  overlay.append(node);
 }
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{
 if(inlineEditor)finishInlineText();
 mode=b.dataset.mode;gesture=null;selected=null;
 document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));
 refreshSideSettings();
 renderItems();
 status(mode==='whiteout'?'Arrastra para cubrir el área. Al seleccionarla podrás elegir fondo, marco, color y grosor.'
   :mode==='text'?'Toca la hoja y escribe dentro del cuadro. Haz clic fuera para terminar.'
   :mode==='check'||mode==='cross'?'Toca la hoja donde quieres colocar la marca. Después podrás moverla y cambiar su tamaño.'
   :'Selecciona un elemento para moverlo. Haz clic en un espacio vacío para soltarlo.');
});
overlay.addEventListener('pointerdown',e=>{
 if(!doc)return;
 if(inlineEditor){finishInlineText();return;}
 const p=xy(e);
 if(samplingColor){
  const c=$('pageCanvas'),rgba=c.getContext('2d').getImageData(Math.min(c.width-1,Math.floor(p.x*c.width)),Math.min(c.height-1,Math.floor(p.y*c.height)),1,1).data;
  $('coverColor').value='#'+Array.from(rgba.slice(0,3)).map(v=>v.toString(16).padStart(2,'0')).join('');
  samplingColor=false;status('Color seleccionado: '+$('coverColor').value);return;
 }
 if(mode==='select'){
  if(selected){selected=null;gesture=null;renderItems();status('Elemento soltado. Puedes continuar editando.')}
  return;
 }
 if(mode==='check'||mode==='cross'){
  const pg=doc.getPage(selectedPage),angle=((pg.getRotation().angle||0)%180+180)%180;
  const visibleWidth=angle===90?pg.getHeight():pg.getWidth();
  const size=Math.max(8,Math.min(120,Number($('markSize').value)||25));
  const width=Math.min(.3,size/Math.max(1,visibleWidth));
  const height=Math.min(.3,width*overlay.clientWidth/Math.max(1,overlay.clientHeight));
  const item={page:selectedPage,kind:'mark',markType:mode,x:Math.max(0,Math.min(1-width,p.x-width/2)),
    y:Math.max(0,Math.min(1-height,p.y-height/2)),w:width,h:height,
    size,color:$('markColor').value,stroke:Math.max(1,Math.min(12,Number($('markStroke').value)||3))};
  switchToSelect();add(item);
  status('Marca colocada. Selecciónala para cambiar color o grosor, moverla o redimensionarla.');
  return;
 }
 if(mode==='text'){
  const page=doc.getPage(selectedPage);
  const item={page:selectedPage,kind:'text',x:Math.min(p.x,.58),y:Math.min(p.y,.92),w:.42,h:.06,text:$('textValue').value,size:Number($('fontSize').value)||16,baseWidth:page.getWidth()};
  add(item);openInlineText(item);
 }else if(mode==='whiteout'){
  gesture={start:p,kind:'whiteout'};
  overlay.setPointerCapture(e.pointerId);
 }
});
overlay.addEventListener('pointermove',e=>{
 if(!gesture)return;
 const p=xy(e);
 if(gesture.item){
  if(gesture.kind!=='resize'){
   gesture.item.x=Math.max(0,Math.min(1-gesture.item.w,gesture.x+p.x-gesture.at.x));
   gesture.item.y=Math.max(0,Math.min(1-gesture.item.h,gesture.y+p.y-gesture.at.y));
  }
  if(gesture.kind==='resize'||gesture.kind==='mark-resize'){
   if(gesture.kind==='mark-resize'){
     const factor=Math.max(.3,1+Math.max((p.x-gesture.at.x)/Math.max(.01,gesture.w),
       (p.y-gesture.at.y)/Math.max(.01,gesture.h)));
     const upper=Math.min((1-gesture.item.x)/gesture.w,(1-gesture.item.y)/gesture.h,5);
     const bounded=Math.min(upper,factor);
     gesture.item.w=gesture.w*bounded;gesture.item.h=gesture.h*bounded;
     gesture.item.size=Math.max(8,Math.min(120,(gesture.item.size||25)*bounded));
   }else{
     gesture.item.w=Math.max(.008,Math.min(1-gesture.item.x,gesture.w+p.x-gesture.at.x));
     gesture.item.h=Math.max(.008,Math.min(1-gesture.item.y,gesture.h+p.y-gesture.at.y));
   }
   gesture.node.style.width=(gesture.item.w*100)+'%';gesture.node.style.height=(gesture.item.h*100)+'%';
  }else{
   gesture.node.style.left=(gesture.item.x*100)+'%';gesture.node.style.top=(gesture.item.y*100)+'%';
  }
 }
});
overlay.addEventListener('pointerup',e=>{
 if(!gesture)return;
 if(gesture.kind==='whiteout'){
  const p=xy(e),a=gesture.start;
  const w=Math.abs(p.x-a.x),h=Math.abs(p.y-a.y);
  if(w>.003&&h>.003){
   add({page:selectedPage,kind:'whiteout',x:Math.min(p.x,a.x),y:Math.min(p.y,a.y),w,h,color:$('coverColor').value,frame:$('coverFrame').checked,borderColor:$('coverBorderColor').value,borderWidth:Number($('coverBorderWidth').value)});
   switchToSelect();renderItems();
   status('Cobertura colocada. Haz clic fuera para soltarla o usa su barra para ajustarla.');
  }
 }
 gesture=null;
});
overlay.addEventListener('pointercancel',()=>{gesture=null});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!inlineEditor&&selected){selected=null;gesture=null;renderItems();}
});
document.addEventListener('pointerdown',e=>{
 if(!selected||inlineEditor)return;
 if(e.target.closest('#overlay'))return;
 selected=null;gesture=null;renderItems();
});
$('undo').onclick=()=>{if(inlineEditor)finishInlineText();if(!items.length)return;items.pop();selected=null;renderItems()};
$('remove').onclick=()=>{if(!selected)return;items=items.filter(x=>x!==selected);selected=null;renderItems()};
$('deskewAngle').oninput=e=>{
 if(!doc)return;
 const angle=Number(e.target.value);
 deskew[selectedPage]=angle;
 $('deskewValue').textContent=angle+'°';
 updateDeskewPreview();
 status('Vista previa: '+angle+'°. El ajuste se aplicará únicamente a esta página al exportar.');
};
$('deskewReset').onclick=()=>{
 if(!doc)return;
 deskew[selectedPage]=0;
 $('deskewAngle').value='0';$('deskewValue').textContent='0°';
 updateDeskewPreview();
};
$('sampleCover').onclick=()=>{samplingColor=true;status('Toca una zona limpia de la hoja para copiar su color.');};
$('coverColor').oninput=e=>{if(selected?.kind==='whiteout'){selected.color=e.target.value;renderItems()}};
$('coverFrame').onchange=e=>{showFrameSettings();if(selected?.kind==='whiteout'){selected.frame=e.target.checked;renderItems()}};
$('coverBorderColor').oninput=e=>{if(selected?.kind==='whiteout'){selected.borderColor=e.target.value;renderItems()}};
$('coverBorderWidth').onchange=e=>{if(selected?.kind==='whiteout'){selected.borderWidth=Math.max(.5,Math.min(6,Number(e.target.value)||1.5));renderItems()}};
$('markColor').oninput=e=>{if(selected?.kind==='mark'){selected.color=e.target.value;renderItems()}};
$('markStroke').onchange=e=>{if(selected?.kind==='mark'){selected.stroke=Math.max(1,Math.min(12,Number(e.target.value)||3));renderItems()}};
$('markSize').onchange=e=>{
 if(selected?.kind!=='mark')return;
 const next=Math.max(8,Math.min(120,Number(e.target.value)||25));
 const factor=next/Math.max(1,selected.size||25);
 selected.size=next;selected.w=Math.min(1-selected.x,selected.w*factor);
 selected.h=Math.min(1-selected.y,selected.h*factor);
 renderItems();
};
refreshSideSettings();
showFrameSettings();
async function setZoom(value){if(!doc)return;zoom=Math.max(.5,Math.min(3,value));await showPage(selectedPage)}
$('zoomIn').onclick=()=>setZoom(zoom+.25);
$('zoomOut').onclick=()=>setZoom(zoom-.25);
$('fitWidth').onclick=async()=>{if(!doc)return;const pg=await viewDoc.getPage(selectedPage+1),base=pg.getViewport({scale:1});const available=document.querySelector('.viewer').clientWidth-55;zoom=Math.max(.5,Math.min(3,available/Math.min(base.width*1.2,900)));await showPage(selectedPage)};
$('file').onchange=e=>loadFile(e.target.files[0]);
$('save').onclick=async()=>{
 if(inlineEditor)finishInlineText();
 if(!doc)return;
 $('save').disabled=true;status('Guardando correcciones…');
 try{
  // Preserve all untouched pages as PDF. Rasterize only pages explicitly deskewed.
  const result=await PDFLib.PDFDocument.create();
  const originalPdf=await PDFLib.PDFDocument.load(original.slice());
  const outputIndexBySource=new Map(pageOrder.map((sourceIndex,outputIndex)=>[sourceIndex,outputIndex]));
  for(const i of pageOrder){
    const angle=Number(deskew[i]||0);
    if(Math.abs(angle)<.001){
      const [copied]=await result.copyPages(originalPdf,[i]);result.addPage(copied);
      continue;
    }
    const source=await viewDoc.getPage(i+1);
    const viewport=source.getViewport({scale:2});
    const raster=document.createElement('canvas');
    raster.width=Math.ceil(viewport.width);raster.height=Math.ceil(viewport.height);
    await source.render({canvasContext:raster.getContext('2d'),viewport}).promise;
    const rotated=document.createElement('canvas');
    rotated.width=raster.width;rotated.height=raster.height;
    const ctx=rotated.getContext('2d');
    ctx.fillStyle='white';ctx.fillRect(0,0,rotated.width,rotated.height);
    ctx.translate(rotated.width/2,rotated.height/2);
    ctx.rotate(angle*Math.PI/180);
    const scale=Math.min(rotated.width/(Math.abs(raster.width*Math.cos(angle*Math.PI/180))+Math.abs(raster.height*Math.sin(angle*Math.PI/180))),rotated.height/(Math.abs(raster.height*Math.cos(angle*Math.PI/180))+Math.abs(raster.width*Math.sin(angle*Math.PI/180))));
    ctx.scale(scale,scale);ctx.drawImage(raster,-raster.width/2,-raster.height/2);
    const image=await result.embedPng(new Uint8Array(await(await fetch(rotated.toDataURL('image/png'))).arrayBuffer()));
    const originalPage=originalPdf.getPage(i);
    const width=originalPage.getWidth(),height=originalPage.getHeight();
    const page=result.addPage([width,height]);
    page.drawImage(image,{x:0,y:0,width,height});
  }
  const font=await result.embedFont(PDFLib.StandardFonts.Helvetica);
  // The preview uses PDF.js viewport coordinates; convert back to the PDF
  // user-space coordinates when exporting (honors crop boxes and /Rotate).
  const boundsFor=async item=>{
    const target=outputIndexBySource.get(item.page);
    if(target===undefined)return null;
    const page=result.getPage(target);
    if(Math.abs(Number(deskew[item.page]||0))>.001){
      const {width,height}=page.getSize();
      return {x:item.x*width,y:(1-item.y-item.h)*height,width:item.w*width,height:item.h*height,
        textPoint:[item.x*width,(1-item.y)*height-(Number(item.size)||16)],rotation:0};
    }
    const source=await viewDoc.getPage(item.page+1);
    const vp=source.getViewport({scale:1});
    const points=[
      vp.convertToPdfPoint(item.x*vp.width,item.y*vp.height),
      vp.convertToPdfPoint((item.x+item.w)*vp.width,item.y*vp.height),
      vp.convertToPdfPoint(item.x*vp.width,(item.y+item.h)*vp.height),
      vp.convertToPdfPoint((item.x+item.w)*vp.width,(item.y+item.h)*vp.height)
    ];
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const size=Math.max(6,Math.min(72,Number(item.size)||16));
    const textPoint=vp.convertToPdfPoint(item.x*vp.width,item.y*vp.height+size);
    return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),
      height:Math.max(...ys)-Math.min(...ys),textPoint,rotation:(360-(vp.rotation%360))%360};
  };
  for(const item of items){
   const target=outputIndexBySource.get(item.page);
   if(target===undefined)continue;
   const page=result.getPage(target),geom=await boundsFor(item);
   if(!geom)continue;
   if(item.kind==='whiteout'){
     const opts={x:geom.x,y:geom.y,width:geom.width,height:geom.height,
       color:pdfColor(item.color||'#ffffff'),borderWidth:0};
     if(item.frame){opts.borderColor=pdfColor(item.borderColor||'#245881');
       opts.borderWidth=Math.max(.5,Math.min(6,Number(item.borderWidth)||1.5));}
     page.drawRectangle(opts);
   }else if(item.kind==='text'&&String(item.text||'').trim()){
     const size=Math.max(6,Math.min(72,Number(item.size)||16));
     page.drawText(item.text,{x:geom.textPoint[0],y:geom.textPoint[1],
       size,font,color:PDFLib.rgb(.09,.14,.2),maxWidth:Math.max(size,geom.width),
       rotate:PDFLib.degrees(geom.rotation),lineHeight:size*1.2});
   }
  }
  const bytes=await result.save(),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const link=document.createElement('a');link.href=url;link.download='GS_Studio_PDF_corregido.pdf';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  // Clear all document data held by this editor once the download has started.
  original=null;doc=null;items=[];selected=null;gesture=null;deskew={};samplingColor=false;
  pageOrder=[];selectedPages.clear();pageOrderHistory=[];updateBulkToolbar();
  if(window.__gsThumbnailObserver){window.__gsThumbnailObserver.disconnect();window.__gsThumbnailObserver=null;}
  if(viewDoc){viewDoc.destroy().catch(()=>{});viewDoc=null;}
  $('file').value='';$('thumbs').replaceChildren();
  $('pageCanvas').width=1;$('pageCanvas').height=1;
  $('overlay').replaceChildren();$('save').disabled=true;
  $('deskewAngle').disabled=true;$('deskewReset').disabled=true;
  $('zoomValue').textContent='100%';
  status('Descarga iniciada. El documento se ha retirado del editor; ya puedes abrir otro.');
 }catch(e){status('Error: '+e.message)}finally{$('save').disabled=!doc}
};
})();