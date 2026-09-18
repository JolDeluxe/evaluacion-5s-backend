import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const snapshotPath = resolve(__dirname, 'data', 'formularios-5s-ultima-version.json');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

function escapeSql(str: string | null | undefined): string {
  if (str === null || str === undefined) return 'NULL';
  return "'" + str.replace(/'/g, "''") + "'";
}

let sql = `-- =============================================================================
-- 02_migrar-formularios-produccion.sql
-- MODO: MIGRACIÓN MANUAL TRANSACCIONAL E IDEMPOTENTE
-- Fuente canónica: scripts/data/formularios-5s-ultima-version.json
--
-- REGLAS ESTRICTAS DE SEGURIDAD:
-- 1. NO modifica ObjetivoAuditoria, EnvioAuditoria, RespuestaAuditoria ni FotoAuditoria.
-- 2. NO altera ni elimina versiones históricas existentes (V1, V2, etc.).
-- 3. NO desactiva ninguna versión existente (la activación es un paso posterior separado).
-- 4. No asume IDs de desarrollo; utiliza slug, claveEstable y numeroVersion.
-- 5. Es idempotente: solo inserta lo faltante y preserva claves estables.
-- =============================================================================

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- 0. Asignación de Usuario Autor en Producción
-- -----------------------------------------------------------------------------
SET @admin_id = (
    SELECT id FROM usuarios 
    WHERE activo = 1 AND rol IN ('SUPER_ADMIN', 'ADMINISTRADOR') 
    ORDER BY id ASC LIMIT 1
);

SELECT IF(@admin_id IS NULL, 
    'ADVERTENCIA: No se encontró usuario admin activo. Usando ID 1.', 
    CONCAT('Usuario autor asignado (ID): ', @admin_id)
) AS comprobacion_autor;

SET @admin_id = COALESCE(@admin_id, 1);
`;

for (const item of snapshot) {
  const f = item.formulario;
  const v = item.version;
  sql += `\n-- =============================================================================
-- FORMULARIO: ${f.nombre} (${f.slug}) -> VERSIÓN META ${v.numeroVersion}
-- =============================================================================

-- 1. Asegurar Formulario raíz
INSERT INTO formularios (nombre, slug, descripcion, alcance, activo, creadoPorId, creadoEn, actualizadoEn)
SELECT ${escapeSql(f.nombre)}, ${escapeSql(f.slug)}, ${escapeSql(f.descripcion)}, ${escapeSql(f.alcance)}, 1, @admin_id, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM formularios WHERE slug = ${escapeSql(f.slug)});

SET @form_id = (SELECT id FROM formularios WHERE slug = ${escapeSql(f.slug)});

-- 2. Asegurar Versión ${v.numeroVersion} (se inserta con activa = 0 para NO alterar operación actual)
INSERT INTO versiones_formulario (formularioId, numeroVersion, activa, creadoPorId, creadoEn, actualizadoEn)
SELECT @form_id, ${v.numeroVersion}, 0, @admin_id, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM versiones_formulario 
    WHERE formularioId = @form_id AND numeroVersion = ${v.numeroVersion}
);

SET @version_id = (
    SELECT id FROM versiones_formulario 
    WHERE formularioId = @form_id AND numeroVersion = ${v.numeroVersion}
);
`;

  for (const s of item.secciones) {
    sql += `\n-- Sección: ${s.nombre} (orden ${s.orden})
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, ${escapeSql(s.claveEstable)}, ${escapeSql(s.nombre)}, ${escapeSql(s.objetivo)}, ${s.orden}, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = ${escapeSql(s.claveEstable)}
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = ${escapeSql(s.claveEstable)}
);
`;
    for (const p of s.preguntas) {
      const reqVal = p.requiereHallazgo ? 1 : 0;
      sql += `INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, ${escapeSql(p.claveEstable)}, ${escapeSql(p.texto)}, ${p.orden}, ${reqVal}, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = ${escapeSql(p.claveEstable)}
);
`;
    }
  }
}

sql += `\n-- =============================================================================
-- RESUMEN DE COMPROBACIÓN POST-INSERCIÓN
-- =============================================================================
SELECT 
    f.slug,
    vf.numeroVersion,
    vf.id AS versionId,
    vf.activa,
    COUNT(DISTINCT sf.id) AS totalSecciones,
    COUNT(DISTINCT pf.id) AS totalPreguntas,
    CASE 
        WHEN f.slug = 'evaluacion-5s-administrativa' AND vf.numeroVersion = 3 AND COUNT(DISTINCT sf.id) = 7 AND COUNT(DISTINCT pf.id) = 23 THEN 'OK_MIGRADO'
        WHEN f.slug = 'evaluacion-5s-operativa' AND vf.numeroVersion = 4 AND COUNT(DISTINCT sf.id) = 7 AND COUNT(DISTINCT pf.id) = 34 THEN 'OK_MIGRADO'
        ELSE 'REVISAR_DISCREPANCIA'
    END AS estadoValidacion
FROM formularios f
JOIN versiones_formulario vf ON vf.formularioId = f.id
JOIN secciones_formulario sf ON sf.versionFormularioId = vf.id
JOIN preguntas_formulario pf ON pf.seccionFormularioId = sf.id
WHERE (f.slug = 'evaluacion-5s-administrativa' AND vf.numeroVersion = 3)
   OR (f.slug = 'evaluacion-5s-operativa' AND vf.numeroVersion = 4)
GROUP BY f.slug, vf.numeroVersion, vf.id, vf.activa;

-- Si los conteos son exactamente (Admin: 7/23) y (Oper: 7/34), confirmar los cambios:
COMMIT;
`;

const outputPath = resolve(__dirname, 'sql', '02_migrar-formularios-produccion.sql');
writeFileSync(outputPath, sql, 'utf-8');
console.log('Script SQL 02 generado exitosamente en:', outputPath);
