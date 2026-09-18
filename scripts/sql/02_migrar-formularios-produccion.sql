-- =============================================================================
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

-- =============================================================================
-- FORMULARIO: EVALUACION 5'S ADMINISTRATIVA (evaluacion-5s-administrativa) -> VERSIÓN META 3
-- =============================================================================

-- 1. Asegurar Formulario raíz
INSERT INTO formularios (nombre, slug, descripcion, alcance, activo, creadoPorId, creadoEn, actualizadoEn)
SELECT 'EVALUACION 5''S ADMINISTRATIVA', 'evaluacion-5s-administrativa', 'Sistema de Gestión de Calidad · Formato F-16-SA', 'ADMINISTRATIVO', 1, @admin_id, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM formularios WHERE slug = 'evaluacion-5s-administrativa');

SET @form_id = (SELECT id FROM formularios WHERE slug = 'evaluacion-5s-administrativa');

-- 2. Asegurar Versión 3 (se inserta con activa = 0 para NO alterar operación actual)
INSERT INTO versiones_formulario (formularioId, numeroVersion, activa, creadoPorId, creadoEn, actualizadoEn)
SELECT @form_id, 3, 0, @admin_id, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM versiones_formulario 
    WHERE formularioId = @form_id AND numeroVersion = 3
);

SET @version_id = (
    SELECT id FROM versiones_formulario 
    WHERE formularioId = @form_id AND numeroVersion = 3
);

-- Sección: 1´S (SEIRI) (orden 0)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '63b0d326-9cff-578e-b2b7-e29fb3e739d6', '1´S (SEIRI)', '"Clasificación - Separación": Identificar lo necesario de lo innecesario', 0, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '63b0d326-9cff-578e-b2b7-e29fb3e739d6'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '63b0d326-9cff-578e-b2b7-e29fb3e739d6'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '1b1f1188-850f-511e-8723-84c3addc0481', 'Se evalúa: Archivo. Documentos que se tiene en escritorio, clasificados de acuerdo al uso de cada documento). ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '1b1f1188-850f-511e-8723-84c3addc0481'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '15bf22a9-1da1-5010-be5b-25aefe7810ab', 'Se evalúa: Escritorio. Documentos, materiales, equipos innecesarios almacenados o guardados en cajones o gavetas. ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '15bf22a9-1da1-5010-be5b-25aefe7810ab'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '214ff673-9e8c-520c-9904-a995b7199c4e', 'Se evalúa: Control Visual. Artículos y documentos que no son necesarios para la realización de actividades y que son identificados a simple vista. ¿CUMPLE?', 2, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '214ff673-9e8c-520c-9904-a995b7199c4e'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '81f6f17b-939a-5e16-90e5-b3a791a4e313', 'Se evalúa: Elemento para descartar Documentos, materiales y equipos que deben ser devueltos o dados de baja por no prestar ninguna utilidad. ¿CUMPLE?', 3, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '81f6f17b-939a-5e16-90e5-b3a791a4e313'
);

-- Sección: 2´S (SEITON) (orden 1)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '425480dc-9ac9-5f75-97bb-f33599d5605f', '2´S (SEITON)', '"Orden": Designar un lugar para cada cosa', 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '425480dc-9ac9-5f75-97bb-f33599d5605f'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '425480dc-9ac9-5f75-97bb-f33599d5605f'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'ea66f727-5a0c-5fda-bc7c-03b121f23523', 'Se evalúa: Identificación de carpetas. Todas las carpetas están identificadas o rotuladas a fin de localizar documentos con la mayor facilidad posible. ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'ea66f727-5a0c-5fda-bc7c-03b121f23523'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '127d1318-d2da-5dc3-88d7-e716bdfbaf81', 'Se evalúa: Gavetas de escritorio. Existe mezcla de documentos, elementos y/o artículos que son utilizados, pero no van acorde a la identificación de la gaveta. ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '127d1318-d2da-5dc3-88d7-e716bdfbaf81'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '8d1014cd-7f26-53d5-b8a8-0168de365fe0', 'Se evalúa: Organización de equipos y documentos en escritorio. Todos los documentos, elementos y equipos tienen un lugar fijo y siempre están en el mismo lugar. ¿CUMPLE?', 2, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '8d1014cd-7f26-53d5-b8a8-0168de365fe0'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'eac9ec97-b77f-58d5-8e53-b046b63e15cb', 'Se evalúa: Documentos escritorio. No tener o contar con documentos en exceso y sin orden sobre el escritorio de trabajo. ¿CUMPLE?', 3, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'eac9ec97-b77f-58d5-8e53-b046b63e15cb'
);

