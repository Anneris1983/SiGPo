/**
 * ══════════════════════════════════════════════════════════════
 * SiGPo — GAS DE RECIBOS TANGO
 * Google Apps Script — correr desde crm.posgrado@gmail.com
 *
 * DESPLIEGUE (una sola vez):
 *  1. script.google.com desde la cuenta crm.posgrado@gmail.com → Nuevo proyecto
 *  2. Pegar este código
 *  3. Servicios avanzados → habilitar "Drive API" (v3)
 *  4. Reemplazar los valores REEMPLAZAR_* de abajo
 *  5. Ejecutar configurarTriggers() una vez → autorizar permisos
 *  6. Para TEST: cambiar la hora del trigger en configurarTriggers() a la hora actual + 1
 *
 * LO QUE HACE EL SCRIPT:
 *  · Busca en Gmail emails no procesados del remitente configurado con PDF adjunto
 *  · Lee el texto del PDF (convierte a Google Doc temporario)
 *  · Extrae: Nro. Recibo / CUIT o DNI / Concepto (programa_id + cohorte + periodo)
 *  · Normaliza el DNI: maneja CUIT (XX-XXXXXXXX-X) y ceros a la izquierda
 *  · Busca la cuota exacta en Supabase
 *  · Si la encuentra → sube el PDF a Storage y registra en recibos_tango
 *  · Si NO la encuentra → registra en recibos_pendientes_tango y avisa por email
 *  · Etiqueta el thread de Gmail para no procesarlo dos veces
 * ══════════════════════════════════════════════════════════════
 */

var SUPABASE_URL   = 'https://fdevypdowdhqaxvfiywt.supabase.co';
var SUPABASE_KEY   = 'REEMPLAZAR_CON_SERVICE_ROLE_KEY';   // ← solo en script.google.com, nunca en el repo
var EMAIL_REMITENTE = 'mrsuncuyo@gmail.com';              // TEST — en producción: cooperadora.comprobantes@fce.uncu.edu.ar
var EMAIL_ADMIN    = 'REEMPLAZAR_CON_EMAIL_ADMIN';        // ← recibe avisos de recibos que no se pudieron asignar
var NOMBRE_INST    = 'Secretaría de Posgrado — FCE UNCUYO';
var LABEL_PROCESADOS = 'Recibos-Tango-Procesados';

// ══════════════════════════════════════════════════════════════
// TRIGGER
// ══════════════════════════════════════════════════════════════

function configurarTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'procesarRecibos') ScriptApp.deleteTrigger(t);
  });
  // Para TEST: cambiar atHour(8) por la hora que quieras probar (0-23, hora de Argentina = UTC-3)
  ScriptApp.newTrigger('procesarRecibos').timeBased().everyDays(1).atHour(8).create();
  Logger.log('✅ Trigger diario 08:00 configurado.');
}

// ══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════════

function procesarRecibos() {
  Logger.log('=== SiGPo recibos-tango — ' + new Date().toISOString() + ' ===');
  var label = _obtenerOCrearLabel(LABEL_PROCESADOS);
  var query = 'from:' + EMAIL_REMITENTE + ' has:attachment filename:pdf -label:' + LABEL_PROCESADOS;
  var threads = GmailApp.search(query);
  Logger.log('Threads sin procesar: ' + threads.length);

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      msg.getAttachments().forEach(function(att) {
        var nombre = att.getName().toLowerCase();
        var tipo   = att.getContentType();
        if (tipo === 'application/pdf' || nombre.slice(-4) === '.pdf') {
          Logger.log('→ Procesando: ' + att.getName());
          try {
            _procesarUnPDF(att, msg);
          } catch(e) {
            Logger.log('ERROR no controlado en ' + att.getName() + ': ' + e.toString());
            _registrarPendiente({
              email_origen: msg.getFrom(),
              email_asunto: msg.getSubject()
            }, 'Excepción no controlada: ' + e.toString());
          }
        }
      });
    });
    thread.addLabel(label);
    thread.markRead();
  });
}

// ══════════════════════════════════════════════════════════════
// PROCESAR UN PDF
// ══════════════════════════════════════════════════════════════

