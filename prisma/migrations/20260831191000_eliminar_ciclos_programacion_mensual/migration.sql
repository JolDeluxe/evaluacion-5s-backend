-- Elimina la configuracion legacy de ciclos y mueve el periodo/formulario
-- historico directamente a objetivos_auditoria.
--
-- Orden intencional:
-- 1. expandir columnas nuevas como NULL;
-- 2. backfill desde ciclos_auditoria y formularios_ciclo;
-- 3. validar historicos;
-- 4. endurecer NOT NULL e indices;
-- 5. agregar AsignacionMensual para programacion nueva;
-- 6. retirar FKs/columnas/tablas legacy.

SET @objetivos_antes_eliminar_ciclos := (SELECT COUNT(*) FROM `objetivos_auditoria`);

ALTER TABLE `objetivos_auditoria`
  ADD COLUMN `anio` INTEGER NULL,
  ADD COLUMN `mes` INTEGER NULL,
  ADD COLUMN `periodo` INTEGER NULL,
  ADD COLUMN `versionFormularioId` INTEGER NULL,
  ADD COLUMN `iniciaEn` DATETIME(3) NULL,
  ADD COLUMN `terminaEn` DATETIME(3) NULL;

UPDATE `objetivos_auditoria` AS `oa`
INNER JOIN `ciclos_auditoria` AS `ca`
  ON `ca`.`id` = `oa`.`cicloAuditoriaId`
INNER JOIN `formularios_ciclo` AS `fc`
  ON `fc`.`id` = `oa`.`formularioCicloId`
SET
  `oa`.`anio` = `ca`.`anio`,
  `oa`.`mes` = `ca`.`mes`,
  `oa`.`periodo` = `ca`.`numeroCorte`,
  `oa`.`iniciaEn` = `ca`.`iniciaEn`,
  `oa`.`terminaEn` = `ca`.`terminaEn`,
  `oa`.`versionFormularioId` = `fc`.`versionFormularioId`;

CREATE TEMPORARY TABLE `_validacion_eliminar_ciclos` (
  `id` INTEGER NOT NULL,
  PRIMARY KEY (`id`)
);

INSERT INTO `_validacion_eliminar_ciclos` (`id`) VALUES (1);

INSERT INTO `_validacion_eliminar_ciclos` (`id`)
SELECT 1 FROM (SELECT COUNT(*) AS `c` FROM `objetivos_auditoria` WHERE `anio` IS NULL) AS `v`
WHERE `v`.`c` > 0;

INSERT INTO `_validacion_eliminar_ciclos` (`id`)
SELECT 1 FROM (SELECT COUNT(*) AS `c` FROM `objetivos_auditoria` WHERE `mes` IS NULL) AS `v`
WHERE `v`.`c` > 0;

INSERT INTO `_validacion_eliminar_ciclos` (`id`)
SELECT 1 FROM (SELECT COUNT(*) AS `c` FROM `objetivos_auditoria` WHERE `periodo` IS NULL) AS `v`
WHERE `v`.`c` > 0;

INSERT INTO `_validacion_eliminar_ciclos` (`id`)
SELECT 1 FROM (
  SELECT COUNT(*) AS `c`
  FROM `objetivos_auditoria`
  WHERE `periodo` IS NULL OR `periodo` NOT IN (1, 2)
) AS `v`
WHERE `v`.`c` > 0;

INSERT INTO `_validacion_eliminar_ciclos` (`id`)
SELECT 1 FROM (SELECT COUNT(*) AS `c` FROM `objetivos_auditoria` WHERE `versionFormularioId` IS NULL) AS `v`
WHERE `v`.`c` > 0;

INSERT INTO `_validacion_eliminar_ciclos` (`id`)
SELECT 1 FROM (SELECT COUNT(*) AS `c` FROM `objetivos_auditoria` WHERE `iniciaEn` IS NULL) AS `v`
WHERE `v`.`c` > 0;

INSERT INTO `_validacion_eliminar_ciclos` (`id`)
SELECT 1 FROM (SELECT COUNT(*) AS `c` FROM `objetivos_auditoria` WHERE `terminaEn` IS NULL) AS `v`
WHERE `v`.`c` > 0;

INSERT INTO `_validacion_eliminar_ciclos` (`id`)
SELECT 1 FROM (
  SELECT `areaId`, `anio`, `mes`, `periodo`, COUNT(*) AS `c`
  FROM `objetivos_auditoria`
  GROUP BY `areaId`, `anio`, `mes`, `periodo`
  HAVING COUNT(*) > 1
  LIMIT 1
) AS `duplicados`;

