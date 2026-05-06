/**
 * ══════════════════════════════════════════════════════════════
 * SiGPo — GAS del COORDINADOR
 * Google Apps Script — uno por coordinador, en su cuenta Workspace
 *
 * DESPLIEGUE (una sola vez por coordinador):
 *  1. script.google.com desde la cuenta del coordinador → Nuevo proyecto
 *  2. Pegar este código
 *  3. Configurar PROGRAMA_IDS y SUPABASE_KEY (service role key)
 *  4. Ejecutar configurarTriggers() una vez → autorizar permisos
 *  5. Implementar → Web App · Ejecutar como: Yo · Acceso: Cualquier persona
 *  6. Copiar URL y guardar en tabla programas → columna gas_url
 *
 * FUNCIONES AUTOMÁTICAS (salen desde el email del coordinador):
 *  · Día 1  → Recordatorio de vencimiento de cuota → al estudiante
 *  · Día 16 → Reclamo de cuotas en mora           → al estudiante
 *
 * FUNCIÓN MANUAL:
 *  · doPost → recibe llamadas del frontend para envío individual
 * ══════════════════════════════════════════════════════════════
 */

var SUPABASE_URL  = 'https://fdevypdowdhqaxvfiywt.supabase.co';
var SUPABASE_KEY  = 'REEMPLAZAR_CON_SERVICE_ROLE_KEY'; // ← solo en script.google.com, nunca en el repo
var SECRET        = 'SIGPO_KEY_FCE_2025';
var NOMBRE_INST   = 'Secretaría de Posgrado — FCE UNCUYO';

// ══════════════════════════════════════════════════════════════
// CONFIGURACIÓN — completar antes de ejecutar
// Listar los programa_id que gestiona este coordinador.
// Ejemplo un programa:    var PROGRAMA_IDS = [3];
// Ejemplo dos programas:  var PROGRAMA_IDS = [3, 7];
// ══════════════════════════════════════════════════════════════
var PROGRAMA_IDS = [REEMPLAZAR_CON_ID_DEL_PROGRAMA]; // ← número(s), sin comillas

// ══════════════════════════════════════════════════════════════
// TRIGGER PRINCIPAL
// ══════════════════════════════════════════════════════════════

function ejecutarTareasDiarias() {
  var dia = new Date().getDate();
  Logger.log('=== SiGPo coordinador — día ' + dia + ' — programas: [' + PROGRAMA_IDS.join(',') + '] ===');
  if (dia === 1)  enviarRecordatoriosVencimiento();
  if (dia === 16) enviarReclamosMora();
}

function configurarTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'ejecutarTareasDiarias') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ejecutarTareasDiarias').timeBased().everyDays(1).atHour(7).create();
  Logger.log('✅ Trigger diario 07:00 configurado.');
}

// ══════════════════════════════════════════════════════════════
// DÍA 1 — RECORDATORIO DE VENCIMIENTO DE CUOTA
// ══════════════════════════════════════════════════════════════

function enviarRecordatoriosVencimiento() {
  var hoy    = new Date();
  var anio   = hoy.getFullYear();
  var mes    = hoy.getMonth();
  var desde  = _primerDiaMes(anio, mes);
  var hasta  = _ultimoDiaMes(anio, mes);
  var mesNom = _mesNombre(mes);

  Logger.log('--- Recordatorios de vencimiento: ' + mesNom + ' ' + anio + ' ---');

  var cobros = _sbGet(
    'cobros?select=cobro_id,dni,cohorte_id,programa_id,concepto,periodo,nro_cuota,fecha_vencimiento,monto_final,saldo_pendiente,estado' +
    '&programa_id=in.(' + PROGRAMA_IDS.join(',') + ')' +
    '&estado=not.in.(ABONADA,A_DEFINIR)' +
    '&no_aplica=not.is.true' +
    '&fecha_vencimiento=gte.' + desde +
    '&fecha_vencimiento=lte.' + hasta
  );

  if (!cobros.length) { Logger.log('Sin cobros pendientes este mes.'); return; }

  var ctx      = _cargarContexto(cobros);
  var ccPorDni = _cuentasCorrientesLote(Object.keys(ctx.porDni), Object.keys(ctx.cohMap));

  var enviados = 0;
  Object.keys(ctx.porDni).forEach(function(dni) {
    var usu = ctx.usuMap[dni];
    if (!usu || !usu.email) { Logger.log('Sin email: DNI ' + dni); return; }
    var cuotasMes = ctx.porDni[dni];
    var progNom   = _nombrePrograma(cuotasMes[0], ctx);
    var cc        = ccPorDni[dni] || [];
    var subject = 'Recordatorio de cuota — ' + progNom + ' — ' + mesNom + ' ' + anio;
    var html    = _htmlRecordatorio(_nombreCompleto(usu), progNom, mesNom, anio, cuotasMes, cc);
    if (_enviarMail(usu.email, subject, html)) enviados++;
  });

  Logger.log('Recordatorios enviados: ' + enviados);
}

