-- Migración: revertir_coordinador_baja_inscripciones
-- Fecha: 2026-06-03
--
-- Revierte la migración 20260603_coordinador_baja_inscripciones.sql.
-- A pedido del usuario, el coordinador NO debe poder dar de baja/alta a un
-- estudiante en la cohorte. Se elimina la política de UPDATE para el rol
-- COORDINADOR y la tabla `inscripciones` vuelve a quedar en solo-lectura
-- para ese rol (UPDATE permitido únicamente al ADMINISTRADOR).

DROP POLICY IF EXISTS "Inscripciones: coordinador actualiza sus programas" ON public.inscripciones;