INSERT INTO `_validacion_eliminar_ciclos` (`id`)
SELECT 1
WHERE (SELECT COUNT(*) FROM `objetivos_auditoria`) <> @objetivos_antes_eliminar_ciclos;

DROP TEMPORARY TABLE `_validacion_eliminar_ciclos`;

ALTER TABLE `objetivos_auditoria`
  MODIFY `anio` INTEGER NOT NULL,
  MODIFY `mes` INTEGER NOT NULL,
  MODIFY `periodo` INTEGER NOT NULL,
  MODIFY `versionFormularioId` INTEGER NOT NULL,
  MODIFY `iniciaEn` DATETIME(3) NOT NULL,
  MODIFY `terminaEn` DATETIME(3) NOT NULL;

CREATE TABLE `asignaciones_mensuales` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `areaId` INTEGER NOT NULL,
  `anio` INTEGER NOT NULL,
  `mes` INTEGER NOT NULL,
  `auditorId` INTEGER NOT NULL,
  `asignadoPorId` INTEGER NOT NULL,
  `asignadoEn` DATETIME(3) NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  UNIQUE INDEX `asignaciones_mensuales_areaId_anio_mes_key`(`areaId`, `anio`, `mes`),
  INDEX `asignaciones_mensuales_auditorId_anio_mes_idx`(`auditorId`, `anio`, `mes`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `asignaciones_auditoria`
  ADD COLUMN `asignacionMensualId` INTEGER NULL;

CREATE UNIQUE INDEX `objetivos_auditoria_areaId_anio_mes_periodo_key`
  ON `objetivos_auditoria`(`areaId`, `anio`, `mes`, `periodo`);

CREATE INDEX `objetivos_auditoria_anio_mes_periodo_tipoAreaSnapshot_idx`
  ON `objetivos_auditoria`(`anio`, `mes`, `periodo`, `tipoAreaSnapshot`);

CREATE INDEX `objetivos_auditoria_versionFormularioId_idx`
  ON `objetivos_auditoria`(`versionFormularioId`);

CREATE INDEX `asignaciones_auditoria_asignacionMensualId_idx`
  ON `asignaciones_auditoria`(`asignacionMensualId`);

ALTER TABLE `asignaciones_mensuales`
  ADD CONSTRAINT `asignaciones_mensuales_areaId_fkey`
  FOREIGN KEY (`areaId`) REFERENCES `areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `asignaciones_mensuales`
  ADD CONSTRAINT `asignaciones_mensuales_auditorId_fkey`
  FOREIGN KEY (`auditorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `asignaciones_mensuales`
  ADD CONSTRAINT `asignaciones_mensuales_asignadoPorId_fkey`
  FOREIGN KEY (`asignadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `asignaciones_auditoria`
  ADD CONSTRAINT `asignaciones_auditoria_asignacionMensualId_fkey`
  FOREIGN KEY (`asignacionMensualId`) REFERENCES `asignaciones_mensuales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `objetivos_auditoria`
  ADD CONSTRAINT `objetivos_auditoria_versionFormularioId_fkey`
  FOREIGN KEY (`versionFormularioId`) REFERENCES `versiones_formulario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `objetivos_auditoria` DROP FOREIGN KEY `objetivos_auditoria_cicloAuditoriaId_fkey`;
ALTER TABLE `objetivos_auditoria` DROP FOREIGN KEY `objetivos_auditoria_formularioCicloId_fkey`;
ALTER TABLE `formularios_ciclo` DROP FOREIGN KEY `formularios_ciclo_cicloAuditoriaId_fkey`;
ALTER TABLE `formularios_ciclo` DROP FOREIGN KEY `formularios_ciclo_versionFormularioId_fkey`;
ALTER TABLE `ciclos_auditoria` DROP FOREIGN KEY `ciclos_auditoria_creadoPorId_fkey`;

DROP INDEX `objetivos_auditoria_cicloAuditoriaId_areaId_key` ON `objetivos_auditoria`;
DROP INDEX `objetivos_auditoria_cicloAuditoriaId_tipoAreaSnapshot_idx` ON `objetivos_auditoria`;
DROP INDEX `objetivos_auditoria_areaId_cicloAuditoriaId_idx` ON `objetivos_auditoria`;
DROP INDEX `objetivos_auditoria_formularioCicloId_idx` ON `objetivos_auditoria`;

ALTER TABLE `objetivos_auditoria`
  DROP COLUMN `cicloAuditoriaId`,
  DROP COLUMN `formularioCicloId`;

DROP TABLE `formularios_ciclo`;
DROP TABLE `ciclos_auditoria`;
