import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    if (!token) return json({ ok: false, error: 'Sin token' }, 401)

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: userErr } = await sbAdmin.auth.getUser(token)
    if (userErr || !user) return json({ ok: false, error: 'Token invalido' }, 401)

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

    // Leer secretos via RPC (vault no es accesible via schema() en REST API)
    const { data: secretos, error: secErr } = await sbAdmin
      .rpc('get_vault_secrets', { secret_names: ['GAS_SECRET', 'GAS_FALLBACK_URL'] })
    if (secErr) return json({ ok: false, error: 'No se pudieron leer secretos: ' + secErr.message }, 200)

    const mapa: Record<string, string> = {}
    for (const s of (secretos || [])) mapa[s.name] = s.value
    const secret = mapa['GAS_SECRET']
    if (!secret) return json({ ok: false, error: 'GAS_SECRET no configurado en el Vault' }, 200)

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
    if (!gasUrl) return json({ ok: false, error: 'Sin gas_url configurada' }, 200)

    let host = ''
    try { host = new URL(gasUrl).host } catch (_) { return json({ ok: false, error: 'gas_url invalida' }, 200) }
    if (host !== 'script.google.com') return json({ ok: false, error: 'gas_url no permitida' }, 200)

    const replyTo = fromEmail || replyToClient
    console.log(`[enviar-email] programa=${programaId} to=${to} from=${fromEmail} replyTo=${replyTo} gasUrl=${gasUrl.slice(-30)}`)

    const gasPayload = JSON.stringify({ secret, to, subject, body: emailBody, from: fromEmail, replyTo })

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
    try { rawText = await gasRes.text() } catch (_) { rawText = '' }
    console.log(`[enviar-email] GAS status=${gasRes.status} redirected=${gasRes.redirected} body=${rawText.slice(0, 300)}`)

    if (rawText.trimStart().startsWith('<')) {
      const titulo = (rawText.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || 'HTML'
      return json({
        ok: false,
        error: `GAS devolvió HTML (${gasRes.status}): "${titulo}". Verificar deployment: acceso "Cualquier persona" + versión con doPost.`,
        debug: { status: gasRes.status, redirected: gasRes.redirected, snippet: rawText.slice(0, 200) }
      }, 200)
    }

    let out: Record<string, unknown>
    try {
      out = JSON.parse(rawText)
    } catch (_) {
      return json({ ok: false, error: `GAS devolvió no-JSON (status ${gasRes.status}): ${rawText.slice(0, 150)}` }, 200)
    }

    return json(out, 200)

  } catch (e) {
    const err = e as Error
    console.error('[enviar-email] EXCEPCION:', err.message, err.stack)
    return json({ ok: false, error: 'Excepción interna: ' + (err.message || String(e)) }, 200)
  }
})
