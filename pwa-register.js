/* Register the installable application shell. No PDF or image data is cached. */
if('serviceWorker' in navigator && location.protocol==='https:'){
 window.addEventListener('load',()=>{
   navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(error=>{
     console.warn('GS Studio: no se pudo registrar el modo instalable',error);
   });
 });
}
