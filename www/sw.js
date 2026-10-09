// Service worker (version web/PWA uniquement — désactivé dans l'APK, cf. IS_NATIVE_APP dans index.html).
// Stratégie "cache d'abord, réseau en secours" + mise à jour en tâche de fond.
// INCRÉMENTER CACHE_NAME à chaque version déployée, sinon les visiteurs gardent l'ancienne.
const CACHE_NAME = "selectionneur-v48";
const PRECACHE = [
  "./", "./index.html", "./manifest.json",
  "./vendor/three.min.js", "./js/stade3d.js", "./fonts/fonts.css",
  "./icons/icon-192.png", "./icons/icon-512.png", "./img/superessence.png",
];
self.addEventListener("install", (e)=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=> c.addAll(PRECACHE)).then(()=> self.skipWaiting()));
});
self.addEventListener("activate", (e)=>{
  e.waitUntil(caches.keys().then(keys=> Promise.all(keys.filter(k=> k!==CACHE_NAME).map(k=> caches.delete(k)))).then(()=> self.clients.claim()));
});
self.addEventListener("fetch", (e)=>{
  const req = e.request;
  if(req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE_NAME).then(async cache=>{
    const cached = await cache.match(req);
    const network = fetch(req).then(res=>{ if(res && res.ok) cache.put(req, res.clone()); return res; }).catch(()=> cached);
    return cached || network;
  }));
});