function _procesarUnPDF(att, msg) {
  // 1. Extraer texto
  var texto = _extraerTextoPDF(att);
  Logger.log('--- TEXTO PDF (primeros 800 chars) ---\n' + texto.substring(0, 800));

  // 2. Parsear campos del recibo
  var datos = _parsearRecibo(texto);
  datos.email_origen = msg.getFrom();
  datos.email_asunto = msg.getSubject();
  Logger.log('Datos extraídos: ' + JSON.stringify(datos));

  // 3. Validar campos mínimos
  if (!datos.dni_normalizado) {
    _registrarPendiente(datos, 'No se pudo extraer DNI/CUIT del PDF.');
    return;
  }
  if (!datos.programa_id || !datos.periodo_bd) {
    _registrarPendiente(datos,
      'No se pudo parsear el Concepto del PDF. Texto extraído: "' + (datos.concepto_raw || '') + '"');
    return;
  }

  // 4. Evitar procesar dos veces el mismo recibo
  if (datos.nro_recibo && _reciboDuplicado(datos.nro_recibo)) {
    Logger.log('Recibo ' + datos.nro_recibo + ' ya procesado. Saltando.');
    return;
  }

  // 5. Subir PDF a Storage (se hace SIEMPRE, antes de buscar el cobro,
  //    para que quede disponible tanto si se asigna automáticamente como si va a pendientes)
  var fileBase = datos.nro_recibo || ('sin-nro-' + Date.now());
  var fileName = 'recibos-tango/' + fileBase + '.pdf';
  var pdfUrl   = _subirStorage(att.copyBlob(), fileName);

  // 6. Buscar la cuota en Supabase
  var cobro = _buscarCobro(datos.dni_normalizado, datos.programa_id, datos.periodo_bd);
  if (cobro === 'MULTIPLE') {
    _registrarPendiente(datos, 'Se encontraron múltiples cuotas para los mismos datos. Revisión manual requerida.', pdfUrl);
    return;
  }
  if (!cobro) {
    _registrarPendiente(datos,
      'No se encontró cuota para: DNI=' + datos.dni_normalizado +
      ', Programa=' + datos.programa_id +
      ', Periodo=' + datos.periodo_bd,
      pdfUrl);
    return;
  }
  if (!pdfUrl) {
    _registrarPendiente(datos, 'Error al subir el PDF a Supabase Storage.', null);
    return;
  }

  // 7. Registrar éxito: insert recibos_tango + update cobros.recibo_url
  var ok = _registrarExito(cobro.cobro_id, datos.nro_recibo, pdfUrl, datos);
  if (ok) {
    Logger.log('✅ Recibo ' + datos.nro_recibo + ' asignado a cobro_id=' + cobro.cobro_id);
  } else {
    _registrarPendiente(datos, 'Error al guardar en la BD (PDF ya subido a Storage: ' + pdfUrl + ').', pdfUrl);
  }
}

// ══════════════════════════════════════════════════════════════
// EXTRAER TEXTO DEL PDF
// Requiere: Servicios avanzados → Drive API (v3) habilitado
// ══════════════════════════════════════════════════════════════

