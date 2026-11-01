// CC Dental · WEB SIN CONEXIÓN · arranque (16/10/2026).
// 1) registra el service worker (la página funciona sin red una vez abierta con red), 2) lee de la tablet el PAQUETE de
// datos (IndexedDB: instalaciones, instrumentos, controles anteriores y agenda) y 3) carga la página (app.js, generada a
// partir de appscript/CC_Web.html con el módulo de conexión sin conexión).
(function () {
  var VERSION = '25102026-38.5';
  function abrir() {
    return new Promise(function (ok, ko) {
      var r = indexedDB.open('cc_dental', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('datos'); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { ko(r.error); };
    });
  }
  window.CCDB = {
    leer: function (k) { return abrir().then(function (db) { return new Promise(function (ok, ko) { var q = db.transaction('datos').objectStore('datos').get(k); q.onsuccess = function () { ok(q.result); }; q.onerror = function () { ko(q.error); }; }); }); },
    guardar: function (k, v) { return abrir().then(function (db) { return new Promise(function (ok, ko) { var t = db.transaction('datos', 'readwrite'); t.objectStore('datos').put(v, k); t.oncomplete = function () { ok(); }; t.onerror = function () { ko(t.error); }; }); }); },
    borrar: function (k) { return abrir().then(function (db) { return new Promise(function (ok, ko) { var t = db.transaction('datos', 'readwrite'); t.objectStore('datos').delete(k); t.oncomplete = function () { ok(); }; t.onerror = function () { ko(t.error); }; }); }); }
  };
  function ls(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  // 23/10/2026: enlace de configuración «…/cc-dental/#api=<dirección>&tablet=A» (se manda por correo a la tablet): guarda la
  // dirección de la puerta de entrada y la tablet sin teclearlas. Lo que va tras «#» no sale del aparato (no llega a GitHub).
  // La clave NUNCA va en el enlace: se teclea en ⚙.
  try {
    var h = /[#&]api=([^&]+)/.exec(location.hash), tb = /[#&]tablet=([AB])/i.exec(location.hash);
    if (h) { localStorage.setItem('cc_off_api', decodeURIComponent(h[1])); }
    if (tb) { localStorage.setItem('cc_off_tablet', tb[1].toUpperCase()); }
    if (h || tb) { history.replaceState(null, '', location.pathname + location.search); }
  } catch (e) { }
  window.CFG = { api: ls('cc_off_api', ''), clave: ls('cc_off_clave', ''), tablet: ls('cc_off_tablet', 'A'), version: VERSION };
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(function () { }); }
  window.CCDB.leer('paquete').then(function (p) { window.PAQUETE = p || null; }, function () { window.PAQUETE = null; }).then(function () {
    var s = document.createElement('script'); s.src = 'app.js?v=' + VERSION;
    s.onload = function () { if (window.OFFLINE) window.OFFLINE.iniciar(); };
    document.body.appendChild(s);
  });
})();