-- Sección: 3´S (SEISO) (orden 2)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '0a37e142-b495-51c2-860a-450fd9820091', '3´S (SEISO)', '"Limpieza": Integrar hábitos de limpieza como un ámbito laboral', 2, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '0a37e142-b495-51c2-860a-450fd9820091'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '0a37e142-b495-51c2-860a-450fd9820091'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '2ea3dce9-84f7-529f-8cb0-3add0f85d3e0', 'Se evalúa: Piso. El piso de trabajo se encuentra limpio y libre de obstáculos que puedan generar una caída al mismo nivel. ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '2ea3dce9-84f7-529f-8cb0-3add0f85d3e0'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'c8c05543-80a7-5002-83e3-06d25f786635', 'Se evalúa: Escritorio. El escritorio o mesa de trabajo se encuentra limpio y libre de suciedad. ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'c8c05543-80a7-5002-83e3-06d25f786635'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'f49352c9-cb9b-53ea-8fca-f4b85886a903', 'Se evalúa: Limpieza habitual. Diariamente se realiza limpieza al área de trabajo y equipos de oficina. (Pantallas, CPU, teclado, teléfonos, gavetas, etc.) ¿CUMPLE?', 2, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'f49352c9-cb9b-53ea-8fca-f4b85886a903'
);

-- Sección: 4´S (SEIKETSU) (orden 3)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '36a014fe-589a-536a-9690-df77bc9f4848', '4´S (SEIKETSU)', '"Estandarizar": Mantener las condiciones de anteriores S´', 3, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '36a014fe-589a-536a-9690-df77bc9f4848'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '36a014fe-589a-536a-9690-df77bc9f4848'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'd1c43b33-04c1-58b0-b917-f60d783b605c', 'Se evalúa: Etiquetado y/o rotulado. Todas las carpetas están identificadas con el etiquetado y/o rotulado estandarizado por parte de la empresa.) ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'd1c43b33-04c1-58b0-b917-f60d783b605c'
);

-- Sección: 5´S (SHITSUKE) (orden 4)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, 'de4484ad-9480-5374-ad2c-390fd2d9aa00', '5´S (SHITSUKE)', '"Disciplina": Fomentar la autodisciplina a los colaboradores', 4, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = 'de4484ad-9480-5374-ad2c-390fd2d9aa00'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = 'de4484ad-9480-5374-ad2c-390fd2d9aa00'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'db5acd61-4fe3-5472-ad71-0180ac987890', 'Se evalúa: Cultura. ¿Todos los trabajadores participan en mantener en orden y limpia sus áreas de trabajo? ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'db5acd61-4fe3-5472-ad71-0180ac987890'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '45a3e506-14d6-5b7c-8b47-7e21ab8a740b', 'Se evalúa: Cultura. ¿Todos los trabajadores utilizan su uniforme, así como el material de equipo de protección personal para las actividades diarias de su trabajo? ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '45a3e506-14d6-5b7c-8b47-7e21ab8a740b'
);

