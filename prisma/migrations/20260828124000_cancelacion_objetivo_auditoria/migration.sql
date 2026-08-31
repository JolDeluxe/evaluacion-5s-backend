-- AlterTable
ALTER TABLE `objetivos_auditoria`
  ADD COLUMN `canceladoEn` DATETIME(3) NULL,
  ADD COLUMN `motivoCancelacion` TEXT NULL;
