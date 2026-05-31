import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ══════════════════════════════════════════════════════════════
// SiGPo — Relay de envío de email
// Reenvía al Google Apps Script (gas_url del programa) inyectando
// el secreto GAS_SECRET del lado del servidor, para que la clave
// NUNCA viaje en el HTML público ni en el repositorio.
//
// Secretos requeridos (Supabase → Edge Functions → Secrets):
//   · GAS_SECRET        → debe coincidir con SECRET en sigpo_gas_email.gs
//   · GAS_FALLBACK_URL  → URL del GAS por defecto (cuando el programa no tiene gas_url)
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
    //    (El propio GAS valida que los destinatarios sean usuarios activos registrados.)
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
    const replyTo = String(body.replyTo || '').trim()

    if (!to || !subject || !emailBody) {
      return json({ ok: false, error: 'Faltan campos: to, subject, body' }, 400)
    }

    // 3. Resolver la gas_url desde la BD (nunca desde el cliente) para evitar
    //    que un usuario apunte el relay a una URL arbitraria y robe el secreto.
    let gasUrl = ''
    if (programaId !== null && programaId !== '') {
      const { data: prog } = await sbAdmin
        .from('programas')
        .select('gas_url')
        .eq('programa_id', programaId)
        .single()
      if (prog && prog.gas_url) gasUrl = String(prog.gas_url).trim()
    }
    if (!gasUrl) gasUrl = (Deno.env.get('GAS_FALLBACK_URL') || '').trim()

    if (!gasUrl) return json({ ok: false, error: 'Sin gas_url configurada' }, 400)

    // 4. Restringir a Google Apps Script (defensa adicional anti-SSRF)
    let host = ''
    try { host = new URL(gasUrl).host } catch (_) { return json({ ok: false, error: 'gas_url invalida' }, 400) }
    if (host !== 'script.google.com') {
      return json({ ok: false, error: 'gas_url no permitida' }, 400)
    }

    const secret = Deno.env.get('GAS_SECRET')
    if (!secret) return json({ ok: false, error: 'GAS_SECRET no configurado en el servidor' }, 500)

    // 5. Reenviar al GAS con el secreto inyectado del lado servidor
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ secret, to, subject, body: emailBody, replyTo }),
    })
    const out = await res.json().catch(() => ({ ok: false, error: 'Respuesta no JSON del GAS' }))
    return json(out, 200)

  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
