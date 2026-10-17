// MÓDULO DE CONEXIÓN — VERSIÓN SIN CONEXIÓN (16/10/2026). Sustituye al bloque CONEXION de la página online (misma forma
// que google.script.run). Los datos salen del PAQUETE guardado en la tablet; lo que se envía va a una COLA en la tablet y
// se manda a la puerta de entrada de Google (CC_API.gs, con clave) en cuanto hay conexión.
var PAQUETE = window.PAQUETE || null;
function marcaAhora() { var d = new Date(), z = function (n) { return ('0' + n).slice(-2); }; return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()); }
var COLA = {
  leer: function () { try { return JSON.parse(localStorage.getItem('cc_off_cola') || '[]'); } catch (e) { return []; } },
  guardar: function (l) { localStorage.setItem('cc_off_cola', JSON.stringify(l)); },
  poner: function (x) {
    // los borradores de una instalación y técnico se sustituyen (solo cuenta el último); borrar anula el borrador pendiente
    var l = COLA.leer().filter(function (y) { return !((x.tipo === 'borrador' || x.tipo === 'borrar') && (y.tipo === 'borrador' || y.tipo === 'borrar') && y.cod === x.cod && y.tec === x.tec); });
    l.push(x); COLA.guardar(l); if (window.OFFLINE) OFFLINE.barra();
  },
  envios: function () { return COLA.leer().filter(function (y) { return y.tipo === 'enviar'; }).length; }
};
function llamarApi(datos) {   // POST con texto (sin «preflight» CORS); la respuesta de Apps Script es JSON
  if (!CFG.api || !CFG.clave) return Promise.reject(new Error('Falta configurar la dirección y la clave'));
  return fetch(CFG.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ clave: CFG.clave }, datos)) })
    .then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error); return j; });
}
var CONEXION = (function () {
  function R(ok, ko) { this.ok = ok; this.ko = ko; }
  R.prototype.withSuccessHandler = function (f) { return new R(f, this.ko); };
  R.prototype.withFailureHandler = function (f) { return new R(this.ok, f); };
  function responder(r, fn) { setTimeout(function () { var v; try { v = fn(); } catch (e) { if (r.ko) r.ko(e); return; } if (r.ok) r.ok(v); }, 0); }
  R.prototype.datosAnteriores = function (cod) { responder(this, function () { return ((PAQUETE && PAQUETE.anteriores) || {})[String(cod || '').split(' · ')[0].trim().toUpperCase()] || null; }); };
  R.prototype.guardarControlWeb = function (json) { responder(this, function () { var m = marcaAhora(); COLA.poner({ tipo: 'enviar', json: json, marca: m }); OFFLINE.pronto(); return m + ' · guardado en la tablet: se enviará solo en cuanto haya conexión'; }); };
  R.prototype.guardarBorradorWeb = function (cod, json, tec) { responder(this, function () { COLA.poner({ tipo: 'borrador', cod: cod, json: json, tec: tec || '' }); OFFLINE.pronto(); return marcaAhora().slice(0, 16) + ' en la tablet (se subirá a Google al tener conexión)'; }); };
  R.prototype.borrarBorradorWeb = function (cod, tec) { responder(this, function () { COLA.poner({ tipo: 'borrar', cod: cod, tec: tec || '' }); OFFLINE.pronto(); return true; }); };
  R.prototype.leerBorradoresWeb = function (cod) {   // con conexión, los de Google (otro ordenador o tablet); sin conexión, ninguno (los de esta tablet ya los ve la página)
    var me = this;
    if (!navigator.onLine || !CFG.api) { responder(me, function () { return []; }); return; }
    llamarApi({ accion: 'leerBorradores', cod: cod }).then(function (j) { if (me.ok) me.ok(j.borradores || []); }, function () { if (me.ok) me.ok([]); });
  };
  return { modo: 'offline', run: function () { return new R(null, null); } };
})();

