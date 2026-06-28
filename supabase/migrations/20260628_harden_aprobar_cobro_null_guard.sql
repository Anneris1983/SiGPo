-- aprobar_cobro: la guardia "v_rol NOT IN (...)" fallaba ABIERTA para anon,
-- porque get_user_rol() devuelve NULL y "NULL NOT IN (...)" = NULL (no TRUE),
-- asi que el chequeo no frenaba al llamador anonimo. Se corrige con COALESCE
-- y se revoca anon (solo usuarios logueados la llaman). Cuerpo intacto.
CREATE OR REPLACE FUNCTION public.aprobar_cobro(p_cobro_id bigint, p_tipo text, p_monto numeric, p_recibo_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_rol          rol_usuario;
    v_cobro        cobros%ROWTYPE;
    v_abonado_prev NUMERIC;
    v_abonado_tot  NUMERIC;
    v_nuevo_saldo  NUMERIC;
    v_estado_nuevo TEXT;
    v_fecha_pago   DATE;
BEGIN
    v_rol := get_user_rol();
    IF COALESCE(v_rol::text, '') NOT IN ('COOPERADORA', 'ADMINISTRADOR') THEN
        RETURN jsonb_build_object('ok', false, 'mensaje', 'Sin permiso');
    END IF;

    SELECT * INTO v_cobro FROM cobros WHERE cobro_id = p_cobro_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'mensaje', 'Cobro no encontrado');
    END IF;

    IF v_cobro.estado = 'ABONADA' THEN
        RETURN jsonb_build_object('ok', false, 'mensaje', 'Esta cuota ya está abonada');
    END IF;

    v_fecha_pago := COALESCE(v_cobro.comprobante_fecha::DATE, CURRENT_DATE);

    IF p_tipo IN ('COMPLETO', 'total') THEN
        UPDATE cobros SET
            estado          = 'ABONADA',
            saldo_pendiente = 0,
            monto_abonado   = v_cobro.monto_final,
            fecha_aprobacion = CURRENT_DATE,
            recibo_url      = COALESCE(p_recibo_url, v_cobro.recibo_url),
            aprobado_por    = get_user_dni()
        WHERE cobro_id = p_cobro_id;

        INSERT INTO pagos (cobro_id, monto, fecha_pago, recibo_url)
        VALUES (p_cobro_id, v_cobro.monto_final, v_fecha_pago, COALESCE(p_recibo_url, v_cobro.recibo_url));

    ELSE
        IF p_monto IS NULL OR p_monto <= 0 THEN
            RETURN jsonb_build_object('ok', false, 'mensaje', 'El monto debe ser mayor a cero');
        END IF;

        v_abonado_prev := COALESCE(v_cobro.monto_abonado, 0);
        v_abonado_tot  := ROUND((v_abonado_prev + p_monto)::NUMERIC, 2);
        v_nuevo_saldo  := ROUND((COALESCE(v_cobro.monto_final, 0) - v_abonado_tot)::NUMERIC, 2);
        v_estado_nuevo := CASE WHEN v_nuevo_saldo <= 0 THEN 'ABONADA' ELSE 'PAGO_PARCIAL' END;

        UPDATE cobros SET
            estado          = v_estado_nuevo,
            saldo_pendiente = GREATEST(0, v_nuevo_saldo),
            monto_abonado   = v_abonado_tot,
            recibo_url      = COALESCE(p_recibo_url, v_cobro.recibo_url),
            aprobado_por    = get_user_dni(),
            saldo_mora_base = NULL,
            fecha_aprobacion = CASE WHEN v_estado_nuevo = 'ABONADA' THEN CURRENT_DATE ELSE NULL END
        WHERE cobro_id = p_cobro_id;

        INSERT INTO pagos (cobro_id, monto, fecha_pago, recibo_url)
        VALUES (p_cobro_id, p_monto, v_fecha_pago, COALESCE(p_recibo_url, v_cobro.recibo_url));
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.aprobar_cobro(bigint, text, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aprobar_cobro(bigint, text, numeric, text) TO authenticated;
