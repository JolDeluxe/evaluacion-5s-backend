-- =========================================================================================
-- SCRIPT SQL DEFINITIVO DE DIAGNÓSTICO, RESPALDO, SANEAMIENTO CONTROLADO Y ROLLBACK
-- =========================================================================================
-- Propósito:
--   Sincronizar objetivos de auditoría pendientes cuyo `version_formulario_id` o
--   `tipo_area_snapshot` quedó desfasado respecto a la clasificación vigente de `areas.tipo`.
--
-- ADVERTENCIA:
--   NO EJECUTAR AUTOMÁTICAMENTE EN PRODUCCIÓN SIN VENTANA DE MANTENIMIENTO AUTORIZADA.
--   Este script incluye:
--     1. Diagnóstico de solo lectura (objetivos candidatos, omitidos por protección e inconsistentes).
--     2. Validación estricta y por separado de unicidad de formularios y versiones activas.
--     3. Creación de tabla de respaldo única (no reutilizable) con bloqueo FOR UPDATE.
--     4. Actualización condicional que revalida elegibilidad y control de concurrencia (actualizado_en).
--     5. Verificación exacta entre filas respaldadas y filas actualizadas (ABORT si difiere).
--     6. Reporte post-actualización.
--     7. Procedimiento de ROLLBACK condicional que NO sobrescribe evaluaciones iniciadas o
--        completadas con posterioridad al saneamiento.
-- =========================================================================================

-- =========================================================================================
-- FASE 1: DIAGNÓSTICO INTEGRAL (100% SOLO LECTURA)
-- =========================================================================================

-- 1.1 Verificar unicidad de formularios activos y versiones activas por alcance
SELECT
  f.alcance,
  COUNT(DISTINCT f.id) AS total_formularios_activos,
  COUNT(DISTINCT vf.id) AS total_versiones_activas,
  MIN(f.id) AS formulario_activo_id,
  MIN(vf.id) AS version_activa_id,
  MIN(vf.numero_version) AS numero_version_activa
FROM formularios f
LEFT JOIN versiones_formulario vf
  ON vf.formulario_id = f.id
  AND vf.activa = 1
WHERE f.activo = 1
  AND f.alcance IN ('OPERATIVO', 'ADMINISTRATIVO')
GROUP BY f.alcance;

-- 1.2 Reporte clasificado de todos los objetivos con discrepancia respecto al tipo actual del área:
--     - ELEGIBLE_ACTUALIZAR: Pendiente limpio (sin envíos, sin cancelación, sin asignación iniciada/completada)
--     - OMITIDO_CANCELADO: Objetivo cancelado
--     - OMITIDO_CON_ENVIO_OFICIAL: Evaluación finalizada (histórico inmutable)
--     - OMITIDO_CON_ENVIO_HISTORICO: Tiene envíos registrados (incluidos invalidados)
--     - OMITIDO_ASIGNACION_INICIADA_O_COMPLETADA: Tiene asignación EN_PROCESO, COMPLETADA o con timestamps de inicio/fin
SELECT
  o.id AS objetivo_id,
  o.area_id,
  a.codigo AS codigo_area_vigente,
  a.nombre AS nombre_area_vigente,
  a.tipo AS tipo_area_vigente,
  o.anio,
  o.mes,
  o.periodo,
  o.tipo_area_snapshot AS tipo_snapshot_actual,
  o.version_formulario_id AS version_actual_id,
  f_actual.alcance AS alcance_formulario_actual,
  o.envio_resultado_id,
  o.cancelado_en,
  CASE
    WHEN o.cancelado_en IS NOT NULL THEN 'OMITIDO_CANCELADO'
    WHEN o.envio_resultado_id IS NOT NULL THEN 'OMITIDO_CON_ENVIO_OFICIAL'
    WHEN EXISTS (
      SELECT 1 FROM envios_auditoria ea WHERE ea.objetivo_auditoria_id = o.id
    ) THEN 'OMITIDO_CON_ENVIO_HISTORICO'
    WHEN EXISTS (
      SELECT 1
      FROM asignaciones_auditoria aa
      WHERE aa.objetivo_auditoria_id = o.id
        AND (
          aa.estado IN ('COMPLETADA', 'EN_PROCESO')
          OR aa.iniciado_en IS NOT NULL
          OR aa.completado_en IS NOT NULL
        )
    ) THEN 'OMITIDO_ASIGNACION_INICIADA_O_COMPLETADA'
    ELSE 'ELEGIBLE_ACTUALIZAR'
  END AS clasificacion_saneamiento