// ---------- barra de la versión sin conexión: estado, agenda, sincronizar y configurar
var OFFLINE = {
  enCurso: false, temporizador: null,
  pronto: function () { clearTimeout(OFFLINE.temporizador); OFFLINE.temporizador = setTimeout(function () { OFFLINE.sincronizar(false); }, 1500); },
  edadDias: function () { return PAQUETE && PAQUETE.generado ? (Date.now() - new Date(PAQUETE.generado.replace(' ', 'T')).getTime()) / 864e5 : Infinity; },
  barra: function () {
    var b = document.getElementById('offbar'); if (!b) return;
    var n = COLA.envios(), bor = COLA.leer().length - n, edad = OFFLINE.edadDias();
    b.innerHTML = '<b>Tablet ' + CFG.tablet + '</b> · ' + (PAQUETE ? 'datos del ' + (PAQUETE.datosDe || PAQUETE.generado) : '<span style="color:#FFC7CE">sin datos</span>') +
      ' · ' + (navigator.onLine ? 'con conexión' : '<span style="color:#FFEB9C">sin conexión</span>') +
      ' · <span' + (n ? ' style="color:#FFEB9C;font-weight:700"' : '') + '>' + n + ' control(es) pendiente(s) de enviar</span>' + (bor ? ' · ' + bor + ' borrador(es) por subir' : '') +
      (PAQUETE && edad > 30 ? ' · <span style="color:#FFC7CE;font-weight:700">datos caducados: sincronice con wifi</span>' : '') +
      (OFFLINE.recargar ? ' <button type="button" onclick="guardarBorrador(); location.reload()" style="background:#FFEB9C;color:#000;font-weight:700;border-color:#FFEB9C">⟳ Datos nuevos: recargar ahora</button>' : '') +
      ' <button type="button" onclick="OFFLINE.verAgenda()">📅 Agenda</button> <button type="button" onclick="OFFLINE.sincronizar(true)">🔄 Sincronizar</button> <button type="button" onclick="OFFLINE.configurar()">⚙</button>' +
      (OFFLINE.enCurso ? ' <i>sincronizando…</i>' : '');
  },
  sincronizar: function (manual) {
    if (OFFLINE.enCurso) return; if (!CFG.api || !CFG.clave) { if (manual) OFFLINE.configurar(); return; }
    if (!navigator.onLine) { if (manual) aviso('Sin conexión: los envíos siguen guardados en la tablet y saldrán solos al conectarse a una wifi.', false); return; }
    OFFLINE.enCurso = true; OFFLINE.barra();
    var enviados = 0, fallo = null;
    var siguiente = function () {
      var l = COLA.leer(); if (!l.length) return Promise.resolve();
      var x = l[0], p = x.tipo === 'enviar' ? llamarApi({ accion: 'enviar', json: x.json }) : x.tipo === 'borrador' ? llamarApi({ accion: 'guardarBorrador', cod: x.cod, json: x.json, tec: x.tec }) : llamarApi({ accion: 'borrarBorrador', cod: x.cod, tec: x.tec });
      return p.then(function () { if (x.tipo === 'enviar') enviados++; COLA.guardar(COLA.leer().slice(1)); OFFLINE.barra(); return siguiente(); });
    };
    var url = function (q) { return CFG.api + (CFG.api.indexOf('?') < 0 ? '?' : '&') + q + '&clave=' + encodeURIComponent(CFG.clave); };
    var paquete = function () {
      // 17/10/2026: al abrir con conexión pregunta a Google la fecha de sus datos y solo descarga si son más nuevos que los de
      // la tablet (gasta muy poco también con el móvil); si la puerta de entrada no lo sabe responder, regla antigua de 12 h
      if (!manual && PAQUETE) return fetch(url('accion=estado')).then(function (r) { return r.json(); })
        .then(function (e) { return e && !e.error && e.datosDe ? e.datosDe : null; }, function () { return null; })
        .then(function (d) { return d === null ? (OFFLINE.edadDias() < 0.5 ? false : descargar()) : (d > (PAQUETE.datosDe || '') ? descargar() : false); });
      return descargar();
    };
    var descargar = function () {
      return fetch(CFG.api + (CFG.api.indexOf('?') < 0 ? '?' : '&') + 'accion=paquete&tablet=' + encodeURIComponent(CFG.tablet) + '&clave=' + encodeURIComponent(CFG.clave))
        .then(function (r) { return r.json(); }).then(function (p) { if (p.error) throw new Error(p.error); return CCDB.guardar('paquete', p).then(function () { var nuevo = !PAQUETE || PAQUETE.generado !== p.generado; PAQUETE = window.PAQUETE = p; return nuevo; }); });
    };
    siguiente().then(paquete).then(function (nuevo) {
      OFFLINE.enCurso = false; OFFLINE.barra();
      if (enviados) aviso('<b>✔ ' + enviados + ' control(es) enviado(s) a la oficina.</b>', true);
      if (nuevo && !hayDatos() && !COLA.leer().length) { location.reload(); return; }   // nada escrito: se recarga sola con los datos nuevos
      if (nuevo) { OFFLINE.recargar = true; OFFLINE.barra(); window.scrollTo(0, 0); }   // botón destacado en la barra fija de arriba (siempre visible)
      if (nuevo) preguntar('Datos de la tablet actualizados (' + (PAQUETE.datosDe || PAQUETE.generado) + '). Para usarlos hay que recargar la página' + (hayDatos() ? ' (lo escrito queda guardado en la tablet)' : '') + '.', [['Recargar ahora', function () { guardarBorrador(); location.reload(); }], ['Más tarde', function () { }]]);
      else if (manual && !enviados) aviso('Sincronizado: no había nada pendiente y los datos ya estaban al día.', true);
    }, function (e) {
      OFFLINE.enCurso = false; OFFLINE.barra();
      if (manual || enviados) aviso((enviados ? '<b>✔ ' + enviados + ' control(es) enviado(s).</b> ' : '') + 'No se ha podido terminar de sincronizar: ' + (e && e.message ? e.message : e) + '. Lo pendiente sigue en la tablet.', false);
    });
  },
  verAgenda: function () {
    var c = document.getElementById('offagenda'); if (!c) return;
    if (c.style.display === 'block') { c.style.display = 'none'; return; }
    var ag = (PAQUETE && PAQUETE.agenda) || [], hoy = new Date().toISOString().slice(0, 10), dias = {};
    ag.forEach(function (x) { (dias[x.dia] = dias[x.dia] || []).push(x); });
    var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
    c.innerHTML = '<h2 style="margin:0 0 8px">Agenda de la tablet ' + CFG.tablet + '</h2>' + (ag.length ? Object.keys(dias).sort().map(function (dia) {
      var f = dia.split('-').reverse().join('/');
      return '<h3>' + (dia === hoy ? 'Hoy, ' : '') + f + '</h3>' + dias[dia].map(function (x) {
        return '<div class="cita" onclick="OFFLINE.elegir(\'' + esc(x.cod).replace(/'/g, '') + '\', \'' + dia + '\')"><b>' + esc(x.hora) + ' · ' + esc(x.cod) + '</b> · ' + esc(x.titular) + '<br><span>' + esc([x.dir, x.pob].filter(Boolean).join(', ')) + (x.tel ? ' · ☎ ' + esc(x.tel) : '') + (x.contacto ? ' · ' + esc(x.contacto) : '') + ' · ' + esc(x.tecnico) + '</span></div>';
      }).join('');
    }).join('') : '<p class="ayuda">No hay citas en la agenda de esta tablet. Sincronice con wifi para actualizarla.</p>') + '<p><button type="button" onclick="document.getElementById(\'offagenda\').style.display=\'none\'">Cerrar</button></p>';
    c.style.display = 'block'; window.scrollTo(0, 0);
  },
  elegir: function (cod, dia) {
    document.getElementById('offagenda').style.display = 'none';
    var inst = INSTALACIONES.filter(function (o) { return o.split(' · ')[0].trim().toUpperCase() === cod; })[0] || cod, ei = document.getElementById('inst');
    window.FECHA_PROPUESTA = dia || null;   // la página la pone como fecha del control al cargar la instalación
    ei.value = inst; pedirAnteriores();
  },
  configurar: function () {
    // ventana fija encima de todo (16/10/2026): dentro de la página, otros avisos la desplazaban y no se veía al abrir
    var c = document.getElementById('offcfg');
    if (!c) { c = el('div', { id: 'offcfg' }); document.body.appendChild(c); }
    c.innerHTML = '<div class="tarjeta"><h2 style="margin:0 0 8px">Configuración de esta tablet</h2>' +
      (CFG.api && CFG.clave ? '' : '<p>Para empezar, escriba la dirección y la clave que le da la oficina y pulse «Guardar y sincronizar» (con wifi).</p>') +
      '<div class="fila"><div class="campo ancho"><label>Dirección de la puerta de entrada (la da la oficina)</label><input id="cfg_api" value="' + (CFG.api || '').replace(/"/g, '&quot;') + '"></div>' +
      '<div class="campo"><label>Clave</label><input id="cfg_clave" type="password" value="' + (CFG.clave || '').replace(/"/g, '&quot;') + '"></div>' +
      '<div class="campo"><label>Tablet</label><select id="cfg_tablet"><option' + (CFG.tablet === 'A' ? ' selected' : '') + '>A</option><option' + (CFG.tablet === 'B' ? ' selected' : '') + '>B</option></select></div></div>' +
      '<p><button type="button" onclick="OFFLINE.guardarCfg()">Guardar y sincronizar</button> <button type="button" onclick="OFFLINE.borrarTodo()">Borrar todos los datos de esta tablet</button> <button type="button" onclick="document.getElementById(\'offcfg\').style.display=\'none\'">Cerrar</button></p></div>';
    c.style.display = 'block';
  },
  guardarCfg: function () {
    CFG.api = v(document.getElementById('cfg_api')); CFG.clave = v(document.getElementById('cfg_clave')); CFG.tablet = v(document.getElementById('cfg_tablet')) || 'A';
    localStorage.setItem('cc_off_api', CFG.api); localStorage.setItem('cc_off_clave', CFG.clave); localStorage.setItem('cc_off_tablet', CFG.tablet);
    document.getElementById('offcfg').style.display = 'none'; OFFLINE.barra(); OFFLINE.sincronizar(true);
  },
  borrarTodo: function () {
    var b = event && event.target; if (b && !b.getAttribute('data-seguro')) { b.setAttribute('data-seguro', '1'); b.textContent = '¿Seguro? Se perderán los controles sin enviar. Pulse otra vez'; b.style.color = '#C00000'; return; }
    CCDB.borrar('paquete').then(function () { Object.keys(localStorage).forEach(function (k) { if (/^cc_/.test(k)) localStorage.removeItem(k); }); location.reload(); });
  },
  iniciar: function () {
    var b = el('div', { id: 'offbar' }); document.body.insertBefore(b, document.body.firstChild);
    var a = el('div', { id: 'offagenda', 'class': 'tarjeta' }); a.style.display = 'none'; document.querySelector('main').insertBefore(a, document.querySelector('main').firstChild);
    OFFLINE.barra();
    window.addEventListener('online', function () { OFFLINE.barra(); OFFLINE.sincronizar(false); });
    window.addEventListener('offline', function () { OFFLINE.barra(); });
    setInterval(function () { if (navigator.onLine && COLA.leer().length) OFFLINE.sincronizar(false); }, 5 * 60000);
    if (!CFG.api || !CFG.clave) OFFLINE.configurar();
    else if (!PAQUETE) { aviso('Esta tablet aún no tiene datos: conéctela a una wifi y pulse «🔄 Sincronizar».', false); OFFLINE.sincronizar(false); }
    else if (OFFLINE.edadDias() > 30) { aviso('Los datos de esta tablet tienen más de 30 días: no se pueden usar hasta sincronizar con wifi.', false); INSTALACIONES.length = 0; document.getElementById('lista-inst').innerHTML = ''; }
    else OFFLINE.sincronizar(false);
    var q = /[?&]inst=([^&]+)/.exec(location.search); if (q) OFFLINE.elegir(decodeURIComponent(q[1]).toUpperCase(), '');
  }
};

var INSTALACIONES = ((PAQUETE && PAQUETE.instalaciones) || []);
// técnicos e instrumentos (13/10/2026; de Access: Config CC_Tecnico_n + tabla INSTRUMENTACIÓN):
// {tecnico, ne: nº instrumento de los equipos, te: su texto, ns: nº del de las salas, ts: su texto}
var INSTRUMENTOS = ((PAQUETE && PAQUETE.instrumentos) || []);
function instrDe(t) { for (var i = 0; i < INSTRUMENTOS.length; i++) if (INSTRUMENTOS[i].tecnico === t) return INSTRUMENTOS[i]; return null; }
function esInstrConocido(v) { v = String(v || '').trim(); if (!v) return true; return INSTRUMENTOS.some(function (x) { return String(x.ne) === v || String(x.ns) === v; }); }
function esTextoConocido(v) { v = String(v || '').trim(); if (!v) return true; return INSTRUMENTOS.some(function (x) { return x.te === v || x.ts === v; }); }
// IDENTIFICACIÓN COMPLETA (14/10/2026): campos de la hoja Identificación de la plantilla
var IDENT = ['ncontrol', 'motivo', 'mmarca', 'mserie', 'mfc', 'maniqui', 'omarca', 'oserie', 'ofc', 'obsgen'];
// «Unfors XI n:150207 FC:20/01/26» → [marca/modelo, nº de serie, calibración]
function partesInstr(t) {
  t = String(t || ''); var serie = (t.match(/\bn[º°o]?\s*:\s*(\S+)/i) || [])[1] || '', fc = (t.match(/FC\s*:\s*(\S+)/i) || [])[1] || '';
  return [t.replace(/\bn[º°o]?\s*:\s*\S+/i, '').replace(/FC\s*:\s*\S+/i, '').replace(/\s+/g, ' ').trim(), serie, fc];
}
function sugSiLibre(id, val) { var e = document.getElementById(id); if (e && val && (!e.value || e.value === e.getAttribute('data-sug'))) { e.value = val; e.setAttribute('data-sug', val); } }
// texto del equipo de medida para la base antigua (REVISIONES.[Equipo de medida])
function textoMedidor() {
  var a = v(document.getElementById('mmarca')), sr = v(document.getElementById('mserie')), f = v(document.getElementById('mfc'));
  return a ? [a, sr ? 'n:' + sr : '', f ? 'FC:' + f : ''].filter(Boolean).join(' ') : v(document.getElementById('medidor'));
}
// datos de la instalación que vienen de la base (titular, NIF/CIF, registro, dirección): solo se muestran
function pintarCab() {
  var c = (ANT && ANT.cab) || {}, e = document.getElementById('cabinst'); if (!e) return;
  var l = [['Titular', c.tit], ['NIF/CIF', c.nif], ['Nº de registro RX', c.reg], ['Dirección', [c.dir, c.mun].filter(Boolean).join(', ')], ['Nº de cliente', c.ncli]].filter(function (x) { return x[1]; });
  e.innerHTML = l.length ? l.map(function (x) { return '<b>' + x[0] + ':</b> ' + String(x[1]).replace(/</g, '&lt;'); }).join(' · ') + ' <span style="color:#888">(de la base de datos; se corrigen en la oficina)</span>' : '';
}
// rellena equipo de medida e instrumento (de equipos y filtración) con los del técnico; no pisa lo escrito a mano
function aplicarTecnico(soloEquipo) {
  var x = instrDe(document.getElementById('tecnico').value); if (!x) return;
  var m = document.getElementById('medidor'); if (!soloEquipo && esTextoConocido(m.value)) m.value = x.te;
  if (!soloEquipo) {   // instrumentación desglosada (14/10/2026), sugerida del técnico
    var pa = partesInstr(x.te), pb = partesInstr(x.ts);
    ['mmarca', 'mserie', 'mfc'].forEach(function (k, i) { sugSiLibre(k, pa[i]); }); ['omarca', 'oserie', 'ofc'].forEach(function (k, i) { sugSiLibre(k, pb[i]); });
  }
  var raiz = soloEquipo ? [soloEquipo] : document.querySelectorAll('.tarjeta.equipo');
  Array.prototype.forEach.call(raiz, function (t) {
    ['[data-k="instr"]', '[data-f="instr"]'].forEach(function (sel) { var c = t.querySelector(sel); if (c && esInstrConocido(c.value)) c.value = x.ne; });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.monitor-sala'), function (e) { e.textContent = x.ts ? 'Monitor de radiación: ' + x.ts + ' (nº ' + x.ns + ')' : ''; });
  guardarBorrador();
}
var LETRAS_SALA = 'ABCDEFGHIJKLMNOPQRS'.split(''), LETRAS_PUNTO = 'ABCDEFGHIJ'.split('');
var CAMPOS_DISPARO = [['kvf','kVp fijado'],['maf','mA fijado'],['tf','t fijado (s)'],['kvm','kVp medio medido'],['tm','Tiempo medido'],['dosis','Dosis (mGy)'],['dist','Distancia tubo–equipo (cm)']];
var nEq = 0, nSa = 0;
var LECT_DISPARO = ['kvm', 'tm', 'dosis'], TEC_DISPARO = ['kvf', 'maf', 'tf', 'dist'];
var UMBRAL = 0.15, UMBRAL_SALA = 0.30;   // como en el libro Excel: violeta si la lectura se aleja más de esto de la anterior
var ANT = null;                           // datos de la instalación elegida (equipos del censo y su último control)

// ---- prerrelleno desde la base (13/10/2026): equipos del censo y último control antiguo de la instalación
function sug(e, val) { if (!e || val === undefined || val === null || val === '') return; e.value = val; e.setAttribute('data-sug', val); }
function ant(e, val) {
  if (!e || val === undefined || val === null || val === '') return;
  e.setAttribute('data-ant', val);
  var s = el('span', { 'class': 'ant' }); s.textContent = 'ant. ' + val; e.parentNode.appendChild(s);
}
function hayDatos() {
  return Array.prototype.some.call(document.querySelectorAll('#equipos input, #salas input, #equipos select, #salas select'), function (e) {
    return e.value && !e.getAttribute('data-sug') && !(e.getAttribute('data-def') === '1' && e.value === '2') && !/instr/.test(e.getAttribute('data-k') || e.getAttribute('data-f') || ''); });   // 15/10/2026: el espesor por defecto no cuenta
}
// PREGUNTAS EN LA PÁGINA (15/10/2026): botones bajo la instalación en lugar de confirm(), que dentro del marco de
// Google puede no mostrarse (la página se quedaba parada sin avisar). traza(): pasos en la consola con «[CC]».
function traza(m) { try { console.log('[CC] ' + m); } catch (e) { } }
function preguntar(html, botones, destino) {
  var c = document.getElementById(destino || 'cargando'); c.className = 'cargando pregunta'; c.innerHTML = '<b>' + html + '</b>';
  botones.forEach(function (b) { var x = el('button', { type: 'button' }); x.textContent = b[0]; x.onclick = function () { c.className = 'cargando'; c.textContent = ''; b[1](); }; c.appendChild(x); });
  c.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
window.addEventListener('error', function (ev) { try { aviso('<b>Error en la página:</b> ' + ev.message + ' (línea ' + ev.lineno + '). Avise a la oficina con este texto.', false); } catch (x) { } });
function pedirAnteriores() {
  var ei = document.getElementById('inst'), inst = ei.value.trim(), cg = document.getElementById('cargando');
  if (INSTALACIONES.indexOf(inst) < 0) {   // 15/10/2026: también vale escribir solo el código
    var cc = inst.split(' · ')[0].trim().toUpperCase(), hall = INSTALACIONES.filter(function (o) { return o.split(' · ')[0].trim().toUpperCase() === cc; })[0];
    if (!hall) { if (inst) cg.textContent = 'No se encuentra «' + inst + '» en la lista de instalaciones: escriba el código y elija la línea del desplegable.'; return; }
    ei.value = inst = hall;
  }
  var cod = inst.split(' · ')[0].trim();
  if (ANT && ANT._cod === cod && instVigente === inst && document.querySelector('.tarjeta.equipo [data-k="id"]') && v(document.querySelector('.tarjeta.equipo [data-k="id"]'))) return;   // ya cargada
  if (!pedirAnteriores.sinBorrador) {
    if (pedirAnteriores.enCurso === cod) return;   // ya se está buscando (input + change)
    pedirAnteriores.enCurso = cod;
    var c0 = document.getElementById('cargando'); c0.textContent = 'Comprobando si hay un control de ' + cod + ' empezado…';
    buscarBorrador(cod.toUpperCase(), function (d) {
      c0.textContent = '';
      if (d) { pedirAnteriores.enCurso = null; rellenarDesde(d); c0.textContent = 'Control empezado recuperado: continúe donde lo dejó.'; return; }
      pedirAnteriores.sinBorrador = true; try { pedirAnteriores(); } finally { pedirAnteriores.sinBorrador = false; }
    });
    return;
  }
  if (hayDatos() && !pedirAnteriores.sustituir) {
    traza('hay datos escritos: se pregunta si sustituirlos');
    preguntar('Ya hay datos escritos en la página. ¿Sustituirlos por los equipos y la técnica del control anterior de ' + cod + '?', [
      ['Sí, sustituirlos', function () { pedirAnteriores.sustituir = true; pedirAnteriores.sinBorrador = true; try { pedirAnteriores(); } finally { pedirAnteriores.sustituir = false; pedirAnteriores.sinBorrador = false; } }],
      ['No, mantener lo escrito', function () { pedirAnteriores.enCurso = null; if (instVigente) document.getElementById('inst').value = instVigente; }]]);
    return;
  }
  traza('se piden los datos del control anterior de ' + cod);
  var c = document.getElementById('cargando'); c.textContent = 'Cargando los equipos y el control anterior de ' + cod + '…';
  CONEXION.run()
    .withSuccessHandler(function (d) { pedirAnteriores.enCurso = null; traza('control anterior recibido: ' + (d ? (d.eq || []).length + ' equipo(s), ' + (d.sa || []).length + ' sala(s)' : 'ninguno')); c.textContent = d ? ('Datos del control anterior' + (d.f ? ' (' + d.f + ')' : '') + ': técnica en verde, lecturas anteriores en gris.') : 'Sin datos anteriores de esta instalación en la base.'; if (d && d.inc) {   // 16/10/2026: el último control está a medias → completarlo o empezar otro
        var dd = d; preguntar('El control de ' + cod + ' del ' + d.inc.f + ' está incompleto: falta ' + d.inc.faltan.join(', ') + '.', [
          ['Completar ese control', function () { prellenar(dd, cod); aplicarCompletar(dd.inc); }], ['Empezar un control nuevo', function () { prellenar(dd, cod); }]]);
        return;
      }
      prellenar(d || { eq: [], sa: [] }, cod); })
    .withFailureHandler(function (e) { pedirAnteriores.enCurso = null; c.textContent = 'No se han podido cargar los datos anteriores (' + (e && e.message ? e.message : e) + '). Puede rellenarlo a mano.'; })
    .datosAnteriores(cod);
}
function prellenar(d, cod) {
  ANT = d; ANT._cod = cod; pintarCab(); instVigente = document.getElementById('inst').value;
  // fecha del control = la de la cita de la Tabla de seguimiento (16/10/2026), propuesta en verde; sin completar nada
  var fe0 = document.getElementById('fecha'); fe0.readOnly = false; fe0.removeAttribute('title'); COMPLETAR = null;
  var fp = window.FECHA_PROPUESTA || d.cita; window.FECHA_PROPUESTA = null;   // la de la cita elegida en la agenda (web sin conexión) o la última cita
  if (fp) { fe0.value = fp; fe0.setAttribute('data-sug', fp); } else fe0.removeAttribute('data-sug');
  if (d.ident && d.ident.maniqui) sugSiLibre('maniqui', d.ident.maniqui);
  document.getElementById('equipos').innerHTML = ''; document.getElementById('salas').innerHTML = '';
  document.getElementById('lista-eq').innerHTML = (d.eq || []).map(function (e) { return '<option value="' + e.id + '">' + (e.d || '') + '</option>'; }).join('');
  (d.eq || []).forEach(function (e) {
    nuevoEquipo(); var t = document.getElementById('eq' + nEq), tb = t.querySelector('tbody');
    t.querySelector('.desc').textContent = e.d || ''; sug(t.querySelector('[data-k="clase"]'), esPanDesc(t) ? 'Panorámico / cefalométrico' : 'Intraoral'); t.setAttribute('data-serie', e.s || ''); t.setAttribute('data-ubic', e.u || '');
    sug(t.querySelector('[data-k="id"]'), e.id);
    // del control anterior hecho con la página (15/10/2026): propuestos en verde; DL001/DL002 como lectura anterior (gris)
    ['diam', 'l1', 'l2', 'dfpl'].forEach(function (k) { if (e[k]) ant(t.querySelector('[data-k="' + k + '"]'), e[k]); });
    ['clase', 'col', 'gen', 'rec', 'tmec', 'dl011', 'dxresp', 'dxpend', 'dxei', 'dxiec', 'dl015m', 'mdisp', 'mkv', 'mma', 'mt'].forEach(function (k) { if (e[k]) sug(t.querySelector('[data-k="' + k + '"]'), e[k]); });   // del control anterior (14/10/2026)
    var ds = e.disp || [];
    while (tb.rows.length < ds.length) nuevoDisparo('eq' + nEq);
    ds.forEach(function (x, i) {
      TEC_DISPARO.forEach(function (k) { sug(tb.rows[i].querySelector('[data-d="' + k + '"]'), x[k]); });
      LECT_DISPARO.forEach(function (k) { ant(tb.rows[i].querySelector('[data-d="' + k + '"]'), x[k]); });
    });
    if (e.filt) ant(t.querySelector('[data-f="hvl"]'), e.filt.hvl);   // kV y espesor no se sugieren (13/10/2026): kV medido del 1.er disparo, 2 mm Al
  });
  if (!(d.eq || []).length) nuevoEquipo();
  (d.sa || []).forEach(function (s) {
    nuevaSala(); var t = document.getElementById('sa' + nSa), tb = t.querySelector('tbody'), ps = s.p || [];
    ['kv', 'ma', 't', 'dfp', 'carga'].forEach(function (k) { sug(t.querySelector('[data-s="' + k + '"]'), s[k]); });
    sug(t.querySelector('[data-s="letra"]'), s.l); sug(t.querySelector('[data-s="equipo"]'), s.eq);
    while (tb.rows.length < Math.min(ps.length, LETRAS_PUNTO.length)) nuevoPunto('sa' + nSa);
    ps.slice(0, LETRAS_PUNTO.length).forEach(function (p, i) {
      ['eti', 'uni', 'haz', 'fo'].forEach(function (k) { sug(tb.rows[i].querySelector('[data-p="' + k + '"]'), p[k]); });
      ant(tb.rows[i].querySelector('[data-p="valor"]'), p.v);
    });
  });
  // DL002 (15/10/2026, criterio del usuario): distancia foco-extremo del localizador = «d (f, p)» de la sala que se mide con el equipo
  (d.sa || []).forEach(function (sl) {
    if (!sl.dfp || !sl.eq) return;
    Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.equipo'), function (t) { var e = t.querySelector('[data-k="dfpl"]'); if (e && !e.value && v(t.querySelector('[data-k="id"]')) === sl.eq) sug(e, sl.dfp); });
  });
  colocarSalas();
  Array.prototype.forEach.call(document.querySelectorAll('.equipo tbody'), ordenarDisparos);
  aplicarTecnico(); colorear(); guardarBorrador();
}

// ---- colores y casillas que faltan (como el libro Excel)
// ---- INFORME PROVISIONAL (13/10/2026): pruebas con los datos de la página y las tolerancias del libro Excel
var TOL = { KV_EX: 0.10, KV_CV_INT: 0.10, KV_CV_PAN: 0.05, T_EX: 0.10, T_CV: 0.10, R_MIN: 25, R_CV: 0.10, LIM_PUB: 1, W_INT: 4, W_PAN: 200,
            CAMPO: 6, DFP: 20, KV_MIN_HF: 60, KV_MIN_MONO: 65, T_EX_MONO: 0.20, T_UMB_MONO: 100, T_PULSO: 20, R_LIN: 0.1, R_VAR_MA: 0.15, R_VAR_MAS: 0.20, BVELO: 0.3, NRD: 4, BSF: 1.1 };   // hoja Tolerancias (PECCRD 2011)
// campos del equipo añadidos el 14/10/2026 (comprobaciones sin disparo)
var EXTRA_EQ = ['funciona', 'mdisp', 'clase', 'pc2a', 'pc2b', 'pc2c', 'gen', 'rec', 'col', 'diam', 'l1', 'l2', 'dfpl', 'tmec', 'dl011', 'dl014', 'bvelo', 'dxresp', 'dxpend', 'dxei', 'dxiec', 'ug', 'ul', 'rug', 'rul', 'artef', 'dl015m', 'mkv', 'mma', 'mt', 'mker', 'mret'],
    MEDIDOS_EQ = ['diam', 'l1', 'l2', 'dfpl', 'bvelo', 'ug', 'ul', 'rug', 'rul', 'artef', 'mt', 'mker'], LECT_DX = [];   // VMP/EI (DX12–DX13) retirados el 15/10/2026: de momento no se usan   // VMP y EI de cada disparo (DX12–DX13)
function pct(x) { return (x * 100).toFixed(1).replace('.', ',') + ' %'; }
function fx(x, d) { return isNaN(x) ? '' : x.toFixed(d).replace('.', ','); }
function media(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
function cv(a) { if (a.length < 2) return NaN; var m = media(a), v = a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1); return m ? Math.sqrt(v) / m : NaN; }
function res(cond, hay) { return !hay ? 'PENDIENTE' : (cond ? 'CONFORME' : 'NO CONFORME'); }
function esPanDesc(t) { return /PANOR|ORTOP|CEFAL|TELERR|OPG/i.test((t.querySelector('.desc') || {}).textContent || ''); }
function esPan(t) { var c = v(t.querySelector('[data-k="clase"]')); return c ? c !== 'Intraoral' : esPanDesc(t); }   // 14/10/2026: elegible
function imprimirInforme() {
  colorear();
  if (!document.querySelector('#inf-cuerpo .hoja')) { alert('Aún no hay datos para el informe.'); return; }
  var t = document.title, cod = (document.getElementById('inst').value || '').split(' · ')[0], f = document.getElementById('fecha').value;
  document.title = 'Informe CC ' + (cod || '') + ' ' + (f || '');   // nombre propuesto para el PDF
  window.print();
  setTimeout(function () { document.title = t; }, 1000);
}
function tecTxt(g) { return (isNaN(g.kvf) ? '?' : g.kvf) + ' kV · ' + (isNaN(g.maf) ? '?' : fx(g.maf, 1).replace(/,0$/, '')) + ' mA · ' + (isNaN(g.tf) ? '?' : fx(g.tf, 3).replace(/0+$/, '').replace(/,$/, '')) + ' s'; }
function chip(r) { return '<span class="r ' + r.replace(/ /g, '_') + '">' + r + '</span>'; }
var LOGO = 'data:image/png;base64,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';
// VALORACIONES AUTOMÁTICAS (13/10/2026): con los resultados de las pruebas y las tolerancias del libro Excel. Se ponen
// como sugeridas (verde); si el técnico elige otro valor se respeta (azul); si lo deja en blanco, vuelve el automático.
function autoSel(t, k, val) {
  var e = t.querySelector('[data-k="' + k + '"]'); if (!e) return;
  if (e.getAttribute('data-manual') === '1' && e.value) return;
  e.removeAttribute('data-manual');
  if (val) { e.value = val; e.setAttribute('data-sug', val); } else { if (e.getAttribute('data-sug') !== null && e.value === e.getAttribute('data-sug')) e.value = ''; e.removeAttribute('data-sug'); }
}
function grupoVal(filas, cods) {
  var rs = filas.filter(function (f) { return cods.indexOf(f[0].slice(2)) >= 0; }).map(function (f) { return f[5]; }).filter(function (r) { return r === 'CONFORME' || r === 'NO CONFORME'; });
  if (rs.indexOf('NO CONFORME') >= 0) return 'Incorrecta';
  if (rs.length && rs.every(function (r) { return r === 'CONFORME'; })) return 'Correcta';
  return '';
}
function autoValoraciones(t, filas) {
  if (v(t.querySelector('[data-k="funciona"]')) === 'No') {   // equipo que no funciona (15/10/2026)
    ['vdosis', 'vrend', 'vtens', 'vfilt'].forEach(function (k) { autoSel(t, k, 'No valorado'); });
    var ob0 = t.querySelector('[data-k="obs"]'), tx0 = 'El equipo no funciona a la fecha del control.';
    if (ob0 && ob0.getAttribute('data-manual') !== '1') { ob0.value = tx0; ob0.setAttribute('data-sug', tx0); }
    return v(t.querySelector('[data-k="revision"]'));
  }
  autoSel(t, 'vtens', grupoVal(filas, ['003', '004']));
  autoSel(t, 'vrend', grupoVal(filas, ['009', '010', '011']));
  autoSel(t, 'vfilt', grupoVal(filas, ['005']));
  autoSel(t, 'vdosis', grupoVal(filas, ['015']));
  var malas = filas.some(function (f) { return f[5] === 'NO CONFORME'; }) || ['vdosis', 'vrend', 'vtens', 'vfilt'].some(function (k) { return v(t.querySelector('[data-k="' + k + '"]')) === 'Incorrecta'; });
  var pend = filas.some(function (f) { return f[5] === 'PENDIENTE'; });
  autoSel(t, 'revision', malas ? 'Sí' : filas.some(function (f) { return f[5] === 'CONFORME'; }) ? 'No' : '');
  // conclusiones en Observaciones (máx. 50 caracteres, como la base antigua) si el técnico no ha escrito nada
  var nom = { '015': 'dosis', '12': 'detector', '13': 'índice exp.', '14': 'uniformidad', '15': 'artefactos', '001': 'campo', '002': 'dist. foco-piel', '011': 'linealidad', '014': 'cuarto oscuro', '003': 'tensión', '004': 'repet. tensión', '005': 'filtración', '007': 'tiempo', '008': 'repet. tiempo', '009': 'rendimiento', '010': 'repet. rend.' };
  var fallos = filas.filter(function (f) { return f[5] === 'NO CONFORME'; }).map(function (f) { return nom[f[0].slice(2)] || f[0]; });
  if (v(t.querySelector('[data-k="vdosis"]')) === 'Incorrecta' && fallos.indexOf('dosis') < 0) fallos.push('dosis');
  var ob = t.querySelector('[data-k="obs"]');
  if (ob && ob.getAttribute('data-manual') !== '1') {
    var txt0 = fallos.length ? ('Revisar: ' + fallos.join(', ')).slice(0, 50) : '';
    if (txt0) { ob.value = txt0; ob.setAttribute('data-sug', txt0); } else if (ob.getAttribute('data-sug') !== null) { if (ob.value === ob.getAttribute('data-sug')) ob.value = ''; ob.removeAttribute('data-sug'); }
  }
  return v(t.querySelector('[data-k="revision"]'));
}
// lo que el técnico cambia a mano en estas listas ya no lo pisa el automático
document.addEventListener('change', function (ev) {
  var e = ev.target, k = e && e.getAttribute && e.getAttribute('data-k');
  if (['vtens', 'vrend', 'vfilt', 'vdosis', 'revision'].indexOf(k) >= 0) { if (e.value) e.setAttribute('data-manual', '1'); else e.removeAttribute('data-manual'); }
  if (k === 'obs') { if (e.value && e.value !== e.getAttribute('data-sug')) e.setAttribute('data-manual', '1'); else e.removeAttribute('data-manual'); }
}, true);
function cab(tit, sub) { return '<div class="cab"><img src="' + LOGO + '" alt=""><div class="t"><div class="tit">' + tit + '</div><div class="sub">' + sub + '</div><div class="ent">Radioprotección Consultores · C/ Pintores Zubiaurre, 12 – 48012 Bilbao · Tel. 944 21 96 38</div></div></div>'; }
function celdaRes(r) { return '<td class="res ' + r.replace(/ /g, '_') + '">' + r + '</td>'; }
// PAPEL DE CADA DISPARO (14/10/2026, decisión del usuario). Intraorales: D1–D3 = kV de referencia (el más repetido; si
// empatan, el menor), mismos mA y tres tiempos distintos; D4 = otro kV (solo si el equipo lo permite) con el tiempo de D1.
// Los demás disparos, «extra» (p. ej. de controles antiguos); también cuentan en los cálculos.
function papeles(t) {
  var filas = Array.prototype.map.call(t.querySelectorAll('tbody tr'), function (r) {
    var g = function (k) { return n_(r.querySelector('[data-d="' + k + '"]').value); };
    return { r: r, kvf: g('kvf'), maf: g('maf'), tf: g('tf'), kvm: g('kvm'), tm: g('tm'), dosis: g('dosis'), dist: g('dist'), papel: '', esRef: false };
  });
  var cuenta = {}, ref = NaN, nR = 0, nO = 0;
  filas.forEach(function (x) { if (!isNaN(x.kvf)) cuenta[x.kvf] = (cuenta[x.kvf] || 0) + 1; });
  var pan = esPan(t), L = pan ? 'P' : 'D';
  Object.keys(cuenta).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) {
    if (isNaN(ref)) { ref = k; return; }
    if (pan ? (Math.abs(k - 80) < Math.abs(ref - 80) || (Math.abs(k - 80) === Math.abs(ref - 80) && cuenta[k] > cuenta[ref])) : cuenta[k] > cuenta[ref]) ref = k;
  });
  filas.forEach(function (x) {
    if (isNaN(x.kvf)) return;
    if (x.kvf === ref) { nR++; x.esRef = true; x.papel = pan ? (nR <= 3 ? 'P' + nR : 'extra') : 'D' + nR; }
    else if (pan) { nO++; x.papel = nO <= 3 ? 'P' + (3 + nO) : 'extra'; }
  });
  // intraorales (15/10/2026, petición del usuario: el cuarto disparo es «D4», no «extra»): los de otro kV siguen la numeración
  if (!pan) filas.forEach(function (x) { if (!isNaN(x.kvf) && !x.esRef) { nO++; x.papel = 'D' + (nR + nO); } });
  return { filas: filas, ref: ref };
}
// PRUEBAS SEGÚN EL TIPO DE RECEPTOR (14/10/2026, decisión del usuario): analógicas (película) y digitales son
// excluyentes. Elegido el receptor, las que no corresponden no se rellenan (se ocultan) y en el informe salen juntas como
// «NO PROCEDE». CR01 solo procede con placas de fósforo (CR).
var PRUEBAS_TIPO = {
  pel: [['DL014', 'Cuarto oscuro y cubetas de revelado']],
  dig: [],   // pruebas del receptor digital retiradas por ahora (15/10/2026)
  cr: []
};
function tipoReceptor(t) { var r = v(t.querySelector('[data-k="rec"]')); return r === 'Película' ? 'pel' : /^Digital CR/.test(r) ? 'cr' : /^Digital/.test(r) ? 'dig' : ''; }
function procede(grupo, tipo) { return !tipo || (grupo === 'pel' ? tipo === 'pel' : grupo === 'dig' ? tipo !== 'pel' : tipo === 'cr'); }
function noProceden(tipo) { if (!tipo) return []; var l = []; ['pel', 'dig', 'cr'].forEach(function (g) { if (!procede(g, tipo)) l = l.concat(PRUEBAS_TIPO[g]); }); return l; }
// recta de mínimos cuadrados y = a + b·x y su R² (DX12)
function ajuste(xs, ys) {
  var mx = media(xs), my = media(ys), sxy = 0, sxx = 0, syy = 0;
  for (var i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); }
  var b = sxx ? sxy / sxx : NaN; return { b: b, a: my - b * mx, r2: (sxx && syy) ? sxy * sxy / (sxx * syy) : NaN };
}
// DX12–DX15 (receptor digital) con los disparos dados: intraorales D1–D3, panorámicos todos
function filasDX(t, R, tipo, img) {   // img: disparo cuya imagen se usa en DX14/DX15
  var filas = [], q = function (k) { return v(t.querySelector('[data-k="' + k + '"]')); };
  // DX12–DX15 receptor digital (14/10/2026, decisión del usuario): DX12/DX13 con las imágenes de D1–D3 (kerma en el detector
  // = el medido en cada disparo, µGy); DX14/DX15 con la imagen de D2. Criterios de la plantilla (Módulo 1 del PECCRD, 2024).
  if (procede('dig', tipo)) {
    var logR = q('dxresp') === 'Logarítmica';
    var pts = R.map(function (x) { return { k: x.dosis * 1000, vmp: n_(v(x.r.querySelector('[data-x="vmp"]'))), ei: n_(v(x.r.querySelector('[data-x="ei"]'))), p: x.papel }; })
               .filter(function (z) { return !isNaN(z.k) && z.k > 0; });
    var p12 = pts.filter(function (z) { return !isNaN(z.vmp); });
    if (p12.length >= 3) {
      var xs = p12.map(function (z) { return logR ? Math.log(z.k) : z.k; }), aj = ajuste(xs, p12.map(function (z) { return z.vmp; })), dmax = 0;
      var det12 = p12.map(function (z, i) { var f = aj.a + aj.b * xs[i], d = f ? Math.abs(z.vmp - f) / Math.abs(f) : NaN; dmax = Math.max(dmax, d); return ['· ' + z.p + ': ' + fx(z.k, 0) + ' µGy', 'VMP ' + fx(z.vmp, 0) + ' (ajuste ' + fx(f, 0) + ', ' + fx(d * 100, 1) + ' %)', d <= 0.05 ? 'Correcto' : 'Incorrecto', 0]; });
      var pref = n_(q('dxpend')), rel = (!isNaN(pref) && pref) ? aj.b / pref : NaN;
      filas.push(['DX12', 'Función de conversión del detector (digital)', 'Respuesta ' + (logR ? 'logarítmica' : 'lineal') + ' · ' + p12.length + ' puntos (' + p12.map(function (z) { return z.p; }).join(', ') + ')',
        'R² ' + fx(aj.r2, 4) + ' · desv. máx. ' + fx(dmax * 100, 1) + ' %' + (isNaN(rel) ? '' : ' · pendiente / ref. ' + fx(rel, 2)), 'R² > 0,97 · desv. ≤ 5 %' + (isNaN(rel) ? '' : ' · pendiente 0,9–1,1 × ref.'),
        (aj.r2 > 0.97 && dmax <= 0.05 && (isNaN(rel) || (rel >= 0.9 && rel <= 1.1))) ? 'CONFORME' : 'NO CONFORME', det12]);
    }
    var p13 = pts.filter(function (z) { return !isNaN(z.ei); });
    if (q('dxei') === 'Sí' && p13.length >= 2) {
      var sxy = 0, sxx = 0, r13 = 0, iec = q('dxiec') === 'Sí';
      p13.forEach(function (z) { sxy += z.k * z.ei; sxx += z.k * z.k; });
      var k13 = sxy / sxx; p13.forEach(function (z) { r13 = Math.max(r13, Math.abs(z.ei - k13 * z.k) / (k13 * z.k)); });
      filas.push(['DX13', 'Índice de exposición del detector (digital)', (iec ? 'EI según IEC 62494-1' : 'EI del fabricante') + ' · ' + p13.length + ' puntos (' + p13.map(function (z) { return z.p; }).join(', ') + ')', 'EI / kerma ' + fx(k13, 1) + ' · residuo máx. ' + fx(r13 * 100, 1) + ' %',
        iec ? 'EI / kerma entre 90 y 110' : 'residuos ≤ ±20 %', (iec ? (k13 >= 90 && k13 <= 110) : r13 <= 0.2) ? 'CONFORME' : 'NO CONFORME', []]);
    }
    var ug = n_(q('ug')), ul = n_(q('ul')), rug = n_(q('rug')), rul = n_(q('rul'));
    if (!isNaN(ug) && !isNaN(ul)) {
      var mal14 = ug >= 15 || ul >= 10 || (!isNaN(rug) && rug >= 30) || (!isNaN(rul) && rul >= 20);
      filas.push(['DX14', 'Uniformidad de la imagen (digital)', 'Imagen de ' + (img || (R[1] ? R[1].papel : 'D2')), 'VMP: UG ' + fx(ug, 1) + ' % · UL ' + fx(ul, 1) + ' %' + (isNaN(rug) ? '' : ' · RSR: UG ' + fx(rug, 1) + ' %' + (isNaN(rul) ? '' : ' · UL ' + fx(rul, 1) + ' %')),
        'VMP: UG < 15 %, UL < 10 % · RSR: UG < 30 %, UL < 20 %', mal14 ? 'NO CONFORME' : 'CONFORME', []]);
    }
    if (q('artef')) filas.push(['DX15', 'Artefactos de la imagen (digital)', 'Imagen de ' + (img || (R[1] ? R[1].papel : 'D2')) + ', ventana estrecha', q('artef') === 'Sí' ? 'Con artefactos o píxeles defectuosos' : 'Sin artefactos', 'Sin artefactos ni píxeles defectuosos sin corregir', q('artef') === 'Sí' ? 'NO CONFORME' : 'CONFORME', []]);
  }
  if (procede('pel', tipo) && q('dl014') === 'Medido' && !isNaN(bv)) filas.push(['DL014', 'Cuarto oscuro y cubetas de revelado', 'Base + velo', fx(bv, 2) + ' DO', '≤ ' + fx(TOL.BVELO, 1) + ' DO', bv <= TOL.BVELO ? 'CONFORME' : 'NO CONFORME', []]);
  return filas;
}
function fxs(x) { return fx(x, 3).replace(/0+$/, '').replace(/,$/, ''); }
// Pruebas de un equipo INTRAORAL con el esquema D1–D4 (14/10/2026). Cada fila: [código, prueba, condiciones, valor,
// tolerancia, resultado, detalle]. Solo se añaden las pruebas con datos (las no realizadas no salen en el informe).
function filasIntraoral(t) {
  var P = papeles(t), filas = [], q = function (k) { return v(t.querySelector('[data-k="' + k + '"]')); };
  var asc = function (a, b) { return a - b; }, sgn = function (x) { return (x >= 0 ? '+' : '') + fx(x * 100, 1) + ' %'; };
  var tec = P.filas.filter(function (x) { return !isNaN(x.kvf); });
  var dis = tec.filter(function (x) { return !isNaN(x.kvm) || !isNaN(x.tm) || !isNaN(x.dosis); });
  var R = dis.filter(function (x) { return x.esRef; }), O = dis.filter(function (x) { return !x.esRef; }), mono = q('gen') === 'Monofásico';
  var tt = function (x) { return !isNaN(x.tm) ? x.tm : x.tf; };
  var rend = function (x, t2) { return (!isNaN(x.dosis) && !isNaN(x.dist) && x.maf && t2) ? x.dosis * 1000 * Math.pow(x.dist / 100, 2) / (x.maf * t2) : NaN; };
  // DL001 tamaño del campo
  var col = q('col'), diam = n_(q('diam')), l1 = n_(q('l1')), l2 = n_(q('l2'));
  if (col === 'Rectangular' && !isNaN(l1) && !isNaN(l2)) filas.push(['DL001', 'Tamaño del campo en el extremo del localizador', 'Colimador rectangular', fx(l1, 1) + ' × ' + fx(l2, 1) + ' cm', 'Ø ≤ ' + TOL.CAMPO + ' cm (se aconseja rectangular)', 'CONFORME', []]);
  else if (!isNaN(diam)) filas.push(['DL001', 'Tamaño del campo en el extremo del localizador', 'Colimador circular', 'Ø ' + fx(diam, 1) + ' cm', 'Ø ≤ ' + TOL.CAMPO + ' cm', diam <= TOL.CAMPO ? 'CONFORME' : 'NO CONFORME', []]);
  // DL002 distancia foco-piel
  var dfp = n_(q('dfpl'));
  if (!isNaN(dfp)) filas.push(['DL002', 'Mínima distancia foco-piel', 'Foco – extremo del localizador', fx(dfp, 1) + ' cm', '≥ ' + TOL.DFP + ' cm', dfp >= TOL.DFP ? 'CONFORME' : 'NO CONFORME', []]);
  // DL003 exactitud de la tensión (cada kV nominal) y tensión mínima = el menor kV disparado
  var porKv = {}; dis.forEach(function (x) { if (!isNaN(x.kvm)) (porKv[x.kvf] = porKv[x.kvf] || []).push(x.kvm); });
  var detK = Object.keys(porKv).map(Number).sort(asc).map(function (k) { var m = media(porKv[k]), d = (m - k) / k; return ['· nominal ' + k + ' kV', 'medido ' + fx(m, 1) + ' kV (' + sgn(d) + ')', Math.abs(d) < TOL.KV_EX ? 'Correcto' : 'Incorrecto', Math.abs(d)]; });
  if (detK.length) {
    var mk = Math.max.apply(null, detK.map(function (x) { return x[3]; })), kmin = Math.min.apply(null, Object.keys(porKv).map(Number)), lim = mono ? TOL.KV_MIN_MONO : TOL.KV_MIN_HF;
    detK.push(['· tensión mínima disparada', fx(kmin, 0) + ' kV', kmin >= lim ? 'Correcto' : 'Incorrecto', 0]);
    filas.push(['DL003', 'Exactitud de la tensión. Tensión mínima nominal', mono ? 'Monofásico' : 'Alta frecuencia', 'Desv. máx.: ' + fx(mk * 100, 1) + ' %', '±10 % · mínima ≥ ' + lim + ' kV', (mk < TOL.KV_EX && kmin >= lim) ? 'CONFORME' : 'NO CONFORME', detK]);
  }
  // DL004 repetibilidad de la tensión: D1–D3
  var kR = R.map(function (x) { return x.kvm; }).filter(function (y) { return !isNaN(y); });
  if (kR.length >= 2) { var c4 = cv(kR); filas.push(['DL004', 'Repetibilidad y reproducibilidad de la tensión', kR.length + ' disparos a ' + P.ref + ' kV', 'CV ' + fx(c4 * 100, 1) + ' %', 'CV < ' + (TOL.KV_CV_INT * 100) + ' %', c4 < TOL.KV_CV_INT ? 'CONFORME' : 'NO CONFORME', []]); }
  // DL005 filtración (como antes)
  var hvl = n_(t.querySelector('[data-f="hvl"]').value), kvh = n_(t.querySelector('[data-f="kvf"]').value);
  var dconI = n_((t.querySelector('[data-f="dcon"]') || {}).value), espI = n_(t.querySelector('[data-f="esp"]').value), fmin = (!isNaN(kvh) && kvh > 70) ? 2.5 : 1.5;
  if (!isNaN(hvl)) filas.push(['DL005', 'Filtración. Capa hemirreductora', (isNaN(dconI) ? 'CHR directa' : 'CHR por atenuación (' + fx(espI, 2) + ' mm Al' + (n_((t.querySelector('[data-f="tcon"]') || {}).value) > 0 ? ', con tasa de kerma' : '') + ')') + (isNaN(kvh) ? '' : ' a ' + fx(kvh, 1).replace(/,0$/, '') + ' kV'),
    'CHR ' + fx(hvl, 2) + ' mm Al', 'CHR ≥ ' + fx(fmin, 1) + ' mm Al (filtración mín. Tp ' + (fmin > 2 ? '> 70' : '≤ 70') + ' kV)', hvl >= fmin ? 'CONFORME' : 'NO CONFORME', []]);
  // DL007 exactitud del tiempo: cada tiempo nominal (monofásico: ±20 % por encima de 100 ms; por debajo, ±1 pulso de 20 ms)
  var porT = {}; dis.forEach(function (x) { if (!isNaN(x.tf) && !isNaN(x.tm) && x.tf) (porT[x.tf] = porT[x.tf] || []).push(x.tm); });
  var detT = Object.keys(porT).map(Number).sort(asc).map(function (k) {
    var m = media(porT[k]), d = (m - k) / k, bien = (mono && k * 1000 <= TOL.T_UMB_MONO) ? Math.abs(m - k) * 1000 <= TOL.T_PULSO : Math.abs(d) <= (mono ? TOL.T_EX_MONO : TOL.T_EX);
    return ['· nominal ' + fxs(k) + ' s', 'medido ' + fxs(m) + ' s (' + sgn(d) + ')', bien ? 'Correcto' : 'Incorrecto', Math.abs(d)];
  });
  if (detT.length) {
    var mt = Math.max.apply(null, detT.map(function (x) { return x[3]; }));
    filas.push(['DL007', 'Exactitud del tiempo de exposición', (mono ? 'Monofásico' : 'Alta frecuencia') + (q('tmec') === 'Sí' ? ' · temporizador mecánico' : ''), 'Desv. máx.: ' + fx(mt * 100, 1) + ' %',
      mono ? '±20 % (> 100 ms) · ±1 pulso' : '±10 %', detT.some(function (x) { return x[2] === 'Incorrecto'; }) ? 'NO CONFORME' : 'CONFORME', detT]);
  }
  // DL008 repetibilidad del tiempo: D1 y D4 (mismo tiempo, otro kV); sin D4, cociente t medido / t nominal de D1–D3
  var d1 = R[0], o4 = d1 ? O.filter(function (x) { return x.tf === d1.tf && !isNaN(x.tm); })[0] : null;
  if (d1 && o4 && !isNaN(d1.tm)) {
    var c8 = cv([d1.tm, o4.tm]);
    filas.push(['DL008', 'Repetibilidad y reproducibilidad del tiempo', d1.papel + ' (' + d1.kvf + ' kV) y ' + o4.papel + ' (' + o4.kvf + ' kV) con ' + fxs(d1.tf) + ' s', 'CV ' + fx(c8 * 100, 1) + ' %', 'CV ≤ ' + (TOL.T_CV * 100) + ' %', c8 <= TOL.T_CV ? 'CONFORME' : 'NO CONFORME', []]);
  } else {
    var rt = R.filter(function (x) { return !isNaN(x.tm) && x.tf; }).map(function (x) { return x.tm / x.tf; });
    if (rt.length >= 2) { var c8b = cv(rt); filas.push(['DL008', 'Repetibilidad y reproducibilidad del tiempo', rt.length + ' disparos (t medido / t nominal)', 'CV ' + fx(c8b * 100, 1) + ' %', 'CV ≤ ' + (TOL.T_CV * 100) + ' %', c8b <= TOL.T_CV ? 'CONFORME' : 'NO CONFORME', []]); }
  }
  // DL009 rendimiento de cada disparo (tiempo MEDIDO, a 1 m); el de referencia es la media de D1–D3
  var yR = R.map(function (x) { return { x: x, y: rend(x, tt(x)) }; }).filter(function (z) { return !isNaN(z.y); });
  if (yR.length) {
    var ym = media(yR.map(function (z) { return z.y; }));
    var detR = dis.map(function (x) { var y = rend(x, tt(x)); return isNaN(y) ? null : ['· ' + x.papel + ': ' + tecTxt(x), fx(y, 1) + ' µGy/mAs a 1 m', '', 0]; }).filter(Boolean);
    filas.push(['DL009', 'Valor del rendimiento', 'Media de ' + yR.length + ' disparo(s) a ' + P.ref + ' kV', fx(ym, 1) + ' µGy/mAs a 1 m', '> ' + TOL.R_MIN + ' µGy/mAs', ym > TOL.R_MIN ? 'CONFORME' : 'NO CONFORME', detR]);
  }
  // DL010 repetibilidad del rendimiento: D1–D3
  if (yR.length >= 2) { var c10 = cv(yR.map(function (z) { return z.y; })); filas.push(['DL010', 'Repetibilidad del rendimiento', yR.length + ' disparos a ' + P.ref + ' kV', 'CV ' + fx(c10 * 100, 1) + ' %', 'CV < ' + (TOL.R_CV * 100) + ' %', c10 < TOL.R_CV ? 'CONFORME' : 'NO CONFORME', []]); }
  // DL011 variación con la carga: D1–D3 (mAs distintos), rendimiento con mAs NOMINALES como la plantilla
  var yL = R.map(function (x) { return { mas: x.maf * x.tf, y: rend(x, x.tf) }; }).filter(function (z) { return !isNaN(z.y) && z.mas; }).sort(function (a, b) { return a.mas - b.mas; });
  var distintos = yL.filter(function (z, i) { return !i || z.mas !== yL[i - 1].mas; }).length;
  if (yL.length >= 2 && distintos >= 2) {
    var mL = media(yL.map(function (z) { return z.y; })), lin = 0, dev = 0, porMa = q('dl011') === 'Corriente (mA)', limV = porMa ? TOL.R_VAR_MA : TOL.R_VAR_MAS;
    yL.forEach(function (z, i) { dev = Math.max(dev, Math.abs(z.y - mL) / mL); if (i) lin = Math.max(lin, Math.abs(z.y - yL[i - 1].y) / (z.y + yL[i - 1].y)); });
    filas.push(['DL011', 'Variación del rendimiento con la ' + (porMa ? 'corriente' : 'carga'), yL.length + ' pasos de ' + fx(yL[0].mas, 2) + ' a ' + fx(yL[yL.length - 1].mas, 2) + ' mAs', 'Coef. lin. ' + fx(lin, 3) + ' · desv. ' + fx(dev * 100, 1) + ' %',
      'Coef. ≤ ' + fx(TOL.R_LIN, 1) + ' · desv. < ' + (limV * 100) + ' %', (lin <= TOL.R_LIN && dev < limV) ? 'CONFORME' : 'NO CONFORME', []]);
  }
  // DL014 cuarto oscuro (por defecto «No procede»)
  var bv = n_(q('bvelo'));
  var tipo = tipoReceptor(t);
  // DL015 kerma en aire a la entrada del paciente, molar superior adulto (14/10/2026; fórmulas de la plantilla). Estimado: rendimiento
  // de referencia (media D1–D3, tiempo medido) llevado a la tensión del molar con la curva D1–D3 / D4 (sin D4 y otro kV:
  // rendimiento ∝ kV², aproximación), × mA · t del molar × (100 / distancia foco-piel)² × factor de retrodispersión 1,1.
  // Distancia foco-piel: la de DL002; si no se midió, la de los disparos. Medido: kerma en el extremo del localizador (× 1,1 si sin retrodispersión).
  var met = q('dl015m'), mtt = n_(q('mt')), mker = n_(q('mker')), dPiel = !isNaN(dfp) ? dfp : (R[0] ? R[0].dist : NaN);
  var xM = q('mdisp') ? dis.filter(function (x) { return x.papel === q('mdisp'); })[0] : null;   // 15/10/2026: técnica = un disparo
  if (met !== 'Medido' && xM && !isNaN(xM.dosis) && !isNaN(xM.dist) && !isNaN(dPiel) && dPiel > 0) {
    var kD = xM.dosis * Math.pow(xM.dist / dPiel, 2) * TOL.BSF;
    filas.push(['DL015', 'Kerma en aire a la entrada del paciente', 'Técnica del molar = ' + xM.papel + ' (' + tecTxt(xM) + '): kerma medido a ' + fx(xM.dist, 0) + ' cm llevado a ' + fx(dPiel, 0) + ' cm (' + (isNaN(dfp) ? 'distancia de los disparos' : 'foco-piel DL002') + ') · retrodispersión × ' + fx(TOL.BSF, 1),
      fx(kD, 2) + ' mGy', '< ' + TOL.NRD + ' mGy (molar superior adulto)', kD < TOL.NRD ? 'CONFORME' : 'NO CONFORME', []]);
  } else if (met === 'Medido' && !isNaN(mker)) {
    var bsfM = q('mret') === 'Sí' ? 1 : TOL.BSF, kM = mker * bsfM;
    filas.push(['DL015', 'Kerma en aire a la entrada del paciente', 'Medido en el extremo del localizador' + (bsfM === 1 ? ' (con retrodispersión)' : ' · retrodispersión × ' + fx(TOL.BSF, 1)),
      fx(kM, 2) + ' mGy', '< ' + TOL.NRD + ' mGy (molar superior adulto)', kM < TOL.NRD ? 'CONFORME' : 'NO CONFORME', []]);
  } else if (met !== 'Medido' && !isNaN(mtt) && yR.length && !isNaN(dPiel) && dPiel > 0) {
    var mkv = n_(q('mkv')), mma = n_(q('mma')), yRef = media(yR.map(function (z) { return z.y; })), yM, nota;
    if (isNaN(mkv)) mkv = P.ref; if (isNaN(mma)) mma = R[0].maf;
    var yO = O.map(function (x) { return { kv: x.kvf, y: rend(x, tt(x)) }; }).filter(function (z) { return !isNaN(z.y); })[0];
    if (mkv === P.ref) { yM = yRef; nota = 'rendimiento de D1–D3'; }
    else if (yO) { var nE = Math.log(yRef / yO.y) / Math.log(P.ref / yO.kv); yM = yRef * Math.pow(mkv / P.ref, nE); nota = 'curva D1–D3 / D4 (exponente ' + fx(nE, 2) + ')'; }
    else { yM = yRef * Math.pow(mkv / P.ref, 2); nota = 'sin D4: rendimiento ∝ kV² (aproximación)'; }
    var kE = yM * mma * mtt * Math.pow(100 / dPiel, 2) / 1000 * TOL.BSF;
    filas.push(['DL015', 'Kerma en aire a la entrada del paciente', 'Estimado: ' + mkv + ' kV · ' + fx(mma, 1).replace(/,0$/, '') + ' mA · ' + fxs(mtt) + ' s a ' + fx(dPiel, 0) + ' cm (' + (isNaN(dfp) ? 'distancia de los disparos' : 'foco-piel DL002') + ') · ' + nota + ' · retrodispersión × ' + fx(TOL.BSF, 1),
      fx(kE, 2) + ' mGy', '< ' + TOL.NRD + ' mGy (molar superior adulto)', kE < TOL.NRD ? 'CONFORME' : 'NO CONFORME', []]);
  }
  if (tipo === 'pel' && q('dl014') !== 'Medido') filas.push(['DL014', 'Cuarto oscuro y cubetas de revelado', '', '', '', 'NO PROCEDE', []]);
  noProceden(tipo).forEach(function (x) { filas.push([x[0], x[1], '', '', '', 'NO PROCEDE', []]); });
  return filas;
}
// Pruebas de un equipo PANORÁMICO (14/10/2026, decisiones del usuario sobre la práctica de la base: 6 disparos, 3 a cada
// kV, mismos mA y programa): P1–P3 = kV más cercano a 80 (referencia del rendimiento), P4–P6 = el otro kV. Tolerancias de la
// plantilla (PC002–PC011). PC011 solo si hay disparos con distinta carga al kV de referencia (opcional). Sin DL001/DL002/DL014/DL015.
function filasPanoramico(t) {
  var P = papeles(t), filas = [], q = function (k) { return v(t.querySelector('[data-k="' + k + '"]')); };
  var asc = function (a, b) { return a - b; }, sgn = function (x) { return (x >= 0 ? '+' : '') + fx(x * 100, 1) + ' %'; };
  var dis = P.filas.filter(function (x) { return !isNaN(x.kvf) && (!isNaN(x.kvm) || !isNaN(x.tm) || !isNaN(x.dosis)); });
  var R = dis.filter(function (x) { return x.esRef; }), mono = q('gen') === 'Monofásico', tipo = tipoReceptor(t);
  var tt = function (x) { return !isNaN(x.tm) ? x.tm : x.tf; };
  var rend = function (x, t2) { return (!isNaN(x.dosis) && !isNaN(x.dist) && x.maf && t2) ? x.dosis * 1000 * Math.pow(x.dist / 100, 2) / (x.maf * t2) : NaN; };
  var grupos = {}; dis.forEach(function (x) { (grupos[x.kvf] = grupos[x.kvf] || []).push(x); });
  // PC002 alineamiento
  if (q('pc2a') && q('pc2b') && q('pc2c')) {
    var ok2 = q('pc2a') === 'Sí' && q('pc2b') === 'Sí' && q('pc2c') === 'No';
    filas.push(['PC002', 'Alineamiento tubo – receptor de imagen', 'Haz en la rendija / fila de detectores', ok2 ? 'Alineado, sin artefactos' : 'Desalineado o con artefactos', 'Haz contenido y centrado', ok2 ? 'CONFORME' : 'NO CONFORME', []]);
  }
  // PC003 exactitud de la tensión
  var detK = Object.keys(grupos).map(Number).sort(asc).map(function (k) { var a = grupos[k].map(function (x) { return x.kvm; }).filter(function (y) { return !isNaN(y); }); if (!a.length) return null; var m = media(a), d = (m - k) / k; return ['· nominal ' + k + ' kV', 'medido ' + fx(m, 1) + ' kV (' + sgn(d) + ')', Math.abs(d) < TOL.KV_EX ? 'Correcto' : 'Incorrecto', Math.abs(d)]; }).filter(Boolean);
  if (detK.length) { var mk = Math.max.apply(null, detK.map(function (x) { return x[3]; })); filas.push(['PC003', 'Exactitud de la tensión', mono ? 'Monofásico' : 'Alta frecuencia', 'Desv. máx.: ' + fx(mk * 100, 1) + ' %', '±10 %', mk < TOL.KV_EX ? 'CONFORME' : 'NO CONFORME', detK]); }
  // PC004 repetibilidad de la tensión: CV de cada grupo de kV (el mayor)
  var cvs = Object.keys(grupos).map(function (k) { var a = grupos[k].map(function (x) { return x.kvm; }).filter(function (y) { return !isNaN(y); }); return a.length >= 2 ? cv(a) : NaN; }).filter(function (y) { return !isNaN(y); });
  if (cvs.length) { var c4 = Math.max.apply(null, cvs); filas.push(['PC004', 'Repetibilidad y reproducibilidad de la tensión', cvs.length + ' grupo(s) de disparos por kV', 'CV máx. ' + fx(c4 * 100, 1) + ' %', 'CV < ' + (TOL.KV_CV_PAN * 100) + ' %', c4 < TOL.KV_CV_PAN ? 'CONFORME' : 'NO CONFORME', []]); }
  // PC005 filtración (como los intraorales)
  var hvl = n_(t.querySelector('[data-f="hvl"]').value), kvh = n_(t.querySelector('[data-f="kvf"]').value);
  var dconI = n_((t.querySelector('[data-f="dcon"]') || {}).value), espI = n_(t.querySelector('[data-f="esp"]').value), fmin = (!isNaN(kvh) && kvh > 70) ? 2.5 : 1.5;
  if (!isNaN(hvl)) filas.push(['PC005', 'Filtración. Capa hemirreductora', (isNaN(dconI) ? 'CHR directa' : 'CHR por atenuación (' + fx(espI, 2) + ' mm Al' + (n_((t.querySelector('[data-f="tcon"]') || {}).value) > 0 ? ', con tasa de kerma' : '') + ')') + (isNaN(kvh) ? '' : ' a ' + fx(kvh, 1).replace(/,0$/, '') + ' kV'),
    'CHR ' + fx(hvl, 2) + ' mm Al', 'CHR ≥ ' + fx(fmin, 1) + ' mm Al (filtración mín. Tp ' + (fmin > 2 ? '> 70' : '≤ 70') + ' kV)', hvl >= fmin ? 'CONFORME' : 'NO CONFORME', []]);
  // PC007 exactitud del tiempo (tiempo del programa)
  var porT = {}; dis.forEach(function (x) { if (!isNaN(x.tf) && !isNaN(x.tm) && x.tf) (porT[x.tf] = porT[x.tf] || []).push(x.tm); });
  var detT = Object.keys(porT).map(Number).sort(asc).map(function (k) { var m = media(porT[k]), d = (m - k) / k; return ['· nominal ' + fxs(k) + ' s', 'medido ' + fxs(m) + ' s (' + sgn(d) + ')', Math.abs(d) <= (mono ? TOL.T_EX_MONO : TOL.T_EX) ? 'Correcto' : 'Incorrecto', Math.abs(d)]; });
  if (detT.length) { var mt = Math.max.apply(null, detT.map(function (x) { return x[3]; })); filas.push(['PC007', 'Exactitud del tiempo de exposición', 'Programa panorámico', 'Desv. máx.: ' + fx(mt * 100, 1) + ' %', mono ? '±20 %' : '±10 %', detT.some(function (x) { return x[2] === 'Incorrecto'; }) ? 'NO CONFORME' : 'CONFORME', detT]); }
  // PC008 repetibilidad del tiempo: disparos con el mismo tiempo nominal (el grupo más numeroso)
  var tg = Object.keys(porT).map(function (k) { return porT[k]; }).sort(function (a, b) { return b.length - a.length; })[0];
  if (tg && tg.length >= 2) { var c8 = cv(tg); filas.push(['PC008', 'Repetibilidad y reproducibilidad del tiempo', tg.length + ' disparos con el mismo programa', 'CV ' + fx(c8 * 100, 1) + ' %', 'CV < ' + (TOL.T_CV * 100) + ' %', c8 < TOL.T_CV ? 'CONFORME' : 'NO CONFORME', []]); }
  // PC009 rendimiento: media de los disparos de referencia (≈ 80 kV), tiempo MEDIDO
  var yR = R.map(function (x) { return { x: x, y: rend(x, tt(x)) }; }).filter(function (z) { return !isNaN(z.y); });
  if (yR.length) {
    var ym = media(yR.map(function (z) { return z.y; }));
    var detR = dis.map(function (x) { var y = rend(x, tt(x)); return isNaN(y) ? null : ['· ' + x.papel + ': ' + tecTxt(x), fx(y, 1) + ' µGy/mAs a 1 m', '', 0]; }).filter(Boolean);
    filas.push(['PC009', 'Valor del rendimiento', 'Media de ' + yR.length + ' disparo(s) a ' + P.ref + ' kV', fx(ym, 1) + ' µGy/mAs a 1 m', '> ' + TOL.R_MIN + ' µGy/mAs', ym > TOL.R_MIN ? 'CONFORME' : 'NO CONFORME', detR]);
  }
  // PC010 repetibilidad del rendimiento: CV de cada grupo de kV (el mayor)
  var cvr = Object.keys(grupos).map(function (k) { var a = grupos[k].map(function (x) { return rend(x, tt(x)); }).filter(function (y) { return !isNaN(y); }); return a.length >= 2 ? cv(a) : NaN; }).filter(function (y) { return !isNaN(y); });
  if (cvr.length) { var c10 = Math.max.apply(null, cvr); filas.push(['PC010', 'Repetibilidad del rendimiento', cvr.length + ' grupo(s) de disparos por kV', 'CV máx. ' + fx(c10 * 100, 1) + ' %', 'CV < ' + (TOL.R_CV * 100) + ' %', c10 < TOL.R_CV ? 'CONFORME' : 'NO CONFORME', []]); }
  // PC011 (opcional): disparos al kV de referencia con distinta carga (otro mA u otro programa)
  var yL = R.map(function (x) { return { mas: x.maf * x.tf, y: rend(x, x.tf) }; }).filter(function (z) { return !isNaN(z.y) && z.mas; }).sort(function (a, b) { return a.mas - b.mas; });
  var distintos = yL.filter(function (z, i) { return !i || z.mas !== yL[i - 1].mas; }).length;
  if (yL.length >= 2 && distintos >= 2) {
    var mL = media(yL.map(function (z) { return z.y; })), lin = 0, dev = 0, porMa = q('dl011') === 'Corriente (mA)', limV = porMa ? TOL.R_VAR_MA : TOL.R_VAR_MAS;
    yL.forEach(function (z, i) { dev = Math.max(dev, Math.abs(z.y - mL) / mL); if (i) lin = Math.max(lin, Math.abs(z.y - yL[i - 1].y) / (z.y + yL[i - 1].y)); });
    filas.push(['PC011', 'Variación del rendimiento con la ' + (porMa ? 'corriente' : 'carga'), yL.length + ' disparos de ' + fx(yL[0].mas, 1) + ' a ' + fx(yL[yL.length - 1].mas, 1) + ' mAs', 'Coef. lin. ' + fx(lin, 3) + ' · desv. ' + fx(dev * 100, 1) + ' %',
      'Coef. ≤ ' + fx(TOL.R_LIN, 1) + ' · desv. < ' + (limV * 100) + ' %', (lin <= TOL.R_LIN && dev < limV) ? 'CONFORME' : 'NO CONFORME', []]);
  }
  // NO PROCEDE según el receptor (en panorámicos no hay DL014; la calidad de imagen es PC012)
  noProceden(tipo).forEach(function (x) { if (x[0] === 'DL014') return; filas.push([x[0] === 'DL012' ? 'PC012' : x[0], x[1], '', '', '', 'NO PROCEDE', []]); });
  return filas;
}
// ¿Sala sin medir? (15/10/2026): su equipo no funciona (se propone «No») o se ha marcado a mano; con ocultar = true,
// oculta sus datos y avisa en la tarjeta
function salaSinMedir(t, ocultar) {
  var eqS = v(t.querySelector('[data-s="equipo"]')), fS = t.querySelector('[data-s="funciona"]'), eqNo = false;
  Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.equipo'), function (te) { if (eqS && v(te.querySelector('[data-k="id"]')) === eqS && v(te.querySelector('[data-k="funciona"]')) === 'No') eqNo = true; });
  if (fS && ocultar) {
    if (eqNo && fS.value !== 'No') { fS.value = 'No'; fS.setAttribute('data-sug', 'No'); }
    else if (!eqNo && fS.value === 'No' && fS.getAttribute('data-sug') === 'No') { fS.value = 'Sí'; fS.setAttribute('data-sug', 'Sí'); }
  }
  var no = !!fS && fS.value === 'No';
  if (ocultar) {
    Array.prototype.forEach.call(t.querySelectorAll('.campo, .tabla, .acciones, h3, .monitor-sala'), function (e) {
      var deja = e.querySelector && e.querySelector('[data-s="letra"],[data-s="equipo"],[data-s="funciona"]'); e.style.display = (no && !deja) ? 'none' : '';
    });
    var av = t.querySelector('.nofunc-sala'); if (av) av.textContent = no ? 'El equipo no funciona a la fecha del control: la sala no se mide.' : '';
  }
  return no;
}
// SALAS DETRÁS DE SU EQUIPO (15/10/2026, petición del usuario: la toma de datos va equipo a equipo)
function colocarSala(sa) {
  var eqId = v(sa.querySelector('[data-s="equipo"]')), te = null;
  Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.equipo'), function (x) { if (!te && eqId && v(x.querySelector('[data-k="id"]')) === eqId) te = x; });
  if (!te) { if (sa.parentNode.id !== 'salas') document.getElementById('salas').appendChild(sa); sa.removeAttribute('data-de'); return; }
  if (sa.getAttribute('data-de') === te.id && sa.parentNode === te.parentNode) return;
  var ref = te; while (ref.nextElementSibling && ref.nextElementSibling.classList.contains('sala') && ref.nextElementSibling !== sa) ref = ref.nextElementSibling;
  ref.parentNode.insertBefore(sa, ref.nextElementSibling); sa.setAttribute('data-de', te.id);
}
function colocarSalas() { Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.sala'), colocarSala); }
function salaDeEquipo(b) {
  var te = b.closest('.tarjeta.equipo'); nuevaSala(); var sa = document.getElementById('sa' + nSa);
  sug(sa.querySelector('[data-s="equipo"]'), v(te.querySelector('[data-k="id"]'))); colocarSala(sa); colorear(); guardarBorrador();
}
document.addEventListener('change', function (ev) {
  var e = ev.target; if (e && e.getAttribute && (e.getAttribute('data-s') === 'equipo' || e.getAttribute('data-k') === 'id')) colocarSalas();
});
// COMPLETAR UN CONTROL INCOMPLETO (16/10/2026): segunda visita con la fecha de la primera; lo ya hecho no se toca ni se envía
var COMPLETAR = null;
function tarjetaEquipo(id) { return Array.prototype.filter.call(document.querySelectorAll('.tarjeta.equipo'), function (t) { return v(t.querySelector('[data-k="id"]')) === id; })[0]; }
function tarjetaSala(l) { return Array.prototype.filter.call(document.querySelectorAll('.tarjeta.sala'), function (t) { return v(t.querySelector('[data-s="letra"]')) === l; })[0]; }
function marcarHecho(t, txt) {
  t.setAttribute('data-hecho', '1'); t.style.opacity = '0.65';
  Array.prototype.forEach.call(t.children, function (ch) { if (ch.tagName !== 'H2') ch.style.display = 'none'; });
  var p = el('p', { 'class': 'ayuda', style: 'color:#375623;font-weight:600;font-size:13px' }); p.textContent = '✔ ' + txt; t.appendChild(p);
}
function aplicarCompletar(inc) {
  COMPLETAR = inc;
  var fe = document.getElementById('fecha'); fe.value = inc.fecha; fe.setAttribute('data-sug', inc.fecha); fe.readOnly = true; fe.title = 'Fecha del control que se completa';
  (inc.hechos || []).forEach(function (h) { var t = tarjetaEquipo(h.id); if (t) marcarHecho(t, 'Equipo ' + h.id + ' hecho el ' + inc.f + (h.tec ? ' por ' + h.tec : '') + ': ya está en la base; no se vuelve a enviar.'); });
  (inc.salasHechas || []).forEach(function (h) { var t = tarjetaSala(h.l); if (t) marcarHecho(t, 'Sala ' + h.l + ' hecha el ' + inc.f + (h.tec ? ' por ' + h.tec : '') + ': ya está en la base; no se vuelve a enviar.'); });
  document.getElementById('cargando').textContent = 'Completando el control del ' + inc.f + ': rellene solo lo que falta (' + inc.faltan.join(', ') + ').';
  colorear(); guardarBorrador();
}
function informe() {
  var eqs = [], sas = [], globalNo = false, globalPend = false;
  Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.equipo'), function (t) {
    if (t.getAttribute('data-hecho')) return;
    var id = v(t.querySelector('[data-k="id"]')), pan = esPan(t), filas = [];
    if (v(t.querySelector('[data-k="funciona"]')) === 'No') {   // no funciona: sin pruebas, «NO VALORADO» (15/10/2026)
      autoValoraciones(t, []);
      eqs.push({ nofunc: true, n: 0, serie: t.getAttribute('data-serie') || '', ubic: t.getAttribute('data-ubic') || '', gen: '', rec: '', id: id, tipo: pan ? 'Panorámico' : 'Intraoral',
                 desc: (t.querySelector('.desc') || {}).textContent || '', val: 'NO VALORADO', filas: [['—', 'El equipo no funciona a la fecha del control', '', '', '', 'NO VALORADO', []]], rev: '', obs: v(t.querySelector('[data-k="obs"]')) });
      return;
    }
    var dis = Array.prototype.map.call(t.querySelectorAll('tbody tr'), function (r) {
      var g = function (k) { return n_(r.querySelector('[data-d="' + k + '"]').value); };
      return { kvf: g('kvf'), maf: g('maf'), tf: g('tf'), kvm: g('kvm'), tm: g('tm'), dosis: g('dosis'), dist: g('dist') };
    }).filter(function (x) { return !isNaN(x.kvm) || !isNaN(x.tm) || !isNaN(x.dosis); });
    var rev = v(t.querySelector('[data-k="revision"]'));
    if (!dis.length && !v(t.querySelector('[data-f="hvl"]')) && !rev) return;
    var grupos = [], idx = {}; dis.forEach(function (x) { var k = [x.kvf, x.maf, x.tf].join('|'); if (!(k in idx)) { idx[k] = grupos.length; grupos.push([]); } grupos[idx[k]].push(x); });
    var sgn = function (x) { return (x >= 0 ? '+' : '') + fx(x * 100, 1) + ' %'; };
    filas = pan ? filasPanoramico(t) : filasIntraoral(t);   // 14/10/2026
    rev = autoValoraciones(t, filas);
    // (14/10/2026, decisión del usuario) el informe solo lleva las pruebas REALIZADAS y la valoración se refiere a ellas
    var nHechas = filas.filter(function (f) { return f[5] === 'CONFORME' || f[5] === 'NO CONFORME'; }).length;
    filas = filas.filter(function (f) { return f[5] === 'CONFORME' || f[5] === 'NO CONFORME' || f[5] === 'NO PROCEDE'; });
    var no = filas.some(function (f) { return f[5] === 'NO CONFORME'; }) || rev === 'Sí';
    var val = no ? 'NO APTO' : nHechas ? 'APTO' : 'INCOMPLETO'; if (no) globalNo = true; if (!nHechas && !no) globalPend = true;
    eqs.push({ serie: t.getAttribute('data-serie') || '', ubic: t.getAttribute('data-ubic') || '', gen: v(t.querySelector('[data-k="gen"]')), rec: v(t.querySelector('[data-k="rec"]')), n: nHechas, id: id, tipo: pan ? 'Panorámico' : 'Intraoral', desc: (t.querySelector('.desc') || {}).textContent || '', val: val, filas: filas, rev: rev, obs: v(t.querySelector('[data-k="obs"]')) });
  });
  // salas: dosis anual estimada (fórmula de la base antigua; mR/h → mSv/año; µSv/h ÷ 10)
  Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.sala'), function (t) {
    var g = function (k) { return n_(t.querySelector('[data-s="' + k + '"]').value); }, letra = v(t.querySelector('[data-s="letra"]')), eqm = v(t.querySelector('[data-s="equipo"]'));
    if (t.getAttribute('data-hecho')) return;
    if (salaSinMedir(t)) { sas.push({ nofunc: true, letra: letra, eq: eqm, filas: [], val: 'NO VALORADA', mx: null }); return; }   // 15/10/2026
    var carga = g('carga'), ma = g('ma'), panS = false, cargaTxt = '';
    Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.equipo'), function (te) { if (eqm && v(te.querySelector('[data-k="id"]')) === eqm) panS = esPan(te); });
    if (isNaN(carga)) { carga = panS ? TOL.W_PAN : TOL.W_INT; cargaTxt = ' (tabla de cargas)'; }
    var filas = [], pend = false;
    Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (r, i) {
      var q = function (k) { return v(r.querySelector('[data-p="' + k + '"]')); }, val = n_(q('valor')), uni = q('uni'), fo = { '1': 1, '1/4': 0.25, '1/16': 0.0625 }[q('fo')];
      if (!q('eti') && isNaN(val)) return;
      if (isNaN(val)) { pend = true; filas.push([LETRAS_PUNTO[i], q('eti'), q('haz'), q('fo'), '', '', 'PENDIENTE', NaN]); return; }
      var tasa = /^mR\/h/i.test(uni) ? val : /Sv\/h/i.test(uni) ? val / 10 : NaN;
      var da = (!isNaN(tasa) && fo !== undefined && ma) ? (5 / 600) * fo * carga * tasa / ma : NaN;
      if (isNaN(da)) pend = true;
      filas.push([LETRAS_PUNTO[i], q('eti'), q('haz'), q('fo'), fx(val, 2) + ' ' + uni, isNaN(da) ? '(faltan datos)' : fx(da, 4), isNaN(da) ? 'PENDIENTE' : (da <= TOL.LIM_PUB ? 'CONFORME' : 'NO CONFORME'), da]);
    });
    filas = filas.filter(function (f) { return f[6] !== 'PENDIENTE'; });   // puntos sin medir: no salen (14/10/2026)
    if (!filas.length) return;
    var no = filas.some(function (f) { return f[6] === 'NO CONFORME'; }), val = no ? 'NO APTO' : 'APTO';
    if (no) globalNo = true;
    var das = filas.filter(function (f) { return !isNaN(f[7]); }), mx = das.length ? das.reduce(function (a2, b2) { return b2[7] > a2[7] ? b2 : a2; }) : null;
    sas.push({ letra: letra, eq: eqm, kv: g('kv'), ma: ma, t: g('t'), carga: carga, cargaTxt: cargaTxt, filas: filas, val: val, mx: mx });
  });
  // ---------- presentación
  var hayAlgo = eqs.length || sas.length, gv = !hayAlgo ? '' : globalNo ? 'NO APTO' : eqs.concat(sas).some(function (x) { return x.val === 'APTO'; }) ? 'APTO' : 'INCOMPLETO';
  document.getElementById('global').innerHTML = gv ? chip('Valoración global: ' + gv).replace('r Valoración_global:_' + gv.replace(/ /g, '_'), 'r ' + gv.replace(/ /g, '_')) : '';
  if (!hayAlgo) { document.getElementById('inf-cuerpo').innerHTML = '<p class="ayuda">Aún no hay lecturas.</p>'; return; }
  var tec = document.getElementById('tecnico').value, x = instrDe(tec), f = document.getElementById('fecha').value, fecha = f ? f.split('-').reverse().join('/') : '';
  var inst = document.getElementById('inst').value, cod = inst.split(' · ')[0], tit = inst.indexOf(' · ') > 0 ? inst.slice(inst.indexOf(' · ') + 3) : '';
  var sub = 'Equipos de radiodiagnóstico dental – Protocolo Español de Control de Calidad en Radiodiagnóstico (SEFM-SEPR-SERAM, Rev. 2011)';
  var sec = function (txt, n, normal) { return '<tr class="sec"><td colspan="' + n + '"' + (normal ? ' style="text-transform:none"' : '') + '>' + txt + '</td></tr>'; };
  var par = function (et, val) { return '<tr><td class="et">' + et + '</td><td>' + (val || '') + '</td></tr>'; };
  var C = (ANT && ANT._cod === cod && ANT.cab) || {}, nC = v(document.getElementById('ncontrol')) || '1';
  if (C.tit) tit = C.tit;
  var idCtl = cod ? cod + '-' + (f ? f.slice(0, 4) : '') + '-' + nC : '';
  var instrTxt = function (a, sr, fc) { a = v(document.getElementById(a)); sr = v(document.getElementById(sr)); fc = v(document.getElementById(fc)); return a ? a + (sr ? ' · nº de serie ' + sr : '') + (fc ? ' · calibración ' + fc : '') : ''; };
  var mult = instrTxt('mmarca', 'mserie', 'mfc') || v(document.getElementById('medidor')), moni = instrTxt('omarca', 'oserie', 'ofc') || (x && x.ts ? x.ts : ''), maniq = v(document.getElementById('maniqui'));
  var obsG = v(document.getElementById('obsgen')).replace(/</g, '&lt;');
  var firmas = '<div class="firmas"><div>Realizado por: ' + (tec || '') + '<div class="lin"></div>Firma:</div></div>';   // sin «Supervisado por»: no se requiere en radiodiagnóstico dental (14/10/2026)
  var h = '<div class="hoja">' + cab('INFORME DE CONTROL DE CALIDAD', sub) +
    '<table>' + sec('1. TITULAR E INSTALACIÓN', 2) + par('Titular', tit) + par('NIF/CIF', C.nif) + par('Instalación (registro)', cod + (C.reg ? ' · nº de registro ' + C.reg : '')) + par('Dirección', [C.dir, C.mun].filter(Boolean).join(', ')) + '</table>' +
    '<table>' + sec('2. DATOS DEL CONTROL', 2) + par('Nº de control', idCtl) + par('Fecha', fecha) + par('Motivo', v(document.getElementById('motivo'))) + par('Criterio aplicado', 'PECCRD 2011 (pruebas esenciales, Anexo I)') +
      par('Instrumentación', mult) + (maniq ? par('Maniquí de calidad de imagen', maniq) : '') + par('Monitor de radiación', moni) + '</table>' +
    '<table>' + sec('3. EQUIPOS – CONTROL DE CALIDAD', 4) + '<tr class="cols"><th>ID equipo</th><th>Tipo</th><th>Marca / modelo</th><th>Valoración</th></tr>' +
    (eqs.map(function (e) { return '<tr><td>' + e.id + '</td><td>' + e.tipo + '</td><td>' + e.desc + '</td>' + celdaRes(e.val) + '</tr>'; }).join('') || '<tr><td colspan="4">—</td></tr>') + '</table>' +
    '<table>' + sec('4. NIVELES DE RADIACIÓN EN ZONAS COLINDANTES (GS 5.11 CSN)', 5) + '<tr class="cols"><th>Sala</th><th>Equipo de medida</th><th>Puntos</th><th>Dosis anual máx. estimada</th><th>Valoración</th></tr>' +
    (sas.map(function (s2) { return '<tr><td>Sala ' + s2.letra + '</td><td>' + s2.eq + '</td><td class="c">' + s2.filas.length + '</td><td class="c">' + (s2.mx ? fx(s2.mx[7], 4) + ' mSv/año (' + s2.mx[0] + ' – ' + s2.mx[1] + ')' : '') + '</td>' + celdaRes(s2.val) + '</tr>'; }).join('') || '<tr><td colspan="5">—</td></tr>') + '</table>' +
    '<table class="glob"><tr><td class="et">VALORACIÓN GLOBAL DE LA INSTALACIÓN EN ESTE CONTROL</td>' + celdaRes(gv) + '</tr></table>' +
    (obsG ? '<p class="txt"><b>Observaciones:</b> ' + obsG + '</p>' : '') +
    '<p class="ley">APTO: todas las pruebas dentro de tolerancia y dosis anuales estimadas por debajo del límite de cada zona · NO APTO: algún resultado fuera de tolerancia (ver fichas) · Solo figuran las pruebas realizadas en este control; la valoración se refiere a ellas.</p>' +
    '<p class="txt">Se adjunta una ficha de resultados por cada equipo controlado (condiciones de medida, valores obtenidos, tolerancia y resultado de cada parámetro) y una ficha de niveles de radiación con las medidas tras cada barrera y la dosis anual estimada.</p>' +
    '<p class="ley">Pruebas esenciales del PECCRD 2011 (Anexo I) realizadas en este control. Informe provisional generado desde la página web; el informe oficial es el de la base de datos.</p>' + firmas + '</div>';
  eqs.forEach(function (e) {
    h += '<div class="hoja">' + cab('FICHA DE RESULTADOS POR EQUIPO', 'Equipo dental ' + e.tipo.toLowerCase() + ' – pruebas esenciales PECCRD 2011') +
      '<table>' + sec('DATOS DEL CONTROL Y DEL EQUIPO', 4) +
      '<tr><td class="et">Titular</td><td>' + tit + '</td><td class="et">Nº de control</td><td>' + idCtl + '</td></tr>' +
      '<tr><td class="et">Instalación</td><td>' + cod + '</td><td class="et">Fecha</td><td>' + fecha + '</td></tr>' +
      '<tr><td class="et">ID equipo</td><td>' + e.id + ' (' + e.tipo.toLowerCase() + ')</td><td class="et">Sala</td><td>' + (e.ubic || '') + '</td></tr>' +
      '<tr><td class="et">Marca / modelo</td><td>' + e.desc + '</td><td class="et">Nº de serie</td><td>' + (e.serie || '') + '</td></tr>' +
      '<tr><td class="et">' + (e.tipo === 'Panorámico' ? 'Modo controlado' : 'Generador') + '</td><td>' + (e.gen || '') + '</td><td class="et">Receptor</td><td>' + (e.rec || '') + '</td></tr></table>' +
      '<table>' + sec('RESULTADOS DE LAS MEDIDAS', 6) + '<tr class="cols"><th>Código</th><th>Parámetro</th><th>Condiciones / técnica</th><th>Valor medido</th><th>Tolerancia</th><th>Resultado</th></tr>' +
      e.filas.map(function (r) {
        return '<tr><td class="c">' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td class="b">' + r[3] + '</td><td>' + r[4] + '</td>' + celdaRes(r[5]) + '</tr>' +
          (r[6] || []).map(function (d) { return '<tr class="det"><td></td><td>' + d[0] + '</td><td></td><td>' + d[1] + '</td><td></td>' + (d[2] ? '<td class="res ' + d[2] + '">' + d[2] + '</td>' : '<td></td>') + '</tr>'; }).join('');
      }).join('') + '</table>' +
      '<table class="glob"><tr><td class="et">VALORACIÓN DEL EQUIPO · pruebas realizadas: ' + e.n + (e.rev ? ' (¿necesita revisión? ' + e.rev + ')' : '') + '</td>' + celdaRes(e.val) + '</tr></table>' +
      (e.obs ? '<p class="txt">Observaciones: ' + e.obs + '</p>' : '') +
      '<p class="ley">Resultado por prueba: CONFORME = dentro de tolerancia; NO CONFORME = fuera de tolerancia; NO PROCEDE = no corresponde a este equipo (p. ej. por el tipo de receptor); NO VALORADO = el equipo no funciona a la fecha del control. Puntos de detalle: Correcto / Incorrecto según la tolerancia de la prueba. Criterio aplicado: PECCRD 2011.</p>' + firmas + '</div>';
  });
  if (sas.length) {
    h += '<div class="hoja">' + cab('FICHA DE NIVELES DE RADIACIÓN', 'Niveles de radiación en zonas colindantes y dosis anual estimada (GS 5.11 CSN)');
    sas.forEach(function (s2) {
      if (s2.nofunc) { h += '<table>' + sec('SALA ' + s2.letra + ' – equipo ' + s2.eq, 2, true) + '<tr><td>El equipo no funciona a la fecha del control: no se han medido los niveles de radiación.</td>' + celdaRes('NO VALORADA') + '</tr></table>'; return; }
      h += '<table>' + sec('SALA ' + s2.letra + ' – equipo ' + s2.eq + ' · técnica ' + tecTxt({ kvf: s2.kv, maf: s2.ma, tf: s2.t }) + ' · carga ' + fx(s2.carga, 0) + ' mA·min/semana' + s2.cargaTxt, 7, true) +
        '<tr class="cols"><th style="width:7%">Punto</th><th style="width:27%">Ubicación (etiqueta)</th><th style="width:13%">Tipo de haz</th><th style="width:7%">T</th><th style="width:15%">Valor medido</th><th style="width:15%">Dosis anual (mSv/año)</th><th style="width:16%">Resultado</th></tr>' +
        s2.filas.map(function (r) { return '<tr><td class="c">' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td class="c">' + r[3] + '</td><td>' + r[4] + '</td><td class="c">' + r[5] + '</td>' + celdaRes(r[6]) + '</tr>'; }).join('') +
        '<tr><td colspan="6" class="et">VALORACIÓN DE LA SALA ' + s2.letra + ' (límite ' + TOL.LIM_PUB + ' mSv/año, público)</td>' + celdaRes(s2.val) + '</tr></table>';
    });
    h += '<p class="ley">Dosis anual estimada = (5/600) · T · carga · tasa (mR/h) / mA, como en la base de datos (1 mR/h ≈ 10 µSv/h). T = factor de ocupación.</p>' + firmas + '</div>';
  }
  document.getElementById('inf-cuerpo').innerHTML = h;
}
function n_(x) { x = String(x || '').trim().replace(',', '.'); return x === '' ? NaN : Number(x); }
function falta(e, cond) { if (e && cond && !String(e.value || '').trim()) { e.classList.add('falta'); return 1; } return 0; }
// CHR por atenuación (13/10/2026, petición del usuario; fórmula de la plantilla Excel): K sin = dosis del PRIMER disparo de
// la tabla (con lecturas); kV de la filtración = kVp MEDIDO de ese disparo; espesor por defecto 2 mm Al; la CHR calculada
// se pone como sugerida (verde) salvo que se haya escrito a mano (data-manual).
function calcularCHR() {
  Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.equipo'), function (t) {
    // primer disparo con alguna LECTURA (kV medido, tiempo o dosis)
    var filas = Array.prototype.filter.call(t.querySelectorAll('tbody tr'), function (r) { return ['kvm', 'tm', 'dosis'].some(function (k) { return !isNaN(n_(r.querySelector('[data-d="' + k + '"]').value)); }); });
    // (13/10/2026, decisión del usuario) referencia = PRIMER disparo con dosis; kV de la filtración = su kVp MEDIDO
    var ult = filas.length ? filas[0] : null, dsin = ult ? n_(ult.querySelector('[data-d="dosis"]').value) : NaN, tsin = ult ? n_(ult.querySelector('[data-d="tm"]').value) : NaN;
    var ek = t.querySelector('[data-f="kvf"]'), ee = t.querySelector('[data-f="esp"]'), ec = t.querySelector('[data-f="dcon"]'), eh = t.querySelector('[data-f="hvl"]');
    if (!ek || !ee || !ec || !eh) return;
    var dcon = n_(ec.value), tcon = n_((t.querySelector('[data-f="tcon"]') || {}).value), conTasa = !isNaN(tsin) && tsin > 0 && !isNaN(tcon) && tcon > 0;
    var sp = t.querySelector('.dsin'); if (sp) sp.textContent = isNaN(dsin) ? '(sin disparos)' : fxs(dsin) + ' mGy' + (isNaN(tsin) ? '' : ' · t ' + fxs(tsin) + (tsin ? ' → ' + fxs(dsin / tsin) + ' mGy/s' : ''));
    var kSin = conTasa ? dsin / tsin : dsin, kCon = conTasa ? dcon / tcon : dcon;
    ek.removeAttribute('data-sug'); ee.removeAttribute('data-sug');
    if (!ek.value || ek.getAttribute('data-auto') === '1') { var kv = ult ? ult.querySelector('[data-d="kvm"]').value : ''; ek.value = kv; if (kv) ek.setAttribute('data-auto', '1'); else ek.removeAttribute('data-auto'); }
    if (!ee.value) { ee.value = '2'; ee.setAttribute('data-def', '1'); }   // espesor por defecto: 2 mm Al
    var x = n_(ee.value), ra = t.querySelector('.ratio');
    if (!isNaN(kSin) && !isNaN(kCon) && !isNaN(x) && kCon > 0 && kCon < kSin) {
      var chr = x * Math.LN2 / Math.log(kSin / kCon), rel = kCon / kSin, txtC = fx(chr, 2);
      if (eh.getAttribute('data-manual') !== '1' || !eh.value) { eh.value = txtC; eh.setAttribute('data-sug', txtC); eh.removeAttribute('data-manual'); }
      if (ra) ra.textContent = (conTasa ? 'con tasas (dosis / t medido) · ' : 'con dosis (falta el tiempo medido con filtro) · ') + 'relación K con / K sin = ' + fx(rel, 2) + (rel < 0.3 || rel > 0.7 ? ' ⚠ lejos de 0,5: el resultado es menos fiable' : '');
    } else {
      if (eh.getAttribute('data-manual') !== '1' && eh.getAttribute('data-sug') !== null && eh.value === eh.getAttribute('data-sug')) { eh.value = ''; eh.removeAttribute('data-sug'); }
      if (ra) ra.textContent = (!isNaN(kCon) && !isNaN(kSin) && kCon >= kSin) ? '⚠ con filtro debe ser menor que sin filtro' : '';
    }
  });
}
document.addEventListener('change', function (ev) {
  var e = ev.target; if (e && e.getAttribute && e.getAttribute('data-f') === 'kvf') e.removeAttribute('data-auto');   // kV escrito a mano: se respeta
  if (e && e.getAttribute && e.getAttribute('data-f') === 'hvl') { if (e.value && e.value !== e.getAttribute('data-sug')) e.setAttribute('data-manual', '1'); else e.removeAttribute('data-manual'); }
}, true);
function colorear() {
  try { calcularCHR(); } catch (x) { }
  try { informe(); } catch (x) { }   // primero: rellena las valoraciones automáticas que luego se colorean
  var nf = 0;
  Array.prototype.forEach.call(document.querySelectorAll('main input, main select, main textarea'), function (e) {
    e.classList.remove('sug', 'cambiado', 'falta', 'violeta');
    var s = e.getAttribute('data-sug');
    if (s !== null) {   // igual al sugerido: en las numéricas se compara el NÚMERO (0,2 = ,2 = 0,20)
      var igual = String(e.value).trim() === s;
      if (!igual && e.classList.contains('num')) { var a1 = n_(e.value), a2 = n_(s); igual = !isNaN(a1) && !isNaN(a2) && a1 === a2; }
      e.classList.add(igual ? 'sug' : 'cambiado');
    }
    var a = e.getAttribute('data-ant');
    if (a !== null && String(e.value).trim()) {
      var va = n_(a), vv = n_(e.value), umb = e.closest('.sala') ? UMBRAL_SALA : UMBRAL;
      if (!isNaN(va) && !isNaN(vv) && va !== 0 && Math.abs(vv - va) / Math.abs(va) > umb) e.classList.add('violeta');
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.equipo'), function (t) {
    if (t.getAttribute('data-hecho')) return;
    var conDatos = false, pan0 = esPan(t), noF = v(t.querySelector('[data-k="funciona"]')) === 'No', cu = t.querySelector('.cuerpo-eq');
    if (cu) cu.style.display = noF ? 'none' : '';
    papeles(t).filas.forEach(function (x) { var c = x.r.querySelector('.papel'); if (c) c.textContent = x.papel; });
    Array.prototype.forEach.call(t.querySelectorAll('[data-clase]'), function (e) { if ((e.getAttribute('data-clase') === 'pan') !== pan0) e.style.display = 'none'; else if (!e.getAttribute('data-tipo')) e.style.display = ''; });
    var md = v(t.querySelector('[data-k="mdisp"]'));
    if (md && !pan0) { var xd = papeles(t).filas.filter(function (x) { return x.papel === md; })[0];
      if (xd) [['mkv', xd.kvf], ['mma', xd.maf], ['mt', xd.tf]].forEach(function (z) { var e = t.querySelector('[data-k="' + z[0] + '"]'); if (e && !isNaN(z[1])) { var tx = fx(z[1], 3).replace(/0+$/, '').replace(/,$/, ''); e.value = tx; e.setAttribute('data-sug', tx); } }); }
    var tipo0 = tipoReceptor(t), np0 = noProceden(tipo0), rot = t.querySelector('.noprocede');
    Array.prototype.forEach.call(t.querySelectorAll('[data-tipo]'), function (e) { var cl = e.getAttribute('data-clase'); e.style.display = (procede(e.getAttribute('data-tipo'), tipo0) && (!cl || (cl === 'pan') === pan0)) ? '' : 'none'; });
    if (rot) rot.textContent = np0.length ? 'No proceden (' + (tipo0 === 'pel' ? 'equipo analógico, película' : 'equipo digital') + '): ' + np0.map(function (x) { return x[0]; }).join(', ') + '.' : '';
    Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (r) {
      var tec = TEC_DISPARO.slice(0, 3).some(function (k) { return String(r.querySelector('[data-d="' + k + '"]').value).trim(); });
      if (tec) { conDatos = true; LECT_DISPARO.forEach(function (k) { nf += falta(r.querySelector('[data-d="' + k + '"]'), true); }); }
      // rendimiento del disparo (µGy/mAs a 1 m) con el tiempo MEDIDO (si falta, el fijado); la distancia es obligatoria con dosis
      var g = function (k) { return n_(r.querySelector('[data-d="' + k + '"]').value); }, ds = g('dosis'), dd = g('dist'), mm = g('maf'), tt = !isNaN(g('tm')) ? g('tm') : g('tf'), cR = r.querySelector('.rend');
      if (!isNaN(ds)) nf += falta(r.querySelector('[data-d="dist"]'), true);
      if (cR) cR.textContent = (!isNaN(ds) && !isNaN(dd) && mm && tt) ? fx(ds * 1000 * Math.pow(dd / 100, 2) / (mm * tt), 1) : '';
    });
    var fk = t.querySelector('[data-f="kvf"]').value || t.querySelector('[data-f="esp"]').value;
    nf += falta(t.querySelector('[data-f="hvl"]'), fk);
    nf += falta(t.querySelector('[data-f="tcon"]'), !isNaN(n_((t.querySelector('[data-f="dcon"]') || {}).value)));
    nf += falta(t.querySelector('[data-k="id"]'), conDatos || noF);
    nf += falta(t.querySelector('[data-k="revision"]'), conDatos);
    nf += falta(t.querySelector('[data-k="rec"]'), conDatos);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tarjeta.sala'), function (t) {
    var conPuntos = false;
    if (t.getAttribute('data-hecho')) return;
    if (salaSinMedir(t, true)) return;
    Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (r) {
      if (String(r.querySelector('[data-p="eti"]').value).trim()) { conPuntos = true; nf += falta(r.querySelector('[data-p="valor"]'), true); nf += falta(r.querySelector('[data-p="uni"]'), true); }
    });
    nf += falta(t.querySelector('[data-s="letra"]'), conPuntos);
  });
  var est = document.getElementById('estado'), hay = document.querySelectorAll('.tarjeta.equipo, .tarjeta.sala').length;
  est.className = nf ? 'mal' : 'bien';
  est.textContent = !hay ? '' : (nf ? '⚠ Faltan ' + nf + ' dato(s) (casillas naranjas)' : '✔ Todo completo');
  return nf;
}

