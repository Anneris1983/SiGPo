-- rechazar_cobro: misma guardia que fallaba abierta para anon (NULL NOT IN).
-- Se corrige con COALESCE y se revoca anon. Cuerpo intacto.
CREATE OR REPLACE FUNCTION public.rechazar_cobro(p_cobro_id bigint, p_motivo text DEFAULT NULL::text, p_forzar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_rol          rol_usuario;
    v_cobro        cobros%ROWTYPE;
    v_nuevo_estado TEXT;
    v_total_pagado NUMERIC;
BEGIN
    v_rol := get_user_rol();
    IF COALESCE(v_rol::text, '') NOT IN ('COOPERADORA', 'ADMINISTRADOR') THEN
        RETURN jsonb_build_object('ok', false, 'mensaje', 'Sin permiso');
    END IF;

    SELECT * INTO v_cobro FROM cobros WHERE cobro_id = p_cobro_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'mensaje', 'Cobro no encontrado');
    END IF;

    IF v_cobro.estado = 'ABONADA' AND NOT p_forzar THEN
        RETURN jsonb_build_object('ok', false,
            'mensaje', 'Esta cuota ya está abonada. Solo el administrador puede revertirla.');
    END IF;

    IF v_cobro.estado = 'ABONADA' AND p_forzar AND v_rol <> 'ADMINISTRADOR' THEN
        RETURN jsonb_build_object('ok', false,
            'mensaje', 'Solo el administrador puede revertir una cuota abonada.');
    END IF;

    -- Determinar nuevo estado
    IF v_cobro.monto_final IS NULL OR v_cobro.monto_final = 0 THEN
        v_nuevo_estado := 'A_DEFINIR';
    ELSIF v_cobro.fecha_vencimiento IS NOT NULL AND v_cobro.fecha_vencimiento < CURRENT_DATE THEN
        v_nuevo_estado := 'EN_MORA';
    ELSE
        SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado
        FROM pagos WHERE cobro_id = p_cobro_id;
        v_nuevo_estado := CASE WHEN v_total_pagado > 0 THEN 'PAGO_PARCIAL' ELSE 'NO_ABONADA' END;
    END IF;

    UPDATE cobros SET
        estado            = v_nuevo_estado,
        comprobante_url   = NULL,
        comprobante_fecha = NULL,
        motivo_rechazo    = NULLIF(TRIM(COALESCE(p_motivo, '')), '')
    WHERE cobro_id = p_cobro_id;

    RETURN jsonb_build_object('ok', true, 'nuevo_estado', v_nuevo_estado);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rechazar_cobro(bigint, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rechazar_cobro(bigint, text, boolean) TO authenticated;
