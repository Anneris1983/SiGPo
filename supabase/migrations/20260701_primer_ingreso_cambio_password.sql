-- Cambio de clave obligatorio en el PRIMER ingreso (pedido de Anneris 2026-07).
-- La columna nace con DEFAULT true => toda cuenta NUEVA (edge function
-- crear-usuario o insert directo) queda marcada sin tocar los flujos de alta.
ALTER TABLE public.usuarios ADD COLUMN debe_cambiar_password boolean NOT NULL DEFAULT true;

-- Los usuarios EXISTENTES quedan exentos: solo aplica de ahora en mas.
UPDATE public.usuarios SET debe_cambiar_password = false;

-- RPC para apagar la marca cuando el usuario define su clave propia.
-- SECURITY DEFINER acotada al propio usuario (auth.uid()); sin acceso anon.
CREATE OR REPLACE FUNCTION public.marcar_password_cambiada()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $func$
  UPDATE usuarios SET debe_cambiar_password = false
  WHERE auth.uid() IS NOT NULL AND auth_user_id = auth.uid();
$func$;
REVOKE EXECUTE ON FUNCTION public.marcar_password_cambiada() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marcar_password_cambiada() TO authenticated;
