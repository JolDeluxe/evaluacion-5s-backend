import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const snapshotPath = resolve(__dirname, 'data', 'formularios-5s-ultima-version.json');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

function escapeSql(str: string | null | undefined): string {
  if (str === null || str === undefined) return 'NULL';
  return "'" + str.replace(/'/g, "''") + "'";
}

let sql = `-- =============================================================================
-- 03_validar-formularios-produccion.sql
-- MODO: SOLO LECTURA (READ ONLY)
-- Propósito: Verificar con precisión milimétrica la correcta migración de las
-- versiones objetivo (Admin V3 y Oper V4) en la BD de PRODUCCIÓN.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RESUMEN EJECUTIVO DE CONTEOS
-- Esperado:
-- evaluacion-5s-administrativa | Version 3 | 7 secciones | 23 preguntas
-- evaluacion-5s-operativa      | Version 4 | 7 secciones | 34 preguntas
-- -----------------------------------------------------------------------------
SELECT 
    f.slug,
    vf.numeroVersion,
    vf.activa AS versionActiva,
    COUNT(DISTINCT sf.id) AS totalSecciones,
    COUNT(DISTINCT pf.id) AS totalPreguntas,
    CASE 
        WHEN f.slug = 'evaluacion-5s-administrativa' AND vf.numeroVersion = 3 
             AND COUNT(DISTINCT sf.id) = 7 AND COUNT(DISTINCT pf.id) = 23 THEN 'MATCH'
        WHEN f.slug = 'evaluacion-5s-operativa' AND vf.numeroVersion = 4 
             AND COUNT(DISTINCT sf.id) = 7 AND COUNT(DISTINCT pf.id) = 34 THEN 'MATCH'
        ELSE 'MISMATCH / CONFLICT'
    END AS estadoConteo
FROM formularios f
JOIN versiones_formulario vf ON vf.formularioId = f.id
LEFT JOIN secciones_formulario sf ON sf.versionFormularioId = vf.id
LEFT JOIN preguntas_formulario pf ON pf.seccionFormularioId = sf.id
WHERE (f.slug = 'evaluacion-5s-administrativa' AND vf.numeroVersion = 3)
   OR (f.slug = 'evaluacion-5s-operativa' AND vf.numeroVersion = 4)
GROUP BY f.slug, vf.numeroVersion, vf.activa;

-- -----------------------------------------------------------------------------
-- 2. VALIDACIÓN DE REGLA DE NEGOCIO: PREGUNTAS DE CULTURA (requiereHallazgo = false)
-- Esperado: Exactamente 3 preguntas en Administrativa V3 y 3 en Operativa V4 con requiereHallazgo = 0.
-- -----------------------------------------------------------------------------
SELECT 
    f.slug,
    vf.numeroVersion,
    sf.nombre AS seccionNombre,
    pf.claveEstable,
    pf.orden,
    pf.requiereHallazgo,
    CASE WHEN pf.requiereHallazgo = 0 THEN 'CORRECTO (false)' ELSE 'ERROR: DEBE SER false' END AS validacionHallazgo,
    pf.texto
FROM preguntas_formulario pf
JOIN secciones_formulario sf ON pf.seccionFormularioId = sf.id
JOIN versiones_formulario vf ON sf.versionFormularioId = vf.id
JOIN formularios f ON vf.formularioId = f.id
WHERE UPPER(sf.nombre) = 'CULTURA'
  AND ((f.slug = 'evaluacion-5s-administrativa' AND vf.numeroVersion = 3)
    OR (f.slug = 'evaluacion-5s-operativa' AND vf.numeroVersion = 4))
ORDER BY f.slug ASC, pf.orden ASC;

-- -----------------------------------------------------------------------------
-- 3. AUDITORÍA DE INALTERABILIDAD DE DATOS HISTÓRICOS Y OPERATIVOS
-- Verifica que las versiones históricas (ej. V1) sigan intactas con sus objetivos y respuestas.
-- -----------------------------------------------------------------------------
SELECT 
    f.slug,
    vf.numeroVersion,
    vf.activa,
    COUNT(DISTINCT oa.id) AS objetivosAsociados,
    COUNT(DISTINCT ra.id) AS respuestasAsociadas
FROM formularios f
JOIN versiones_formulario vf ON vf.formularioId = f.id
LEFT JOIN objetivos_auditoria oa ON oa.versionFormularioId = vf.id
LEFT JOIN secciones_formulario sf ON sf.versionFormularioId = vf.id
LEFT JOIN preguntas_formulario pf ON pf.seccionFormularioId = sf.id
LEFT JOIN respuestas_auditoria ra ON ra.preguntaFormularioId = pf.id
WHERE f.slug IN ('evaluacion-5s-administrativa', 'evaluacion-5s-operativa')
GROUP BY f.slug, vf.numeroVersion, vf.activa
ORDER BY f.slug ASC, vf.numeroVersion ASC;

-- -----------------------------------------------------------------------------
-- 4. VERIFICACIÓN DETALLADA DE CLAVES ESTABLES FALTANTES CONTRA EL SNAPSHOT
-- Devuelve 0 filas si todas las claves estables esperadas existen en producción.
-- -----------------------------------------------------------------------------
`;

// Generamos consultas UNION para comparar claves estables
const clavesEsperadasPregs: string[] = [];
for (const item of snapshot) {
  for (const s of item.secciones) {
    for (const p of s.preguntas) {
      clavesEsperadasPregs.push(
        `SELECT '${item.formulario.slug}' AS slug, ${item.version.numeroVersion} AS numVer, '${s.claveEstable}' AS secClave, '${p.claveEstable}' AS pregClave`
      );
    }
  }
}

sql += `WITH snapshot_preguntas AS (
    ${clavesEsperadasPregs.join('\n    UNION ALL\n    ')}
)
SELECT 
    sp.slug,
    sp.numVer,
    sp.pregClave,
    CASE 
        WHEN pf.id IS NULL THEN 'MISSING'
        ELSE 'MATCH'
    END AS estadoClaveEstable
FROM snapshot_preguntas sp
LEFT JOIN formularios f ON f.slug = sp.slug
LEFT JOIN versiones_formulario vf ON vf.formularioId = f.id AND vf.numeroVersion = sp.numVer
LEFT JOIN secciones_formulario sf ON sf.versionFormularioId = vf.id AND sf.claveEstable = sp.secClave
LEFT JOIN preguntas_formulario pf ON pf.seccionFormularioId = sf.id AND pf.claveEstable = sp.pregClave
WHERE pf.id IS NULL;
-- NOTA: Si la consulta anterior devuelve 0 filas, significa que NO HAY CLAVES FALTANTES (100% MATCH).
`;

const outputPath = resolve(__dirname, 'sql', '03_validar-formularios-produccion.sql');
writeFileSync(outputPath, sql, 'utf-8');
console.log('Script SQL 03 generado exitosamente en:', outputPath);
