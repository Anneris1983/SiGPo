-- ════════════════════════════════════════════════════════════════
-- Consolidación de políticas RLS múltiples permisivas
-- Detectado por el performance advisor de Supabase (lint 0006).
--
-- Problema: cuando existen varias políticas FOR SELECT permisivas
-- sobre la misma tabla, PostgreSQL evalúa TODAS con OR. Eso impide
-- que el planner use índices en algunos casos.
--
-- Solución A (5 tablas): el patrón "FOR ALL admin + FOR SELECT true"
--   genera una política SELECT implícita desde el ALL y una explícita.
--   Se reemplaza FOR ALL por INSERT/UPDATE/DELETE separados.
--
-- Solución B (10 tablas): múltiples FOR SELECT explícitas se fusionan
--   en una sola con OR.
--
-- Aplicado en migraciones:
--   consolidate_rls_split_all_to_iud
--   consolidate_rls_cobros
--   consolidate_rls_egresos
--   consolidate_rls_estudiantes
--   consolidate_rls_facturas_historial
--   consolidate_rls_inscripciones
--   consolidate_rls_deudas_pagos
--   consolidate_rls_usuarios
-- ════════════════════════════════════════════════════════════════

-- ── MIGRACIÓN 1: consolidate_rls_split_all_to_iud ───────────────
-- Tablas: categorias_gastos, cohortes, configuracion,
--         coordinadores_programas, programas

DROP POLICY "CatGastos: admin/sec modifican" ON public.categorias_gastos;
CREATE POLICY "CatGastos: admin/sec insertan" ON public.categorias_gastos
  FOR INSERT WITH CHECK (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]));
CREATE POLICY "CatGastos: admin/sec actualizan" ON public.categorias_gastos
  FOR UPDATE USING (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]));
CREATE POLICY "CatGastos: admin/sec eliminan" ON public.categorias_gastos
  FOR DELETE USING (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]));

DROP POLICY "Cohortes: admin modifica" ON public.cohortes;
CREATE POLICY "Cohortes: admin inserta" ON public.cohortes
  FOR INSERT WITH CHECK (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]));
CREATE POLICY "Cohortes: admin actualiza" ON public.cohortes
  FOR UPDATE USING (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]));
CREATE POLICY "Cohortes: admin elimina" ON public.cohortes
  FOR DELETE USING (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]));

DROP POLICY "Config: admin modifica" ON public.configuracion;
CREATE POLICY "Config: admin inserta" ON public.configuracion
  FOR INSERT WITH CHECK (get_user_rol() = 'ADMINISTRADOR'::rol_usuario);
CREATE POLICY "Config: admin actualiza" ON public.configuracion
  FOR UPDATE USING (get_user_rol() = 'ADMINISTRADOR'::rol_usuario);
CREATE POLICY "Config: admin elimina" ON public.configuracion
  FOR DELETE USING (get_user_rol() = 'ADMINISTRADOR'::rol_usuario);

DROP POLICY "coordinadores_programas_manage" ON public.coordinadores_programas;
CREATE POLICY "coordinadores_programas_insert" ON public.coordinadores_programas
  FOR INSERT WITH CHECK (
    (SELECT usuarios.rol FROM usuarios WHERE usuarios.auth_user_id = (SELECT auth.uid())) = 'ADMINISTRADOR'::rol_usuario
  );
CREATE POLICY "coordinadores_programas_update" ON public.coordinadores_programas
  FOR UPDATE USING (
    (SELECT usuarios.rol FROM usuarios WHERE usuarios.auth_user_id = (SELECT auth.uid())) = 'ADMINISTRADOR'::rol_usuario
  );
CREATE POLICY "coordinadores_programas_delete" ON public.coordinadores_programas
  FOR DELETE USING (
    (SELECT usuarios.rol FROM usuarios WHERE usuarios.auth_user_id = (SELECT auth.uid())) = 'ADMINISTRADOR'::rol_usuario
  );

DROP POLICY "Programas: admin modifica" ON public.programas;
CREATE POLICY "Programas: admin inserta" ON public.programas
  FOR INSERT WITH CHECK (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]));
