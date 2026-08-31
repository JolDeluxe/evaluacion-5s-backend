/*
  Warnings:

  - You are about to drop the column `imagenAlt` on the `secciones_formulario` table. All the data in the column will be lost.
  - You are about to drop the column `imagenPublicId` on the `secciones_formulario` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `secciones_formulario` DROP COLUMN `imagenAlt`,
    DROP COLUMN `imagenPublicId`;
