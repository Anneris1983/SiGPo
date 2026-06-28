-- delete_auth_user borraba auth.users SIN control de rol y era ejecutable por
-- anon. Solo la usa administrador_11_usuarios.html. Se agrega guard de rol
-- (ADMINISTRADOR) y se revoca anon. Patron: db_harden_security_definer.sql.
CREATE OR REPLACE FUNCTION public.delete_auth_user(p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_auth_user_id uuid;
BEGIN
  IF COALESCE(get_user_rol()::text, '') <> 'ADMINISTRADOR' THEN
    RAISE EXCEPTION 'Acceso denegado: se requiere rol ADMINISTRADOR';
  END IF;

  SELECT auth_user_id INTO v_auth_user_id
  FROM public.usuarios
  WHERE usuario_id = p_usuario_id
  LIMIT 1;

  IF v_auth_user_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_auth_user_id;
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.delete_auth_user(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_auth_user(uuid) TO authenticated;
