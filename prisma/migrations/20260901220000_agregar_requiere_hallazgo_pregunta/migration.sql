-- Create migration
ALTER TABLE `preguntas_formulario` ADD COLUMN `requiereHallazgo` BOOLEAN NOT NULL DEFAULT true;