-- Sección: 6´S (SECURITY - APPEARANCE) (orden 5)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '1c7736fc-95d2-5589-a526-519e72646865', '6´S (SECURITY - APPEARANCE)', '"Seguridad": Fomentar un ambiente de trabajo seguro para los colaboradores', 5, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '1c7736fc-95d2-5589-a526-519e72646865'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '1c7736fc-95d2-5589-a526-519e72646865'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '495b4c49-9afe-55f9-8444-3a9bae6d0a55', 'Se evalúa: Seguridad. Estado de iluminación ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '495b4c49-9afe-55f9-8444-3a9bae6d0a55'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '000d2c36-2a3f-5d4d-bf54-e41a49267fd3', 'Se evalúa: Seguridad ¿Cuenta con equipo contra incendios? (Sin obstruir, Delimitado, y en buenas condiciones sin golpes o falta de pintura). ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '000d2c36-2a3f-5d4d-bf54-e41a49267fd3'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '4fdf21a9-7ff6-5ab6-9957-696391fb7e25', 'Se evalúa: Seguridad ¿Todos los trabajadores utilizan su uniforme, así como el material de equipo de protección personal para las actividades diarias de su trabajo? ¿CUMPLE?', 2, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '4fdf21a9-7ff6-5ab6-9957-696391fb7e25'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'b5528679-4e9b-5007-8b3a-fe4751bd2a91', 'Se evalúa: Imagen ¿Las condiciones del mobiliario y maquinaria es buena? (pintura, condiciones) ¿CUMPLE?', 3, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'b5528679-4e9b-5007-8b3a-fe4751bd2a91'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '719c948b-2bd3-5a1d-be43-a9927e7d8e2d', 'Se evalúa: Imagen Estado de las instalaciones (pintura, condiciones) ¿CUMPLE?', 4, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '719c948b-2bd3-5a1d-be43-a9927e7d8e2d'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '1b2ebea4-81f2-5047-b090-36556f552d87', 'Se evalúa: Imagen Instalaciones electrónicas (seguras y no visibles) ¿CUMPLE?', 5, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '1b2ebea4-81f2-5047-b090-36556f552d87'
);

-- Sección: CULTURA (orden 6)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, 'bdb37162-0a6c-5db3-9a90-da574f4bfabf', 'CULTURA', 'Realizar las preguntas al personal aplicable en el apartado de cultura, con la finalidad de fomentar la cultura de conocimiento realizando preguntas sobre la metodología.', 6, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = 'bdb37162-0a6c-5db3-9a90-da574f4bfabf'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = 'bdb37162-0a6c-5db3-9a90-da574f4bfabf'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '213f66d4-3818-5166-8416-bcad9c1afa14', '¿Cuántas y cuáles son las 5''S? ¿CUMPLE?', 0, 0, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '213f66d4-3818-5166-8416-bcad9c1afa14'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '49756481-fad5-5189-b14f-d49a76c3ff7c', '¿Qué significa WPO y para qué nos sirve dentro de nuestro lugar de trabajo? ¿CUMPLE?', 1, 0, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '49756481-fad5-5189-b14f-d49a76c3ff7c'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '41b96e50-d8c3-5d05-bce2-6782aa348108', '¿Sabes cuál es el estándar ideal de WPO en tu lugar de trabajo? ¿CUMPLE?', 2, 0, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '41b96e50-d8c3-5d05-bce2-6782aa348108'
);

-- =============================================================================
-- FORMULARIO: EVALUACION 5'S OPERATIVA (evaluacion-5s-operativa) -> VERSIÓN META 4
-- =============================================================================

-- 1. Asegurar Formulario raíz
INSERT INTO formularios (nombre, slug, descripcion, alcance, activo, creadoPorId, creadoEn, actualizadoEn)
SELECT 'EVALUACION 5''S OPERATIVA', 'evaluacion-5s-operativa', 'Sistema de Gestión de Calidad · Formato F-16-SA', 'OPERATIVO', 1, @admin_id, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM formularios WHERE slug = 'evaluacion-5s-operativa');

SET @form_id = (SELECT id FROM formularios WHERE slug = 'evaluacion-5s-operativa');

-- 2. Asegurar Versión 4 (se inserta con activa = 0 para NO alterar operación actual)
INSERT INTO versiones_formulario (formularioId, numeroVersion, activa, creadoPorId, creadoEn, actualizadoEn)
SELECT @form_id, 4, 0, @admin_id, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM versiones_formulario 
    WHERE formularioId = @form_id AND numeroVersion = 4
);

SET @version_id = (
    SELECT id FROM versiones_formulario 
    WHERE formularioId = @form_id AND numeroVersion = 4
);

