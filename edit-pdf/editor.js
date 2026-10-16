(()=>{'use strict';
const $=id=>document.getElementById(id);
let original=null,viewDoc=null,doc=null,selectedPage=0,mode='select',items=[],selected=null,gesture=null;
const sheet=$('sheet'),overlay=$('overlay'),status=s=>{$('status').textContent=s};
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const current=()=>items.filter(x=>x.page===selectedPage);
function add(item){items.push(item);selected=item;renderItems();$('save').disabled=false}
function xy(e){const r=overlay.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
async function loadFile(file){
 if(!file)return;
 try{
  original=new Uint8Array(await file.arrayBuffer());
  doc=await PDFLib.PDFDocument.load(original.slice());
  viewDoc=await pdfjsLib.getDocument({data:original.slice()}).promise;
  items=[];selected=null;selectedPage=0;
  $('thumbs').replaceChildren();
  for(let i=0;i<viewDoc.numPages;i++){
   const p=await viewDoc.getPage(i+1),vp=p.getViewport({scale:.18});
   const c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
   await p.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
   const btn=document.createElement('button');btn.className='thumb';btn.append(c);
   const caption=document.createElement('span');caption.textContent='Página '+(i+1);btn.append(caption);
   btn.onclick=()=>showPage(i);$('thumbs').append(btn);
  }
  await showPage(0);$('save').disabled=false;status(viewDoc.numPages+' página(s). Selecciona una herramienta.');
 }catch(e){status('No se pudo abrir el PDF: '+e.message)}
}
async function showPage(index){
 selectedPage=index;selected=null;
 const page=await viewDoc.getPage(index+1);
 const vp=page.getViewport({scale:1});const scale=Math.min(1.2,900/vp.width);
 const viewport=page.getViewport({scale});
 const c=$('pageCanvas');c.width=Math.ceil(viewport.width);c.height=Math.ceil(viewport.height);
 sheet.style.width=c.width+'px';sheet.style.height=c.height+'px';
 await page.render({canvasContext:c.getContext('2d'),viewport}).promise;
 [...$('thumbs').children].forEach((n,i)=>n.classList.toggle('active',i===index));
 renderItems();
}
function renderItems(){
 overlay.replaceChildren();
 for(const item of current()){
  const node=document.createElement('div');node.className='edit-item '+item.kind+(item===selected?' selected':'');
  node.style.left=(item.x*100)+'%';node.style.top=(item.y*100)+'%';
  node.style.width=(item.w*100)+'%';node.style.height=(item.h*100)+'%';
  if(item.kind==='text'){
    node.textContent=item.text;node.style.color='#182433';
    node.style.fontSize=Math.max(7,item.size*overlay.getBoundingClientRect().width/item.baseWidth)+'px';
    node.style.lineHeight='1.25';
  }
  node.onpointerdown=e=>{
    if(mode!=='select')return;
    e.stopPropagation();selected=item;renderItems();
    gesture={item,at:xy(e),x:item.x,y:item.y};
    overlay.setPointerCapture(e.pointerId);
  };
  overlay.append(node);
 }
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{
 mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));
 status(mode==='whiteout'?'Arrastra para cubrir el área incorrecta. Esta cobertura no sirve para censurar datos confidenciales.':mode==='text'?'Haz clic en la página para insertar el texto.':'Arrastra los elementos para ajustar su posición.');
});
overlay.addEventListener('pointerdown',e=>{
 if(!doc || mode==='select')return;
 const p=xy(e);
 if(mode==='text'){
  const page=doc.getPage(selectedPage);
  add({page:selectedPage,kind:'text',x:p.x,y:p.y,w:.42,h:.06,text:$('textValue').value,size:Number($('fontSize').value)||16,baseWidth:page.getWidth()});
 }else if(mode==='whiteout'){
  gesture={start:p,kind:'whiteout'};
  overlay.setPointerCapture(e.pointerId);
 }
});
overlay.addEventListener('pointermove',e=>{
 if(!gesture)return;
 const p=xy(e);
 if(gesture.item){
  gesture.item.x=Math.max(0,Math.min(1-gesture.item.w,gesture.x+p.x-gesture.at.x));
  gesture.item.y=Math.max(0,Math.min(1-gesture.item.h,gesture.y+p.y-gesture.at.y));
  renderItems();
 }
});
overlay.addEventListener('pointerup',e=>{
 if(!gesture)return;
 if(gesture.kind==='whiteout'){
  const p=xy(e),a=gesture.start;
  const w=Math.abs(p.x-a.x),h=Math.abs(p.y-a.y);
  if(w>.003&&h>.003)add({page:selectedPage,kind:'whiteout',x:Math.min(p.x,a.x),y:Math.min(p.y,a.y),w,h});
 }
 gesture=null;
});
$('undo').onclick=()=>{if(!items.length)return;items.pop();selected=null;renderItems()};
$('remove').onclick=()=>{if(!selected)return;items=items.filter(x=>x!==selected);selected=null;renderItems()};
$('file').onchange=e=>loadFile(e.target.files[0]);
$('save').onclick=async()=>{
 if(!doc)return;
 $('save').disabled=true;status('Guardando correcciones…');
 try{
  const result=await PDFLib.PDFDocument.load(original.slice());
  const font=await result.embedFont(PDFLib.StandardFonts.Helvetica);
  for(const item of items){
   const page=result.getPage(item.page),{width,height}=page.getSize();
   const x=item.x*width,y=(1-item.y-item.h)*height;
   if(item.kind==='whiteout')page.drawRectangle({x,y,width:item.w*width,height:item.h*height,color:PDFLib.rgb(1,1,1)});
   else if(item.kind==='text'){
    const maxWidth=item.w*width;const size=Math.max(6,Math.min(72,item.size));
    page.drawText(item.text||' ',{x,y:y+Math.max(0,item.h*height-size*1.2),size,font,color:PDFLib.rgb(.09,.14,.2),maxWidth,lineHeight:size*1.2});
   }
  }
  const bytes=await result.save(),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const link=document.createElement('a');link.href=url;link.download='GS_Studio_PDF_corregido.pdf';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);status('PDF corregido descargado. Comprueba las páginas antes de utilizarlo.');
 }catch(e){status('Error: '+e.message)}finally{$('save').disabled=false}
};
})();