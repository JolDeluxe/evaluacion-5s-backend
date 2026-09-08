-- CreateTable
CREATE TABLE `secretos_sistema` (
    `clave` VARCHAR(120) NOT NULL,
    `valorCifrado` LONGTEXT NOT NULL,
    `metadatos` JSON NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    PRIMARY KEY (`clave`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
