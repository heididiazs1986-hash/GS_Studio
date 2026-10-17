(()=>{'use strict';
const $=id=>document.getElementById(id);
let original=null,viewDoc=null,doc=null,selectedPage=0,mode='select',items=[],selected=null,gesture=null,deskew={},zoom=1,renderVersion=0,samplingColor=false,inlineEditor=null;
const sheet=$('sheet'),overlay=$('overlay'),status=s=>{$('status').textContent=s};
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
$('textSettings').style.display='none';
const current=()=>items.filter(x=>x.page===selectedPage);
function add(item){items.push(item);selected=item;renderItems();$('save').disabled=false}
function finishInlineText(cancel=false){
 if(!inlineEditor)return;
 const {field,item,before}=inlineEditor;inlineEditor=null;
 item.text=cancel?before:field.value;
 field.remove();
 if(!String(item.text||'').trim())items=items.filter(x=>x!==item);
 selected=null;mode='select';
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode==='select'));
 $('textSettings').style.display='none';$('coverSettings').style.display='none';
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
  $('thumbs').replaceChildren();
  // Build page buttons immediately. Render preview only once a thumbnail approaches view.
  if(window.__gsThumbnailObserver)window.__gsThumbnailObserver.disconnect();
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries){
    if(!entry.isIntersecting)continue;
    const btn=entry.target;observer.unobserve(btn);
    (async()=>{
     const i=Number(btn.dataset.index),p=await viewDoc.getPage(i+1),vp=p.getViewport({scale:.16});
     const c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
     await p.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
     if(btn.isConnected)btn.prepend(c);
    })().catch(err=>console.warn('Miniatura no disponible',err));
   }
  },{root:$('thumbs').parentElement,rootMargin:'140px'});
  window.__gsThumbnailObserver=observer;
  for(let i=0;i<viewDoc.numPages;i++){
   const btn=document.createElement('button');btn.className='thumb';btn.dataset.index=i;
   const caption=document.createElement('span');caption.textContent='Página '+(i+1);btn.append(caption);
   btn.onclick=()=>showPage(i);$('thumbs').append(btn);observer.observe(btn);
  }
  await showPage(0);$('save').disabled=false;status(viewDoc.numPages+' página(s). Selecciona una herramienta.');
 }catch(e){status('No se pudo abrir el PDF: '+e.message)}
}
async function showPage(index){
 const version=++renderVersion;
 if(inlineEditor)finishInlineText();
 selectedPage=index;selected=null;
 $('deskewAngle').disabled=false;$('deskewReset').disabled=false;
 $('deskewAngle').value=String(deskew[index]||0);$('deskewValue').textContent=(deskew[index]||0)+'°';
 const page=await viewDoc.getPage(index+1);
 const vp=page.getViewport({scale:1});const scale=Math.min(1.2,900/vp.width)*zoom;
 const viewport=page.getViewport({scale});
 const c=$('pageCanvas');c.width=Math.ceil(viewport.width);c.height=Math.ceil(viewport.height);
 sheet.style.width=c.width+'px';sheet.style.height=c.height+'px';
 await page.render({canvasContext:c.getContext('2d'),viewport}).promise;
 if(version!==renderVersion)return;
 $('zoomValue').textContent=Math.round(zoom*100)+'%';
 c.style.transform='rotate('+(deskew[index]||0)+'deg)';
 c.style.transformOrigin='center center';
 [...$('thumbs').children].forEach((n,i)=>n.classList.toggle('active',i===index));
 renderItems();
}
function renderItems(){
 overlay.replaceChildren();
 for(const item of current()){
  const node=document.createElement('div');node.className='edit-item '+item.kind+(item===selected?' selected':'');
  node.style.left=(item.x*100)+'%';node.style.top=(item.y*100)+'%';
  node.style.width=(item.w*100)+'%';node.style.height=(item.h*100)+'%';
  if(item.kind==='whiteout')node.style.backgroundColor=item.color||'#ffffff';
  if(item.kind==='text'){
    node.textContent=item.text;node.style.color='#182433';
    node.style.fontSize=Math.max(7,item.size*overlay.getBoundingClientRect().width/item.baseWidth)+'px';
    node.style.lineHeight='1.25';
  }
  node.onpointerdown=e=>{
    if(item.kind==='text'&&mode==='text'){e.stopPropagation();openInlineText(item);return;}
    if(mode!=='select' && item.kind!=='whiteout')return;
    if(e.target.closest('.whiteout-toolbar,.whiteout-handle'))return;
    e.stopPropagation();
    selected=item;
    if(item.kind==='whiteout' && mode!=='select'){
      mode='select';
      document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode==='select'));
      $('coverSettings').style.display='none';$('textSettings').style.display='none';
    }
    renderItems();
    const active=[...overlay.querySelectorAll('.edit-item')].find(el=>el.dataset.itemId===String(items.indexOf(item)));
    gesture={item,at:xy(e),x:item.x,y:item.y,node:active,kind:'move'};
    overlay.setPointerCapture(e.pointerId);
  };
  node.dataset.itemId=String(items.indexOf(item));
  if(item.kind==='text')node.ondblclick=e=>{e.stopPropagation();openInlineText(item)};
  if(item.kind==='text'&&selected===item){
    const bar=document.createElement('div');bar.className='whiteout-toolbar text-toolbar';
    const edit=document.createElement('button');edit.type='button';edit.textContent='Editar texto';
    edit.onclick=e=>{e.stopPropagation();openInlineText(item)};
    const removeText=document.createElement('button');removeText.type='button';removeText.textContent='Eliminar';
    removeText.onclick=e=>{e.stopPropagation();items=items.filter(x=>x!==item);selected=null;renderItems()};
    bar.onpointerdown=e=>e.stopPropagation();bar.append(edit,removeText);node.append(bar);
  }
  if(item.kind==='whiteout' && selected===item){
    const toolbar=document.createElement('div');toolbar.className='whiteout-toolbar';
    const color=document.createElement('input');color.type='color';color.value=item.color||'#ffffff';color.title='Color de la cobertura';color.setAttribute('aria-label','Color de la cobertura');
    color.oninput=e=>{item.color=e.target.value;node.style.backgroundColor=item.color;$('coverColor').value=item.color};
    const copy=document.createElement('button');copy.type='button';copy.textContent='Duplicar';copy.onclick=e=>{e.stopPropagation();add({...item,x:Math.min(.9,item.x+.02),y:Math.min(.9,item.y+.02)});};
    const remove=document.createElement('button');remove.type='button';remove.textContent='Eliminar';remove.onclick=e=>{e.stopPropagation();items=items.filter(x=>x!==item);selected=null;renderItems()};
    toolbar.append(color,copy,remove);toolbar.onpointerdown=e=>e.stopPropagation();node.append(toolbar);
    const handle=document.createElement('span');handle.className='whiteout-handle';handle.title='Arrastra para cambiar tamaño';
    handle.onpointerdown=e=>{
      e.stopPropagation();gesture={item,at:xy(e),w:item.w,h:item.h,node,kind:'resize'};
      overlay.setPointerCapture(e.pointerId);
    };node.append(handle);
  }
  overlay.append(node);
 }
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{
 if(inlineEditor)finishInlineText();
 mode=b.dataset.mode;gesture=null;selected=null;
 document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));
 $('textSettings').style.display=mode==='text'?'block':'none';
 $('coverSettings').style.display=mode==='whiteout'?'block':'none';
 renderItems();
 status(mode==='whiteout'?'Arrastra para cubrir el área incorrecta. Después, haz clic fuera para soltar la cobertura.':mode==='text'?'Haz clic en el documento para escribir directamente. Haz clic fuera para terminar.':'Selecciona un elemento para moverlo. Haz clic en un espacio vacío para soltarlo.');
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
  if(gesture.kind==='resize'){
   gesture.item.w=Math.max(.008,Math.min(1-gesture.item.x,gesture.w+p.x-gesture.at.x));
   gesture.item.h=Math.max(.008,Math.min(1-gesture.item.y,gesture.h+p.y-gesture.at.y));
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
   add({page:selectedPage,kind:'whiteout',x:Math.min(p.x,a.x),y:Math.min(p.y,a.y),w,h,color:$('coverColor').value});
   mode='select';
   document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode==='select'));
   $('coverSettings').style.display='none';renderItems();
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
 $('pageCanvas').style.transform='rotate('+angle+'deg)';
 status('Vista previa: '+angle+'°. El ajuste se aplicará únicamente a esta página al exportar.');
};
$('deskewReset').onclick=()=>{
 if(!doc)return;
 deskew[selectedPage]=0;
 $('deskewAngle').value='0';$('deskewValue').textContent='0°';
 $('pageCanvas').style.transform='rotate(0deg)';
};
$('sampleCover').onclick=()=>{samplingColor=true;status('Toca una zona limpia de la hoja para copiar su color.');};
$('coverColor').oninput=e=>{if(selected?.kind==='whiteout'){selected.color=e.target.value;renderItems()}};
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
  for(let i=0;i<originalPdf.getPageCount();i++){
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
  for(const item of items){
   const page=result.getPage(item.page),{width,height}=page.getSize();
   const x=item.x*width,y=(1-item.y-item.h)*height;
   if(item.kind==='whiteout')page.drawRectangle({x,y,width:item.w*width,height:item.h*height,color:PDFLib.rgb(...[1,3,5].map(j=>parseInt((item.color||'#ffffff').slice(j,j+2),16)/255))});
   else if(item.kind==='text'){
    const maxWidth=item.w*width;const size=Math.max(6,Math.min(72,item.size));
    page.drawText(item.text||' ',{x,y:y+Math.max(0,item.h*height-size*1.2),size,font,color:PDFLib.rgb(.09,.14,.2),maxWidth,lineHeight:size*1.2});
   }
  }
  const bytes=await result.save(),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const link=document.createElement('a');link.href=url;link.download='GS_Studio_PDF_corregido.pdf';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  // Clear all document data held by this editor once the download has started.
  original=null;doc=null;items=[];selected=null;gesture=null;deskew={};samplingColor=false;
  if(window.__gsThumbnailObserver){window.__gsThumbnailObserver.disconnect();window.__gsThumbnailObserver=null;}
  if(viewDoc){viewDoc.destroy().catch(()=>{});viewDoc=null;}
  $('file').value='';$('thumbs').replaceChildren();
  $('pageCanvas').width=1;$('pageCanvas').height=1;
  $('overlay').replaceChildren();$('save').disabled=true;
  $('deskewAngle').disabled=true;$('deskewReset').disabled=true;
  $('zoomValue').textContent='100%';
  status('Descarga iniciada. El documento se ha retirado del editor; ya puedes abrir otro.');
 }catch(e){status('Error: '+e.message)}finally{$('save').disabled=false}
};
})();