-- Sección: 1'S SEIRI - Clasificación - Separación (orden 0)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '0352468f-1112-5b55-b7b7-96060b4d2659', '1''S SEIRI - Clasificación - Separación', 'Identificar lo necesario de lo innecesario.', 0, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '0352468f-1112-5b55-b7b7-96060b4d2659'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '0352468f-1112-5b55-b7b7-96060b4d2659'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '2edee3a1-92a7-58c3-a6d7-11c9b7519121', '¿En el área solo se encuentran herramientas o materiales correspondientes a la actividad y/o departamento? ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '2edee3a1-92a7-58c3-a6d7-11c9b7519121'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'c96fbfda-eaa9-5977-88a8-3be4b11eed65', '¿En el área de trabajo no se encuentran objetos personales? ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'c96fbfda-eaa9-5977-88a8-3be4b11eed65'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'e0b12bcf-6acb-571f-905b-b72d9ad7bf45', '¿Existen elementos inutilizados dentro del área separados e identificados (maquinaria, mp, cajones, herramientas, etc)? ¿CUMPLE?', 2, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'e0b12bcf-6acb-571f-905b-b72d9ad7bf45'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '4632addd-4f1d-5658-be89-6e6f52d9496b', '¿No se tiene un exceso de material? ¿CUMPLE?', 3, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '4632addd-4f1d-5658-be89-6e6f52d9496b'
);

-- Sección: 2'S SEITON - Orden (orden 1)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '095c59d6-59ee-5439-8869-b060db75be3b', '2''S SEITON - Orden', 'Designar un lugar para cada cosa.', 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '095c59d6-59ee-5439-8869-b060db75be3b'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '095c59d6-59ee-5439-8869-b060db75be3b'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '8fc83738-636d-539f-a231-e5b55f4cdc84', '¿Están claramente definidos los pasillos, áreas de almacenamiento y lugares de trabajo, sin objetos fuera de su lugar y/o que se encuentren obstruyendo? ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '8fc83738-636d-539f-a231-e5b55f4cdc84'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'e0fb5f9e-7698-5c7b-845c-7ae425f23900', '¿Se encuentran delimitadas las áreas de herramientas de trabajo, maquinaria, residuos o basura y producto terminado o en proceso? ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'e0fb5f9e-7698-5c7b-845c-7ae425f23900'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'be610840-bb84-5022-a24b-a4f8b672134e', '¿Existen objetos fuera de sus áreas delimitadas? (Herramientas de trabajo, maquinaria, residuos o basura, producto). ¿CUMPLE?', 2, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'be610840-bb84-5022-a24b-a4f8b672134e'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '48950498-b7e6-59c3-89d3-faa4137e0e90', '¿Se manejan los residuos correctamente? ¿CUMPLE?', 3, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '48950498-b7e6-59c3-89d3-faa4137e0e90'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '5f8ba638-d4e0-5aa1-a889-91f19fd371f2', 'Vías de circulación transitables, claras y sin obstrucción. ¿CUMPLE?', 4, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '5f8ba638-d4e0-5aa1-a889-91f19fd371f2'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '8892e8ba-c3a8-5f8d-bf16-082c05997394', 'Hay exceso de herramienta o maquinaria en las áreas. ¿CUMPLE?', 5, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '8892e8ba-c3a8-5f8d-bf16-082c05997394'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '1fc74a3a-4dac-5628-a061-fa7c34e52fd7', '¿Las áreas de almacenamiento son empleadas con el propósito asignado? ¿CUMPLE?', 6, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '1fc74a3a-4dac-5628-a061-fa7c34e52fd7'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '4b3677d0-e0bd-5bd2-a2d2-052c156dd1b0', '¿No existen materiales fuera de las estanterías o espacios de almacenamiento? ¿CUMPLE?', 7, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '4b3677d0-e0bd-5bd2-a2d2-052c156dd1b0'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'b8f846a0-24b0-5e5d-baa0-9c18e4968c0b', '¿Hay información fuera de lugares asignados? ¿CUMPLE?', 8, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'b8f846a0-24b0-5e5d-baa0-9c18e4968c0b'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'f90bce3c-7d46-558e-b34c-922e6747102c', '¿Los materiales asignados se cuentan únicamente en los espacios correspondientes? ¿CUMPLE?', 9, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'f90bce3c-7d46-558e-b34c-922e6747102c'
);