FROM objetivos_auditoria o
INNER JOIN areas a
  ON a.id = o.area_id
INNER JOIN versiones_formulario vf_actual
  ON vf_actual.id = o.version_formulario_id
INNER JOIN formularios f_actual
  ON f_actual.id = vf_actual.formulario_id
WHERE (
  o.tipo_area_snapshot <> a.tipo
  OR (a.tipo = 'OPERATIVA' AND f_actual.alcance <> 'OPERATIVO')
  OR (a.tipo = 'ADMINISTRATIVA' AND f_actual.alcance <> 'ADMINISTRATIVO')
)
ORDER BY a.codigo ASC, o.anio ASC, o.mes ASC, o.periodo ASC;

-- 1.3 Detección de posibles inconsistencias históricas (objetivos con envío cuyas respuestas
--     no coincidan con la versión sellada en el objetivo; debe devolver 0 filas)
SELECT
  o.id AS objetivo_id,
  o.area_id,
  o.anio,
  o.mes,
  o.periodo,
  o.version_formulario_id AS version_objetivo_id,
  sf.version_formulario_id AS version_respuesta_id,
  COUNT(ra.id) AS respuestas_desfasadas
FROM objetivos_auditoria o
INNER JOIN envios_auditoria ea
  ON ea.id = o.envio_resultado_id
INNER JOIN respuestas_auditoria ra
  ON ra.envio_auditoria_id = ea.id
INNER JOIN preguntas_formulario pf
  ON pf.id = ra.pregunta_formulario_id
INNER JOIN secciones_formulario sf
  ON sf.id = pf.seccion_formulario_id
WHERE sf.version_formulario_id <> o.version_formulario_id
GROUP BY o.id, o.area_id, o.anio, o.mes, o.periodo, o.version_formulario_id, sf.version_formulario_id;


-- =========================================================================================
-- FASE 2: RESPALDO ÚNICO Y ACTUALIZACIÓN TRANSACCIONAL CONTROLADA
-- =========================================================================================
-- Nota: Crear primero la tabla de respaldo sin IF NOT EXISTS para garantizar que NO se
-- reutilice ni contamine un respaldo anterior.

