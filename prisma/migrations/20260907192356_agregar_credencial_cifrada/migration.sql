-- DropForeignKey
ALTER TABLE `asignaciones_auditoria` DROP FOREIGN KEY `asignaciones_auditoria_asignacionMensualId_fkey`;

-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `credencialCifrada` TEXT NULL;

-- AddForeignKey
ALTER TABLE `asignaciones_auditoria` ADD CONSTRAINT `asignaciones_auditoria_asignacionMensualId_fkey` FOREIGN KEY (`asignacionMensualId`) REFERENCES `asignaciones_mensuales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
