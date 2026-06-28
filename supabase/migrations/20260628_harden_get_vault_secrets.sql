-- Endurecimiento: get_vault_secrets devuelve secretos DESCIFRADOS del vault.
-- Estaba ejecutable por anon/authenticated sin control => fuga potencial de
-- la service_role key. Solo debe usarla el backend (service_role).
-- Auditoria 2026-06-28. Continua el patron de db_harden_security_definer.sql.
REVOKE EXECUTE ON FUNCTION public.get_vault_secrets(text[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_vault_secrets(text[]) TO service_role;
