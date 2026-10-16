(()=>{
'use strict';
const { PDFDocument } = PDFLib;
const q=s=>document.querySelector(s);
const els={
  zipInput:q('#zipInput'),drop:q('#dropzone'),workspace:q('#workspace'),openCard:q('#openCard'),
  status:q('#statusPill'),legacy:q('#legacyBadge'),master:q('#masterGrid'),tabs:q('#docTabs'),
  fields:q('#docFields'),title:q('#docTitle'),meta:q('#docMeta'),summary:q('#summary'),packageTitle:q('#packageTitle'),
  save:q('#saveZipBtn'),reset:q('#resetBtn'),toast:q('#toast')
};
const S={sourceFile:null,zip:null,entries:new Map(),docs:new Map(),manifest:null,master:{},active:null};

const DOC_ORDER=['TD','E1','E6','AR','DJ','RETIE','EC'];
const masterDefs=[
 ['orden','Orden RO','text'],
 ['nombre','Nombre del usuario','text'],
 ['cedula','Identificación','text'],
 ['telefono','Contacto','text'],
 ['localidad','Localidad','text'],
 ['sector','Sector / barrio','text'],
 ['municipio','Municipio','text'],
 ['departamento','Departamento','text'],
 ['direccion','Dirección','text','full'],
 ['latitud','Latitud','text'],
 ['longitud','Longitud','text'],
 ['fecha','Fecha del documento','date'],
 ['tecnico','Técnico / gestor','text','full'],
 ['cedulaTecnico','Cédula del técnico','text'],
 ['profesion','Profesión','text'],
 ['consejo','Consejo','text'],
 ['matricula','Matrícula profesional','text','full'],
 ['fechaConstruccion','Fecha inicio construcción','date','full'],
 ['observaciones','Observaciones / hallazgos','textarea','full']
];
const linked=new Map();
const friendly={
 '1 Nombre o Razón Social':'Nombre o razón social','4 Número de Documento':'Número de documento','5 Dirección de quien radica':'Dirección de quien radica',
 '6 MunicipioLocalidad':'Municipio / localidad','8 Celular':'Celular','3 Localidad':'Localidad','4 Municipio':'Municipio','6 Dirección del predio':'Dirección del predio',
 'Coordenada X':'Longitud (X)','Coordenada Y':'Latitud (Y)','No de solicitud':'Número de solicitud / Orden RO','2 Fecha de solicitud de servicio':'Fecha de solicitud',
 'text_1xogj':'Nombre del proyecto','text_2gqcv':'Dirección','text_18ovuf':'Fecha del acta','textarea_22rqal':'Materiales requeridos','textarea_23tsxt':'Explicación de no aprobación',
 'text_27bpxy':'Nombre del solicitante','text_30sznp':'Técnico / gestor','text_329o6m':'Contacto',
 'text_6prgm':'Nombre del solicitante','text_7jdiv':'Identificación','text_1lojj':'Sector','text_2tgsw':'Localidad','text_3kjbx':'Municipio','text_4mqvb':'Dirección',
 'text_5yied':'Localidad / alcaldía','text_8ptdj':'Día','text_9ujpp':'Mes','text_10ipyf':'Año',
 'Nombre solicitante':'Nombre del solicitante','Identificacion':'Tipo de identificación','NumIdentificacion':'Número de identificación','Domicilio':'Domicilio',
 'Direccion':'Dirección','Descripcion':'Descripción del inmueble','Fechapropiedad':'Fecha desde la que posee el inmueble','LugarDom':'Lugar de posesión','Posesion':'Origen de la posesión',
 'LugarFirma':'Lugar de firma','FechaFirma':'Fecha de firma','Solicitante Firma':'Nombre bajo la firma',
 'retie_constructor':'Constructor / técnico','retie_const_identificacion':'Identificación del técnico','retie_matricula_const':'Matrícula profesional','retie_municipio':'Municipio',
 'retie_departamento':'Departamento','retie_fecha_construccion':'Fecha inicio construcción','retie_solicitante':'Propietario / solicitante','retie_identificacion':'Identificación propietario',
 'retie_dia':'Día','retie_mes':'Mes','retie_año':'Año','retie_ciudad':'Ciudad de firma','retie_prof_constructor':'Profesión','retie_consejo':'Consejo profesional','retie_direccion':'Dirección',
 'ec_fecha':'Fecha','ec_usuario':'Usuario','ec_identificacion':'Identificación','ec_municipio':'Municipio','ec_tecnico':'Técnico','ec_matricula':'Matrícula','ec_direccion':'Dirección',
 'ec_tecnico_1':'Técnico (cierre)','ec_identificacion_tecnico':'Identificación del técnico','ec_matricula_1':'Matrícula (cierre)',
 'orden_ro':'Orden RO','localidad':'Localidad','sector':'Sector','usuario':'Usuario','direccion':'Dirección','contacto':'Contacto','cedula':'Identificación','observaciones':'Hallazgos / observaciones',
 'text_232y0c':'Nombre titular autorización','text_245p3i':'Cédula titular autorización','text_275h9f':'Nombre bajo firma usuario','text_289o8f':'Cédula bajo firma usuario',
 'text_291t9n':'Nombre técnico / gestor','text_301t3m':'Cédula técnico / gestor','text_318x6q':'Fecha','text_331i7n':'ID interno'
};

const map={
 nombre:{E1:['1 Nombre o Razón Social'],E6:['text_27bpxy'],AR:['text_6prgm'],DJ:['Nombre solicitante','Solicitante Firma'],RETIE:['retie_solicitante'],EC:['ec_usuario'],TD:['usuario','text_232y0c','text_275h9f']},
 cedula:{E1:['4 Número de Documento'],AR:['text_7jdiv'],DJ:['NumIdentificacion'],RETIE:['retie_identificacion'],EC:['ec_identificacion'],TD:['cedula','text_245p3i','text_289o8f']},
 telefono:{E1:['8 Celular'],E6:['text_329o6m'],TD:['contacto']},
 localidad:{E1:['3 Localidad'],AR:['text_2tgsw','text_5yied'],TD:['localidad']},
 sector:{AR:['text_1lojj'],TD:['sector']},
 municipio:{E1:['6 MunicipioLocalidad','4 Municipio'],AR:['text_3kjbx'],RETIE:['retie_municipio','retie_ciudad'],EC:['ec_municipio']},
 departamento:{E1:['7 departamento','5 departamento'],RETIE:['retie_departamento']},
 direccion:{E1:['5 Dirección de quien radica','6 Dirección del predio'],E6:['text_2gqcv'],AR:['text_4mqvb'],DJ:['Direccion'],RETIE:['retie_direccion'],EC:['ec_direccion'],TD:['direccion']},
 latitud:{E1:['Coordenada Y']},longitud:{E1:['Coordenada X']},
 orden:{E1:['No de solicitud'],TD:['orden_ro']},
 tecnico:{E6:['text_30sznp'],RETIE:['retie_constructor'],EC:['ec_tecnico','ec_tecnico_1'],TD:['text_291t9n']},
 cedulaTecnico:{RETIE:['retie_const_identificacion'],EC:['ec_identificacion_tecnico'],TD:['text_301t3m']},
 profesion:{RETIE:['retie_prof_constructor']},consejo:{RETIE:['retie_consejo']},
 matricula:{RETIE:['retie_matricula_const'],EC:['ec_matricula','ec_matricula_1']},
 fechaConstruccion:{RETIE:['retie_fecha_construccion']},
 observaciones:{TD:['observaciones']}
};
Object.entries(map).forEach(([master,docs])=>Object.entries(docs).forEach(([doc,names])=>names.forEach(n=>linked.set(doc+'|'+n,master))));

function toast(msg){els.toast.textContent=msg;els.toast.classList.add('show');setTimeout(()=>els.toast.classList.remove('show'),2600)}
function docType(path){
 const n=path.split('/').pop().toUpperCase();
 if(n.startsWith('TD_'))return 'TD'; if(n==='E1.PDF')return 'E1'; if(n==='E6.PDF')return 'E6';
 if(n==='AR.PDF')return 'AR'; if(n==='DJ.PDF')return 'DJ'; if(n.startsWith('RETIE'))return 'RETIE'; if(n.startsWith('EC_'))return 'EC'; return n.replace('.PDF','');
}
function isoDate(v){
 if(!v)return '';
 const s=String(v).trim();
 let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return m[1]+'-'+m[2]+'-'+m[3];
 m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); if(m)return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
 return '';
}
function dmy(v){const s=isoDate(v);if(!s)return v||'';const [y,m,d]=s.split('-');return d+'/'+m+'/'+y}
function firstValue(doc,names){
 const d=S.docs.get(doc); if(!d)return '';
 for(const n of names){const f=d.fields.get(n);if(f && f.value!==undefined && f.value!==null && String(f.value)!=='')return String(f.value)}
 return '';
}
function setDocValue(doc,name,value){
 const d=S.docs.get(doc); if(!d)return; const f=d.fields.get(name); if(!f)return; f.value=value??'';
}
function extractField(field){
 const name=field.getName();
 if(typeof field.getText==='function')return {name,type:'text',value:field.getText()||''};
 if(typeof field.isChecked==='function')return {name,type:'checkbox',value:!!field.isChecked()};
 if(typeof field.getSelected==='function'){
   let v=field.getSelected(); if(Array.isArray(v))v=v[0]||''; return {name,type:'select',value:v||'',options:typeof field.getOptions==='function'?field.getOptions():[]};
 }
 if(typeof field.getOptions==='function')return {name,type:'select',value:'',options:field.getOptions()};
 return {name,type:'other',value:''};
}
async function loadPdf(path,bytes){
 const pdf=await PDFDocument.load(bytes,{ignoreEncryption:true,updateMetadata:false});
 const form=pdf.getForm(); const fields=new Map();
 for(const field of form.getFields()){
   const x=extractField(field); fields.set(x.name,x);
 }
 return {path,type:docType(path),original:bytes,fields,pages:pdf.getPageCount()};
}
function deriveMaster(){
 const manifest=S.manifest?.master||{};
 S.master={
   orden:manifest.orden||firstValue('TD',['orden_ro'])||firstValue('E1',['No de solicitud']),
   nombre:manifest.nombre||firstValue('TD',['usuario'])||firstValue('E1',['1 Nombre o Razón Social'])||firstValue('DJ',['Nombre solicitante']),
   cedula:manifest.cedula||firstValue('TD',['cedula'])||firstValue('E1',['4 Número de Documento']),
   telefono:manifest.telefono||firstValue('TD',['contacto'])||firstValue('E1',['8 Celular']),
   localidad:manifest.localidad||firstValue('TD',['localidad'])||firstValue('E1',['3 Localidad']),
   sector:manifest.sector||firstValue('TD',['sector'])||firstValue('AR',['text_1lojj']),
   municipio:manifest.municipio||firstValue('RETIE',['retie_municipio'])||firstValue('E1',['4 Municipio']),
   departamento:manifest.departamento||firstValue('RETIE',['retie_departamento'])||firstValue('E1',['7 departamento']),
   direccion:manifest.direccion||firstValue('E1',['6 Dirección del predio'])||firstValue('TD',['direccion']),
   latitud:manifest.latitud||firstValue('E1',['Coordenada Y']),
   longitud:manifest.longitud||firstValue('E1',['Coordenada X']),
   fecha:manifest.fecha||isoDate(firstValue('TD',['text_318x6q']))||isoDate(firstValue('E1',['2 Fecha de solicitud de servicio']))||'',
   tecnico:manifest.tecnico||firstValue('TD',['text_291t9n'])||firstValue('RETIE',['retie_constructor']),
   cedulaTecnico:manifest.cedulaTecnico||firstValue('TD',['text_301t3m'])||firstValue('RETIE',['retie_const_identificacion']),
   profesion:manifest.profesion||firstValue('RETIE',['retie_prof_constructor']),
   consejo:manifest.consejo||firstValue('RETIE',['retie_consejo']),
   matricula:manifest.matricula||firstValue('RETIE',['retie_matricula_const'])||firstValue('EC',['ec_matricula']),
   fechaConstruccion:manifest.fechaConstruccion||isoDate(firstValue('RETIE',['retie_fecha_construccion']))||'',
   observaciones:manifest.observaciones||firstValue('TD',['observaciones'])
 };
}
function applyMaster(key){
 const value=S.master[key]??''; const docs=map[key]||{};
 Object.entries(docs).forEach(([doc,names])=>names.forEach(n=>setDocValue(doc,n,value)));
 if(key==='fecha'){
   const iso=isoDate(value), [y,m,d]=iso?iso.split('-'):['','',''];
   setDocValue('TD','text_318x6q',iso);
   setDocValue('E1','2 Fecha de solicitud de servicio',dmy(iso));
   setDocValue('E6','text_18ovuf',dmy(iso));
   setDocValue('DJ','FechaFirma',dmy(iso));
   setDocValue('EC','ec_fecha',dmy(iso));
   setDocValue('AR','text_8ptdj',d);setDocValue('AR','text_9ujpp',m);setDocValue('AR','text_10ipyf',y);
   setDocValue('RETIE','retie_dia',d);setDocValue('RETIE','retie_mes',m);setDocValue('RETIE','retie_año',y);
 }
 if(key==='fechaConstruccion')setDocValue('RETIE','retie_fecha_construccion',dmy(value));
}
function renderMaster(){
 els.master.innerHTML='';
 for(const [key,label,type,cls] of masterDefs){
   const wrap=document.createElement('div');wrap.className='master-field '+(cls||'');
   const lab=document.createElement('label');lab.textContent=label;wrap.appendChild(lab);
   const input=type==='textarea'?document.createElement('textarea'):document.createElement('input');
   if(type==='date')input.type='date';
   input.value=S.master[key]||'';input.dataset.key=key;
   input.addEventListener('input',()=>{S.master[key]=input.value;applyMaster(key);renderActiveFields(false)});
   wrap.appendChild(input);els.master.appendChild(wrap);
 }
}
function renderTabs(){
 const docs=[...S.docs.values()].sort((a,b)=>DOC_ORDER.indexOf(a.type)-DOC_ORDER.indexOf(b.type));
 els.tabs.innerHTML='';
 docs.forEach(d=>{
   const b=document.createElement('button');
   b.className='doc-tab'+(S.active===d.type?' active':'');
   b.innerHTML=d.type+' <span class="count">'+visibleFieldCount(d)+'</span>';
   b.onclick=()=>{S.active=d.type;renderTabs();renderActiveFields(true)};
   els.tabs.appendChild(b);
 });
}
function editableLabel(doc,name){return friendly[name]||name}
function isAppField(docType,f){
  if(!f || f.type==='checkbox' || f.type==='other')return false;
  return !!friendly[f.name] || linked.has(docType+'|'+f.name);
}
function visibleFieldCount(d){
  return [...d.fields.values()].filter(f=>isAppField(d.type,f)).length;
}
function renderActiveFields(scroll){
 const d=S.docs.get(S.active); if(!d)return;
 const visible=visibleFieldCount(d);
 els.title.textContent=d.type;
 els.meta.textContent=d.path+' · '+d.pages+' pág. · '+visible+' campos editables de la app';
 els.fields.innerHTML='';
 [...d.fields.values()].forEach(f=>{
   if(!isAppField(d.type,f))return;
   const wrap=document.createElement('div');wrap.className='raw-field'+(linked.has(d.type+'|'+f.name)?' master-linked':'');
   const lab=document.createElement('label');lab.textContent=editableLabel(d.type,f.name);wrap.appendChild(lab);
   let input;
   if(f.type==='select'){
     input=document.createElement('select');const opts=[...new Set(['',...(f.options||[]),f.value||''])];opts.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v||'—';input.appendChild(o)});input.value=f.value||'';
   }else{
     input=document.createElement((String(f.value).length>130)?'textarea':'input');input.value=f.value||'';
   }
   input.oninput=()=>{
     f.value=f.type==='checkbox'?input.value==='true':input.value;
     const key=linked.get(d.type+'|'+f.name);
     if(key){
       S.master[key]=key==='fechaConstruccion'?isoDate(f.value):f.value;
       applyMaster(key);
       renderMaster();
       // Update siblings without rebuilding the focused document input.
       els.fields.querySelectorAll('[data-field-name]').forEach(el=>{
         if(el!==input)el.value=d.fields.get(el.dataset.fieldName)?.value??'';
       });
     }
   };
   input.dataset.fieldName=f.name;
   wrap.appendChild(input);
   const raw=document.createElement('div');raw.className='raw-name';raw.textContent=f.name+(linked.has(d.type+'|'+f.name)?' · vinculado a '+linked.get(d.type+'|'+f.name):'');wrap.appendChild(raw);
   els.fields.appendChild(wrap);
 });
 if(scroll)els.fields.scrollIntoView({behavior:'smooth',block:'start'});
}
async function openZip(file){
 try{
   els.status.textContent='Leyendo paquete…'; S.sourceFile=file;S.zip=await JSZip.loadAsync(file);S.entries.clear();S.docs.clear();S.manifest=null;
   const jobs=[];
   S.zip.forEach((path,entry)=>{if(!entry.dir)jobs.push((async()=>{
     const bytes=await entry.async('uint8array');S.entries.set(path,bytes);
     if(path.toUpperCase().endsWith('.PDF') && !path.toUpperCase().startsWith('SOPORTES/')){
       const doc=await loadPdf(path,bytes); if(!S.docs.has(doc.type))S.docs.set(doc.type,doc);
     }
     if(path.toUpperCase().endsWith('GS_REGISTRO.JSON')){
       try{S.manifest=JSON.parse(new TextDecoder().decode(bytes))}catch(_){}
     }
   })())});
   await Promise.all(jobs);
   if(!S.docs.size)throw new Error('No se encontraron PDF editables en el ZIP');
   deriveMaster();S.active=[...S.docs.keys()].sort((a,b)=>DOC_ORDER.indexOf(a)-DOC_ORDER.indexOf(b))[0];
   renderMaster();renderTabs();renderActiveFields(false);
   const supports=[...S.entries.keys()].filter(p=>p.toUpperCase().startsWith('SOPORTES/')&&!p.endsWith('/')).length;
   els.summary.textContent=S.docs.size+' documentos · '+supports+' soportes';
   els.packageTitle.textContent=file.name;
   els.legacy.textContent=S.manifest?'ZIP con ficha maestra':'ZIP legado · reconstruido desde PDF';
   els.legacy.style.display='';
   els.workspace.classList.remove('hidden');els.openCard.classList.add('hidden');els.status.textContent='Paquete listo para editar';
   toast('ZIP cargado. El original permanecerá intacto.');
 }catch(e){console.error(e);els.status.textContent='No se pudo abrir';toast('No fue posible abrir el ZIP: '+e.message)}
}
async function writeField(pdf,fieldModel){
 let field; try{field=pdf.getForm().getField(fieldModel.name)}catch(_){return}
 try{
   if(typeof field.setText==='function'){field.setText(String(fieldModel.value??''));return}
   if(typeof field.check==='function'){fieldModel.value?field.check():field.uncheck();return}
   if(typeof field.select==='function'){
     const value=String(fieldModel.value??'');
     if(value!=='')field.select(value);
     else if(typeof field.clear==='function')field.clear();
     else if(typeof field.clearSelected==='function')field.clearSelected();
     else throw new Error('El campo no permite borrar la selección');
     return;
   }
 }catch(e){throw new Error('No se pudo actualizar '+fieldModel.name+': '+e.message)}
}
async function saveZip(){
 try{
   for(const [key,limit] of [['latitud',90],['longitud',180]]){
     const value=String(S.master[key]??'').trim().replace(',','.');
     if(value && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)||!Number.isFinite(Number(value))||Math.abs(Number(value))>limit))
       throw new Error(key==='latitud'?'Latitud inválida':'Longitud inválida');
     S.master[key]=value;
   }
   els.save.disabled=true;els.save.textContent='Generando…';Object.keys(S.master).forEach(applyMaster);
   const out=new JSZip();
   for(const [path,bytes] of S.entries){
     if(path.toUpperCase().endsWith('.PDF') && !path.toUpperCase().startsWith('SOPORTES/')){
       const type=docType(path), model=S.docs.get(type);
       if(model){
         const pdf=await PDFDocument.load(model.original,{ignoreEncryption:true,updateMetadata:false});
         for(const f of model.fields.values())await writeField(pdf,f);
         const saved=await pdf.save({updateFieldAppearances:true,useObjectStreams:false});
         out.file(path,saved);continue;
       }
     }
     if(!path.toUpperCase().endsWith('GS_REGISTRO.JSON'))out.file(path,bytes);
   }
   const manifest={schema:'gs-documentos-editor/1',createdAt:new Date().toISOString(),sourceFile:S.sourceFile?.name||'',master:S.master,documents:{}};
   for(const [type,d] of S.docs)manifest.documents[type]={path:d.path,fields:Object.fromEntries([...d.fields].map(([k,v])=>[k,{type:v.type,value:v.value}]))};
   out.file('GS_REGISTRO.json',JSON.stringify(manifest,null,2));
   const blob=await out.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
   const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;
   const base=(S.sourceFile?.name||'GS_Documentos.zip').replace(/\.zip$/i,'');a.download=base+'_CORREGIDO.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    // GS Studio opt-in bridge: deliver a COPY only when this editor is embedded by the same-origin studio.
    if(window.parent!==window){window.parent.postMessage({type:'GS_STUDIO_CORRECTED_ZIP',blob,filename:a.download},window.location.origin);}
   toast('ZIP corregido generado. El paquete original no fue modificado.');
 }catch(e){console.error(e);toast('Error al generar el ZIP corregido: '+e.message)}
 finally{els.save.disabled=false;els.save.textContent='Generar ZIP corregido'}
}
function reset(){location.reload()}
els.zipInput.onchange=()=>els.zipInput.files?.[0]&&openZip(els.zipInput.files[0]);
['dragenter','dragover'].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.add('drag')}));
['dragleave','drop'].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.remove('drag')}));
els.drop.addEventListener('drop',e=>{const f=[...e.dataTransfer.files].find(x=>/\.zip$/i.test(x.name));if(f)openZip(f);else toast('Selecciona un archivo ZIP')});
els.save.onclick=saveZip;els.reset.onclick=reset;
})();