CREATE TABLE respaldo_saneamiento_objetivos_20261113 (
  objetivo_id INT NOT NULL PRIMARY KEY,
  area_id INT NOT NULL,
  anio INT NOT NULL,
  mes INT NOT NULL,
  periodo INT NOT NULL,
  old_version_formulario_id INT NOT NULL,
  old_tipo_area_snapshot VARCHAR(32) NOT NULL,
  old_codigo_area_snapshot VARCHAR(64) NOT NULL,
  old_nombre_area_snapshot VARCHAR(191) NOT NULL,
  old_actualizado_en DATETIME(3) NOT NULL,
  new_version_formulario_id INT NOT NULL,
  new_tipo_area_snapshot VARCHAR(32) NOT NULL,
  new_codigo_area_snapshot VARCHAR(64) NOT NULL,
  new_nombre_area_snapshot VARCHAR(191) NOT NULL,
  respaldado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS sp_ejecutar_saneamiento_formularios_20261113;
DELIMITER $$

CREATE PROCEDURE sp_ejecutar_saneamiento_formularios_20261113()
BEGIN
  DECLARE v_form_op_count INT DEFAULT 0;
  DECLARE v_form_adm_count INT DEFAULT 0;
  DECLARE v_ver_op_count INT DEFAULT 0;
  DECLARE v_ver_adm_count INT DEFAULT 0;
  DECLARE v_ver_op_id INT DEFAULT NULL;
  DECLARE v_ver_adm_id INT DEFAULT NULL;
  DECLARE v_respaldo_previo INT DEFAULT 0;
  DECLARE v_filas_respaldadas INT DEFAULT 0;
  DECLARE v_filas_actualizadas INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  START TRANSACTION;

  -- 1) Verificar que la tabla de respaldo esté vacía (no reutilizar corrida previa)
  SELECT COUNT(*) INTO v_respaldo_previo FROM respaldo_saneamiento_objetivos_20261113;
  IF v_respaldo_previo > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ABORTADO: La tabla de respaldo ya contiene registros de una ejecución previa.';
  END IF;

  -- 2) Validar por separado que exista exactamente 1 formulario activo por alcance
  SELECT COUNT(*) INTO v_form_op_count
  FROM formularios
  WHERE activo = 1 AND alcance = 'OPERATIVO'
  FOR UPDATE;

  SELECT COUNT(*) INTO v_form_adm_count
  FROM formularios
  WHERE activo = 1 AND alcance = 'ADMINISTRATIVO'
  FOR UPDATE;

  IF v_form_op_count <> 1 OR v_form_adm_count <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ABORTADO: Debe existir exactamente 1 formulario activo para OPERATIVO y 1 para ADMINISTRATIVO.';
  END IF;

  -- 3) Validar por separado que exista exactamente 1 versión activa para cada formulario activo
  SELECT COUNT(*), MIN(vf.id)
    INTO v_ver_op_count, v_ver_op_id
  FROM versiones_formulario vf
  INNER JOIN formularios f ON f.id = vf.formulario_id
  WHERE f.activo = 1 AND f.alcance = 'OPERATIVO' AND vf.activa = 1
  FOR UPDATE;

  SELECT COUNT(*), MIN(vf.id)
    INTO v_ver_adm_count, v_ver_adm_id
  FROM versiones_formulario vf
  INNER JOIN formularios f ON f.id = vf.formulario_id
  WHERE f.activo = 1 AND f.alcance = 'ADMINISTRATIVO' AND vf.activa = 1
  FOR UPDATE;

  IF v_ver_op_count <> 1 OR v_ver_adm_count <> 1 OR v_ver_op_id IS NULL OR v_ver_adm_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ABORTADO: Debe existir exactamente 1 versión activa para OPERATIVO y 1 para ADMINISTRATIVO.';
  END IF;

  -- 4) Bloquear y respaldar únicamente los objetivos elegibles que cambiarán
  INSERT INTO respaldo_saneamiento_objetivos_20261113 (
    objetivo_id,
    area_id,
    anio,
    mes,
    periodo,
    old_version_formulario_id,
    old_tipo_area_snapshot,
    old_codigo_area_snapshot,
    old_nombre_area_snapshot,
    old_actualizado_en,
    new_version_formulario_id,
    new_tipo_area_snapshot,
    new_codigo_area_snapshot,
    new_nombre_area_snapshot
  )
  SELECT
    o.id,
    o.area_id,
    o.anio,
    o.mes,
    o.periodo,
    o.version_formulario_id,
    o.tipo_area_snapshot,
    o.codigo_area_snapshot,
    o.nombre_area_snapshot,
    o.actualizado_en,
    CASE WHEN a.tipo = 'OPERATIVA' THEN v_ver_op_id ELSE v_ver_adm_id END,
    a.tipo,
    a.codigo,
    a.nombre
  FROM objetivos_auditoria o
  INNER JOIN areas a ON a.id = o.area_id
  WHERE o.cancelado_en IS NULL
    AND o.envio_resultado_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM envios_auditoria ea WHERE ea.objetivo_auditoria_id = o.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM asignaciones_auditoria aa
      WHERE aa.objetivo_auditoria_id = o.id
        AND (
          aa.estado IN ('COMPLETADA', 'EN_PROCESO')
          OR aa.iniciado_en IS NOT NULL
          OR aa.completado_en IS NOT NULL
        )
    )
    AND (
      o.version_formulario_id <> (CASE WHEN a.tipo = 'OPERATIVA' THEN v_ver_op_id ELSE v_ver_adm_id END)
      OR o.tipo_area_snapshot <> a.tipo
      OR o.codigo_area_snapshot <> a.codigo
      OR o.nombre_area_snapshot <> a.nombre
    )
  FOR UPDATE;

  SET v_filas_respaldadas = ROW_COUNT();

  -- 5) Actualizar revalidando todas las condiciones de elegibilidad y el timestamp old_actualizado_en
  UPDATE objetivos_auditoria o
  INNER JOIN respaldo_saneamiento_objetivos_20261113 b
    ON b.objetivo_id = o.id
  SET
    o.version_formulario_id = b.new_version_formulario_id,
    o.tipo_area_snapshot = b.new_tipo_area_snapshot,
    o.codigo_area_snapshot = b.new_codigo_area_snapshot,
    o.nombre_area_snapshot = b.new_nombre_area_snapshot,
    o.actualizado_en = CURRENT_TIMESTAMP(3)
  WHERE o.cancelado_en IS NULL
    AND o.envio_resultado_id IS NULL
    AND o.version_formulario_id = b.old_version_formulario_id
    AND o.tipo_area_snapshot = b.old_tipo_area_snapshot
    AND o.actualizado_en = b.old_actualizado_en
    AND NOT EXISTS (
      SELECT 1 FROM envios_auditoria ea WHERE ea.objetivo_auditoria_id = o.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM asignaciones_auditoria aa
      WHERE aa.objetivo_auditoria_id = o.id
        AND (
          aa.estado IN ('COMPLETADA', 'EN_PROCESO')
          OR aa.iniciado_en IS NOT NULL
          OR aa.completado_en IS NOT NULL
        )
    );

  SET v_filas_actualizadas = ROW_COUNT();

  -- 6) Comparación exacta entre filas respaldadas y filas actualizadas
  IF v_filas_actualizadas <> v_filas_respaldadas THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ABORTADO: El número de filas actualizadas no coincide exactamente con las filas respaldadas.';
  END IF;

  COMMIT;

  SELECT
    v_filas_respaldadas AS filas_respaldadas,
    v_filas_actualizadas AS filas_actualizadas,
    v_ver_op_id AS version_operativa_aplicada,
    v_ver_adm_id AS version_administrativa_aplicada;
