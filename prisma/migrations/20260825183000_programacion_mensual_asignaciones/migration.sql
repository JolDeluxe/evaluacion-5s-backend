ALTER TABLE `areas`
  ADD COLUMN `auditableDesde` DATE NULL;

CREATE INDEX `areas_activo_auditableDesde_idx` ON `areas`(`activo`, `auditableDesde`);

ALTER TABLE `asignaciones_auditoria`
  ADD COLUMN `motivoExcepcion` TEXT NULL,
  ADD COLUMN `reabiertaHasta` DATETIME(3) NULL,
  ADD COLUMN `reabiertaEn` DATETIME(3) NULL,
  ADD COLUMN `reabiertaPorId` INTEGER NULL,
  ADD COLUMN `motivoReapertura` TEXT NULL;

CREATE INDEX `asignaciones_auditoria_reabiertaHasta_idx` ON `asignaciones_auditoria`(`reabiertaHasta`);
