-- CreateTable
CREATE TABLE `usuarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombreUsuario` VARCHAR(80) NOT NULL,
    `correo` VARCHAR(180) NULL,
    `telefonoE164` VARCHAR(24) NULL,
    `nombre` VARCHAR(160) NOT NULL,
    `hashContrasena` VARCHAR(255) NOT NULL,
    `rol` ENUM('SUPER_ADMIN', 'ADMINISTRADOR', 'AUDITOR') NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `debeCambiarContrasena` BOOLEAN NOT NULL DEFAULT false,
    `ultimoInicioSesionEn` DATETIME(3) NULL,
    `contrasenaCambiadaEn` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `usuarios_nombreUsuario_key`(`nombreUsuario`),
    UNIQUE INDEX `usuarios_correo_key`(`correo`),
    INDEX `usuarios_rol_activo_idx`(`rol`, `activo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sesiones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `hashToken` CHAR(64) NOT NULL,
    `expiraEn` DATETIME(3) NOT NULL,
    `ultimoUsoEn` DATETIME(3) NULL,
    `revocadoEn` DATETIME(3) NULL,
    `agenteUsuario` VARCHAR(512) NULL,
    `nombreDispositivo` VARCHAR(120) NULL,
    `direccionIp` VARCHAR(64) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sesiones_hashToken_key`(`hashToken`),
    INDEX `sesiones_usuarioId_idx`(`usuarioId`),
    INDEX `sesiones_expiraEn_idx`(`expiraEn`),
    INDEX `sesiones_usuarioId_revocadoEn_expiraEn_idx`(`usuarioId`, `revocadoEn`, `expiraEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tokens_restablecimiento_contrasena` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `hashToken` CHAR(64) NOT NULL,
    `expiraEn` DATETIME(3) NOT NULL,
    `usadoEn` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tokens_restablecimiento_contrasena_hashToken_key`(`hashToken`),
    INDEX `tokens_restablecimiento_contrasena_usuarioId_idx`(`usuarioId`),
    INDEX `tokens_restablecimiento_contrasena_expiraEn_idx`(`expiraEn`),
    INDEX `tokens_restablecimiento_contrasena_usuarioId_usadoEn_expiraE_idx`(`usuarioId`, `usadoEn`, `expiraEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `areas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(50) NOT NULL,
    `nombre` VARCHAR(160) NOT NULL,
    `tipo` ENUM('ADMINISTRATIVA', 'OPERATIVA') NOT NULL,
    `areaPadreId` INTEGER NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `codigoVerificacion` VARCHAR(16) NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `areas_codigo_key`(`codigo`),
    UNIQUE INDEX `areas_codigoVerificacion_key`(`codigoVerificacion`),
    INDEX `areas_tipo_activo_idx`(`tipo`, `activo`),
    INDEX `areas_areaPadreId_idx`(`areaPadreId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usuarios_areas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `areaId` INTEGER NOT NULL,
    `esPrincipal` BOOLEAN NOT NULL DEFAULT false,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `usuarios_areas_usuarioId_idx`(`usuarioId`),
    INDEX `usuarios_areas_areaId_idx`(`areaId`),
    UNIQUE INDEX `usuarios_areas_usuarioId_areaId_key`(`usuarioId`, `areaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `formularios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(160) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `descripcion` TEXT NULL,
    `alcance` ENUM('ADMINISTRATIVO', 'OPERATIVO', 'AMBOS') NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `creadoPorId` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `formularios_slug_key`(`slug`),
    INDEX `formularios_alcance_activo_idx`(`alcance`, `activo`),
    INDEX `formularios_creadoPorId_idx`(`creadoPorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `versiones_formulario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `formularioId` INTEGER NOT NULL,
    `numeroVersion` INTEGER NOT NULL,
    `activa` BOOLEAN NOT NULL DEFAULT true,
    `creadoPorId` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `versiones_formulario_formularioId_activa_idx`(`formularioId`, `activa`),
    INDEX `versiones_formulario_creadoPorId_idx`(`creadoPorId`),
    UNIQUE INDEX `versiones_formulario_formularioId_numeroVersion_key`(`formularioId`, `numeroVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `secciones_formulario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `versionFormularioId` INTEGER NOT NULL,
    `claveEstable` CHAR(36) NOT NULL,
    `nombre` VARCHAR(160) NOT NULL,
    `objetivo` TEXT NULL,
    `imagenPublicId` VARCHAR(255) NULL,
    `imagenAlt` VARCHAR(255) NULL,
    `orden` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `secciones_formulario_versionFormularioId_orden_idx`(`versionFormularioId`, `orden`),
    UNIQUE INDEX `secciones_formulario_versionFormularioId_claveEstable_key`(`versionFormularioId`, `claveEstable`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `preguntas_formulario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `seccionFormularioId` INTEGER NOT NULL,
    `claveEstable` CHAR(36) NOT NULL,
    `texto` TEXT NOT NULL,
    `orden` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `preguntas_formulario_seccionFormularioId_orden_idx`(`seccionFormularioId`, `orden`),
    UNIQUE INDEX `preguntas_formulario_seccionFormularioId_claveEstable_key`(`seccionFormularioId`, `claveEstable`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ciclos_auditoria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `anio` INTEGER NOT NULL,
    `mes` INTEGER NOT NULL,
    `numeroCorte` INTEGER NOT NULL,
    `nombre` VARCHAR(160) NULL,
    `estado` ENUM('BORRADOR', 'PUBLICADO', 'CERRADO', 'ARCHIVADO') NOT NULL DEFAULT 'BORRADOR',
    `iniciaEn` DATETIME(3) NOT NULL,
    `terminaEn` DATETIME(3) NOT NULL,
    `publicadoEn` DATETIME(3) NULL,
    `cerradoEn` DATETIME(3) NULL,
    `creadoPorId` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `ciclos_auditoria_estado_iniciaEn_terminaEn_idx`(`estado`, `iniciaEn`, `terminaEn`),
    INDEX `ciclos_auditoria_creadoPorId_idx`(`creadoPorId`),
    UNIQUE INDEX `ciclos_auditoria_anio_mes_numeroCorte_key`(`anio`, `mes`, `numeroCorte`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `formularios_ciclo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cicloAuditoriaId` INTEGER NOT NULL,
    `tipoArea` ENUM('ADMINISTRATIVA', 'OPERATIVA') NOT NULL,
    `versionFormularioId` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `formularios_ciclo_versionFormularioId_idx`(`versionFormularioId`),
    UNIQUE INDEX `formularios_ciclo_cicloAuditoriaId_tipoArea_key`(`cicloAuditoriaId`, `tipoArea`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `objetivos_auditoria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cicloAuditoriaId` INTEGER NOT NULL,
    `formularioCicloId` INTEGER NOT NULL,
    `areaId` INTEGER NOT NULL,
    `codigoAreaSnapshot` VARCHAR(50) NOT NULL,
    `nombreAreaSnapshot` VARCHAR(160) NOT NULL,
    `tipoAreaSnapshot` ENUM('ADMINISTRATIVA', 'OPERATIVA') NOT NULL,
    `envioResultadoId` INTEGER NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `objetivos_auditoria_envioResultadoId_key`(`envioResultadoId`),
    INDEX `objetivos_auditoria_cicloAuditoriaId_tipoAreaSnapshot_idx`(`cicloAuditoriaId`, `tipoAreaSnapshot`),
    INDEX `objetivos_auditoria_areaId_cicloAuditoriaId_idx`(`areaId`, `cicloAuditoriaId`),
    INDEX `objetivos_auditoria_formularioCicloId_idx`(`formularioCicloId`),
    UNIQUE INDEX `objetivos_auditoria_cicloAuditoriaId_areaId_key`(`cicloAuditoriaId`, `areaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asignaciones_auditoria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `objetivoAuditoriaId` INTEGER NOT NULL,
    `auditorId` INTEGER NOT NULL,
    `asignadoPorId` INTEGER NOT NULL,
    `estado` ENUM('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA', 'VENCIDA') NOT NULL DEFAULT 'PENDIENTE',
    `asignadoEn` DATETIME(3) NULL,
    `venceEn` DATETIME(3) NOT NULL,
    `iniciadoEn` DATETIME(3) NULL,
    `completadoEn` DATETIME(3) NULL,
    `canceladoEn` DATETIME(3) NULL,
    `motivoCancelacion` TEXT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `asignaciones_auditoria_auditorId_estado_venceEn_idx`(`auditorId`, `estado`, `venceEn`),
    INDEX `asignaciones_auditoria_objetivoAuditoriaId_estado_idx`(`objetivoAuditoriaId`, `estado`),
    INDEX `asignaciones_auditoria_asignadoPorId_idx`(`asignadoPorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enlaces_invitado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asignacionAuditoriaId` INTEGER NOT NULL,
    `creadoPorId` INTEGER NOT NULL,
    `hashToken` CHAR(64) NOT NULL,
    `expiraEn` DATETIME(3) NOT NULL,
    `usadoEn` DATETIME(3) NULL,
    `revocadoEn` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `enlaces_invitado_hashToken_key`(`hashToken`),
    INDEX `enlaces_invitado_asignacionAuditoriaId_idx`(`asignacionAuditoriaId`),
    INDEX `enlaces_invitado_creadoPorId_idx`(`creadoPorId`),
    INDEX `enlaces_invitado_expiraEn_revocadoEn_idx`(`expiraEn`, `revocadoEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `envios_auditoria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `identificadorCliente` CHAR(36) NOT NULL,
    `objetivoAuditoriaId` INTEGER NOT NULL,
    `asignacionAuditoriaId` INTEGER NULL,
    `enviadoPorUsuarioId` INTEGER NULL,
    `enlaceInvitadoId` INTEGER NULL,
    `nombreAuditorSnapshot` VARCHAR(160) NOT NULL,
    `origen` ENUM('USUARIO', 'INVITADO') NOT NULL,
    `puntajeObtenido` DECIMAL(10, 4) NOT NULL,
    `puntajePosible` DECIMAL(10, 4) NOT NULL,
    `porcentaje` DECIMAL(10, 4) NOT NULL,
    `finalizadoEn` DATETIME(3) NOT NULL,
    `verificadoEn` DATETIME(3) NOT NULL,
    `recibidoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `invalidadoEn` DATETIME(3) NULL,
    `motivoInvalidacion` TEXT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `envios_auditoria_identificadorCliente_key`(`identificadorCliente`),
    INDEX `envios_auditoria_objetivoAuditoriaId_idx`(`objetivoAuditoriaId`),
    INDEX `envios_auditoria_asignacionAuditoriaId_idx`(`asignacionAuditoriaId`),
    INDEX `envios_auditoria_enviadoPorUsuarioId_finalizadoEn_idx`(`enviadoPorUsuarioId`, `finalizadoEn` DESC),
    INDEX `envios_auditoria_recibidoEn_idx`(`recibidoEn` DESC),
    INDEX `envios_auditoria_enlaceInvitadoId_idx`(`enlaceInvitadoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `respuestas_auditoria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `envioAuditoriaId` INTEGER NOT NULL,
    `preguntaFormularioId` INTEGER NOT NULL,
    `cumple` BOOLEAN NOT NULL,
    `hallazgo` TEXT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `respuestas_auditoria_preguntaFormularioId_idx`(`preguntaFormularioId`),
    UNIQUE INDEX `respuestas_auditoria_envioAuditoriaId_preguntaFormularioId_key`(`envioAuditoriaId`, `preguntaFormularioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fotos_auditoria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `identificadorCliente` CHAR(36) NOT NULL,
    `respuestaAuditoriaId` INTEGER NOT NULL,
    `publicIdCloudinary` VARCHAR(255) NOT NULL,
    `assetIdCloudinary` VARCHAR(255) NULL,
    `formato` VARCHAR(20) NULL,
    `tipoMime` VARCHAR(120) NULL,
    `bytes` INTEGER NULL,
    `ancho` INTEGER NULL,
    `alto` INTEGER NULL,
    `capturadaEn` DATETIME(3) NULL,
    `subidaEn` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fotos_auditoria_identificadorCliente_key`(`identificadorCliente`),
    INDEX `fotos_auditoria_respuestaAuditoriaId_idx`(`respuestaAuditoriaId`),
    INDEX `fotos_auditoria_publicIdCloudinary_idx`(`publicIdCloudinary`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suscripciones_push` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `endpoint` TEXT NOT NULL,
    `hashEndpoint` CHAR(64) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `nombreDispositivo` VARCHAR(120) NULL,
    `agenteUsuario` VARCHAR(512) NULL,
    `expiraEn` DATETIME(3) NULL,
    `ultimoUsoEn` DATETIME(3) NULL,
    `revocadoEn` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `suscripciones_push_hashEndpoint_key`(`hashEndpoint`),
    INDEX `suscripciones_push_usuarioId_revocadoEn_idx`(`usuarioId`, `revocadoEn`),
    INDEX `suscripciones_push_expiraEn_idx`(`expiraEn`),
    INDEX `suscripciones_push_ultimoUsoEn_idx`(`ultimoUsoEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notificaciones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `claveDedupe` VARCHAR(191) NULL,
    `tipo` ENUM('NUEVA_ASIGNACION', 'RECORDATORIO', 'VENCIMIENTO_PROXIMO', 'AUDITORIA_VENCIDA', 'RESULTADO_PUBLICADO', 'APROBACION_PENDIENTE', 'SISTEMA') NOT NULL,
    `titulo` VARCHAR(180) NOT NULL,
    `mensaje` TEXT NOT NULL,
    `ruta` VARCHAR(255) NULL,
    `datos` JSON NULL,
    `leidaEn` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notificaciones_claveDedupe_key`(`claveDedupe`),
    INDEX `notificaciones_usuarioId_leidaEn_creadoEn_idx`(`usuarioId`, `leidaEn`, `creadoEn` DESC),
    INDEX `notificaciones_tipo_creadoEn_idx`(`tipo`, `creadoEn` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entregas_notificacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `notificacionId` INTEGER NOT NULL,
    `suscripcionPushId` INTEGER NULL,
    `canal` ENUM('PUSH', 'CORREO', 'WHATSAPP') NOT NULL,
    `estado` ENUM('PENDIENTE', 'PROCESANDO', 'ENVIADA', 'FALLIDA', 'CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
    `destinoSnapshot` VARCHAR(255) NULL,
    `destinoHash` CHAR(64) NULL,
    `programadoEn` DATETIME(3) NOT NULL,
    `proximoIntentoEn` DATETIME(3) NULL,
    `bloqueadoHasta` DATETIME(3) NULL,
    `bloqueadoPor` VARCHAR(120) NULL,
    `intentos` INTEGER NOT NULL DEFAULT 0,
    `enviadoEn` DATETIME(3) NULL,
    `ultimoIntentoEn` DATETIME(3) NULL,
    `idMensajeExterno` VARCHAR(255) NULL,
    `ultimoError` TEXT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `entregas_notificacion_estado_programadoEn_idx`(`estado`, `programadoEn`),
    INDEX `entregas_notificacion_estado_proximoIntentoEn_idx`(`estado`, `proximoIntentoEn`),
    INDEX `entregas_notificacion_estado_bloqueadoHasta_idx`(`estado`, `bloqueadoHasta`),
    INDEX `entregas_notificacion_suscripcionPushId_idx`(`suscripcionPushId`),
    INDEX `entregas_notificacion_notificacionId_canal_idx`(`notificacionId`, `canal`),
    UNIQUE INDEX `entregas_notificacion_notificacionId_canal_destinoHash_key`(`notificacionId`, `canal`, `destinoHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registros_auditoria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NULL,
    `accion` VARCHAR(120) NOT NULL,
    `tipoEntidad` VARCHAR(120) NOT NULL,
    `idEntidad` INTEGER NULL,
    `datosAnteriores` JSON NULL,
    `datosNuevos` JSON NULL,
    `direccionIp` VARCHAR(64) NULL,
    `agenteUsuario` VARCHAR(512) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `registros_auditoria_usuarioId_creadoEn_idx`(`usuarioId`, `creadoEn` DESC),
    INDEX `registros_auditoria_tipoEntidad_idEntidad_creadoEn_idx`(`tipoEntidad`, `idEntidad`, `creadoEn` DESC),
    INDEX `registros_auditoria_accion_creadoEn_idx`(`accion`, `creadoEn` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sesiones` ADD CONSTRAINT `sesiones_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tokens_restablecimiento_contrasena` ADD CONSTRAINT `tokens_restablecimiento_contrasena_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `areas` ADD CONSTRAINT `areas_areaPadreId_fkey` FOREIGN KEY (`areaPadreId`) REFERENCES `areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `usuarios_areas` ADD CONSTRAINT `usuarios_areas_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `usuarios_areas` ADD CONSTRAINT `usuarios_areas_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `formularios` ADD CONSTRAINT `formularios_creadoPorId_fkey` FOREIGN KEY (`creadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `versiones_formulario` ADD CONSTRAINT `versiones_formulario_formularioId_fkey` FOREIGN KEY (`formularioId`) REFERENCES `formularios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `versiones_formulario` ADD CONSTRAINT `versiones_formulario_creadoPorId_fkey` FOREIGN KEY (`creadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `secciones_formulario` ADD CONSTRAINT `secciones_formulario_versionFormularioId_fkey` FOREIGN KEY (`versionFormularioId`) REFERENCES `versiones_formulario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preguntas_formulario` ADD CONSTRAINT `preguntas_formulario_seccionFormularioId_fkey` FOREIGN KEY (`seccionFormularioId`) REFERENCES `secciones_formulario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ciclos_auditoria` ADD CONSTRAINT `ciclos_auditoria_creadoPorId_fkey` FOREIGN KEY (`creadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `formularios_ciclo` ADD CONSTRAINT `formularios_ciclo_cicloAuditoriaId_fkey` FOREIGN KEY (`cicloAuditoriaId`) REFERENCES `ciclos_auditoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `formularios_ciclo` ADD CONSTRAINT `formularios_ciclo_versionFormularioId_fkey` FOREIGN KEY (`versionFormularioId`) REFERENCES `versiones_formulario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `objetivos_auditoria` ADD CONSTRAINT `objetivos_auditoria_cicloAuditoriaId_fkey` FOREIGN KEY (`cicloAuditoriaId`) REFERENCES `ciclos_auditoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `objetivos_auditoria` ADD CONSTRAINT `objetivos_auditoria_formularioCicloId_fkey` FOREIGN KEY (`formularioCicloId`) REFERENCES `formularios_ciclo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `objetivos_auditoria` ADD CONSTRAINT `objetivos_auditoria_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `objetivos_auditoria` ADD CONSTRAINT `objetivos_auditoria_envioResultadoId_fkey` FOREIGN KEY (`envioResultadoId`) REFERENCES `envios_auditoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asignaciones_auditoria` ADD CONSTRAINT `asignaciones_auditoria_objetivoAuditoriaId_fkey` FOREIGN KEY (`objetivoAuditoriaId`) REFERENCES `objetivos_auditoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asignaciones_auditoria` ADD CONSTRAINT `asignaciones_auditoria_auditorId_fkey` FOREIGN KEY (`auditorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asignaciones_auditoria` ADD CONSTRAINT `asignaciones_auditoria_asignadoPorId_fkey` FOREIGN KEY (`asignadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enlaces_invitado` ADD CONSTRAINT `enlaces_invitado_asignacionAuditoriaId_fkey` FOREIGN KEY (`asignacionAuditoriaId`) REFERENCES `asignaciones_auditoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enlaces_invitado` ADD CONSTRAINT `enlaces_invitado_creadoPorId_fkey` FOREIGN KEY (`creadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `envios_auditoria` ADD CONSTRAINT `envios_auditoria_objetivoAuditoriaId_fkey` FOREIGN KEY (`objetivoAuditoriaId`) REFERENCES `objetivos_auditoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `envios_auditoria` ADD CONSTRAINT `envios_auditoria_asignacionAuditoriaId_fkey` FOREIGN KEY (`asignacionAuditoriaId`) REFERENCES `asignaciones_auditoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `envios_auditoria` ADD CONSTRAINT `envios_auditoria_enviadoPorUsuarioId_fkey` FOREIGN KEY (`enviadoPorUsuarioId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `envios_auditoria` ADD CONSTRAINT `envios_auditoria_enlaceInvitadoId_fkey` FOREIGN KEY (`enlaceInvitadoId`) REFERENCES `enlaces_invitado`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `respuestas_auditoria` ADD CONSTRAINT `respuestas_auditoria_envioAuditoriaId_fkey` FOREIGN KEY (`envioAuditoriaId`) REFERENCES `envios_auditoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `respuestas_auditoria` ADD CONSTRAINT `respuestas_auditoria_preguntaFormularioId_fkey` FOREIGN KEY (`preguntaFormularioId`) REFERENCES `preguntas_formulario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fotos_auditoria` ADD CONSTRAINT `fotos_auditoria_respuestaAuditoriaId_fkey` FOREIGN KEY (`respuestaAuditoriaId`) REFERENCES `respuestas_auditoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suscripciones_push` ADD CONSTRAINT `suscripciones_push_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificaciones` ADD CONSTRAINT `notificaciones_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entregas_notificacion` ADD CONSTRAINT `entregas_notificacion_notificacionId_fkey` FOREIGN KEY (`notificacionId`) REFERENCES `notificaciones`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entregas_notificacion` ADD CONSTRAINT `entregas_notificacion_suscripcionPushId_fkey` FOREIGN KEY (`suscripcionPushId`) REFERENCES `suscripciones_push`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registros_auditoria` ADD CONSTRAINT `registros_auditoria_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
