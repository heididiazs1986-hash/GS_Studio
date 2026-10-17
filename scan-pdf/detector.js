/* Escáner GS Studio: detector opcional de documentos en el propio celular.
 * OpenCV.js se descarga como motor de visión; nunca se envían fotos a OpenCV.
 */
(function(root){
"use strict";
let engine=null,loading=null;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function orderCorners(points){
 if(!Array.isArray(points)||points.length!==4)return null;
 // Select top/bottom rows by y; this is stable for ordinary paper perspective.
 const top=points.slice().sort((a,b)=>a.y-b.y).slice(0,2).sort((a,b)=>a.x-b.x);
 const bottom=points.slice().sort((a,b)=>a.y-b.y).slice(2).sort((a,b)=>a.x-b.x);
 return [top[0],top[1],bottom[1],bottom[0]];
}
function scoreCorners(p){
 if(!p)return 0;
 const side=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const area=Math.abs(p.reduce((v,a,i)=>v+a.x*p[(i+1)%4].y-p[(i+1)%4].x*a.y,0))/2;
 if(area<.10||area>.97)return 0;
 if(p.some((q,i)=>cross(q,p[(i+1)%4],p[(i+2)%4])<=0))return 0;
 if(p.some(q=>q.x<.005||q.x>.995||q.y<.005||q.y>.995))return 0;
 const lengths=[side(p[0],p[1]),side(p[1],p[2]),side(p[2],p[3]),side(p[3],p[0])];
 if(Math.min(...lengths)<.15)return 0;
 const center=p.reduce((q,r)=>({x:q.x+r.x/4,y:q.y+r.y/4}),{x:0,y:0});
 const central=1-Math.min(1,Math.hypot(center.x-.5,center.y-.5)*1.6);
 return area*(.8+.2*central);
}
async function load(){
 if(engine)return engine;
 if(loading)return loading;
 loading=new Promise((resolve,reject)=>{
   const script=document.createElement("script");
   script.src="https://docs.opencv.org/4.10.0/opencv.js";
   script.async=true;
   script.onerror=()=>reject(Error("No se pudo descargar OpenCV.js"));
   script.onload=async()=>{
     try{
       let cv=root.cv;
       if(cv&&typeof cv.then==="function")cv=await cv;
       if(cv?.Mat){engine=cv;resolve(cv);return;}
       if(!cv)throw Error("Motor de visión no disponible");
       const timeout=setTimeout(()=>reject(Error("OpenCV tardó demasiado en iniciar")),12000);
       const original=cv.onRuntimeInitialized;
       cv.onRuntimeInitialized=()=>{
         clearTimeout(timeout);if(typeof original==="function")original();
         if(!cv.Mat)return reject(Error("OpenCV no está listo"));
         engine=cv;resolve(cv);
       };
     }catch(err){reject(err);}
   };
   document.head.append(script);
 });
 try{return await loading}catch(e){loading=null;throw e}
}
function detect(canvas){
 if(!engine)return null;
 const cv=engine;
 let src,gray,blur,edges,kernel,contours,hierarchy;
 try{
   src=cv.imread(canvas);
   gray=new cv.Mat();blur=new cv.Mat();edges=new cv.Mat();
   kernel=cv.Mat.ones(3,3,cv.CV_8U);
   cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
   cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
   cv.Canny(blur,edges,45,130);
   cv.dilate(edges,edges,kernel);
   contours=new cv.MatVector();hierarchy=new cv.Mat();
   cv.findContours(edges,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
   let best=null,bestScore=0;
   for(let i=0;i<contours.size();i++){
     const contour=contours.get(i);
     let approx;
     try{
       const perimeter=cv.arcLength(contour,true);
       const rawArea=Math.abs(cv.contourArea(contour));
       if(rawArea<src.cols*src.rows*.09)continue;
       approx=new cv.Mat();
       cv.approxPolyDP(contour,approx,.022*perimeter,true);
       if(approx.rows!==4||!cv.isContourConvex(approx))continue;
       const raw=[];
       for(let j=0;j<4;j++)raw.push({x:approx.intPtr(j,0)[0]/src.cols,y:approx.intPtr(j,0)[1]/src.rows});
       const quad=orderCorners(raw),quality=scoreCorners(quad);
       if(quality>bestScore){bestScore=quality;best=quad}
     }finally{approx?.delete();contour.delete();}
   }
   return bestScore>.115?{corners:best,confidence:Math.min(1,bestScore/.42)}:null;
 }catch(error){
   console.warn("GS Studio: detección de documento no disponible",error);
   return null;
 }finally{
   for(const m of [src,gray,blur,edges,kernel,contours,hierarchy]){try{m?.delete()}catch(_){}}
 }
}
root.GSScannerDetector={load,detect,scoreCorners,orderCorners,get ready(){return !!engine}};
})(window);