-- Sección: 3'S SEISO - Limpieza (orden 2)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, 'c1d4565b-4b0d-5c7d-8dfc-031d35d1d333', '3''S SEISO - Limpieza', 'Integrar hábitos de limpieza como un ámbito laboral.', 2, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = 'c1d4565b-4b0d-5c7d-8dfc-031d35d1d333'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = 'c1d4565b-4b0d-5c7d-8dfc-031d35d1d333'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'd158d03c-07c8-5595-8940-3806c5d9064f', '¿Las áreas de almacenamiento de materiales se encuentran limpias (Estanterías)? ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'd158d03c-07c8-5595-8940-3806c5d9064f'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'f110904e-948b-531c-8495-d358ca335b07', '¿Los espacios de trabajo se encuentran limpios (Maquinaria, equipo de cómputo, mesas de trabajo, ventiladores, lámparas, pisos)? ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'f110904e-948b-531c-8495-d358ca335b07'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '585f13cb-2d8a-5ec4-a964-06441e718c0c', '¿Los espacios de trabajo, maquinaria, mesas, cajones de trabajo están libres de alimentos? ¿CUMPLE?', 2, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '585f13cb-2d8a-5ec4-a964-06441e718c0c'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '89145f3c-6e68-5436-8bb2-08e772fed28b', 'Pizarrones (limpios) ¿CUMPLE?', 3, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '89145f3c-6e68-5436-8bb2-08e772fed28b'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '1c51c89b-7ebe-5a64-8e19-ff73598de75b', 'Instalaciones (pisos, paredes, ventanas, techos) ¿Se encuentran limpias y libres de materiales innecesarios? ¿CUMPLE?', 4, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '1c51c89b-7ebe-5a64-8e19-ff73598de75b'
);

-- Sección: 4'S SEIKETSU - Estandarizar (orden 3)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '2a5adb5e-1892-5756-a9de-ec1f07acf466', '4''S SEIKETSU - Estandarizar', 'Mantener las condiciones de anteriores S´.', 3, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '2a5adb5e-1892-5756-a9de-ec1f07acf466'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '2a5adb5e-1892-5756-a9de-ec1f07acf466'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '79f2979c-e6b2-56bc-b474-ecb2f6aff555', '¿El encargado de área aporta y trabaja con el equipo para mantener el trabajo de las ´s anteriores? ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '79f2979c-e6b2-56bc-b474-ecb2f6aff555'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '039f1fa0-b154-5a30-8be4-e6ac50e3398d', 'Pizarrones (mismo formato en toda la planta) ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '039f1fa0-b154-5a30-8be4-e6ac50e3398d'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '14071512-9cf5-5244-9b93-4d95f7e80102', '¿Se cuenta con layout del área actualizado y con la correcta delimitación del espacio de trabajo para que se lleve a cabo el bueno uso de los espacios? ¿CUMPLE?', 2, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '14071512-9cf5-5244-9b93-4d95f7e80102'
);

-- Sección: 5'S SHITSUKE - Disciplina (orden 4)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '2b10f9ae-ed49-5ae3-a914-9708dfa6e44b', '5''S SHITSUKE - Disciplina', 'Fomentar la autodisciplina a los colaboradores.', 4, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '2b10f9ae-ed49-5ae3-a914-9708dfa6e44b'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '2b10f9ae-ed49-5ae3-a914-9708dfa6e44b'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'bdca636b-8690-5e88-9a96-e803467d87c5', '¿Todos los trabajadores participan en mantener en orden y limpia sus áreas de trabajo? ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'bdca636b-8690-5e88-9a96-e803467d87c5'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '1f792c59-e62e-5b5c-902c-351719f47db1', '¿Todos los trabajadores utilizan su uniforme, así como el material de equipo de protección personal para las actividades diarias de su trabajo? ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '1f792c59-e62e-5b5c-902c-351719f47db1'
);

