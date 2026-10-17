// CC Dental · web sin conexión · service worker (16/10/2026): guarda la página en la tablet para abrirla sin red.
// Los archivos de la página: primero lo guardado (abre al instante y sin red) y, con red, se actualizan para la próxima
// vez. Las llamadas a la puerta de entrada de Google (otro dominio) no pasan por aquí.
var CACHE = 'cc-dental-16102026-33.4';
var ARCHIVOS = ['./', 'index.html', 'cargador.js', 'app.js', 'manifest.webmanifest', 'icono.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  var clave = u.pathname.endsWith('/') ? './' : u.pathname.split('/').pop();
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(clave, { ignoreSearch: true }).then(function (guardado) {
      var red = fetch(e.request).then(function (r) { if (r && r.ok) c.put(clave, r.clone()); return r; }).catch(function () { return guardado; });
      return guardado || red;
    });
  }));
});
