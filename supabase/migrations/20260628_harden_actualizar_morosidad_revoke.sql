-- actualizar_morosidad muta cobros global (=> EN_MORA). No la llama el frontend
-- ni el GAS; la ejecuta un cron job (pg_cron jobid 1, 03:30 diario) como
-- postgres, que IGNORA los privilegios. Por eso se revoca todo acceso de
-- usuario sin afectar la automatizacion.
REVOKE EXECUTE ON FUNCTION public.actualizar_morosidad() FROM PUBLIC, anon, authenticated;
