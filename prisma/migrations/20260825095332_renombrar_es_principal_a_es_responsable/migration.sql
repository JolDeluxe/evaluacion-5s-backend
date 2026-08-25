-- Renombra el campo esPrincipal → esResponsable en usuarios_areas.
-- El campo antes indicaba "área principal del usuario"; ahora expresa
-- explícitamente "este usuario es responsable de esta área", que es la
-- semántica de negocio correcta para el módulo de gestión de áreas.
--
-- La tabla estaba vacía en el momento de esta migración (ningún registro
-- de usuarios_areas existente), por lo que no hay datos en riesgo.
ALTER TABLE `usuarios_areas`
  CHANGE `esPrincipal` `esResponsable` TINYINT(1) NOT NULL DEFAULT 0;