END$$

DELIMITER ;

-- Para ejecutar en ventana autorizada:
-- CALL sp_ejecutar_saneamiento_formularios_20261113();


-- =========================================================================================
-- FASE 3: VERIFICACIÓN POST-EJECUCIÓN (DEMOSTRACIÓN DE FILAS CAMBIADAS E INTACTAS)
-- =========================================================================================
SELECT
  b.objetivo_id,
  b.area_id,
  b.anio,
  b.mes,
  b.periodo,
  b.old_tipo_area_snapshot,
  o.tipo_area_snapshot AS current_tipo_area_snapshot,
  b.old_version_formulario_id,
  o.version_formulario_id AS current_version_formulario_id,
  b.respaldado_en
FROM respaldo_saneamiento_objetivos_20261113 b
INNER JOIN objetivos_auditoria o ON o.id = b.objetivo_id
ORDER BY b.anio ASC, b.mes ASC, b.periodo ASC;


-- =========================================================================================
-- FASE 4: PROCEDIMIENTO DE ROLLBACK CONDICIONAL SEGURO
-- =========================================================================================
-- Restaura únicamente los objetivos que:
--   1. Fueron modificados por este lote (`respaldo_saneamiento_objetivos_20261113`),
--   2. Permanecen pendientes sin envíos ni cancelación posteriores, y
--   3. Conservan todavía los valores `new_*` aplicados por este saneamiento.
-- Nunca sobrescribe evaluaciones completadas, iniciadas o re-modificadas después del lote.

DROP PROCEDURE IF EXISTS sp_rollback_saneamiento_formularios_20261113;
DELIMITER $$

CREATE PROCEDURE sp_rollback_saneamiento_formularios_20261113()
BEGIN
  DECLARE v_total_respaldo INT DEFAULT 0;
  DECLARE v_revertidos INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  START TRANSACTION;

  SELECT COUNT(*) INTO v_total_respaldo FROM respaldo_saneamiento_objetivos_20261113;

  UPDATE objetivos_auditoria o
  INNER JOIN respaldo_saneamiento_objetivos_20261113 b
    ON b.objetivo_id = o.id
  SET
    o.version_formulario_id = b.old_version_formulario_id,
    o.tipo_area_snapshot = b.old_tipo_area_snapshot,
    o.codigo_area_snapshot = b.old_codigo_area_snapshot,
    o.nombre_area_snapshot = b.old_nombre_area_snapshot,
    o.actualizado_en = CURRENT_TIMESTAMP(3)
  WHERE o.cancelado_en IS NULL
    AND o.envio_resultado_id IS NULL
    AND o.version_formulario_id = b.new_version_formulario_id
    AND o.tipo_area_snapshot = b.new_tipo_area_snapshot
    AND o.codigo_area_snapshot = b.new_codigo_area_snapshot
    AND o.nombre_area_snapshot = b.new_nombre_area_snapshot
    AND NOT EXISTS (
      SELECT 1 FROM envios_auditoria ea WHERE ea.objetivo_auditoria_id = o.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM asignaciones_auditoria aa
      WHERE aa.objetivo_auditoria_id = o.id
        AND (
          aa.estado IN ('COMPLETADA', 'EN_PROCESO')
          OR aa.iniciado_en IS NOT NULL
          OR aa.completado_en IS NOT NULL
        )
    );

  SET v_revertidos = ROW_COUNT();

  COMMIT;

  -- Reporte de rollback: cuántos se revirtieron y cuáles se protegieron por cambios posteriores
  SELECT
    v_total_respaldo AS total_en_respaldo,
    v_revertidos AS total_revertidos,
    (v_total_respaldo - v_revertidos) AS omitidos_por_actividad_posterior;
END$$

DELIMITER ;
