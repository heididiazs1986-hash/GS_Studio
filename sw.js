/* GS Studio PWA: public shell only; never caches personal PDFs, photos or uploads. */
const VERSION='gs-studio-shell-v1';
const PUBLIC_ASSETS=['/offline.html','/gs-studio/icons/pwa-192.png','/gs-studio/icons/pwa-512.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(PUBLIC_ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gs-studio-shell-')&&k!==VERSION).map(k=>caches.delete(k)))),self.clients.claim()]));
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET'||req.mode!=='navigate')return;
 const target=new URL(req.url);
 if(target.origin!==self.location.origin)return;
 event.respondWith(fetch(req).catch(()=>caches.match('/offline.html')));
});