function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (html) e.innerHTML = html; return e; }
function opciones(lista, vacia) { return (vacia ? '<option></option>' : '') + lista.map(function (o) { return '<option>' + o + '</option>'; }).join(''); }
function num(attrs) { attrs = attrs || ''; return '<input ' + (attrs.indexOf('class=') < 0 ? 'class="num" ' : '') + 'inputmode="decimal" ' + attrs + '>'; }

function nuevoEquipo() {
  nEq++; var id = 'eq' + nEq;
  var t = el('div', { 'class': 'tarjeta equipo', id: id });
  t.innerHTML = '<h2>Equipo <span class="desc"></span><button type="button" class="quitar" title="Quitar este equipo" onclick="quitar(\'' + id + '\')">✕ quitar</button></h2>' +
    '<div class="fila"><div class="campo"><label>ID_EQUIPO (código del censo)</label><input data-k="id" list="lista-eq" placeholder="p. ej. GSSUGVIZ1"></div>' +
    '<div class="campo"><label>¿El equipo funciona?</label><select data-k="funciona">' + opciones(['Sí', 'No'], true) + '</select></div>' +
    '<div class="campo"><label>Instrumento de medida (nº)</label>' + num('data-k="instr"') + '</div></div>' +
    '<div class="cuerpo-eq">' +
    '<h3>Disparos</h3><p class="ayuda">Intraorales: <b>D1–D3</b> con el mismo kV y mA y tres tiempos distintos (corto, habitual, largo). <b>D4</b> solo si el equipo permite otra tensión: otro kV con el mismo tiempo que D1. Panorámicos: <b>P1–P3</b> a 80 kV (o el más cercano) y <b>P4–P6</b> al otro kV, mismos mA y programa. La columna «Papel» se pone sola.</p><div class="tabla"><table><thead><tr><th>Nº</th><th>Papel</th>' + CAMPOS_DISPARO.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '<th title="Dosis · 1000 · (d/100)² / (mA · t medido), como el libro Excel y la base antigua">Rend. (µGy/mAs a 1 m)</th>' +
    '<th></th></tr></thead><tbody></tbody></table></div>' +
    '<div class="acciones"><button type="button" onclick="nuevoDisparo(\'' + id + '\')">+ disparo</button></div>' +
    '<h3>Equipo y comprobaciones sin disparo</h3><div class="fila">' +
    '<div class="campo"><label>Tipo de equipo</label><select data-k="clase">' + opciones(['Intraoral', 'Panorámico / cefalométrico'], true) + '</select></div>' +
    '<div class="campo" data-clase="pan"><label>PC002 · ¿haz contenido en la rendija / detector?</label><select data-k="pc2a">' + opciones(['Sí', 'No'], true) + '</select></div>' +
    '<div class="campo" data-clase="pan"><label>PC002 · ¿haz centrado en la fila de detectores?</label><select data-k="pc2b">' + opciones(['Sí', 'No'], true) + '</select></div>' +
    '<div class="campo" data-clase="pan"><label>PC002 · ¿artefactos o defectos de imagen por desalineación?</label><select data-k="pc2c">' + opciones(['No', 'Sí'], true) + '</select></div>' +
    '<div class="campo"><label>Tipo de generador</label><select data-k="gen">' + opciones(['Alta frecuencia', 'Monofásico'], true) + '</select></div>' +
    '<div class="campo"><label>Receptor de imagen (analógico / digital)</label><select data-k="rec">' + opciones(['Digital directo (sensor/panel)', 'Digital CR (placas de fósforo)', 'Película'], true) + '</select></div>' +
    '<div class="campo" data-clase="intra"><label>DL001 · colimador</label><select data-k="col">' + opciones(['Circular', 'Rectangular'], true) + '</select></div>' +
    '<div class="campo" data-clase="intra"><label>DL001 · Ø del campo (cm)</label>' + num('data-k="diam" class="num lec"') + '</div>' +
    '<div class="campo" data-clase="intra"><label>DL001 · lados si rectangular (cm)</label><span style="display:flex;gap:4px">' + num('data-k="l1" class="num lec" style="width:64px"') + num('data-k="l2" class="num lec" style="width:64px"') + '</span></div>' +
    '<div class="campo" data-clase="intra"><label>DL002 · foco – extremo del localizador (cm)</label>' + num('data-k="dfpl" class="num lec"') + '</div>' +
    '<div class="campo" data-clase="intra"><label>DL007 · ¿temporizador mecánico?</label><select data-k="tmec">' + opciones(['No', 'Sí'], true) + '</select></div>' +
    '<div class="campo"><label>DL011 · magnitud que se varía</label><select data-k="dl011">' + opciones(['Carga (mAs)', 'Corriente (mA)'], true) + '</select></div>' +
    '<div class="campo" data-clase="intra"><label>DL015 · método</label><select data-k="dl015m">' + opciones(['Estimado a partir del rendimiento', 'Medido'], true) + '</select></div>' +
    '<div class="campo" data-clase="intra"><label>DL015 · técnica: disparo</label><select data-k="mdisp" title="Disparo cuya técnica es la del molar superior adulto">' + opciones(['D1', 'D2', 'D3', 'D4'], true) + '</select></div>' +
    '<div class="campo" data-clase="intra"><label>DL015 · técnica del molar superior adulto: kV | mA | t (s)</label><span style="display:flex;gap:4px">' + num('data-k="mkv" style="width:58px" placeholder="kV"') + num('data-k="mma" style="width:58px" placeholder="mA"') + num('data-k="mt" class="num lec" style="width:64px" placeholder="t (s)"') + '</span></div>' +
    '<div class="campo" data-clase="intra"><label>DL015 · kerma medido (mGy) · solo «Medido»</label>' + num('data-k="mker" class="num lec"') + '</div>' +
    '<div class="campo" data-clase="intra"><label>DL015 · ¿medido con retrodispersión?</label><select data-k="mret">' + opciones(['No', 'Sí'], true) + '</select></div>' +
    '<div class="campo" data-tipo="pel" data-clase="intra"><label>DL014 · cuarto oscuro</label><select data-k="dl014">' + opciones(['No procede', 'Medido'], true) + '</select></div>' +
    '<div class="campo" data-tipo="pel" data-clase="intra"><label>DL014 · base + velo (DO)</label>' + num('data-k="bvelo" class="num lec"') + '</div></div>' +
    '<p class="ayuda noprocede" style="color:#595959;font-style:italic"></p>' +
    '<p class="ayuda">Las pruebas que no se hagan se dejan en blanco: no salen en el informe. Las que no corresponden al receptor (analógico / digital) salen como «NO PROCEDE».</p>' +
    '<h3>Filtración · capa hemirreductora</h3><p class="ayuda">Repita el <b>primer disparo</b> de la tabla con la lámina de Al junto al colimador y sin mover el detector, y anote la dosis y el tiempo medido. CHR = x · ln 2 / ln(K sin / K con) con K = dosis / tiempo medido (tasa de kerma: corrige las diferencias del tiempo real respecto al seleccionado). Si el medidor da la CHR directamente, escríbala en «HVL».</p>' +
    '<div class="fila"><div class="campo"><label>kVp (medido en el primer disparo)</label>' + num('data-f="kvf"') + '</div>' +
    '<div class="campo"><label>Espesor filtro (mm Al)</label>' + num('data-f="esp"') + '</div><div class="campo"><label>Sin filtro · primer disparo</label><span class="dsin" style="padding:6px 4px;font-weight:600"></span></div>' +
    '<div class="campo"><label>Dosis con filtro (mGy)</label>' + num('data-f="dcon" class="num lec"') + '</div>' +
    '<div class="campo"><label>Tiempo medido con filtro</label>' + num('data-f="tcon" class="num lec"') + '</div>' +
    '<div class="campo"><label>HVL (mm Al)</label>' + num('data-f="hvl" class="num lec"') + '<span class="ratio ayuda" style="margin:2px 0 0"></span></div></div>' +
    '</div>' +
    '<h3>Conclusiones</h3><div class="fila"><div class="campo"><label>¿Necesita revisión?</label><select data-k="revision">' + opciones(['No', 'Sí'], true) + '</select></div>' +
    ['Valoración dosis', 'Valoración rendimiento', 'Valoración tensión', 'Valoración filtración'].map(function (v, i) { return '<div class="campo"><label>' + v + '</label><select data-k="' + ['vdosis', 'vrend', 'vtens', 'vfilt'][i] + '">' + opciones(['Correcta', 'Incorrecta', 'No valorado', 'No procede'], true) + '</select></div>'; }).join('') +
    '</div><div class="campo" style="margin-top:8px"><label>Observaciones</label><textarea data-k="obs" maxlength="50"></textarea></div>' +
    '<div class="acciones"><button type="button" onclick="salaDeEquipo(this)">+ sala de este equipo (niveles de radiación)</button></div>';
  document.getElementById('equipos').appendChild(t);
  t.querySelector('[data-f="esp"]').value = '2'; t.querySelector('[data-f="esp"]').setAttribute('data-def', '1');   // espesor por defecto (2 mm Al)
  sug(t.querySelector('[data-k="gen"]'), 'Alta frecuencia'); sug(t.querySelector('[data-k="tmec"]'), 'No');
  sug(t.querySelector('[data-k="dl011"]'), 'Carga (mAs)'); sug(t.querySelector('[data-k="dl014"]'), 'No procede'); sug(t.querySelector('[data-k="dxresp"]'), 'Lineal'); sug(t.querySelector('[data-k="dl015m"]'), 'Estimado a partir del rendimiento'); sug(t.querySelector('[data-k="mret"]'), 'Sí');
  sug(t.querySelector('[data-k="funciona"]'), 'Sí');
  aplicarTecnico(t);
  for (var i = 0; i < 4; i++) nuevoDisparo(id);   // cuatro disparos por defecto (15/10/2026)
}
function nuevoDisparo(id) {
  var tb = document.querySelector('#' + id + ' tbody'), n = tb.rows.length + 1, tr = el('tr');
  tr.innerHTML = '<td class="n">' + n + '</td><td class="papel" style="font-weight:600;color:#1F4E78;background:#F2F2F2"></td>' + CAMPOS_DISPARO.map(function (c) { return '<td>' + num('data-d="' + c[0] + '"' + (LECT_DISPARO.indexOf(c[0]) >= 0 ? ' class="num lec"' : '')) + '</td>'; }).join('') +
    '<td class="rend" style="background:#F2F2F2;font-weight:600;white-space:nowrap"></td>' +
    LECT_DX.map(function (k) { return '<td data-tipo="dig">' + num('data-x="' + k + '" class="num lec"') + '</td>'; }).join('') + '<td><button type="button" class="quitar" title="Quitar el disparo" onclick="quitarFila(this)">✕</button></td>';
  tb.appendChild(tr); renumerar(tb);
}
function nuevaSala() {
  nSa++; var id = 'sa' + nSa;
  var t = el('div', { 'class': 'tarjeta sala', id: id });
  t.innerHTML = '<h2>Sala · niveles de radiación <button type="button" class="quitar" onclick="quitar(\'' + id + '\')">✕ quitar</button></h2>' +
    '<div class="fila"><div class="campo"><label>Letra de la sala</label><select data-s="letra">' + opciones(LETRAS_SALA, true) + '</select></div>' +
    '<div class="campo"><label>Equipo con el que se mide</label><input data-s="equipo"></div>' +
    '<div class="campo"><label>¿Se puede medir? (equipo en funcionamiento)</label><select data-s="funciona">' + opciones(['Sí', 'No'], true) + '</select></div>' +
    '<p class="ayuda nofunc-sala" style="flex-basis:100%;margin:0;color:#9C0006;font-weight:600"></p>' +
    '<p class="ayuda monitor-sala" style="flex-basis:100%;margin:0"></p>' +
    '<div class="campo"><label>kVp</label>' + num('data-s="kv"') + '</div><div class="campo"><label>mA</label>' + num('data-s="ma"') + '</div>' +
    '<div class="campo"><label>t (s)</label>' + num('data-s="t"') + '</div><div class="campo"><label>d (f, p) (cm)</label>' + num('data-s="dfp"') + '</div>' +
    '<div class="campo"><label>Carga (mA·min/semana)</label>' + num('data-s="carga"') + '</div></div>' +
    '<h3>Puntos de medida</h3><div class="tabla"><table><thead><tr><th>Punto</th><th>Etiqueta (dónde se mide, máx. 20)</th><th>Valor medido</th><th>Unidades</th><th>Tipo de haz</th><th>Factor de ocupación</th><th></th></tr></thead><tbody></tbody></table></div>' +
    '<div class="acciones"><button type="button" onclick="nuevoPunto(\'' + id + '\')">+ punto</button></div>';
  document.getElementById('salas').appendChild(t);
  sug(t.querySelector('[data-s="funciona"]'), 'Sí');
  var xs = instrDe(document.getElementById('tecnico').value); if (xs && xs.ts) t.querySelector('.monitor-sala').textContent = 'Monitor de radiación: ' + xs.ts + ' (nº ' + xs.ns + ')';
  for (var i = 0; i < 4; i++) nuevoPunto(id);
}
function nuevoPunto(id) {
  var tb = document.querySelector('#' + id + ' tbody');
  if (tb.rows.length >= LETRAS_PUNTO.length) { alert('Como máximo ' + LETRAS_PUNTO.length + ' puntos por sala (límite de la base antigua).'); return; }
  var tr = el('tr');
  tr.innerHTML = '<td class="n"></td><td><input data-p="eti" maxlength="20"></td><td>' + num('data-p="valor" class="num lec"') + '</td>' +
    '<td><select data-p="uni">' + opciones(['mR/h', 'µSv/h', 'mR', 'µSv'], true) + '</select></td>' +
    '<td><select data-p="haz">' + opciones(['Secundario', 'Residual', 'Fuga'], true) + '</select></td>' +
    '<td><select data-p="fo">' + opciones(['1', '1/4', '1/16'], true) + '</select></td>' +
    '<td><button type="button" class="quitar" onclick="quitarFila(this)">✕</button></td>';
  tb.appendChild(tr); renumerar(tb);
}
// orden de los disparos (decisión del usuario, 13/10/2026): kV, mA y t FIJADOS de menor a mayor; filas vacías al final
function ordenarDisparos(tb) {
  if (!tb || tb.closest('.sala')) return;
  var val = function (r, k) { var x = n_(r.querySelector('[data-d="' + k + '"]').value); return isNaN(x) ? Infinity : x; };
  var filas = Array.prototype.slice.call(tb.rows), antes = filas.slice();
  filas.sort(function (a, b) { return (val(a, 'kvf') - val(b, 'kvf')) || (val(a, 'maf') - val(b, 'maf')) || (val(a, 'tf') - val(b, 'tf')) || (antes.indexOf(a) - antes.indexOf(b)); });
  if (filas.some(function (r, i) { return r !== antes[i]; })) { filas.forEach(function (r) { tb.appendChild(r); }); renumerar(tb); }
}
function renumerar(tb) {
  var sala = !!tb.closest('.sala');
  Array.prototype.forEach.call(tb.rows, function (r, i) { r.querySelector('.n').textContent = sala ? LETRAS_PUNTO[i] : (i + 1); });
}
function quitarFila(b) { var tb = b.closest('tbody'); b.closest('tr').remove(); renumerar(tb); guardarBorrador(); }
function quitar(id) {   // 16/10/2026: se confirma pulsando otra vez (sin confirm())
  var t = document.getElementById(id), b = t && t.querySelector('h2 .quitar'); if (!t) return;
  if (b && !b.getAttribute('data-seguro')) { b.setAttribute('data-seguro', '1'); b.textContent = '¿Seguro? Pulse otra vez para quitarlo'; b.style.color = '#C00000'; b.style.borderColor = '#C00000';
    setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-seguro'); b.textContent = '✕ quitar'; b.style.color = ''; b.style.borderColor = ''; } }, 5000); return; }
  t.remove(); guardarBorrador(); colorear();
}
function v(e) { return e ? String(e.value || '').trim() : ''; }

// atributos de una casilla para el borrador: [sugerido, anterior] (null si no tiene)
function atr(e) { return e ? [e.getAttribute('data-sug'), e.getAttribute('data-ant')] : [null, null]; }
function recoger(todo) {
  var d = { inst: v(document.getElementById('inst')), fecha: v(document.getElementById('fecha')), tecnico: v(document.getElementById('tecnico')), medidor: textoMedidor(), equipos: [], salas: [] };
  if (COMPLETAR) { var hoy = new Date(); d.completa = { fecha: COMPLETAR.fecha, real: ('0' + hoy.getDate()).slice(-2) + '/' + ('0' + (hoy.getMonth() + 1)).slice(-2) + '/' + hoy.getFullYear() }; if (todo) d._completar = COMPLETAR; }
  d.ident = {}; IDENT.forEach(function (k) { d.ident[k] = v(document.getElementById(k)); if (todo) d.ident['_' + k] = atr(document.getElementById(k)); });
  document.querySelectorAll('.equipo').forEach(function (t) {
    if (t.getAttribute('data-hecho')) return;   // ya está en la base (completar un control)
    var q = function (k) { return v(t.querySelector('[data-k="' + k + '"]')); }, f = function (k) { return v(t.querySelector('[data-f="' + k + '"]')); };
    var eq = { id: q('id'), instr: q('instr'), revision: q('revision'), vdosis: q('vdosis'), vrend: q('vrend'), vtens: q('vtens'), vfilt: q('vfilt'), obs: q('obs'),
               filt: { instr: q('instr'), kvf: f('kvf'), esp: f('esp'), hvl: f('hvl'), dcon: f('dcon'), tcon: f('tcon') }, disparos: [] };
    t.querySelectorAll('tbody tr').forEach(function (r) {
      // solo los disparos con alguna LECTURA (la técnica sugerida del control anterior, sola, no se envía)
      var x = {}, alguno = false; CAMPOS_DISPARO.forEach(function (c) { x[c[0]] = v(r.querySelector('[data-d="' + c[0] + '"]')); if (x[c[0]] && (todo || LECT_DISPARO.indexOf(c[0]) >= 0)) alguno = true; });
      LECT_DX.forEach(function (k) { x[k] = v(r.querySelector('[data-x="' + k + '"]')); if (x[k]) alguno = true; });
      if (todo) { x._m = {}; CAMPOS_DISPARO.forEach(function (c) { x._m[c[0]] = atr(r.querySelector('[data-d="' + c[0] + '"]')); }); }
      if (alguno) eq.disparos.push(x);
    });
    EXTRA_EQ.forEach(function (k) { eq[k] = q(k); });
    if (todo) { eq._serie = t.getAttribute('data-serie') || ''; eq._ubic = t.getAttribute('data-ubic') || ''; }
    if (todo) { eq._desc = (t.querySelector('.desc') || {}).textContent || ''; eq._m = { id: atr(t.querySelector('[data-k="id"]')), kvf: atr(t.querySelector('[data-f="kvf"]')), esp: atr(t.querySelector('[data-f="esp"]')), hvl: atr(t.querySelector('[data-f="hvl"]')), hvlManual: (t.querySelector('[data-f="hvl"]') || {}).getAttribute ? t.querySelector('[data-f="hvl"]').getAttribute('data-manual') : null, kvAuto: t.querySelector('[data-f="kvf"]').getAttribute('data-auto') }; }
    if (todo) EXTRA_EQ.forEach(function (k) { eq._m[k] = atr(t.querySelector('[data-k="' + k + '"]')); });
    // solo los equipos medidos o con conclusiones (los del censo sin tocar no se envían)
    if (todo || eq.disparos.length || eq.filt.hvl || eq.revision || eq.vdosis || eq.vrend || eq.vtens || eq.vfilt || eq.obs || MEDIDOS_EQ.some(function (k) { var e2 = t.querySelector('[data-k="' + k + '"]'); return eq[k] && (!e2 || eq[k] !== e2.getAttribute('data-sug')); })) d.equipos.push(eq);   // 16/10/2026: lo propuesto (verde) no cuenta como medido
  });
  document.querySelectorAll('.sala').forEach(function (t) {
    if (t.getAttribute('data-hecho')) return;
    var s = function (k) { return v(t.querySelector('[data-s="' + k + '"]')); };
    var sa = { letra: s('letra'), equipo: s('equipo'), funciona: s('funciona'), kv: s('kv'), ma: s('ma'), t: s('t'), dfp: s('dfp'), carga: s('carga'), puntos: [] };
    t.querySelectorAll('tbody tr').forEach(function (r, i) {
      var p = { punto: LETRAS_PUNTO[i] }, alguno = false;
      ['eti', 'valor', 'uni', 'haz', 'fo'].forEach(function (k) { p[k] = v(r.querySelector('[data-p="' + k + '"]')); });
      alguno = todo ? !!(p.eti || p.valor || p.d) : !!p.valor;   // solo los puntos medidos
      if (todo) { p._m = {}; ['eti', 'valor', 'uni', 'haz', 'fo'].forEach(function (k) { p._m[k] = atr(r.querySelector('[data-p="' + k + '"]')); }); }
      if (alguno) sa.puntos.push(p);
    });
    if (todo) { sa._m = {}; ['letra', 'equipo', 'funciona', 'kv', 'ma', 't', 'dfp', 'carga'].forEach(function (k) { sa._m[k] = atr(t.querySelector('[data-s="' + k + '"]')); }); }
    if (sa.puntos.length || (todo && sa.letra)) d.salas.push(sa);
  });
  return d;
}
function aviso(txt, ok) { var a = document.getElementById('aviso'); a.className = 'aviso ' + (ok ? 'ok' : 'mal'); a.innerHTML = txt; a.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

function enviar() {
  Array.prototype.forEach.call(document.querySelectorAll('.equipo tbody'), ordenarDisparos);
  var d = recoger(), errores = [];
  if (INSTALACIONES.indexOf(d.inst) < 0) errores.push('Elija la instalación de la lista.');
  if (!d.fecha) errores.push('Falta la fecha del control.');
  if (!d.equipos.length && !d.salas.length) errores.push('No hay ningún equipo ni sala con lecturas.');
  d.equipos.forEach(function (e, i) { if (!e.id) errores.push('Equipo ' + (i + 1) + ': falta el ID_EQUIPO.'); });
  d.salas.forEach(function (s, i) { if (!s.letra) errores.push('Sala ' + (i + 1) + ': falta la letra de la sala.'); });
  if (errores.length) { aviso('<b>No se ha enviado:</b><br>' + errores.join('<br>'), false); return; }
  var nf = colorear();
  if (nf && !enviar.forzar) {   // 16/10/2026: pregunta en la página (sin confirm())
    preguntar('Faltan ' + nf + ' dato(s) (casillas naranjas). ¿Enviar igualmente?', [['Enviar igualmente', function () { enviar.forzar = true; try { enviar(); } finally { enviar.forzar = false; } }], ['No, revisar los datos', function () { }]], 'preg-enviar');
    return;
  }
  var b = document.getElementById('enviar'); b.disabled = true; b.textContent = 'Enviando…';
  CONEXION.run()
    .withSuccessHandler(function (marca) {
      var c1 = codActual(); try { localStorage.removeItem('cc_web_borrador'); if (c1) localStorage.removeItem('cc_web_borrador_' + c1); } catch (e) { }
      if (c1) CONEXION.run().borrarBorradorWeb(c1, v(document.getElementById('tecnico')));   // 16/10/2026: el de este técnico
      document.getElementById('guardado').textContent = ''; bCambios = false;
      aviso('<b>✔ Control enviado</b> (' + marca + '). La oficina lo pasará a la base con «Recibir de tablet». <button type="button" onclick="location.reload()">Meter otro control</button>', true);
      b.textContent = 'Enviado';
    })
    .withFailureHandler(function (e) { b.disabled = false; b.textContent = 'Enviar el control'; aviso('<b>No se ha podido enviar:</b> ' + (e && e.message ? e.message : e) + '<br>Los datos siguen en la página: vuelva a intentarlo.', false); })
    .guardarControlWeb(JSON.stringify(d));
}

// borrador en este navegador (por si se cierra la página sin enviar)
// BORRADORES (15/10/2026, petición del usuario): uno por instalación, en el navegador (cada cambio) y en Google
// («Guardar sin enviar» y, si hay cambios, cada 2 minutos), para continuar el control desde cualquier ordenador.
var CLAVE_B = 'cc_web_borrador', bCambios = false, instVigente = '';   // instVigente: instalación de los datos que hay en pantalla
function codActual() { return (v(document.getElementById('inst')).split(' · ')[0] || '').trim().toUpperCase(); }
function datosBorrador() { var d = recoger(true); d.ant = ANT; d._guardado = new Date().toISOString(); return d; }
// 15/10/2026: solo cuenta como control empezado si los datos en pantalla son de la instalación elegida y hay algo medido
// (antes se guardaba al elegir la instalación, sin datos, y luego se ofrecía como «control empezado»)
function borradorValido() {
  if (!instVigente || v(document.getElementById('inst')) !== instVigente) return false;
  return Array.prototype.some.call(document.querySelectorAll('#equipos input.lec, #salas input.lec'), function (e) { var x = String(e.value).trim(); return x && x !== e.getAttribute('data-sug'); }) ||
         Array.prototype.some.call(document.querySelectorAll('[data-k="funciona"], [data-s="funciona"]'), function (e) { return e.value === 'No'; });
}
function guardarBorrador() {
  try { var j = JSON.stringify(datosBorrador()), c = codActual(); localStorage.setItem(CLAVE_B, j); if (c && borradorValido()) { localStorage.setItem(CLAVE_B + '_' + c, j); bCambios = true; } } catch (e) { }
}
function guardarEnGoogle(manual) {
  var c = codActual(); if (!c) { if (manual) aviso('Elija primero la instalación.', false); return; }
  if (!borradorValido()) { if (manual) aviso('Aún no hay ninguna lectura de ' + c + ' que guardar.', false); bCambios = false; return; }
  var j = JSON.stringify(datosBorrador()); try { localStorage.setItem(CLAVE_B + '_' + c, j); } catch (e) { }
  CONEXION.run()
    .withSuccessHandler(function (m) {
      bCambios = false; document.getElementById('guardado').textContent = 'Guardado en Google el ' + m + ': se puede continuar desde cualquier ordenador eligiendo la instalación.';
      if (manual) aviso('<b>✔ Control guardado sin enviar</b> (' + m + '). Para continuarlo, abra la página y elija esta instalación.', true);
    })
    .withFailureHandler(function (x) { if (manual) aviso('<b>No se ha podido guardar en Google:</b> ' + (x && x.message ? x.message : x) + '. Queda guardado en este navegador.', false); })
    .guardarBorradorWeb(c, j, v(document.getElementById('tecnico')));
}
setInterval(function () { if (bCambios && codActual() && navigator.onLine !== false) guardarEnGoogle(false); }, 120000);
// ¿hay controles de esta instalación empezados? (16/10/2026: uno por técnico; navegador y Google; solo los que tienen lecturas)
function tieneLecturas(d) {
  return !!d && ((d.equipos || []).some(function (e) { return e.funciona === 'No' || (e.disparos || []).some(function (x) { return x.kvm || x.tm || x.dosis; }) || (e.filt && (e.filt.hvl || e.filt.dcon)); }) ||
                 (d.salas || []).some(function (sl) { return sl.funciona === 'No' || (sl.puntos || []).some(function (q) { return q.valor; }); }));
}
function buscarBorrador(cod, cb) {
  var cands = [];
  var poner = function (d) {
    if (!tieneLecturas(d)) return;
    var k = d.tecnico || '', ya = cands.filter(function (x) { return (x.tecnico || '') === k; })[0];
    if (!ya) cands.push(d); else if (String(d._guardado || '') > String(ya._guardado || '')) cands[cands.indexOf(ya)] = d;
  };
  try { poner(JSON.parse(localStorage.getItem(CLAVE_B + '_' + cod) || 'null')); } catch (e) { }
  var decidir = function () {
    if (!cands.length) { cb(null); return; }
    var t0 = v(document.getElementById('tecnico')), mio = cands.filter(function (d) { return t0 && d.tecnico === t0; }), lista = mio.length ? mio : cands;
    var fmt = function (d) { var f = d._guardado ? new Date(d._guardado) : null; return (d.tecnico || 'sin técnico') + (f ? ', guardado el ' + f.toLocaleDateString('es-ES') + ' ' + f.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''); };
    traza('controles empezados de ' + cod + ': ' + lista.length);
    var bots = lista.map(function (d) { return [lista.length > 1 ? 'Continuar el de ' + fmt(d) : 'Continuarlo', function () { cb(d); }]; });
    bots.push(['Empezar de nuevo a partir del control anterior', function () { cb(null); }]);
    preguntar(lista.length > 1 ? 'Hay ' + lista.length + ' controles de ' + cod + ' empezados y sin enviar (uno por técnico).' : 'Hay un control de ' + cod + ' empezado (' + fmt(lista[0]) + ') y sin enviar.', bots);
  };
  try {
    traza('se buscan controles empezados de ' + cod);
    CONEXION.run().withSuccessHandler(function (arr) { (arr || []).forEach(function (o) { try { poner(JSON.parse(o.txt)); } catch (e) { } }); decidir(); })
      .withFailureHandler(function (e) { traza('borradores no leídos: ' + (e && e.message ? e.message : e)); decidir(); }).leerBorradoresWeb(cod);
  } catch (e) { decidir(); }
}
function marcar(e, m) {   // restaura sugerido y anterior de una casilla (sin cambiar su valor)
  if (!e || !m) return;
  if (m[0] !== null && m[0] !== undefined) e.setAttribute('data-sug', m[0]);
  if (m[1] !== null && m[1] !== undefined && !e.getAttribute('data-ant')) ant(e, m[1]);
}
function cargarBorrador() {
  var d; try { d = JSON.parse(localStorage.getItem('cc_web_borrador') || 'null'); } catch (e) { d = null; }
  if (d && (d.equipos || []).length && !d.equipos[0]._m) { try { localStorage.removeItem('cc_web_borrador'); } catch (e) { } d = null; }   // borrador de una versión anterior
  if (!d || (!d.inst && !(d.equipos || []).length && !(d.salas || []).length)) { nuevoEquipo(); return; }
  nuevoEquipo();   // 16/10/2026: pregunta en la página (sin confirm())
  preguntar('Hay un control sin enviar guardado en este navegador' + (d.inst ? ' (' + d.inst + ')' : '') + '. ¿Recuperarlo?', [
    ['Recuperarlo', function () { rellenarDesde(d); }], ['Empezar de cero', function () { try { localStorage.removeItem('cc_web_borrador'); } catch (e) { } }]]);
}
// rellena la página con un borrador (15/10/2026: también al elegir una instalación con un control empezado)
function rellenarDesde(d) {
  document.getElementById('equipos').innerHTML = ''; document.getElementById('salas').innerHTML = '';
  ['inst', 'fecha', 'tecnico', 'medidor'].forEach(function (k) { document.getElementById(k).value = d[k] || ''; });
  IDENT.forEach(function (k) { var e = document.getElementById(k); if (e && d.ident) { e.value = d.ident[k] || ''; e.removeAttribute('data-sug'); marcar(e, d.ident['_' + k]); } });
  ANT = d.ant || null; pintarCab(); instVigente = d.inst || '';
  if (ANT) document.getElementById('lista-eq').innerHTML = (ANT.eq || []).map(function (e) { return '<option value="' + e.id + '">' + (e.d || '') + '</option>'; }).join('');
  (d.equipos || []).forEach(function (e) {
    nuevoEquipo(); var t = document.getElementById('eq' + nEq), tb = t.querySelector('tbody'), m = e._m || {};
    if (e._desc) t.querySelector('.desc').textContent = e._desc;
    t.setAttribute('data-serie', e._serie || ''); t.setAttribute('data-ubic', e._ubic || '');
    ['id', 'instr', 'revision', 'vdosis', 'vrend', 'vtens', 'vfilt', 'obs'].forEach(function (k) { var x = t.querySelector('[data-k="' + k + '"]'); if (x) x.value = e[k] || ''; });
    EXTRA_EQ.forEach(function (k) { var x = t.querySelector('[data-k="' + k + '"]'); if (x && e.hasOwnProperty(k)) { x.value = e[k] || ''; x.removeAttribute('data-sug'); marcar(x, m[k]); } });
    ['instr', 'kvf', 'esp', 'hvl', 'dcon', 'tcon'].forEach(function (k) { var c2 = t.querySelector('[data-f="' + k + '"]'); if (c2) c2.value = (e.filt || {})[k] || ''; });
    marcar(t.querySelector('[data-k="id"]'), m.id); marcar(t.querySelector('[data-f="kvf"]'), m.kvf); marcar(t.querySelector('[data-f="esp"]'), m.esp); marcar(t.querySelector('[data-f="hvl"]'), m.hvl);
    if (m.hvlManual) t.querySelector('[data-f="hvl"]').setAttribute('data-manual', '1');
    if (m.kvAuto) t.querySelector('[data-f="kvf"]').setAttribute('data-auto', '1');
    while (tb.rows.length < (e.disparos || []).length) nuevoDisparo(t.id);
    (e.disparos || []).forEach(function (x, i) {
      CAMPOS_DISPARO.forEach(function (c) { var el2 = tb.rows[i].querySelector('[data-d="' + c[0] + '"]'); el2.value = x[c[0]] || ''; marcar(el2, (x._m || {})[c[0]]); });
      LECT_DX.forEach(function (k) { var e3 = tb.rows[i].querySelector('[data-x="' + k + '"]'); if (e3) e3.value = x[k] || ''; });
    });
    ordenarDisparos(tb);
  });
  (d.salas || []).forEach(function (s) {
    nuevaSala(); var t = document.getElementById('sa' + nSa), tb = t.querySelector('tbody'), m = s._m || {};
    ['letra', 'equipo', 'funciona', 'kv', 'ma', 't', 'dfp', 'carga'].forEach(function (k) { var el2 = t.querySelector('[data-s="' + k + '"]'); el2.value = s[k] || ''; marcar(el2, m[k]); });
    while (tb.rows.length < (s.puntos || []).length) nuevoPunto(t.id);
    (s.puntos || []).forEach(function (p, i) { ['eti', 'valor', 'uni', 'haz', 'fo'].forEach(function (k) { var el2 = tb.rows[i].querySelector('[data-p="' + k + '"]'); el2.value = p[k] || ''; marcar(el2, (p._m || {})[k]); }); });
  });
  if (!document.querySelectorAll('.tarjeta.equipo').length) nuevoEquipo();
  COMPLETAR = d._completar || null;
  if (COMPLETAR) { var fe1 = document.getElementById('fecha'); fe1.value = COMPLETAR.fecha; fe1.readOnly = true; fe1.title = 'Fecha del control que se completa'; }
  colocarSalas(); aplicarTecnico(); colorear();
}
// TECLADO (13/10/2026): punto = coma decimal en las casillas numéricas (el teclado numérico solo tiene punto);
// flechas ↑ ↓ cambian de fila en la misma columna; ← → de casilla (en las de texto, solo al llegar al borde); Intro = siguiente
document.addEventListener('input', function (ev) {
  var e = ev.target;
  if (e && e.classList && e.classList.contains('num') && e.value.indexOf('.') >= 0) {
    var p = e.selectionStart; e.value = e.value.replace(/\./g, ','); try { e.setSelectionRange(p, p); } catch (x) { }
  }
});
function casillas() { return Array.prototype.filter.call(document.querySelectorAll('main input, main select, main textarea'), function (e) { return !e.disabled && e.offsetParent !== null && e.type !== 'button'; }); }
function irA(e) { if (!e) return; e.focus(); try { if (e.select && e.tagName === 'INPUT') e.select(); } catch (x) { } }
document.addEventListener('keydown', function (ev) {
  var e = ev.target, k = ev.key; if (!e || !/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)) return;
  if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
  var todas = casillas(), i = todas.indexOf(e); if (i < 0) return;
  if (k === 'Enter' && e.tagName !== 'TEXTAREA') { ev.preventDefault(); irA(todas[i + (ev.shiftKey ? -1 : 1)]); return; }
  if (e.tagName === 'SELECT' && (k === 'ArrowUp' || k === 'ArrowDown') && !ev.shiftKey) {
    var td0 = e.closest('td'); if (!td0) return;   // en las listas fuera de tablas, ↑ ↓ cambian la opción (como siempre)
  }
  if (e.tagName === 'TEXTAREA' && (k === 'ArrowUp' || k === 'ArrowDown')) return;
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    var td = e.closest('td');
    if (td) {   // en tablas: misma columna, fila de arriba / abajo
      var tr = td.parentNode, col = Array.prototype.indexOf.call(tr.children, td), otra = k === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
      if (otra && otra.children[col]) { var dest = otra.children[col].querySelector('input, select'); if (dest) { ev.preventDefault(); irA(dest); return; } }
    }
    ev.preventDefault(); irA(todas[i + (k === 'ArrowUp' ? -1 : 1)]); return;
  }
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') {
      var ini = e.selectionStart, fin = e.selectionEnd, lon = (e.value || '').length;
      var todoSel = ini === 0 && fin === lon;
      if (!todoSel && ((k === 'ArrowLeft' && ini > 0) || (k === 'ArrowRight' && fin < lon))) return;   // moverse dentro del texto
    }
    ev.preventDefault(); irA(todas[i + (k === 'ArrowLeft' ? -1 : 1)]);
  }
});
// al salir de una casilla numérica: «,2» → «0,2» y «-,2» → «-0,2»
document.addEventListener('change', function (ev) {
  var e = ev.target; if (!e || !e.classList || !e.classList.contains('num')) return;
  var x = String(e.value || '').trim().replace(/\./g, ',');
  if (/^,/.test(x)) x = '0' + x; else if (/^-,/.test(x)) x = '-0' + x.slice(1);
  if (x !== e.value) { e.value = x; colorear(); guardarBorrador(); }
}, true);
document.addEventListener('focusout', function (ev) {
  var tb = ev.target && ev.target.closest && ev.target.closest('.equipo tbody'); if (!tb) return;
  setTimeout(function () { if (!tb.contains(document.activeElement)) { ordenarDisparos(tb); guardarBorrador(); } }, 0);
});
document.addEventListener('input', function () { colorear(); guardarBorrador(); }); document.addEventListener('change', function () { colorear(); guardarBorrador(); });
document.getElementById('lista-inst').innerHTML = INSTALACIONES.map(function (o) { return '<option value="' + o.replace(/"/g, '&quot;') + '">'; }).join('');
document.getElementById('tecnico').innerHTML = '<option></option>' + INSTRUMENTOS.map(function (x) { return '<option>' + x.tecnico + '</option>'; }).join('') + '<option>Otro</option>';
document.getElementById('fecha').value = new Date().toISOString().slice(0, 10);
sug(document.getElementById('ncontrol'), '1'); sug(document.getElementById('motivo'), 'Revisión anual programada');
try { for (var kb = localStorage.length - 1; kb >= 0; kb--) { var nb = localStorage.key(kb); if (nb && nb.indexOf('cc_web_borrador_') === 0) { var ob = JSON.parse(localStorage.getItem(nb) || 'null'); if (!ob || !ob._guardado || Date.now() - new Date(ob._guardado).getTime() > 30 * 864e5) localStorage.removeItem(nb); } } } catch (e) { }
cargarBorrador();