function _extraerTextoPDF(attachment) {
  var blob = attachment.copyBlob().setContentType('application/pdf');
  var file = Drive.Files.create(
    { name: 'sigpo_tmp_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
    blob
  );
  var texto = DocumentApp.openById(file.id).getBody().getText();
  DriveApp.getFileById(file.id).setTrashed(true);
  return texto;
}

// ══════════════════════════════════════════════════════════════
// PARSEAR CAMPOS DEL RECIBO TANGO
// Formato real en el PDF (cooperadora carga el Nº de programa en el concepto):
//   Concepto : 11  cohorte 2025-2026 septiembre 2026
//     · 11               → programa_id
//     · cohorte 2025-2026 → nombre de cohorte ("Cohorte 2025-2026")
//     · septiembre 2026   → periodo ("Septiembre de 2026")
//   C.U.I.T. : 36190484   (DNI directo, o CUIT 20-24207661-3)
//   NºRecibo : X00004-00009901
// ══════════════════════════════════════════════════════════════

function _parsearRecibo(texto) {
  var datos = {
    nro_recibo:      null,
    cuit_raw:        null,
    dni_normalizado: null,
    concepto_raw:    null,
    programa_id:     null,  // ej: 11
    cohorte_nombre:  null,  // ej: "Cohorte 2025-2026"
    periodo_bd:      null   // ej: "Septiembre de 2026"
  };

  // Nro. Recibo — ej: X00004-00009901 (letra + dígitos, guion, dígitos)
  var mRec = texto.match(/([A-Z]\d{3,6}[-]\d{5,10})/);
  if (mRec) datos.nro_recibo = mRec[1];

  // CUIT / DNI del CLIENTE — formato con puntos "C.U.I.T. :" (el encabezado
  // de la cooperadora usa "CUIT:" sin puntos, así no lo confundimos)
  var mCuit = texto.match(/C\.U\.I\.T\.\s*:?\s*([\d.\-]{7,14})/);
  if (mCuit) {
    datos.cuit_raw        = mCuit[1];
    datos.dni_normalizado = _normalizarDni(mCuit[1]);
  }

  // Concepto — ej: "11  cohorte 2025-2026 septiembre 2026"
  var mConc = texto.match(/Concepto\s*:?\s*(\d{1,3})\s+cohorte\s+(\d{4}-\d{4})\s+([a-záéíóúñ]+)\s+(\d{4})/i);
  if (mConc) {
    datos.concepto_raw   = mConc[0].replace(/\s+/g, ' ').trim();
    datos.programa_id    = parseInt(mConc[1], 10);
    datos.cohorte_nombre = 'Cohorte ' + mConc[2];
    datos.periodo_bd     = _normalizarMes(mConc[3]) + ' de ' + mConc[4];
  } else {
    // Captura parcial para incluir en el aviso de pendiente
    var mConc2 = texto.match(/Concepto\s*[:\s]+(.{5,80})/i);
    if (mConc2) datos.concepto_raw = mConc2[1].trim();
  }

  return datos;
}

// ══════════════════════════════════════════════════════════════
// NORMALIZAR DNI
// Maneja: "20-07654321-3" → "7654321"
//         "07654321"      → "7654321"
//         "24207661"      → "24207661"
// ══════════════════════════════════════════════════════════════

function _normalizarDni(valor) {
  var dig = valor.replace(/\D/g, '');
  if (dig.length === 11) {
    // Es CUIT/CUIL: los 8 dígitos del medio son el DNI (posiciones 2 a 9)
    dig = dig.substring(2, 10);
  }
  // Quitar ceros a la izquierda (resuelve el caso DNI guardado sin 0 inicial)
  dig = dig.replace(/^0+/, '') || '0';
  return dig;
}

// ══════════════════════════════════════════════════════════════
// NORMALIZAR MES: "marzo" → "Marzo"
// ══════════════════════════════════════════════════════════════

function _normalizarMes(mes) {
  var tabla = {
    enero:'Enero', febrero:'Febrero', marzo:'Marzo', abril:'Abril',
    mayo:'Mayo', junio:'Junio', julio:'Julio', agosto:'Agosto',
    septiembre:'Septiembre', octubre:'Octubre', noviembre:'Noviembre', diciembre:'Diciembre'
  };
  return tabla[mes.toLowerCase()] || (mes.charAt(0).toUpperCase() + mes.slice(1).toLowerCase());
}

// ══════════════════════════════════════════════════════════════
// BUSCAR COBRO EN SUPABASE
// Identifica la cuota por: programa_id + periodo + DNI (recibo sin asignar).
// El periodo (mes + año) ya determina la cuota exacta del programa.
// Retorna: objeto cobro | null (no encontrado) | 'MULTIPLE'
// ══════════════════════════════════════════════════════════════

function _buscarCobro(dniNorm, programaId, periodoBD) {
  // Buscar cobros del programa, en ese periodo, sin recibo asignado
  var cobros = _sbGet(
    'cobros?select=cobro_id,dni' +
    '&programa_id=eq.' + programaId +
    '&periodo=ilike.' + encodeURIComponent(periodoBD) +
    '&recibo_url=is.null'
  );

  // Filtrar por DNI normalizado (maneja ceros a la izquierda en la BD)
  var coincidencias = cobros.filter(function(c) {
    return (String(c.dni).replace(/^0+/, '') || '0') === dniNorm;
  });

  if (coincidencias.length === 0) return null;
  if (coincidencias.length > 1)  return 'MULTIPLE';
  return coincidencias[0];
}

// ══════════════════════════════════════════════════════════════
// VERIFICAR RECIBO DUPLICADO
// ══════════════════════════════════════════════════════════════

function _reciboDuplicado(nroRecibo) {
  var r = _sbGet('recibos_tango?select=id&nro_recibo=eq.' + encodeURIComponent(nroRecibo));
  return r.length > 0;
}

// ══════════════════════════════════════════════════════════════
// SUBIR PDF A SUPABASE STORAGE (bucket: comprobantes)
// ══════════════════════════════════════════════════════════════

function _subirStorage(pdfBlob, fileName) {
  var url = SUPABASE_URL + '/storage/v1/object/comprobantes/' + fileName;
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true'
      },
      payload: pdfBlob.getBytes(),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 200 || code === 201) {
      return SUPABASE_URL + '/storage/v1/object/public/comprobantes/' + fileName;
    }
    Logger.log('Storage error HTTP ' + code + ': ' + resp.getContentText().substring(0, 300));
    return null;
  } catch(e) {
    Logger.log('Storage excepción: ' + e.toString());
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// REGISTRAR ÉXITO: insert recibos_tango + update cobros.recibo_url
// ══════════════════════════════════════════════════════════════

function _registrarExito(cobroId, nroRecibo, pdfUrl, datos) {
  var ok1 = _sbPost('recibos_tango', {
    cobro_id:         cobroId,
    nro_recibo:       nroRecibo,
    pdf_url:          pdfUrl,
    tango_datos_json: datos,
    estado:           'asignado'
  });
  var ok2 = _sbPatch('cobros?cobro_id=eq.' + cobroId, { recibo_url: pdfUrl });
  return ok1 && ok2;
}

// ══════════════════════════════════════════════════════════════
// REGISTRAR PENDIENTE: insert recibos_pendientes_tango + aviso email
// pdfUrl: URL del PDF ya subido al Storage (puede ser null si falló el upload)
// ══════════════════════════════════════════════════════════════

function _registrarPendiente(datos, motivo, pdfUrl) {
  Logger.log('⚠ PENDIENTE: ' + motivo);
  _sbPost('recibos_pendientes_tango', {
    email_origen:    datos.email_origen  || null,
    email_asunto:    datos.email_asunto  || null,
    nro_recibo:      datos.nro_recibo    || null,
    pdf_url:         pdfUrl || null,
    datos_extraidos: datos,
    motivo_fallo:    motivo,
    notificado_en:   new Date().toISOString(),
    resuelto:        false
  });
  try {
    GmailApp.sendEmail(
      EMAIL_ADMIN,
      '[SiGPo] Recibo Tango pendiente de revisión',
      'Un recibo no pudo asignarse automáticamente.\n\n' +
      'Motivo: ' + motivo + '\n' +
      'Recibo Nro: ' + (datos.nro_recibo || 'desconocido') + '\n' +
      'Email origen: ' + (datos.email_origen || 'desconocido') + '\n\n' +
      'Revisarlo en Supabase → tabla recibos_pendientes_tango',
      { name: NOMBRE_INST }
    );
  } catch(e) {
    Logger.log('No se pudo enviar email de aviso: ' + e.toString());
  }
}

// ══════════════════════════════════════════════════════════════
// HELPERS — GMAIL
// ══════════════════════════════════════════════════════════════

function _obtenerOCrearLabel(nombre) {
  var lbl = GmailApp.getUserLabelByName(nombre);
  if (!lbl) lbl = GmailApp.createLabel(nombre);
  return lbl;
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
      Logger.log('_sbGet error ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
      return [];
    }
    return JSON.parse(resp.getContentText()) || [];
  } catch(e) {
    Logger.log('_sbGet excepción: ' + e.toString());
    return [];
  }
}

function _sbPost(table, data) {
  try {
    var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal'
      },
      payload: JSON.stringify(data),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 300) {
      Logger.log('_sbPost error ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
      return false;
    }
    return true;
  } catch(e) {
    Logger.log('_sbPost excepción: ' + e.toString());
    return false;
  }
}

function _sbPatch(path, data) {
  try {
    var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method: 'patch',
      contentType: 'application/json',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal'
      },
      payload: JSON.stringify(data),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 300) {
      Logger.log('_sbPatch error ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
      return false;
    }
    return true;
  } catch(e) {
    Logger.log('_sbPatch excepción: ' + e.toString());
    return false;
  }
}
