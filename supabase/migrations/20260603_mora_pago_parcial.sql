-- Migración: mora_pago_parcial
-- Fecha: 2026-06-03
--
-- Problema: los cobros con PAGO_PARCIAL (que tienen recibo parcial) caían en la
-- "Parte 1" de aplicar_mora_cohorte_impl (solo corrección de estado, sin tocar
-- el saldo). Por eso el saldo remanente de un pago parcial nunca recibía mora.
--
-- Regla de negocio:
--   - El saldo remanente de un PAGO_PARCIAL vencido pierde el descuento en el
--     primer mes (= precio proporcional sin descuento).
--   - Desde el 2do mes en adelante: +5% mensual compuesto sobre esa base.
--   - Igual que una cuota no abonada, pero partiendo del saldo proporcional.
--
-- Solución:
--   1. Nueva columna `saldo_mora_base` en `cobros`: almacena la base estable
--      (saldo proporcional sin descuento) para el cálculo compuesto idempotente.
--   2. Parte 3 en aplicar_mora_cohorte_impl: maneja PAGO_PARCIAL vencido.
--   3. Parte 1 ya no revierte a PAGO_PARCIAL los cobros que están EN_MORA
--      por la Parte 3 (saldo_mora_base IS NOT NULL).

-- ── 1. Nueva columna ──────────────────────────────────────────────────────────
ALTER TABLE public.cobros ADD COLUMN IF NOT EXISTS saldo_mora_base numeric(12,2);

