-- RPCs que resuelven recibos/facturas pendientes de Tango. Se llaman desde
-- recibos_pendientes_tango.html (gateada a COOPERADORA/ADMINISTRADOR) pero no
-- tenian control de rol y eran ejecutables por anon. Se agrega guard de rol y
-- se revoca anon. Cuerpos intactos. Patron: db_harden_security_definer.sql.

CREATE OR REPLACE FUNCTION public.asignar_recibo_pendiente(p_pendiente_id bigint, p_cobro_id bigint, p_resuelto_por text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pend  recibos_pendientes_tango%ROWTYPE;
  v_nro   text;
BEGIN
  IF COALESCE(get_user_rol()::text, '') NOT IN ('COOPERADORA', 'ADMINISTRADOR') THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Sin permiso');
  END IF;

  SELECT * INTO v_pend FROM recibos_pendientes_tango WHERE id = p_pendiente_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Pendiente no encontrado');
  END IF;
  IF v_pend.resuelto THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Ya estaba resuelto');
  END IF;

  IF v_pend.pdf_url IS NOT NULL THEN
    UPDATE cobros SET recibo_url = v_pend.pdf_url WHERE cobro_id = p_cobro_id;
  END IF;

  v_nro := v_pend.nro_recibo;
  BEGIN
    INSERT INTO recibos_tango (cobro_id, nro_recibo, pdf_url, tango_datos_json, estado)
    VALUES (p_cobro_id, v_nro, v_pend.pdf_url, v_pend.datos_extraidos, 'asignado_manual');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO recibos_tango (cobro_id, nro_recibo, pdf_url, tango_datos_json, estado)
    VALUES (p_cobro_id, NULL, v_pend.pdf_url, v_pend.datos_extraidos, 'asignado_manual');
  END;

  UPDATE recibos_pendientes_tango
  SET resuelto = true, resuelto_por = p_resuelto_por, resuelto_en = now()
  WHERE id = p_pendiente_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.asignar_factura_pendiente(p_pendiente_id bigint, p_estudiante_dni bigint, p_resuelto_por text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pend  facturas_pendientes_tango%ROWTYPE;
  v_desc  text;
  v_per   text;
BEGIN
  IF COALESCE(get_user_rol()::text, '') NOT IN ('COOPERADORA', 'ADMINISTRADOR') THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Sin permiso');
  END IF;

  SELECT * INTO v_pend FROM facturas_pendientes_tango WHERE id = p_pendiente_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Pendiente no encontrado');
  END IF;
  IF v_pend.resuelto THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Ya estaba resuelto');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM estudiantes WHERE dni = p_estudiante_dni) THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'No existe un estudiante con ese DNI');
  END IF;

  v_desc := COALESCE(v_pend.datos_extraidos->>'descripcion',
                     'Factura ' || COALESCE(v_pend.nro_factura, ''));
  v_per  := v_pend.datos_extraidos->>'periodo';

  INSERT INTO facturas (estudiante_dni, descripcion, periodo, archivo_url, subido_por_dni)
  VALUES (p_estudiante_dni, v_desc, v_per, v_pend.pdf_url, 'TANGO');

  UPDATE facturas_pendientes_tango
  SET resuelto = true, resuelto_por = p_resuelto_por, resuelto_en = now()
  WHERE id = p_pendiente_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_pendiente_resuelto(p_pendiente_id bigint, p_resuelto_por text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(get_user_rol()::text, '') NOT IN ('COOPERADORA', 'ADMINISTRADOR') THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Sin permiso');
  END IF;

  UPDATE recibos_pendientes_tango
  SET resuelto = true, resuelto_por = p_resuelto_por, resuelto_en = now()
  WHERE id = p_pendiente_id AND resuelto = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'No encontrado o ya resuelto');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_factura_pendiente_resuelto(p_pendiente_id bigint, p_resuelto_por text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(get_user_rol()::text, '') NOT IN ('COOPERADORA', 'ADMINISTRADOR') THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'Sin permiso');
  END IF;

  UPDATE facturas_pendientes_tango
  SET resuelto = true, resuelto_por = p_resuelto_por, resuelto_en = now()
  WHERE id = p_pendiente_id AND resuelto = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'mensaje', 'No encontrado o ya resuelto');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.asignar_recibo_pendiente(bigint, bigint, text)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.asignar_factura_pendiente(bigint, bigint, text)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marcar_pendiente_resuelto(bigint, text)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marcar_factura_pendiente_resuelto(bigint, text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.asignar_recibo_pendiente(bigint, bigint, text)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.asignar_factura_pendiente(bigint, bigint, text)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.marcar_pendiente_resuelto(bigint, text)          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.marcar_factura_pendiente_resuelto(bigint, text)  TO authenticated;
