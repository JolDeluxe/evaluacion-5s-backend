-- =============================================================================
-- 01_diagnostico-formularios-produccion.sql
-- MODO: SOLO LECTURA (READ ONLY)
-- Propósito: Auditar el estado actual de los formularios, versiones,
-- secciones, preguntas y objetivos en la BD de PRODUCCIÓN antes de migrar.
-- =============================================================================

-- 1. FORMULARIOS EXISTENTES
SELECT 
    id,
    slug,
    nombre,
    alcance,
    activo,
    creadoPorId,
    creadoEn,
    actualizadoEn
FROM formularios
WHERE slug IN ('evaluacion-5s-administrativa', 'evaluacion-5s-operativa')
ORDER BY id ASC;

-- 2. RESUMEN DE VERSIONES EXISTENTES Y CONTEOS DE ESTRUCTURA Y OPERACIÓN
SELECT 
    f.id AS formularioId,
    f.slug,
    f.nombre AS formularioNombre,
    vf.id AS versionId,
    vf.numeroVersion,
    vf.activa AS versionActiva,
    vf.creadoEn AS versionCreadoEn,
    COUNT(DISTINCT sf.id) AS totalSecciones,
    COUNT(DISTINCT pf.id) AS totalPreguntas,
    COUNT(DISTINCT oa.id) AS totalObjetivosAuditoria,
    COUNT(DISTINCT ra.id) AS totalRespuestasAuditoria
FROM formularios f
JOIN versiones_formulario vf ON vf.formularioId = f.id
LEFT JOIN secciones_formulario sf ON sf.versionFormularioId = vf.id
LEFT JOIN preguntas_formulario pf ON pf.seccionFormularioId = sf.id
LEFT JOIN objetivos_auditoria oa ON oa.versionFormularioId = vf.id
LEFT JOIN respuestas_auditoria ra ON ra.preguntaFormularioId = pf.id
WHERE f.slug IN ('evaluacion-5s-administrativa', 'evaluacion-5s-operativa')
GROUP BY f.id, f.slug, f.nombre, vf.id, vf.numeroVersion, vf.activa, vf.creadoEn
ORDER BY f.slug ASC, vf.numeroVersion ASC;

-- 3. DETALLE DE OBJETIVOS POR VERSIÓN (Rango de años y meses cubiertos)
SELECT 
    f.slug,
    vf.numeroVersion,
    vf.activa AS versionActiva,
    oa.anio,
    MIN(oa.mes) AS mesMinimo,
    MAX(oa.mes) AS mesMaximo,
    COUNT(oa.id) AS totalObjetivosEnRango
FROM objetivos_auditoria oa
JOIN versiones_formulario vf ON oa.versionFormularioId = vf.id
JOIN formularios f ON vf.formularioId = f.id
WHERE f.slug IN ('evaluacion-5s-administrativa', 'evaluacion-5s-operativa')
GROUP BY f.slug, vf.numeroVersion, vf.activa, oa.anio
ORDER BY f.slug ASC, oa.anio ASC, vf.numeroVersion ASC;

-- 4. DETALLE DE SECCIONES EN VERSIONES EXISTENTES
SELECT 
    f.slug,
    vf.numeroVersion,
    sf.id AS seccionId,
    sf.claveEstable AS seccionClaveEstable,
    sf.nombre AS seccionNombre,
    sf.orden AS seccionOrden,
    LEFT(sf.objetivo, 50) AS seccionObjetivoPreview,
    COUNT(pf.id) AS preguntasEnSeccion
FROM formularios f
JOIN versiones_formulario vf ON vf.formularioId = f.id
JOIN secciones_formulario sf ON sf.versionFormularioId = vf.id
LEFT JOIN preguntas_formulario pf ON pf.seccionFormularioId = sf.id
WHERE f.slug IN ('evaluacion-5s-administrativa', 'evaluacion-5s-operativa')
GROUP BY f.slug, vf.numeroVersion, sf.id, sf.claveEstable, sf.nombre, sf.orden, sf.objetivo
ORDER BY f.slug ASC, vf.numeroVersion ASC, sf.orden ASC;

-- 5. DIAGNÓSTICO ESPECÍFICO DE VERSIONES OBJETIVO:
-- ¿Existen ya V3 en Administrativa y V4 en Operativa?
SELECT 
    f.slug,
    vf.numeroVersion,
    vf.id AS versionId,
    vf.activa,
    COUNT(DISTINCT sf.id) AS totalSecciones,
    COUNT(DISTINCT pf.id) AS totalPreguntas,
    CASE 
        WHEN f.slug = 'evaluacion-5s-administrativa' AND vf.numeroVersion = 3 THEN 'OBJETIVO_V3_ADMIN'
        WHEN f.slug = 'evaluacion-5s-operativa' AND vf.numeroVersion = 4 THEN 'OBJETIVO_V4_OPER'
        ELSE 'VERSION_EXISTENTE_OTRA'
    END AS tipoVersion
FROM formularios f
JOIN versiones_formulario vf ON vf.formularioId = f.id
LEFT JOIN secciones_formulario sf ON sf.versionFormularioId = vf.id
LEFT JOIN preguntas_formulario pf ON pf.seccionFormularioId = sf.id
WHERE (f.slug = 'evaluacion-5s-administrativa' AND vf.numeroVersion = 3)
   OR (f.slug = 'evaluacion-5s-operativa' AND vf.numeroVersion = 4)
GROUP BY f.slug, vf.numeroVersion, vf.id, vf.activa;

-- 6. VERIFICACIÓN DE PREGUNTAS DE CULTURA (requiereHallazgo) EN TODAS LAS VERSIONES EXISTENTES
SELECT 
    f.slug,
    vf.numeroVersion,
    sf.nombre AS seccionNombre,
    pf.id AS preguntaId,
    pf.claveEstable,
    pf.orden,
    pf.requiereHallazgo,
    pf.texto
FROM preguntas_formulario pf
JOIN secciones_formulario sf ON pf.seccionFormularioId = sf.id
JOIN versiones_formulario vf ON sf.versionFormularioId = vf.id
JOIN formularios f ON vf.formularioId = f.id
WHERE UPPER(sf.nombre) = 'CULTURA'
ORDER BY f.slug ASC, vf.numeroVersion ASC, pf.orden ASC;
