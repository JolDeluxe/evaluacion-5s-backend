-- Normaliza drift previo conocido y no relacionado con la eliminacion de ciclos.
-- En bases que nacen desde cero elimina la jerarquia legacy de areas y
-- el indicador esResponsable de usuarios_areas. En la base local actual
-- estos cambios ya existian como drift manual, por eso se marca applied.

ALTER TABLE `areas` DROP FOREIGN KEY `areas_areaPadreId_fkey`;
DROP INDEX `areas_areaPadreId_idx` ON `areas`;
ALTER TABLE `areas` DROP COLUMN `areaPadreId`;

ALTER TABLE `usuarios_areas` DROP COLUMN `esResponsable`;