// ══════════════════════════════════════════════════════════════
// DÍA 16 — RECLAMO DE MORA
// ══════════════════════════════════════════════════════════════

function enviarReclamosMora() {
  var hoy    = new Date();
  var mesNom = _mesNombre(hoy.getMonth());
  var anio   = hoy.getFullYear();

  Logger.log('--- Reclamos de mora: ' + mesNom + ' ' + anio + ' ---');

  var cobros = _sbGet(
    'cobros?select=cobro_id,dni,cohorte_id,programa_id,concepto,periodo,nro_cuota,fecha_vencimiento,monto_final,saldo_pendiente,estado' +
    '&programa_id=in.(' + PROGRAMA_IDS.join(',') + ')' +
    '&estado=eq.EN_MORA'
  );

  if (!cobros.length) { Logger.log('No hay cobros en mora.'); return; }

  var ctx      = _cargarContexto(cobros);
  var ccPorDni = _cuentasCorrientesLote(Object.keys(ctx.porDni), Object.keys(ctx.cohMap));

  var enviados = 0;
  Object.keys(ctx.porDni).forEach(function(dni) {
    var usu = ctx.usuMap[dni];
    if (!usu || !usu.email) { Logger.log('Sin email: DNI ' + dni); return; }
    var cuotasMora = ctx.porDni[dni];
    var progNom    = _nombrePrograma(cuotasMora[0], ctx);
    var cc         = ccPorDni[dni] || [];
    var deuda      = cuotasMora.reduce(function(s,c){ return s + Number(c.saldo_pendiente || c.monto_final || 0); }, 0);
    var subject = 'Aviso de cuotas en mora — ' + progNom;
    var html    = _htmlReclamo(_nombreCompleto(usu), progNom, cuotasMora, cc, deuda, mesNom, anio);
    if (_enviarMail(usu.email, subject, html)) enviados++;
  });

  Logger.log('Reclamos enviados: ' + enviados);
}

// ══════════════════════════════════════════════════════════════
// doPost — ENVÍO MANUAL DESDE EL FRONTEND
// ══════════════════════════════════════════════════════════════

function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Sin datos en el request');
    var data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) throw new Error('No autorizado');
    var to      = String(data.to      || '').trim();
    var subject = String(data.subject || '').trim();
    var body    = String(data.body    || '').trim();
    var replyTo = String(data.replyTo || '').trim();
    if (!to || !subject || !body) throw new Error('Faltan campos: to, subject, body');
    var opts = { name: NOMBRE_INST, htmlBody: body.replace(/\n/g, '<br>') };
    if (replyTo) opts.replyTo = replyTo;
    MailApp.sendEmail(to, subject, body, opts);
    output.setContent(JSON.stringify({ ok: true }));
  } catch(err) {
    output.setContent(JSON.stringify({ ok: false, error: err.message }));
  }
  return output;
}

// ══════════════════════════════════════════════════════════════
// HELPERS — SUPABASE
// ══════════════════════════════════════════════════════════════

function _sbGet(path) {
  try {
    var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + path, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('Supabase error ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0,200));
      return [];
    }
    return JSON.parse(resp.getContentText()) || [];
  } catch(err) {
    Logger.log('_sbGet excepción: ' + err.message);
    return [];
  }
}

function _cuentasCorrientesLote(dnis, cohorteIds) {
  if (!dnis.length || !cohorteIds.length) return {};
  var todas = _sbGet(
    'cobros?select=dni,concepto,periodo,nro_cuota,fecha_vencimiento,monto_final,saldo_pendiente,estado' +
    '&dni=in.(' + dnis.join(',') + ')' +
    '&cohorte_id=in.(' + cohorteIds.join(',') + ')' +
    '&order=fecha_vencimiento.asc'
  );
  var porDni = {};
  todas.forEach(function(c) {
    if (!porDni[c.dni]) porDni[c.dni] = [];
    porDni[c.dni].push(c);
  });
  return porDni;
}

