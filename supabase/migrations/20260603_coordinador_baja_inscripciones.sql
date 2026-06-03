-- Migración: coordinador_baja_inscripciones
-- Fecha: 2026-06-03
--
-- Problema: la tabla `inscripciones` solo permitía UPDATE al ADMINISTRADOR,
-- por lo que el coordinador no podía dar de baja/alta a un estudiante en su
-- cohorte (la acción fallaba por RLS, además de llamar a una función GAS
-- inexistente desde el frontend).
--
-- Solución: política RLS que permite al COORDINADOR actualizar inscripciones
-- únicamente dentro de los programas que coordina (cohorte -> programa via
-- get_user_programas()). La edición de descuentos se restringe en la UI:
-- el coordinador solo consulta cuotas y descuentos, no los modifica.

CREATE POLICY "Inscripciones: coordinador actualiza sus programas"
ON public.inscripciones
FOR UPDATE
TO public
USING (
  ( SELECT get_user_rol() ) = 'COORDINADOR'::rol_usuario
  AND cohorte_id IN (
    SELECT c.cohorte_id FROM cohortes c
    WHERE c.programa_id IN ( SELECT get_user_programas() )
  )
)
WITH CHECK (
  ( SELECT get_user_rol() ) = 'COORDINADOR'::rol_usuario
  AND cohorte_id IN (
    SELECT c.cohorte_id FROM cohortes c
    WHERE c.programa_id IN ( SELECT get_user_programas() )
  )
);
