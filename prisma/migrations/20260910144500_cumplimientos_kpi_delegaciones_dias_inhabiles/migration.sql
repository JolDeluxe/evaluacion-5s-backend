-- AlterTable
ALTER TABLE `asignaciones_auditoria` ADD COLUMN `responsableCumplimientoId` INTEGER NULL;

-- AlterTable
ALTER TABLE `asignaciones_mensuales` ADD COLUMN `responsableCumplimientoId` INTEGER NULL;

-- AlterTable
ALTER TABLE `envios_auditoria` ADD COLUMN `realizadaATiempo` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `esComodin` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `puedeSerAsignadoAuditoria` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `seEvalua` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `rol` ENUM('SUPER_ADMIN', 'ADMINISTRADOR', 'AUDITOR', 'VISUALIZADOR') NOT NULL;

-- CreateTable
CREATE TABLE `delegaciones_cumplimiento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ejecutorId` INTEGER NOT NULL,
    `responsableId` INTEGER NOT NULL,
    `vigenteDesde` DATE NOT NULL,
    `vigenteHasta` DATE NULL,
    `activa` BOOLEAN NOT NULL DEFAULT true,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `delegaciones_cumplimiento_ejecutorId_activa_vigenteDesde_idx`(`ejecutorId`, `activa`, `vigenteDesde`),
    INDEX `delegaciones_cumplimiento_responsableId_idx`(`responsableId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cumplimientos_mensuales_usuario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `anio` INTEGER NOT NULL,
    `mes` INTEGER NOT NULL,
    `seEvaluaSnapshot` BOOLEAN NOT NULL DEFAULT false,
    `auditoriasEsperadas` INTEGER NOT NULL DEFAULT 0,
    `auditoriasATiempo` INTEGER NOT NULL DEFAULT 0,
    `porcentajeCumplimiento` DECIMAL(10, 4) NULL,
    `promedioAreas` DECIMAL(10, 4) NULL,
    `areasConResultado` INTEGER NOT NULL DEFAULT 0,
    `kpiFinal` DECIMAL(10, 4) NULL,
    `calculadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `cumplimientos_mensuales_usuario_anio_mes_idx`(`anio`, `mes`),
    UNIQUE INDEX `cumplimientos_mensuales_usuario_usuarioId_anio_mes_key`(`usuarioId`, `anio`, `mes`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cumplimientos_mensuales_area` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cumplimientoMensualUsuarioId` INTEGER NOT NULL,
    `areaId` INTEGER NOT NULL,
    `codigoAreaSnapshot` VARCHAR(50) NOT NULL,
    `nombreAreaSnapshot` VARCHAR(160) NOT NULL,
    `tipoAreaSnapshot` ENUM('ADMINISTRATIVA', 'OPERATIVA') NOT NULL,
    `resultadoMensualUtilizado` DECIMAL(10, 4) NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cumplimientos_mensuales_area_areaId_idx`(`areaId`),
    UNIQUE INDEX `cumplimientos_mensuales_area_cumplimientoMensualUsuarioId_ar_key`(`cumplimientoMensualUsuarioId`, `areaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dias_inhabiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fecha` DATE NOT NULL,
    `descripcion` VARCHAR(160) NOT NULL,
    `tipo` ENUM('DESCANSO_OFICIAL', 'ELECTORAL') NOT NULL DEFAULT 'DESCANSO_OFICIAL',
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dias_inhabiles_fecha_key`(`fecha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `asignaciones_auditoria_responsableCumplimientoId_idx` ON `asignaciones_auditoria`(`responsableCumplimientoId`);

-- CreateIndex
CREATE INDEX `asignaciones_mensuales_responsableCumplimientoId_idx` ON `asignaciones_mensuales`(`responsableCumplimientoId`);

-- AddForeignKey
ALTER TABLE `asignaciones_mensuales` ADD CONSTRAINT `asignaciones_mensuales_responsableCumplimientoId_fkey` FOREIGN KEY (`responsableCumplimientoId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asignaciones_auditoria` ADD CONSTRAINT `asignaciones_auditoria_responsableCumplimientoId_fkey` FOREIGN KEY (`responsableCumplimientoId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delegaciones_cumplimiento` ADD CONSTRAINT `delegaciones_cumplimiento_ejecutorId_fkey` FOREIGN KEY (`ejecutorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delegaciones_cumplimiento` ADD CONSTRAINT `delegaciones_cumplimiento_responsableId_fkey` FOREIGN KEY (`responsableId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cumplimientos_mensuales_usuario` ADD CONSTRAINT `cumplimientos_mensuales_usuario_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cumplimientos_mensuales_area` ADD CONSTRAINT `cumplimientos_mensuales_area_cumplimientoMensualUsuarioId_fkey` FOREIGN KEY (`cumplimientoMensualUsuarioId`) REFERENCES `cumplimientos_mensuales_usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
