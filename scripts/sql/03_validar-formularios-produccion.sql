-- =============================================================================
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
WITH snapshot_preguntas AS (
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '63b0d326-9cff-578e-b2b7-e29fb3e739d6' AS secClave, '1b1f1188-850f-511e-8723-84c3addc0481' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '63b0d326-9cff-578e-b2b7-e29fb3e739d6' AS secClave, '15bf22a9-1da1-5010-be5b-25aefe7810ab' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '63b0d326-9cff-578e-b2b7-e29fb3e739d6' AS secClave, '214ff673-9e8c-520c-9904-a995b7199c4e' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '63b0d326-9cff-578e-b2b7-e29fb3e739d6' AS secClave, '81f6f17b-939a-5e16-90e5-b3a791a4e313' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '425480dc-9ac9-5f75-97bb-f33599d5605f' AS secClave, 'ea66f727-5a0c-5fda-bc7c-03b121f23523' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '425480dc-9ac9-5f75-97bb-f33599d5605f' AS secClave, '127d1318-d2da-5dc3-88d7-e716bdfbaf81' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '425480dc-9ac9-5f75-97bb-f33599d5605f' AS secClave, '8d1014cd-7f26-53d5-b8a8-0168de365fe0' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '425480dc-9ac9-5f75-97bb-f33599d5605f' AS secClave, 'eac9ec97-b77f-58d5-8e53-b046b63e15cb' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '0a37e142-b495-51c2-860a-450fd9820091' AS secClave, '2ea3dce9-84f7-529f-8cb0-3add0f85d3e0' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '0a37e142-b495-51c2-860a-450fd9820091' AS secClave, 'c8c05543-80a7-5002-83e3-06d25f786635' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '0a37e142-b495-51c2-860a-450fd9820091' AS secClave, 'f49352c9-cb9b-53ea-8fca-f4b85886a903' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '36a014fe-589a-536a-9690-df77bc9f4848' AS secClave, 'd1c43b33-04c1-58b0-b917-f60d783b605c' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, 'de4484ad-9480-5374-ad2c-390fd2d9aa00' AS secClave, 'db5acd61-4fe3-5472-ad71-0180ac987890' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, 'de4484ad-9480-5374-ad2c-390fd2d9aa00' AS secClave, '45a3e506-14d6-5b7c-8b47-7e21ab8a740b' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '1c7736fc-95d2-5589-a526-519e72646865' AS secClave, '495b4c49-9afe-55f9-8444-3a9bae6d0a55' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '1c7736fc-95d2-5589-a526-519e72646865' AS secClave, '000d2c36-2a3f-5d4d-bf54-e41a49267fd3' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '1c7736fc-95d2-5589-a526-519e72646865' AS secClave, '4fdf21a9-7ff6-5ab6-9957-696391fb7e25' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '1c7736fc-95d2-5589-a526-519e72646865' AS secClave, 'b5528679-4e9b-5007-8b3a-fe4751bd2a91' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '1c7736fc-95d2-5589-a526-519e72646865' AS secClave, '719c948b-2bd3-5a1d-be43-a9927e7d8e2d' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, '1c7736fc-95d2-5589-a526-519e72646865' AS secClave, '1b2ebea4-81f2-5047-b090-36556f552d87' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, 'bdb37162-0a6c-5db3-9a90-da574f4bfabf' AS secClave, '213f66d4-3818-5166-8416-bcad9c1afa14' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, 'bdb37162-0a6c-5db3-9a90-da574f4bfabf' AS secClave, '49756481-fad5-5189-b14f-d49a76c3ff7c' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-administrativa' AS slug, 3 AS numVer, 'bdb37162-0a6c-5db3-9a90-da574f4bfabf' AS secClave, '41b96e50-d8c3-5d05-bce2-6782aa348108' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '0352468f-1112-5b55-b7b7-96060b4d2659' AS secClave, '2edee3a1-92a7-58c3-a6d7-11c9b7519121' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '0352468f-1112-5b55-b7b7-96060b4d2659' AS secClave, 'c96fbfda-eaa9-5977-88a8-3be4b11eed65' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '0352468f-1112-5b55-b7b7-96060b4d2659' AS secClave, 'e0b12bcf-6acb-571f-905b-b72d9ad7bf45' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '0352468f-1112-5b55-b7b7-96060b4d2659' AS secClave, '4632addd-4f1d-5658-be89-6e6f52d9496b' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, '8fc83738-636d-539f-a231-e5b55f4cdc84' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, 'e0fb5f9e-7698-5c7b-845c-7ae425f23900' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, 'be610840-bb84-5022-a24b-a4f8b672134e' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, '48950498-b7e6-59c3-89d3-faa4137e0e90' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, '5f8ba638-d4e0-5aa1-a889-91f19fd371f2' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, '8892e8ba-c3a8-5f8d-bf16-082c05997394' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, '1fc74a3a-4dac-5628-a061-fa7c34e52fd7' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, '4b3677d0-e0bd-5bd2-a2d2-052c156dd1b0' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, 'b8f846a0-24b0-5e5d-baa0-9c18e4968c0b' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '095c59d6-59ee-5439-8869-b060db75be3b' AS secClave, 'f90bce3c-7d46-558e-b34c-922e6747102c' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, 'c1d4565b-4b0d-5c7d-8dfc-031d35d1d333' AS secClave, 'd158d03c-07c8-5595-8940-3806c5d9064f' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, 'c1d4565b-4b0d-5c7d-8dfc-031d35d1d333' AS secClave, 'f110904e-948b-531c-8495-d358ca335b07' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, 'c1d4565b-4b0d-5c7d-8dfc-031d35d1d333' AS secClave, '585f13cb-2d8a-5ec4-a964-06441e718c0c' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, 'c1d4565b-4b0d-5c7d-8dfc-031d35d1d333' AS secClave, '89145f3c-6e68-5436-8bb2-08e772fed28b' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, 'c1d4565b-4b0d-5c7d-8dfc-031d35d1d333' AS secClave, '1c51c89b-7ebe-5a64-8e19-ff73598de75b' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '2a5adb5e-1892-5756-a9de-ec1f07acf466' AS secClave, '79f2979c-e6b2-56bc-b474-ecb2f6aff555' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '2a5adb5e-1892-5756-a9de-ec1f07acf466' AS secClave, '039f1fa0-b154-5a30-8be4-e6ac50e3398d' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '2a5adb5e-1892-5756-a9de-ec1f07acf466' AS secClave, '14071512-9cf5-5244-9b93-4d95f7e80102' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '2b10f9ae-ed49-5ae3-a914-9708dfa6e44b' AS secClave, 'bdca636b-8690-5e88-9a96-e803467d87c5' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '2b10f9ae-ed49-5ae3-a914-9708dfa6e44b' AS secClave, '1f792c59-e62e-5b5c-902c-351719f47db1' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '352318fc-9a37-5ce5-8ca5-06190fc2436c' AS secClave, '2f3b0e80-4770-5f2f-91d5-5f40da7fa89d' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '352318fc-9a37-5ce5-8ca5-06190fc2436c' AS secClave, 'c6ae2aba-ba96-51b9-bc36-f00c215bd75f' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '352318fc-9a37-5ce5-8ca5-06190fc2436c' AS secClave, 'e3e8bc46-5a47-59f7-b797-2631fd129d07' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '352318fc-9a37-5ce5-8ca5-06190fc2436c' AS secClave, '745d7632-ee14-5c67-a3c1-9dbf69243dce' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '352318fc-9a37-5ce5-8ca5-06190fc2436c' AS secClave, '3b38a378-a503-5078-85ea-22145b31fe59' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '352318fc-9a37-5ce5-8ca5-06190fc2436c' AS secClave, 'b804a2a8-cbee-5182-94dc-160469c271d0' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '352318fc-9a37-5ce5-8ca5-06190fc2436c' AS secClave, '57033597-0781-546d-a95d-9a2eb5e2d859' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '98a7d9e5-7e82-5687-ab07-6999b5856054' AS secClave, '24b1d15a-a6c0-59aa-8185-2f52afabdb07' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '98a7d9e5-7e82-5687-ab07-6999b5856054' AS secClave, '940cd18f-149e-5235-bb7a-ae4bebaf4099' AS pregClave
    UNION ALL
    SELECT 'evaluacion-5s-operativa' AS slug, 4 AS numVer, '98a7d9e5-7e82-5687-ab07-6999b5856054' AS secClave, '73c94db3-ec73-5d2f-8bf9-0096a9a8885e' AS pregClave
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