function _cargarContexto(cobros) {
  var porDni = {};
  cobros.forEach(function(c) {
    if (!porDni[c.dni]) porDni[c.dni] = [];
    porDni[c.dni].push(c);
  });
  var dnis      = Object.keys(porDni);
  var usuarios  = dnis.length ? _sbGet('usuarios?select=dni,nombre,apellido,email&dni=in.(' + dnis.join(',') + ')') : [];
  var programas = _sbGet('programas?select=programa_id,nombre');
  var cohIds    = _uniq(cobros.map(function(c){ return c.cohorte_id; }));
  var cohortes  = cohIds.length ? _sbGet('cohortes?select=cohorte_id,nombre,programa_id&cohorte_id=in.(' + cohIds.join(',') + ')') : [];
  return {
    porDni:  porDni,
    usuMap:  _indexar(usuarios,  'dni'),
    progMap: _indexar(programas, 'programa_id'),
    cohMap:  _indexar(cohortes,  'cohorte_id')
  };
}

// ══════════════════════════════════════════════════════════════
// HELPERS — UTILIDADES
// ══════════════════════════════════════════════════════════════

var _MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function _mesNombre(m)         { return _MESES[m] || ''; }
function _primerDiaMes(a, m)   { return new Date(a, m, 1).toISOString().split('T')[0]; }
function _ultimoDiaMes(a, m)   { return new Date(a, m+1, 0).toISOString().split('T')[0]; }
function _fmtPeso(n)           { return '$' + Number(n||0).toLocaleString('es-AR'); }
function _nombreCompleto(u)    { return ((u.nombre||'') + ' ' + (u.apellido||'')).trim(); }
function _indexar(arr, campo)  { var m={}; arr.forEach(function(x){ m[x[campo]] = x; }); return m; }
function _uniq(arr)            { return arr.filter(function(v,i,a){ return a.indexOf(v)===i; }); }