-- Sección: SEGURIDAD (orden 5)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '352318fc-9a37-5ce5-8ca5-06190fc2436c', 'SEGURIDAD', 'Fomentar un ambiente de trabajo seguro para los colaboradores.', 5, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '352318fc-9a37-5ce5-8ca5-06190fc2436c'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '352318fc-9a37-5ce5-8ca5-06190fc2436c'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '2f3b0e80-4770-5f2f-91d5-5f40da7fa89d', 'Estado de iluminación. ¿CUMPLE?', 0, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '2f3b0e80-4770-5f2f-91d5-5f40da7fa89d'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'c6ae2aba-ba96-51b9-bc36-f00c215bd75f', '¿Cuenta con equipo contra incendios? (Sin obstruir, Delimitado, y en buenas condiciones sin golpes o falta de pintura). ¿CUMPLE?', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'c6ae2aba-ba96-51b9-bc36-f00c215bd75f'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'e3e8bc46-5a47-59f7-b797-2631fd129d07', '¿Cuenta con la señalética correspondiente y en condiciones? ¿CUMPLE?', 2, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'e3e8bc46-5a47-59f7-b797-2631fd129d07'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '745d7632-ee14-5c67-a3c1-9dbf69243dce', '¿Las condiciones del mobiliario y maquinaria es buena? (pintura, condiciones). ¿CUMPLE?', 3, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '745d7632-ee14-5c67-a3c1-9dbf69243dce'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '3b38a378-a503-5078-85ea-22145b31fe59', 'Estado de las instalaciones (pintura, condiciones). ¿CUMPLE?', 4, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '3b38a378-a503-5078-85ea-22145b31fe59'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, 'b804a2a8-cbee-5182-94dc-160469c271d0', 'Instalaciones electrónicas (seguras y no visibles). ¿CUMPLE?', 5, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = 'b804a2a8-cbee-5182-94dc-160469c271d0'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '57033597-0781-546d-a95d-9a2eb5e2d859', '¿Uso de equipo de protección personal de acuerdo a lo establecido por seguridad e higiene como lo marca la señalética? ¿CUMPLE?', 6, 1, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '57033597-0781-546d-a95d-9a2eb5e2d859'
);

-- Sección: CULTURA (orden 6)
INSERT INTO secciones_formulario (versionFormularioId, claveEstable, nombre, objetivo, orden, creadoEn, actualizadoEn)
SELECT @version_id, '98a7d9e5-7e82-5687-ab07-6999b5856054', 'CULTURA', 'Realizar las preguntas al personal aplicable en el apartado de cultura, con la finalidad de fomentar la cultura de conocimiento realizando preguntas sobre la metodología.', 6, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '98a7d9e5-7e82-5687-ab07-6999b5856054'
);

SET @seccion_id = (
    SELECT id FROM secciones_formulario 
    WHERE versionFormularioId = @version_id AND claveEstable = '98a7d9e5-7e82-5687-ab07-6999b5856054'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '24b1d15a-a6c0-59aa-8185-2f52afabdb07', '¿Cuántas y cuáles son las 5''S? ¿CUMPLE?', 0, 0, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '24b1d15a-a6c0-59aa-8185-2f52afabdb07'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '940cd18f-149e-5235-bb7a-ae4bebaf4099', '¿Qué significa WPO y para qué nos sirve dentro de nuestro lugar de trabajo? ¿CUMPLE?', 1, 0, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '940cd18f-149e-5235-bb7a-ae4bebaf4099'
);
INSERT INTO preguntas_formulario (seccionFormularioId, claveEstable, texto, orden, requiereHallazgo, creadoEn, actualizadoEn)
SELECT @seccion_id, '73c94db3-ec73-5d2f-8bf9-0096a9a8885e', '¿Sabes cuál es el estándar ideal de WPO en tu lugar de trabajo? ¿CUMPLE?', 2, 0, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM preguntas_formulario 
    WHERE seccionFormularioId = @seccion_id AND claveEstable = '73c94db3-ec73-5d2f-8bf9-0096a9a8885e'
);

-- =============================================================================
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
