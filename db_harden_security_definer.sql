-- ════════════════════════════════════════════════════════════════
-- Endurecimiento de funciones SECURITY DEFINER expuestas
-- Aplicado a la BD (migraciones: harden_security_definer_rpcs,
-- harden_rpc_wrappers_revoke_public, harden_dashboard_admin_revoke_anon).
-- Detectado por el security advisor de Supabase.
--
-- Patrón: rename + wrapper. El cuerpo original se conserva intacto en
-- *_impl (sin EXECUTE para anon/authenticated; solo lo invoca el wrapper
-- vía SECURITY DEFINER), y un wrapper con guard de rol toma el nombre
-- público que llama el frontend. El control de rol usa get_user_rol()
-- (mismo helper que las RLS), con COALESCE para bloquear anon/sin-rol.
-- ════════════════════════════════════════════════════════════════

-- 1) aplicar_mora_cohorte: muta montos/estados de toda una cohorte.
--    Antes: callable por anon y cualquier authenticated, SIN control.
--    Ahora: solo ADMINISTRADOR/COORDINADOR; anon bloqueado.
ALTER FUNCTION public.aplicar_mora_cohorte(bigint) RENAME TO aplicar_mora_cohorte_impl;
REVOKE ALL ON FUNCTION public.aplicar_mora_cohorte_impl(bigint) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.aplicar_mora_cohorte(p_cohorte_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(get_user_rol()::text, '') NOT IN ('ADMINISTRADOR','COORDINADOR') THEN
    RAISE EXCEPTION 'Acceso denegado: se requiere rol ADMINISTRADOR o COORDINADOR';
  END IF;
  RETURN public.aplicar_mora_cohorte_impl(p_cohorte_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.aplicar_mora_cohorte(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aplicar_mora_cohorte(bigint) TO authenticated;

-- 2) dashboard_stats_admin: expone finanzas globales agregadas.
--    Antes: cualquier authenticated (incluye estudiantes/profesores).
--    Ahora: solo personal de back-office (ADMINISTRADOR/SECRETARIA/COOPERADORA).
ALTER FUNCTION public.dashboard_stats_admin() RENAME TO dashboard_stats_admin_impl;
REVOKE ALL ON FUNCTION public.dashboard_stats_admin_impl() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_stats_admin()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(get_user_rol()::text, '') NOT IN ('ADMINISTRADOR','SECRETARIA','COOPERADORA') THEN
    RAISE EXCEPTION 'Acceso denegado: estadisticas restringidas a personal autorizado';
  END IF;
  RETURN public.dashboard_stats_admin_impl();
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.dashboard_stats_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dashboard_stats_admin() TO authenticated;

-- 3) generar_cobros_nuevo_inscripto: es función de TRIGGER, no debe ser
--    invocable como RPC. Revocar EXECUTE no afecta el disparo del trigger.
REVOKE EXECUTE ON FUNCTION public.generar_cobros_nuevo_inscripto() FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- NOTAS / pendientes (NO aplicados):
--
-- · aplicar_mora_estudiante() y distribuir_egreso_todos_programas() tienen
--   un guard que filtra por "WHERE auth_id = auth.uid()", pero la columna
--   correcta es auth_user_id (auth_id NO existe). Lanzarían
--   'column auth_id does not exist' si se invocaran. Hoy NINGUNA está en
--   uso desde el frontend (código muerto con bug latente). Si se quieren
--   reactivar, corregir auth_id -> auth_user_id (o usar get_user_rol()).
--
-- · Funciones anon intencionales (login pre-auth / verificación pública):
--   get_login_data, get_login_info, verificar_libre_deuda. Se dejan como están.
--
-- · El advisor seguirá marcando "authenticated can execute SECURITY DEFINER"
--   en los wrappers: es esperado, la autorización está dentro de la función.
--
-- · auth_leaked_password_protection: habilitar en el panel de Supabase
--   (Authentication -> Policies). No configurable por SQL/MCP.
-- ════════════════════════════════════════════════════════════════
