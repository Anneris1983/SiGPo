import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ══════════════════════════════════════════════════════════════
// SiGPo — Relay de envío de email
// Reenvía al Google Apps Script (gas_url del programa) inyectando
// el secreto GAS_SECRET del lado del servidor, para que la clave
// NUNCA viaje en el HTML público ni en el repositorio.
//
// Los secretos se leen del Supabase Vault (tabla cifrada en la BD):
//   · GAS_SECRET        → debe coincidir con SECRET en sigpo_gas_email.gs
//   · GAS_FALLBACK_URL  → URL del GAS por defecto (cuando el programa no tiene gas_url)
// Rotación: actualizar el valor en vault.secrets (vía SQL) y en el GAS.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.
// ══════════════════════════════════════════════════════════════

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // 1. Autenticación: cualquier usuario con sesión válida puede disparar envíos.
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    if (!token) return json({ ok: false, error: 'Sin token' }, 401)

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: userErr } = await sbAdmin.auth.getUser(token)
    if (userErr || !user) return json({ ok: false, error: 'Token invalido' }, 401)

    // 2. Validar payload
    const body = await req.json().catch(() => null)
    if (!body) return json({ ok: false, error: 'Body invalido' }, 400)

    const programaId = body.programaId ?? body.programa_id ?? null
    const to = String(body.to || '').trim()
    const subject = String(body.subject || '').trim()
    const emailBody = String(body.body || '').trim()
    const replyToClient = String(body.replyTo || '').trim()

    if (!to || !subject || !emailBody) {
      return json({ ok: false, error: 'Faltan campos: to, subject, body' }, 400)
    }

    // 3. Leer secretos del Vault (cifrados en la BD, accesibles solo con service role)
    const { data: secretos, error: secErr } = await sbAdmin
      .schema('vault')
      .from('decrypted_secrets')
      .select('name, decrypted_secret')
      .in('name', ['GAS_SECRET', 'GAS_FALLBACK_URL'])
    if (secErr) return json({ ok: false, error: 'No se pudieron leer secretos: ' + secErr.message }, 500)

    const mapa: Record<string, string> = {}
    for (const s of secretos || []) mapa[s.name] = s.decrypted_secret
    const secret = mapa['GAS_SECRET']
    if (!secret) return json({ ok: false, error: 'GAS_SECRET no configurado en el Vault' }, 500)

    // 4. Resolver gas_url y email_remitente desde la BD
    let gasUrl = ''
    let fromEmail = ''
    if (programaId !== null && programaId !== '') {
      const { data: prog } = await sbAdmin
        .from('programas')
        .select('gas_url, email_remitente')
        .eq('programa_id', programaId)
        .single()
      if (prog && prog.gas_url) gasUrl = String(prog.gas_url).trim()
      if (prog && prog.email_remitente) fromEmail = String(prog.email_remitente).trim()
    }
    if (!gasUrl) gasUrl = (mapa['GAS_FALLBACK_URL'] || '').trim()
    if (!gasUrl) return json({ ok: false, error: 'Sin gas_url configurada' }, 400)

    // 5. Restringir a Google Apps Script (defensa adicional anti-SSRF)
    let host = ''
    try { host = new URL(gasUrl).host } catch (_) { return json({ ok: false, error: 'gas_url invalida' }, 400) }
    if (host !== 'script.google.com') {
      return json({ ok: false, error: 'gas_url no permitida' }, 400)
    }

    // 6. Reenviar al GAS con el secreto inyectado del lado servidor
    const replyTo = fromEmail || replyToClient
    console.log(`[enviar-email] programa=${programaId} to=${to} from=${fromEmail} replyTo=${replyTo} gasUrl=${gasUrl.slice(-30)}`)

    const gasPayload = JSON.stringify({ secret, to, subject, body: emailBody, from: fromEmail, replyTo })

    // GAS web apps responden con un 302 hacia googleusercontent.com donde se
    // sirve el resultado de doPost. Seguimos el redirect (follow) para obtener
    // el JSON. NO usar 'manual': en Deno produce una respuesta opaca sin body.
    let gasRes: Response
    try {
      gasRes = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: gasPayload,
        redirect: 'follow',
      })
    } catch (fetchErr) {
      return json({ ok: false, error: 'Error de red al contactar GAS: ' + (fetchErr as Error).message }, 200)
    }

    let rawText = ''
    try {
      rawText = await gasRes.text()
    } catch (readErr) {
      return json({ ok: false, error: 'No se pudo leer respuesta del GAS: ' + (readErr as Error).message }, 200)
    }
    console.log(`[enviar-email] GAS status=${gasRes.status} redirected=${gasRes.redirected} body=${rawText.slice(0, 300)}`)

    // Si la respuesta es HTML (error de Google), devolver diagnóstico claro
    if (rawText.trimStart().startsWith('<')) {
      const tituloMatch = rawText.match(/<title[^>]*>([^<]*)<\/title>/i)
      const titulo = tituloMatch ? tituloMatch[1] : 'página HTML'
      return json({
        ok: false,
        error: `GAS devolvió HTML (${gasRes.status}): ${titulo}. Verificar que el deployment tenga acceso "Cualquier persona" y versión con doPost.`,
        debug: { status: gasRes.status, redirected: gasRes.redirected, snippet: rawText.slice(0, 200) }
      }, 200)
    }

    let out: Record<string, unknown>
    try {
      out = JSON.parse(rawText)
    } catch (_) {
      return json({ ok: false, error: `GAS devolvió texto no JSON (${gasRes.status}): ${rawText.slice(0, 100)}` }, 200)
    }

    return json(out, 200)

  } catch (e) {
    // Devolvemos 200 con ok:false para que el mensaje real llegue al cliente
    // (supabase-js oculta el body en respuestas no-2xx con un error genérico).
    const err = e as Error
    console.error('[enviar-email] EXCEPCION:', err.message, err.stack)
    return json({ ok: false, error: 'Excepción en edge function: ' + (err.message || String(e)) }, 200)
  }
})
