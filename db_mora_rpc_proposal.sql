-- ════════════════════════════════════════════════════════════════════
-- PROPUESTA — Centralizar el cálculo de mora en una función de base de datos
-- Proyecto SiGPo (fdevypdowdhqaxvfiywt)
--
-- ⚠️  PROPUESTA PARA REVISIÓN — NO APLICADA AUTOMÁTICAMENTE.
--
-- PROBLEMA ACTUAL
--   La mora se calcula y se ESCRIBE en el cliente, dentro de
--   administrador_4_cohorte.html → aplicarMoraCohorteJS(), que corre en
--   cada carga de la cohorte y dispara N UPDATE en paralelo (Promise.all).
--   Riesgos: race condition (dos personas abriendo la misma cohorte se
--   pisan los UPDATE) y lógica financiera viviendo en el navegador.
--   (cooperadora_5 y coordinador_3 sólo MUESTRAN la mora, no la escriben.)
--
-- SOLUCIÓN
--   Mover el cálculo a esta función. La cohorte completa se actualiza en
--   UNA sola sentencia atómica (sin race). El cliente pasa a llamar:
--       await sb.rpc('aplicar_mora_cohorte', { p_cohorte_id: cohorteId });
--   en lugar del bucle aplicarMoraCohorteJS().
--
-- REGLAS REPLICADAS (idénticas a aplicarMoraCohorteJS, admin_4:1076-1157)
--   Config (tabla configuracion): mora_porcentaje = 5 (% mensual compuesto)
--   Se omiten cobros: sin monto definido, sin fecha_venc, NO vencidos
--     (fecha_vencimiento >= hoy), no_aplica = true, o estado en
--     (ABONADA, NO_APLICA, PENDIENTE).
--   Cobros CON recibo (recibo_url no vacío): NO se toca saldo_pendiente
--     (el pago es un hecho fijo); sólo se corrige el estado a ABONADA si
--     saldo <= 0, o PAGO_PARCIAL si saldo > 0. → protege pagos parciales.
--   meses_mora = floor(dias_mora / 30); el cálculo usa meses fraccionarios.
--   precio_base = monto_original (o monto_final si aquel es 0/null).
--   CON descuento (inscripción o cobro con descuento_porcentaje > 0):
--     · meses <= 1  → pierde el descuento, sin interés: saldo = precio_base
--     · meses  > 1  → interés compuesto desde el mes 2:
--                     saldo = precio_base * (1 + pct) ^ (meses - 1)
--   SIN descuento: interés compuesto desde el día 1:
--                     saldo = precio_base * (1 + pct) ^ meses
--
-- Devuelve la cantidad de cobros efectivamente modificados.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.aplicar_mora_cohorte(p_cohorte_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pct        numeric;       -- porcentaje mensual en fracción (0.05)
    v_afectados  integer := 0;
BEGIN
    -- Porcentaje de mora desde configuracion (default 5%)
    SELECT COALESCE(NULLIF(valor, '')::numeric, 5) / 100.0
      INTO v_pct
      FROM configuracion
     WHERE clave = 'mora_porcentaje';
    IF v_pct IS NULL THEN
        v_pct := 0.05;
    END IF;

    -- ── 1) Cobros CON recibo: sólo corregir el estado, sin tocar saldo ──
    WITH afectados AS (
        UPDATE cobros c
           SET estado = CASE WHEN COALESCE(c.saldo_pendiente, 0) <= 0
                             THEN 'ABONADA'::estado_cobro
                             ELSE 'PAGO_PARCIAL'::estado_cobro END
         WHERE c.cohorte_id = p_cohorte_id
           AND c.recibo_url IS NOT NULL
           AND btrim(c.recibo_url) <> ''
           AND c.monto_final IS NOT NULL
           AND c.fecha_vencimiento IS NOT NULL
           AND c.fecha_vencimiento < CURRENT_DATE
           AND COALESCE(c.no_aplica, false) = false
           AND c.estado NOT IN ('ABONADA','NO_APLICA','PENDIENTE')
           AND c.estado <> CASE WHEN COALESCE(c.saldo_pendiente, 0) <= 0
                                THEN 'ABONADA'::estado_cobro
                                ELSE 'PAGO_PARCIAL'::estado_cobro END
        RETURNING 1
    )
    SELECT v_afectados + count(*) INTO v_afectados FROM afectados;

    -- ── 2) Cobros SIN recibo: aplicar pérdida de descuento + interés ──
    WITH calc AS (
        SELECT
            c.cobro_id,
            c.estado,
            c.monto_final,
            c.saldo_pendiente,
            floor((CURRENT_DATE - c.fecha_vencimiento) / 30.0)         AS meses_floor,
            (CURRENT_DATE - c.fecha_vencimiento) / 30.0                AS meses_frac,
            COALESCE(NULLIF(c.monto_original, 0), c.monto_final, 0)     AS precio_base,
            -- "con descuento" si el cobro o la inscripción tienen descuento
            (COALESCE(c.descuento_porcentaje, 0) > 0
             OR EXISTS (
                 SELECT 1
                   FROM inscripciones i
                   JOIN estudiantes e ON e.id = i.estudiante_id
                  WHERE i.cohorte_id = c.cohorte_id
                    AND e.dni = c.dni
                    AND COALESCE(i.descuento_porcentaje, 0) > 0
             ))                                                        AS con_descuento
          FROM cobros c
         WHERE c.cohorte_id = p_cohorte_id
           AND (c.recibo_url IS NULL OR btrim(c.recibo_url) = '')
           AND c.monto_final IS NOT NULL
           AND c.fecha_vencimiento IS NOT NULL
           AND c.fecha_vencimiento < CURRENT_DATE
           AND COALESCE(c.no_aplica, false) = false
           AND c.estado NOT IN ('ABONADA','NO_APLICA','PENDIENTE')
    ),
    nuevo AS (
        SELECT
            cobro_id,
            estado,
            monto_final,
            saldo_pendiente,
            meses_floor,
            round(
                CASE
                    WHEN con_descuento AND meses_frac <= 1 THEN precio_base
                    WHEN con_descuento                     THEN precio_base * power(1 + v_pct, meses_frac - 1)
                    ELSE                                        precio_base * power(1 + v_pct, meses_frac)
                END
            , 2) AS nuevo_saldo
          FROM calc
    ),
    afectados2 AS (
        UPDATE cobros c
           SET estado          = 'EN_MORA'::estado_cobro,
               monto_final     = n.nuevo_saldo,
               saldo_pendiente = n.nuevo_saldo,
               meses_mora      = n.meses_floor::integer,
               fecha_mora      = COALESCE(c.fecha_mora, c.fecha_vencimiento + 1),
               updated_at      = now()
          FROM nuevo n
         WHERE c.cobro_id = n.cobro_id
           -- sólo si hay cambio real (evita writes inútiles)
           AND (
                 abs(COALESCE(c.monto_final, 0)     - n.nuevo_saldo) > 0.01
              OR abs(COALESCE(c.saldo_pendiente, 0) - n.nuevo_saldo) > 0.01
              OR c.estado <> 'EN_MORA'::estado_cobro
               )
        RETURNING 1
    )
    SELECT v_afectados + count(*) INTO v_afectados FROM afectados2;

    RETURN v_afectados;
END;
$$;

-- Permisos: sólo usuarios autenticados pueden invocarla.
REVOKE ALL ON FUNCTION public.aplicar_mora_cohorte(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicar_mora_cohorte(bigint) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- USO DESDE EL CLIENTE (reemplaza aplicarMoraCohorteJS en admin_4)
--   var r = await sb.rpc('aplicar_mora_cohorte', { p_cohorte_id: cohorteId });
--   // r.data = cantidad de cobros actualizados
-- Luego recargar los cobros de la cohorte para reflejar los cambios.
-- ────────────────────────────────────────────────────────────────────

-- PRUEBA (no destructiva): ver cuántos cobros cambiarían sin escribir.
-- Ejecutar dentro de una transacción y hacer ROLLBACK:
--   BEGIN;
--   SELECT public.aplicar_mora_cohorte(<COHORTE_ID>);
--   ROLLBACK;
