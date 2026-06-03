-- ════════════════════════════════════════════════════════════════════
-- PROPUESTAS DE PERFORMANCE — Base de datos SiGPo (proyecto fdevypdowdhqaxvfiywt)
-- Generado a partir de los Supabase Performance Advisors.
--
-- ⚠️  ESTE ARCHIVO NO SE APLICA AUTOMÁTICAMENTE.
--     Revisar y ejecutar manualmente (idealmente primero en una rama de
--     desarrollo de Supabase). Cada bloque es independiente.
--
-- Contexto de escala actual: pocas filas (368 cobros, 45 estudiantes).
-- El impacto real de estas mejoras crece a medida que crecen los datos.
-- ════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────
-- BLOQUE 1 — Índices faltantes en claves foráneas  (7 advisors)
-- ────────────────────────────────────────────────────────────────────
-- Sin un índice que cubra la columna FK, los JOIN sobre esa FK y los
-- DELETE/UPDATE en cascada hacen scans completos. Bajo riesgo, alto valor.
--
-- En producción, preferir la variante CONCURRENTLY (no bloquea escrituras)
-- ejecutada FUERA de una transacción:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_... ON ...;

CREATE INDEX IF NOT EXISTS idx_coord_prog_cohorte
    ON public.coordinadores_programas (cohorte_id);

CREATE INDEX IF NOT EXISTS idx_egresos_padre
    ON public.egresos (egreso_padre_id);

CREATE INDEX IF NOT EXISTS idx_estudiantes_auth_user
    ON public.estudiantes (auth_user_id);

CREATE INDEX IF NOT EXISTS idx_hist_cob_registrado_por
    ON public.historial_cobros (registrado_por);

CREATE INDEX IF NOT EXISTS idx_hist_insc_registrado_por
    ON public.historial_inscripciones (registrado_por);

CREATE INDEX IF NOT EXISTS idx_libre_deudas_auth_user
    ON public.libre_deudas (auth_user_id);

CREATE INDEX IF NOT EXISTS idx_usuarios_programa
    ON public.usuarios (programa_id);


-- ────────────────────────────────────────────────────────────────────
-- BLOQUE 2 — RLS: auth_rls_initplan  (6 advisors)
-- ────────────────────────────────────────────────────────────────────
-- Las políticas re-evalúan auth.uid() / get_user_rol() UNA VEZ POR FILA.
-- Envolviéndolas en un subselect, Postgres las evalúa UNA VEZ por consulta.
-- Mismo resultado lógico, mucho más barato al escalar.
-- Se recrea cada política idéntica salvo el wrapping en (SELECT ...).

-- coordinadores_programas_manage  (ALL)
ALTER POLICY "coordinadores_programas_manage"
    ON public.coordinadores_programas
    USING (
        (SELECT usuarios.rol FROM usuarios
          WHERE usuarios.auth_user_id = (SELECT auth.uid())) = 'ADMINISTRADOR'::rol_usuario
    )
    WITH CHECK (
        (SELECT usuarios.rol FROM usuarios
          WHERE usuarios.auth_user_id = (SELECT auth.uid())) = 'ADMINISTRADOR'::rol_usuario
    );

-- historial_cobros: "Hist cobros: coordinador ve sus programas"  (SELECT)
ALTER POLICY "Hist cobros: coordinador ve sus programas"
    ON public.historial_cobros
    USING (
        ((SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario)
        AND (programa_id IN (
            SELECT cp.programa_id
              FROM coordinadores_programas cp
              JOIN usuarios u ON u.usuario_id = cp.coordinador_id
             WHERE u.auth_user_id = (SELECT auth.uid())
        ))
    );

-- historial_inscripciones: "Historial: coordinador ve sus programas"  (SELECT)
ALTER POLICY "Historial: coordinador ve sus programas"
    ON public.historial_inscripciones
    USING (
        ((SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario)
        AND (cohorte_id IN (
            SELECT c.cohorte_id
              FROM cohortes c
              JOIN coordinadores_programas cp ON cp.programa_id = c.programa_id
              JOIN usuarios u ON u.usuario_id = cp.coordinador_id
             WHERE u.auth_user_id = (SELECT auth.uid())
        ))
    );

-- usuarios: "Usuarios: select"  (SELECT)
ALTER POLICY "Usuarios: select"
    ON public.usuarios
    USING (
        (auth_user_id = (SELECT auth.uid()))
        OR ((SELECT get_user_rol()) = ANY (ARRAY[
            'ADMINISTRADOR'::rol_usuario,
            'SECRETARIA'::rol_usuario,
            'COOPERADORA'::rol_usuario
        ]))
    );

-- libre_deudas: "libre_deudas: estudiante ve los suyos"  (SELECT)
ALTER POLICY "libre_deudas: estudiante ve los suyos"
    ON public.libre_deudas
    USING (auth_user_id = (SELECT auth.uid()));

-- libre_deudas: "libre_deudas: estudiante inserta el suyo"  (INSERT)
ALTER POLICY "libre_deudas: estudiante inserta el suyo"
    ON public.libre_deudas
    WITH CHECK (auth_user_id = (SELECT auth.uid()));


-- ────────────────────────────────────────────────────────────────────
-- BLOQUE 3 — Índices sin uso  (12 advisors)  ⚠️ REVISAR ANTES DE EJECUTAR
-- ────────────────────────────────────────────────────────────────────
-- "Sin uso" es relativo al tráfico observado HASTA AHORA. Varios podrían
-- servir a funciones todavía poco ejercitadas (reportes, filtros por
-- estado). NO eliminar a ciegas: confirmar con pg_stat_user_indexes en
-- producción tras un período representativo. Dejados COMENTADOS a propósito.
--
-- DROP INDEX IF EXISTS public.idx_usuarios_estado;
-- DROP INDEX IF EXISTS public.idx_notif_leida;
-- DROP INDEX IF EXISTS public.idx_hist_insc_estado;
-- DROP INDEX IF EXISTS public.idx_inscripciones_cohorte;
-- DROP INDEX IF EXISTS public.idx_libre_deudas_cohorte;
-- DROP INDEX IF EXISTS public.idx_hist_cob_dni;
-- DROP INDEX IF EXISTS public.idx_hist_cob_estado;
-- DROP INDEX IF EXISTS public.idx_libre_deudas_dni;
-- DROP INDEX IF EXISTS public.idx_facturas_estudiante_dni;
-- DROP INDEX IF EXISTS public.idx_cohortes_programa;
-- DROP INDEX IF EXISTS public.idx_inscripciones_estado;
-- DROP INDEX IF EXISTS public.idx_pagos_fecha;


-- ────────────────────────────────────────────────────────────────────
-- BLOQUE 4 — Consolidación de políticas permisivas múltiples (82 advisors)
-- ────────────────────────────────────────────────────────────────────
-- NO incluido aquí: requiere reescribir con OR las políticas SELECT
-- solapadas por rol en cobros, estudiantes, egresos, inscripciones,
-- preservando exactamente la semántica de acceso de los 6 roles.
-- Es la categoría de mayor cantidad pero la más delicada — se aborda
-- en una propuesta separada y revisada caso por caso.
