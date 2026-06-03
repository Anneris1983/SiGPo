-- Migración: sincronizar_email_usuarios_estudiantes
-- Fecha: 2026-06-03
--
-- Problema: las tablas `usuarios` (cuentas/roles) y `estudiantes` (ficha académica)
-- almacenan el email de forma independiente. Si el email cambia en una tabla,
-- la otra queda desactualizada y el GAS manda correos al email viejo.
--
-- Solución: dos triggers AFTER UPDATE OF email que sincronizan el email
-- entre las dos tablas usando el DNI como vínculo. La guarda
-- "email IS DISTINCT FROM" evita recursión infinita entre los dos triggers.

-- usuarios -> estudiantes
CREATE OR REPLACE FUNCTION sync_email_usuarios_a_estudiantes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE estudiantes
    SET email = NEW.email
    WHERE dni = NEW.dni
      AND email IS DISTINCT FROM NEW.email;
  END IF;
  RETURN NEW;
END;
$$;

-- estudiantes -> usuarios
CREATE OR REPLACE FUNCTION sync_email_estudiantes_a_usuarios()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE usuarios
    SET email = NEW.email
    WHERE dni = NEW.dni
      AND email IS DISTINCT FROM NEW.email;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_email_usuarios ON usuarios;
CREATE TRIGGER trg_sync_email_usuarios
AFTER UPDATE OF email ON usuarios
FOR EACH ROW
EXECUTE FUNCTION sync_email_usuarios_a_estudiantes();

DROP TRIGGER IF EXISTS trg_sync_email_estudiantes ON estudiantes;
CREATE TRIGGER trg_sync_email_estudiantes
AFTER UPDATE OF email ON estudiantes
FOR EACH ROW
EXECUTE FUNCTION sync_email_estudiantes_a_usuarios();
