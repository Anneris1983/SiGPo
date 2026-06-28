-- stats_cohorte y stats_programa ya bloquean rol NULL internamente
-- (IF v_rol IS NULL THEN RAISE). Se agrega defensa en profundidad revocando
-- anon a nivel de privilegio. Solo authenticated las consume.
REVOKE EXECUTE ON FUNCTION public.stats_cohorte(bigint)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.stats_programa(bigint)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.stats_cohorte(bigint)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.stats_programa(bigint)  TO authenticated;