CREATE POLICY "Programas: admin actualiza" ON public.programas
  FOR UPDATE USING (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]));
CREATE POLICY "Programas: admin elimina" ON public.programas
  FOR DELETE USING (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]));

-- ── MIGRACIÓN 2: consolidate_rls_cobros ─────────────────────────
-- Fusiona 4 SELECT, 2 DELETE, 2 INSERT y 3 UPDATE en una por comando.

DROP POLICY "Cobros: admin/coop/sec ven todos" ON public.cobros;
DROP POLICY "Cobros: coordinador ve sus programas" ON public.cobros;
DROP POLICY "Cobros: estudiante ve solo sus cobros" ON public.cobros;
DROP POLICY "Cobros: profesor ve sus programas" ON public.cobros;
CREATE POLICY "Cobros: select" ON public.cobros
  FOR SELECT USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((( SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
    OR ((get_user_rol() = 'ESTUDIANTE'::rol_usuario) AND (dni = get_user_dni()))
    OR ((( SELECT get_user_rol()) = 'PROFESOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
  );

DROP POLICY "Cobros: admin/sec eliminan" ON public.cobros;
DROP POLICY "Cobros: coordinador elimina sus programas" ON public.cobros;
CREATE POLICY "Cobros: delete" ON public.cobros
  FOR DELETE USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]))
    OR ((( SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
  );

DROP POLICY "Cobros: admin/coop/sec insertan" ON public.cobros;
DROP POLICY "Cobros: coordinador inserta sus programas" ON public.cobros;
CREATE POLICY "Cobros: insert" ON public.cobros
  FOR INSERT WITH CHECK (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((( SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
  );

DROP POLICY "Cobros: admin/coop/sec actualizan" ON public.cobros;
DROP POLICY "Cobros: coordinador actualiza sus programas" ON public.cobros;
DROP POLICY "Cobros: estudiante sube comprobante" ON public.cobros;
CREATE POLICY "Cobros: update" ON public.cobros
  FOR UPDATE
  USING (
    (get_user_rol() = ANY (ARRAY['COOPERADORA'::rol_usuario,'ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]))
    OR ((( SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
    OR ((get_user_rol() = 'ESTUDIANTE'::rol_usuario) AND (dni = get_user_dni()))
  )
  WITH CHECK (
    (get_user_rol() = ANY (ARRAY['COOPERADORA'::rol_usuario,'ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]))
    OR ((( SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
    OR ((get_user_rol() = 'ESTUDIANTE'::rol_usuario) AND (dni = get_user_dni()))
  );

-- ── MIGRACIÓN 3: consolidate_rls_egresos ────────────────────────
-- 2 FOR ALL + 3 FOR SELECT → I/U/D separados + 1 SELECT consolidado.

DROP POLICY "Egresos: admin/coop modifican" ON public.egresos;
DROP POLICY "Egresos: coordinador gestiona sus programas" ON public.egresos;
DROP POLICY "Egresos: admin/coop/sec ven todos" ON public.egresos;
DROP POLICY "Egresos: coordinador ve sus programas" ON public.egresos;
DROP POLICY "Egresos: profesor ve sus programas" ON public.egresos;

CREATE POLICY "Egresos: select" ON public.egresos
  FOR SELECT USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((( SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
    OR ((( SELECT get_user_rol()) = 'PROFESOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
  );
CREATE POLICY "Egresos: insert" ON public.egresos
  FOR INSERT WITH CHECK (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((get_user_rol() = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
  );
CREATE POLICY "Egresos: update" ON public.egresos
  FOR UPDATE
  USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((get_user_rol() = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
  )
  WITH CHECK (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((get_user_rol() = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
  );
CREATE POLICY "Egresos: delete" ON public.egresos
  FOR DELETE USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((get_user_rol() = 'COORDINADOR'::rol_usuario) AND (programa_id IN ( SELECT get_user_programas())))
  );

-- ── MIGRACIÓN 4: consolidate_rls_estudiantes ────────────────────
-- 1 FOR ALL + 4 FOR SELECT + 1 FOR UPDATE → I/U/D + 1 SELECT.

DROP POLICY "Estudiantes: admin modifica" ON public.estudiantes;
DROP POLICY "Estudiantes: admin ve todos" ON public.estudiantes;
DROP POLICY "Estudiantes: coordinador ve sus programas" ON public.estudiantes;
DROP POLICY "Estudiantes: estudiante ve solo sus datos" ON public.estudiantes;
DROP POLICY "Estudiantes: profesor ve sus programas" ON public.estudiantes;
DROP POLICY "Estudiantes: estudiante actualiza sus datos de facturación" ON public.estudiantes;

CREATE POLICY "Estudiantes: select" ON public.estudiantes
  FOR SELECT USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((( SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario) AND (id IN ( SELECT get_programa_estudiante_ids())))
    OR ((get_user_rol() = 'ESTUDIANTE'::rol_usuario) AND (dni = get_user_dni()))
    OR ((( SELECT get_user_rol()) = 'PROFESOR'::rol_usuario) AND (id IN ( SELECT get_programa_estudiante_ids())))
  );
CREATE POLICY "Estudiantes: insert" ON public.estudiantes
  FOR INSERT WITH CHECK (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]));
CREATE POLICY "Estudiantes: update" ON public.estudiantes
  FOR UPDATE
  USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]))
    OR ((get_user_rol() = 'ESTUDIANTE'::rol_usuario) AND (dni = get_user_dni()))
  )
  WITH CHECK (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]))
    OR ((get_user_rol() = 'ESTUDIANTE'::rol_usuario) AND (dni = get_user_dni()))
  );
CREATE POLICY "Estudiantes: delete" ON public.estudiantes
  FOR DELETE USING (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario]));

-- ── MIGRACIÓN 5: consolidate_rls_facturas_historial ─────────────

DROP POLICY "facturas_estudiante_select" ON public.facturas;
DROP POLICY "facturas_staff_select" ON public.facturas;
CREATE POLICY "facturas_select" ON public.facturas
  FOR SELECT USING (
    (get_user_rol() = ANY (ARRAY['COOPERADORA'::rol_usuario,'SECRETARIA'::rol_usuario,'ADMINISTRADOR'::rol_usuario,'COORDINADOR'::rol_usuario]))
    OR ((get_user_rol() = 'ESTUDIANTE'::rol_usuario) AND ((estudiante_dni)::text = get_user_dni()))
  );

DROP POLICY "Hist cobros: admin/sec/coop ven todo" ON public.historial_cobros;
DROP POLICY "Hist cobros: coordinador ve sus programas" ON public.historial_cobros;
CREATE POLICY "Hist cobros: select" ON public.historial_cobros
  FOR SELECT USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((( SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario) AND (programa_id IN (
      SELECT cp.programa_id FROM coordinadores_programas cp
      JOIN usuarios u ON u.usuario_id = cp.coordinador_id
      WHERE u.auth_user_id = ( SELECT auth.uid())
    )))
  );

DROP POLICY "Historial: admin/sec/coop ven todo" ON public.historial_inscripciones;
DROP POLICY "Historial: coordinador ve sus programas" ON public.historial_inscripciones;
CREATE POLICY "Historial: select" ON public.historial_inscripciones
  FOR SELECT USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((( SELECT get_user_rol()) = 'COORDINADOR'::rol_usuario) AND (cohorte_id IN (
      SELECT c.cohorte_id FROM cohortes c
      JOIN coordinadores_programas cp ON cp.programa_id = c.programa_id
      JOIN usuarios u ON u.usuario_id = cp.coordinador_id
      WHERE u.auth_user_id = ( SELECT auth.uid())
    )))
  );

-- ── MIGRACIÓN 6: consolidate_rls_inscripciones ──────────────────
-- "autenticado lee todo = true" ya cubre coord/prof/estudiante.
-- Se eliminan las 3 SELECT redundantes y se separa el FOR ALL de admin.

DROP POLICY "Inscripciones: admin modifica" ON public.inscripciones;
DROP POLICY "Inscripciones: coordinador ve sus cohortes" ON public.inscripciones;
DROP POLICY "Inscripciones: estudiante ve la suya" ON public.inscripciones;
DROP POLICY "Inscripciones: profesor ve sus cohortes" ON public.inscripciones;
-- "Inscripciones: autenticado lee todo" (SELECT true) se conserva.

CREATE POLICY "Inscripciones: admin inserta" ON public.inscripciones
  FOR INSERT WITH CHECK (( SELECT get_user_rol()) = 'ADMINISTRADOR'::rol_usuario);
CREATE POLICY "Inscripciones: admin actualiza" ON public.inscripciones
  FOR UPDATE
  USING (( SELECT get_user_rol()) = 'ADMINISTRADOR'::rol_usuario)
  WITH CHECK (( SELECT get_user_rol()) = 'ADMINISTRADOR'::rol_usuario);
CREATE POLICY "Inscripciones: admin elimina" ON public.inscripciones
  FOR DELETE USING (( SELECT get_user_rol()) = 'ADMINISTRADOR'::rol_usuario);

-- ── MIGRACIÓN 7: consolidate_rls_deudas_pagos ───────────────────

DROP POLICY "libre_deudas: estudiante ve los suyos" ON public.libre_deudas;
DROP POLICY "libre_deudas: staff ve todos" ON public.libre_deudas;
CREATE POLICY "libre_deudas: select" ON public.libre_deudas
  FOR SELECT USING (
    (auth_user_id = ( SELECT auth.uid()))
    OR (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]))
  );

DROP POLICY "Pagos: admin/coop ven todos" ON public.pagos;
DROP POLICY "Pagos: estudiante ve sus pagos" ON public.pagos;
CREATE POLICY "Pagos: select" ON public.pagos
  FOR SELECT USING (
    (get_user_rol() = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]))
    OR ((get_user_rol() = 'ESTUDIANTE'::rol_usuario) AND (cobro_id IN (
      SELECT cobros.cobro_id FROM cobros WHERE cobros.dni = get_user_dni()
    )))
  );

-- ── MIGRACIÓN 8: consolidate_rls_usuarios ───────────────────────
-- Separa el FOR ALL de admin; restringe SELECT a authenticated
-- para no solapar con la política anon separada.

DROP POLICY "Usuarios: admin modifica" ON public.usuarios;
DROP POLICY "Usuarios: select" ON public.usuarios;

CREATE POLICY "Usuarios: select autenticado" ON public.usuarios
  FOR SELECT TO authenticated USING (
    (auth_user_id = ( SELECT auth.uid()))
    OR (( SELECT get_user_rol()) = ANY (ARRAY['ADMINISTRADOR'::rol_usuario,'SECRETARIA'::rol_usuario,'COOPERADORA'::rol_usuario]))
  );
CREATE POLICY "Usuarios: admin inserta" ON public.usuarios
  FOR INSERT WITH CHECK (get_user_rol() = 'ADMINISTRADOR'::rol_usuario);
CREATE POLICY "Usuarios: admin actualiza" ON public.usuarios
  FOR UPDATE
  USING (get_user_rol() = 'ADMINISTRADOR'::rol_usuario)
  WITH CHECK (get_user_rol() = 'ADMINISTRADOR'::rol_usuario);
CREATE POLICY "Usuarios: admin elimina" ON public.usuarios
  FOR DELETE USING (get_user_rol() = 'ADMINISTRADOR'::rol_usuario);

-- ════════════════════════════════════════════════════════════════
-- NOTAS:
-- · La semántica efectiva NO cambia en ningún caso:
--   - FOR ALL con qual Q ya evaluaba SELECT/INSERT/UPDATE/DELETE con Q.
--   - Combinar varias SELECT con OR mantiene el mismo conjunto visible.
--   - "autenticado lee todo=true" en inscripciones ya cubría coord/prof.
-- · El advisor seguirá mostrando 0006 hasta que se refresque el cache.
-- · libre_deudas: el estudiante ve sus propios registros via auth_user_id
--   (no via get_user_rol), compatible con la nueva política unificada.
-- ════════════════════════════════════════════════════════════════