-- ── 2. Función actualizada ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicar_mora_cohorte_impl(p_cohorte_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_pct        numeric;
    v_afectados  integer := 0;
BEGIN
    SELECT COALESCE(NULLIF(valor, '')::numeric, 5) / 100.0
      INTO v_pct
      FROM configuracion
     WHERE clave = 'mora_porcentaje';
    IF v_pct IS NULL THEN
        v_pct := 0.05;
    END IF;

    -- Parte 1: Cobros CON recibo — solo corregir estado, sin tocar saldo.
    -- Excluye cobros EN_MORA que provienen de PAGO_PARCIAL (saldo_mora_base IS NOT NULL)
    -- para que no sean revertidos a PAGO_PARCIAL (los maneja la Parte 3).
    WITH afectados AS (
        UPDATE cobros c
           SET estado = CASE WHEN COALESCE(c.saldo_pendiente, 0) <= 0
                             THEN 'ABONADA'::estado_cobro
                             ELSE 'PAGO_PARCIAL'::estado_cobro END
         WHERE c.cohorte_id = p_cohorte_id
           AND c.recibo_url IS NOT NULL
           AND btrim(c.recibo_url) <> ''
           AND COALESCE(c.monto_final, 0) > 0
           AND c.fecha_vencimiento IS NOT NULL
           AND c.fecha_vencimiento < CURRENT_DATE
           AND COALESCE(c.no_aplica, false) = false
           AND c.estado NOT IN ('ABONADA','NO_APLICA','PENDIENTE','A_DEFINIR')
           -- No revertir EN_MORA con saldo pendiente que proviene de PAGO_PARCIAL
           AND NOT (c.estado = 'EN_MORA'
                    AND COALESCE(c.saldo_pendiente, 0) > 0
                    AND c.saldo_mora_base IS NOT NULL)
           AND c.estado <> CASE WHEN COALESCE(c.saldo_pendiente, 0) <= 0
                                THEN 'ABONADA'::estado_cobro
                                ELSE 'PAGO_PARCIAL'::estado_cobro END
        RETURNING 1
    )
    SELECT v_afectados + count(*) INTO v_afectados FROM afectados;

    -- Parte 2: Cobros SIN recibo — interés compuesto desde monto_original.
    WITH calc AS (
        SELECT
            c.cobro_id,
            c.fecha_vencimiento,
            c.fecha_mora,
            floor((CURRENT_DATE - c.fecha_vencimiento) / 30.0)         AS meses_floor,
            (CURRENT_DATE - c.fecha_vencimiento) / 30.0                AS meses_frac,
            COALESCE(NULLIF(c.monto_original, 0), c.monto_final, 0)    AS precio_base,
            (COALESCE(c.descuento_porcentaje, 0) > 0
             OR EXISTS (
                 SELECT 1
                   FROM inscripciones i
                   JOIN estudiantes e ON e.id = i.estudiante_id
                  WHERE i.cohorte_id = c.cohorte_id
                    AND e.dni = c.dni
                    AND COALESCE(i.descuento_porcentaje, 0) > 0
             ))                                                         AS con_descuento
          FROM cobros c
         WHERE c.cohorte_id = p_cohorte_id
           AND (c.recibo_url IS NULL OR btrim(c.recibo_url) = '')
           AND COALESCE(c.monto_final, 0) > 0
           AND c.fecha_vencimiento IS NOT NULL
           AND c.fecha_vencimiento < CURRENT_DATE
           AND COALESCE(c.no_aplica, false) = false
           AND c.estado NOT IN ('ABONADA','NO_APLICA','PENDIENTE','A_DEFINIR')
    ),
    nuevo AS (
        SELECT
            cobro_id,
            fecha_vencimiento,
            fecha_mora,
            meses_floor,
            round(
                CASE
                    WHEN con_descuento AND meses_frac <= 1 THEN precio_base
                    WHEN con_descuento                     THEN precio_base * power(1 + v_pct, meses_frac - 1)
                    ELSE                                        precio_base * power(1 + v_pct, meses_frac)
                END
            , 2) AS nuevo_saldo
          FROM calc
         WHERE precio_base > 0
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
           AND (
                 abs(COALESCE(c.monto_final, 0)     - n.nuevo_saldo) > 0.01
              OR abs(COALESCE(c.saldo_pendiente, 0) - n.nuevo_saldo) > 0.01
              OR c.estado <> 'EN_MORA'::estado_cobro
               )
        RETURNING 1
    )
    SELECT v_afectados + count(*) INTO v_afectados FROM afectados2;

    -- Parte 3: PAGO_PARCIAL vencido (y EN_MORA proveniente de PAGO_PARCIAL).
    -- Aplica mora sobre el saldo remanente:
    --   - Primer mes: pierde el descuento (saldo proporcional sin descuento)
    --   - Meses siguientes: +5% mensual compuesto sobre esa base
    -- saldo_mora_base guarda la base estable para que el cálculo sea idempotente.
    WITH calc_parcial AS (
        SELECT
            c.cobro_id,
            floor((CURRENT_DATE - c.fecha_vencimiento) / 30.0)  AS meses_floor,
            (CURRENT_DATE - c.fecha_vencimiento) / 30.0         AS meses_frac,
            c.saldo_mora_base IS NULL                            AS es_primera_mora,
            -- Base para interés compuesto (estable entre recálculos):
            --   primera vez → proporción sin descuento del monto_original
            --   siguientes  → base guardada
            COALESCE(
                c.saldo_mora_base,
                round(
                    COALESCE(NULLIF(c.monto_original, 0), c.monto_final, 0)
                    * COALESCE(c.saldo_pendiente, 0)
                    / NULLIF(c.monto_final, 0)
                , 2)
            )                                                    AS precio_base_rem,
            (COALESCE(c.descuento_porcentaje, 0) > 0
             OR EXISTS (
                 SELECT 1 FROM inscripciones i
                 JOIN estudiantes e ON e.id = i.estudiante_id
                 WHERE i.cohorte_id = c.cohorte_id AND e.dni = c.dni
                   AND COALESCE(i.descuento_porcentaje, 0) > 0
             ))                                                  AS con_descuento
        FROM cobros c
        WHERE c.cohorte_id = p_cohorte_id
          AND c.recibo_url IS NOT NULL AND btrim(c.recibo_url) <> ''
          AND (
              c.estado = 'PAGO_PARCIAL'
              OR (c.estado = 'EN_MORA' AND c.saldo_mora_base IS NOT NULL)
          )
          AND COALESCE(c.saldo_pendiente, 0) > 0
          AND COALESCE(c.monto_final, 0) > 0
          AND c.fecha_vencimiento IS NOT NULL
          AND c.fecha_vencimiento < CURRENT_DATE
          AND COALESCE(c.no_aplica, false) = false
    ),
    nuevo_parcial AS (
        SELECT
            cobro_id,
            es_primera_mora,
            precio_base_rem,
            meses_floor,
            round(
                CASE
                    WHEN con_descuento AND meses_frac <= 1 THEN precio_base_rem
                    WHEN con_descuento                     THEN precio_base_rem * power(1 + v_pct, meses_frac - 1)
                    ELSE                                        precio_base_rem * power(1 + v_pct, meses_frac)
                END
            , 2) AS nuevo_saldo
        FROM calc_parcial
        WHERE precio_base_rem > 0
    ),
    afectados3 AS (
        UPDATE cobros c
           SET estado          = 'EN_MORA'::estado_cobro,
               saldo_pendiente = n.nuevo_saldo,
               monto_final     = n.nuevo_saldo,
               saldo_mora_base = CASE WHEN n.es_primera_mora THEN n.precio_base_rem
                                      ELSE c.saldo_mora_base END,
               meses_mora      = n.meses_floor::integer,
               fecha_mora      = COALESCE(c.fecha_mora, c.fecha_vencimiento + 1),
               updated_at      = now()
          FROM nuevo_parcial n
         WHERE c.cobro_id = n.cobro_id
           AND (
                 abs(COALESCE(c.saldo_pendiente, 0) - n.nuevo_saldo) > 0.01
              OR c.estado <> 'EN_MORA'::estado_cobro
               )
        RETURNING 1
    )
    SELECT v_afectados + count(*) INTO v_afectados FROM afectados3;

    RETURN v_afectados;
END;
$function$;
