/**
 * ══════════════════════════════════════════════════════════
 * SiGPo — Script de envío de emails
 * Google Apps Script — desplegar como Web App desde cada cuenta
 *
 * INSTRUCCIONES DE DESPLIEGUE (repetir para cada cuenta):
 *  1. Ir a script.google.com → Nuevo proyecto
 *  2. Pegar este código
 *  3. Clic en "Implementar" → "Nueva implementación"
 *  4. Tipo: Aplicación web
 *     · Ejecutar como: Yo (la cuenta actual)
 *     · Quién tiene acceso: Cualquier persona
 *  5. Copiar la URL generada y cargarla en Supabase:
 *     UPDATE programas SET gas_url = 'URL_AQUI' WHERE programa_id = X;
 *
 * CUENTAS:
 *  · costosygestion@fce.uncu.edu.ar  → Especialización en Costos
 *  · magnagro@fce.uncu.edu.ar        → Maestría MAGNAGRO
 *  · mrs@fce.uncu.edu.ar             → Maestría MRS
 *  · anneris.amarfil@fce.uncu.edu.ar → Sistema (fallback)
 * ══════════════════════════════════════════════════════════
 */

// ⚠️  Cambiar esta clave en producción — debe coincidir con GAS_SECRET en el HTML
var SECRET = 'SIGPO_KEY_FCE_2025';

// ─────────────────────────────────────────────────────────
function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Sin datos en el request');
    }

    var data = JSON.parse(e.postData.contents);

    if (data.secret !== SECRET) {
      throw new Error('No autorizado');
    }

    var to      = String(data.to      || '').trim();
    var subject = String(data.subject || '').trim();
    var body    = String(data.body    || '').trim();
    var replyTo = String(data.replyTo || '').trim();

    if (!to || !subject || !body) {
      throw new Error('Faltan campos obligatorios: to, subject, body');
    }

    var options = {
      name: 'Secretaría de Posgrado — FCE UNCUYO',
      htmlBody: body.replace(/\n/g, '<br>')
    };
    if (replyTo) options.replyTo = replyTo;

    MailApp.sendEmail(to, subject, body, options);

    output.setContent(JSON.stringify({ ok: true }));

  } catch (err) {
    output.setContent(JSON.stringify({ ok: false, error: err.message }));
  }

  return output;
}

// ─────────────────────────────────────────────────────────
// Función de prueba — ejecutar manualmente desde el editor
// para verificar que el envío funciona desde esta cuenta
// ─────────────────────────────────────────────────────────
function testEnvio() {
  var miEmail = Session.getActiveUser().getEmail();
  var mockRequest = {
    postData: {
      contents: JSON.stringify({
        secret:  SECRET,
        to:      miEmail,
        subject: '✅ Test SiGPo — envío funcionando',
        body:    'Este es un mensaje de prueba del sistema SiGPo FCE UNCUYO.\n\nSi recibiste este email, el script está configurado correctamente.'
      })
    }
  };
  var result = JSON.parse(doPost(mockRequest).getContent());
  Logger.log('Resultado: ' + JSON.stringify(result));
  if (result.ok) {
    Logger.log('✅ Email enviado a ' + miEmail);
  } else {
    Logger.log('❌ Error: ' + result.error);
  }
}
