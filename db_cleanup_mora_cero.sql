-- ════════════════════════════════════════════════════════════════════
-- SANEAMIENTO DE DATOS — Revertir cuotas "EN_MORA con monto 0" a A_DEFINIR
-- Proyecto SiGPo (fdevypdowdhqaxvfiywt)
--
-- CONTEXTO
--   El trigger generar_cobros_nuevo_inscripto() crea las cuotas nuevas con
--   monto_final = 0 y estado = 'A_DEFINIR' (placeholder "a definir").
--   El cálculo de mora anterior (aplicarMoraCohorteJS y la primera versión
--   de la RPC) NO las salteaba: las veía vencidas y sin pago, y las marcaba
--   EN_MORA con saldo 0. Resultado: 101 cuotas "en mora" falsas (todas en
--   la cohorte 10), sin ningún pago ni recibo asociado.
--
--   La RPC ya fue corregida (migración fix_mora_excluir_a_definir_y_monto_cero)
--   para que nunca vuelva a ocurrir. Este script repara los datos existentes.
--
-- SEGURIDAD
--   Solo afecta filas con monto_final = 0, sin pago (monto_abonado) y sin
--   recibo. Devuelve cada cuota a su estado correcto 'A_DEFINIR' y limpia
--   los campos de mora. No toca cuotas con monto, pagos ni recibos.
-- ════════════════════════════════════════════════════════════════════

UPDATE cobros
   SET estado          = 'A_DEFINIR',
       saldo_pendiente = 0,
       meses_mora      = 0,
       fecha_mora      = NULL,
       updated_at      = now()
 WHERE estado = 'EN_MORA'
   AND COALESCE(monto_final, 0) = 0
   AND COALESCE(monto_abonado, 0) = 0
   AND (recibo_url IS NULL OR btrim(recibo_url) = '');