function _fmtFecha(f) {
  if (!f) return '—';
  var p = f.split('T')[0].split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

function _nombrePrograma(cobro, ctx) {
  if (!cobro) return 'Posgrado';
  var coh  = ctx.cohMap[cobro.cohorte_id] || {};
  var prog = ctx.progMap[cobro.programa_id || coh.programa_id] || {};
  return prog.nombre || 'Posgrado';
}

function _enviarMail(to, subject, html) {
  try {
    MailApp.sendEmail(to, subject, html.replace(/<[^>]+>/g,''), { name: NOMBRE_INST, htmlBody: html });
    Logger.log('✅ → ' + to);
    return true;
  } catch(err) {
    Logger.log('❌ ' + to + ': ' + err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// TEMPLATES HTML
// ══════════════════════════════════════════════════════════════

var _CSS = '<style>' +
  'body{font-family:Arial,sans-serif;color:#1e3a5f;max-width:620px;margin:0 auto;padding:0;}' +
  '.hdr{background:#1e3a5f;color:#fff;padding:20px 28px;border-radius:8px 8px 0 0;}' +
  '.hdr h1{margin:0;font-size:20px;font-weight:700;}' +
  '.hdr p{margin:4px 0 0;font-size:13px;opacity:.8;}' +
  '.bod{background:#f8f6f1;padding:24px 28px;}' +
  '.ftr{background:#e5e7eb;padding:12px 28px;font-size:11px;color:#6b7280;border-radius:0 0 8px 8px;}' +
  'table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;}' +
  'th{background:#1e3a5f;color:#fff;padding:7px 10px;text-align:left;}' +
  'td{padding:7px 10px;border-bottom:1px solid #e5e7eb;}' +
  'tr.mora td{background:#fee2e2;}' +
  'tr.pend td{background:#fffbeb;}' +
  'tr.abon td{color:#9ca3af;}' +
  '.aviso{background:#dbeafe;border-left:4px solid #1e3a5f;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;font-size:14px;}' +
  '.alerta{background:#fee2e2;border-left:4px solid #c0392b;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;font-size:14px;}' +
  '.deuda{font-size:20px;font-weight:700;color:#c0392b;}' +
  'p{font-size:14px;line-height:1.6;}' +
  '</style>';

function _wrapHtml(contenido) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' + _CSS + '</head><body>' +
    '<div class="hdr"><h1>' + NOMBRE_INST + '</h1><p>Sistema de Gestión de Posgrado</p></div>' +
    '<div class="bod">' + contenido + '</div>' +
    '<div class="ftr">Este es un mensaje automático del sistema SiGPo. Por consultas comuníquese con la Secretaría de Posgrado.</div>' +
    '</body></html>';
}

function _filasCC(cc) {
  return cc.map(function(c) {
    var cls   = c.estado === 'EN_MORA' ? 'mora' : (c.estado === 'ABONADA' ? 'abon' : 'pend');
    var saldo = c.estado === 'ABONADA' ? '<em>Abonado</em>' : _fmtPeso(c.saldo_pendiente || c.monto_final);
    return '<tr class="' + cls + '">' +
      '<td>' + (c.concepto||'—') + '</td>' +
      '<td>' + (c.periodo||'—') + '</td>' +
      '<td>' + _fmtFecha(c.fecha_vencimiento) + '</td>' +
      '<td>' + _fmtPeso(c.monto_final) + '</td>' +
      '<td>' + saldo + '</td>' +
      '<td>' + c.estado + '</td></tr>';
  }).join('');
}

function _htmlRecordatorio(nombre, prog, mesNom, anio, cuotasMes, cc) {
  var filasCuota = cuotasMes.map(function(c) {
    return '<tr class="pend"><td>' + (c.concepto||'—') + '</td><td>' + (c.periodo||'—') + '</td>' +
           '<td>15/' + String(new Date().getMonth()+1).padStart(2,'0') + '/' + anio + '</td>' +
           '<td><strong>' + _fmtPeso(c.monto_final) + '</strong></td></tr>';
  }).join('');
  var deudaPrev = cc.filter(function(c){ return c.estado === 'EN_MORA'; })
                    .reduce(function(s,c){ return s + Number(c.saldo_pendiente||c.monto_final||0); }, 0);
  return _wrapHtml(
    '<p>Estimado/a <strong>' + nombre + '</strong>,</p>' +
    '<div class="aviso">Le recordamos que la/s siguiente/s cuota/s del programa <strong>' + prog + '</strong> ' +
    'vence/n el <strong>15 de ' + mesNom + ' ' + anio + '</strong>.</div>' +
    '<table><tr><th>Concepto</th><th>Período</th><th>Vencimiento</th><th>Monto</th></tr>' + filasCuota + '</table>' +
    (deudaPrev > 0 ?
      '<div class="alerta">Además, registra una deuda previa en mora de <span class="deuda">' + _fmtPeso(deudaPrev) + '</span>. Le solicitamos regularizar su situación.</div>' : '') +
    '<h3 style="color:#1e3a5f;">Estado de cuenta corriente</h3>' +
    '<table><tr><th>Concepto</th><th>Período</th><th>Vencimiento</th><th>Monto</th><th>Saldo</th><th>Estado</th></tr>' +
    _filasCC(cc) + '</table>'
  );
}

function _htmlReclamo(nombre, prog, cuotasMora, cc, deuda, mesNom, anio) {
  var filasMora = cuotasMora.map(function(c) {
    return '<tr class="mora"><td>' + (c.concepto||'—') + '</td><td>' + (c.periodo||'—') + '</td>' +
           '<td>' + _fmtFecha(c.fecha_vencimiento) + '</td>' +
           '<td>' + _fmtPeso(c.monto_final) + '</td>' +
           '<td><strong>' + _fmtPeso(c.saldo_pendiente||c.monto_final) + '</strong></td></tr>';
  }).join('');
  return _wrapHtml(
    '<p>Estimado/a <strong>' + nombre + '</strong>,</p>' +
    '<div class="alerta">Le informamos que a la fecha de hoy registra las siguientes cuotas <strong>vencidas e impagas</strong> ' +
    'en el programa <strong>' + prog + '</strong>. Le solicitamos que regularice su situación a la brevedad.</div>' +
    '<table><tr><th>Concepto</th><th>Período</th><th>Vencimiento</th><th>Monto</th><th>Saldo pendiente</th></tr>' +
    filasMora + '</table>' +
    '<p>Deuda total en mora: <span class="deuda">' + _fmtPeso(deuda) + '</span></p>' +
    '<h3 style="color:#1e3a5f;">Estado de cuenta corriente completo</h3>' +
    '<table><tr><th>Concepto</th><th>Período</th><th>Vencimiento</th><th>Monto</th><th>Saldo</th><th>Estado</th></tr>' +
    _filasCC(cc) + '</table>'
  );
}

// ══════════════════════════════════════════════════════════════
// FUNCIONES DE PRUEBA — ejecutar manualmente desde el editor
// ══════════════════════════════════════════════════════════════

function testRecordatorio()     { enviarRecordatoriosVencimiento(); }
function testMora()             { enviarReclamosMora(); }
function testConexionSupabase() {
  var programas = _sbGet('programas?select=programa_id,nombre&limit=3');
  Logger.log('Conexión OK — ' + programas.length + ' programas:');
  programas.forEach(function(p){ Logger.log('  · ' + p.programa_id + ': ' + p.nombre); });
}
