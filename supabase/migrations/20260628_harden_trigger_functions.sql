-- Funciones de TRIGGER (RETURNS trigger): se disparan solas cuando cambia la
-- tabla; no deben ser invocables como RPC. Revocar EXECUTE no afecta el disparo
-- del trigger. ping_gas_reclamos ademas lee el secreto GAS del vault.
-- IMPORTANTE: el EXECUTE viene de PUBLIC, hay que revocarlo de ahi (revocar solo
-- de anon/authenticated no alcanza). Patron: db_harden_security_definer.sql.
REVOKE EXECUTE ON FUNCTION public.ping_gas_reclamos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_email_estudiantes_a_usuarios() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_email_usuarios_a_estudiantes() FROM PUBLIC, anon, authenticated;
