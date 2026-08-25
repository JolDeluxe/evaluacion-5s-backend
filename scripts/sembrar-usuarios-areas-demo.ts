/**
 * sembrar-usuarios-areas-demo.ts
 *
 * Pobla usuarios ficticios de desarrollo y los relaciona con todas las areas
 * activas, garantizando que cada area activa tenga al menos un responsable.
 *
 * USO:
 *   bun scripts/sembrar-usuarios-areas-demo.ts           --> DRY RUN (seguro, no escribe)
 *   bun scripts/sembrar-usuarios-areas-demo.ts --apply   --> aplica los cambios
 *
 * REGLAS:
 *   - No modifica al SUPER_ADMIN existente.
 *   - No toca auditorias, envios, respuestas, fotos, formularios.
 *   - Idempotente: si se ejecuta dos veces no duplica usuarios ni relaciones.
 *   - Responsabilidad y rol son dimensiones separadas (un AUDITOR puede ser
 *     responsable de un area; un ADMINISTRADOR tambien).
 *   - Estar relacionado con un area (UsuarioArea) NO implica auditar esa area;
 *     al contrario, la logica de conflicto de interes del backend BLOQUEA que
 *     un auditor audite un area donde tiene UsuarioArea registrado.
 */

import { prisma } from '../src/db';
import { hashContrasena } from '../src/utils/crypto';
import { RolUsuario } from '../src/generated/prisma/enums';

const APPLY = process.argv.includes('--apply');
const CONTRASENA_DEMO = 'Demo2026!';

interface UsuarioDemo {
  nombre: string;
  nombreUsuario: string;
  correo: string;
  rol: RolUsuario;
}

const USUARIOS_DEMO: UsuarioDemo[] = [
  { nombre: 'Andrea Lopez', nombreUsuario: 'andrea.lopez', correo: 'andrea.lopez@example.test', rol: RolUsuario.ADMINISTRADOR },
  { nombre: 'Fernando Castro', nombreUsuario: 'fernando.castro', correo: 'fernando.castro@example.test', rol: RolUsuario.ADMINISTRADOR },
  { nombre: 'Patricia Vega', nombreUsuario: 'patricia.vega', correo: 'patricia.vega@example.test', rol: RolUsuario.ADMINISTRADOR },
  { nombre: 'Carlos Mendoza', nombreUsuario: 'carlos.mendoza', correo: 'carlos.mendoza@example.test', rol: RolUsuario.AUDITOR },
  { nombre: 'Miguel Torres', nombreUsuario: 'miguel.torres', correo: 'miguel.torres@example.test', rol: RolUsuario.AUDITOR },
  { nombre: 'Laura Hernandez', nombreUsuario: 'laura.hernandez', correo: 'laura.hernandez@example.test', rol: RolUsuario.AUDITOR },
  { nombre: 'Daniel Ramirez', nombreUsuario: 'daniel.ramirez', correo: 'daniel.ramirez@example.test', rol: RolUsuario.AUDITOR },
  { nombre: 'Roberto Salinas', nombreUsuario: 'roberto.salinas', correo: 'roberto.salinas@example.test', rol: RolUsuario.AUDITOR },
  { nombre: 'Alejandro Reyes', nombreUsuario: 'alejandro.reyes', correo: 'alejandro.reyes@example.test', rol: RolUsuario.AUDITOR },
  { nombre: 'Sofia Morales', nombreUsuario: 'sofia.morales', correo: 'sofia.morales@example.test', rol: RolUsuario.AUDITOR },
];

type UsuarioLocal = { id: number; nombreUsuario: string; nombre: string; rol: RolUsuario; activo: boolean };

function distribuirAreas(
  areas: { id: number; codigo: string; nombre: string; tipo: string }[],
  usuarios: UsuarioLocal[],
): Map<number, { usuarioId: number; esResponsable: boolean }[]> {
  const mapa = new Map<number, { usuarioId: number; esResponsable: boolean }[]>();
  const admins = usuarios.filter((u) => u.rol === RolUsuario.ADMINISTRADOR);
  const auditores = usuarios.filter((u) => u.rol === RolUsuario.AUDITOR);
  const grupoAdmin = admins.length > 0 ? admins : usuarios;
  const grupoOp = auditores.length > 0 ? auditores : usuarios;
  const areasAdmin = areas.filter((a) => a.tipo === 'ADMINISTRATIVA');
  const areasOp = areas.filter((a) => a.tipo === 'OPERATIVA');
  areasAdmin.forEach((area, idx) => {
    mapa.set(area.id, [{ usuarioId: grupoAdmin[idx % grupoAdmin.length].id, esResponsable: true }]);
  });
  areasOp.forEach((area, idx) => {
    mapa.set(area.id, [{ usuarioId: grupoOp[idx % grupoOp.length].id, esResponsable: true }]);
  });
  return mapa;
}

async function main() {
  console.log('');
  console.log('====================================================');
  console.log(' SEED: Usuarios y Areas Demo');
  console.log('====================================================');
  console.log(` Modo: ${APPLY ? 'APPLY -- escribira en la BD' : 'DRY RUN -- solo lectura'}`);
  console.log('');

  const areasActivas = await prisma.area.findMany({
    where: { activo: true },
    orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
    select: { id: true, codigo: true, nombre: true, tipo: true },
  });
  console.log(`Areas activas encontradas: ${areasActivas.length}`);
  if (areasActivas.length === 0) { await prisma.$disconnect(); return; }

  const superAdmin = await prisma.usuario.findFirst({ where: { rol: RolUsuario.SUPER_ADMIN }, select: { id: true, nombreUsuario: true } });
  if (superAdmin) console.log(`SUPER_ADMIN: ${superAdmin.nombreUsuario} (id=${superAdmin.id}) -- NO sera modificado.`);

  const hash = APPLY ? await hashContrasena(CONTRASENA_DEMO) : '[hash-demo]';

  console.log('');
  console.log('--- Usuarios demo ---');
  const resultadosUsuarios: UsuarioLocal[] = [];
  for (const demo of USUARIOS_DEMO) {
    const existente = await prisma.usuario.findUnique({ where: { nombreUsuario: demo.nombreUsuario }, select: { id: true, nombreUsuario: true, nombre: true, rol: true, activo: true } });
    if (existente) {
      console.log(`  ya existe: ${demo.nombreUsuario} (${demo.rol}) id=${existente.id}`);
      resultadosUsuarios.push(existente as UsuarioLocal);
    } else {
      console.log(`  + crear: ${demo.nombre} (${demo.nombreUsuario}) / ${demo.rol}`);
      if (APPLY) {
        const creado = await prisma.usuario.create({
          data: { nombre: demo.nombre, nombreUsuario: demo.nombreUsuario, correo: demo.correo, rol: demo.rol, hashContrasena: hash, debeCambiarContrasena: true, activo: true },
          select: { id: true, nombreUsuario: true, nombre: true, rol: true, activo: true },
        });
        resultadosUsuarios.push(creado as UsuarioLocal);
      } else {
        resultadosUsuarios.push({ id: -(resultadosUsuarios.length + 1), nombreUsuario: demo.nombreUsuario, nombre: demo.nombre, rol: demo.rol, activo: true });
      }
    }
  }

  const distribucion = distribuirAreas(areasActivas, resultadosUsuarios);

  console.log('');
  console.log('--- Distribucion de responsabilidades ---');
  let areasConResponsable = 0;
  let relacionesNuevas = 0;
  let relacionesExistentes = 0;

  for (const area of areasActivas) {
    const asignaciones = distribucion.get(area.id) ?? [];
    for (const asignacion of asignaciones) {
      const usuario = resultadosUsuarios.find((u) => u.id === asignacion.usuarioId);
      const label = usuario ? `${usuario.nombre} (${usuario.nombreUsuario})` : `id=${asignacion.usuarioId}`;
      console.log(`  [${area.tipo.slice(0, 2)}] ${area.codigo.padEnd(10)} ${area.nombre.padEnd(42).slice(0, 42)} -> ${label}${asignacion.esResponsable ? ' *' : ''}`);
      if (asignacion.esResponsable) areasConResponsable++;
      if (APPLY && asignacion.usuarioId > 0) {
        const existeRel = await prisma.usuarioArea.findUnique({ where: { usuarioId_areaId: { usuarioId: asignacion.usuarioId, areaId: area.id } } });
        if (existeRel) {
          if (existeRel.esResponsable !== asignacion.esResponsable) await prisma.usuarioArea.update({ where: { id: existeRel.id }, data: { esResponsable: asignacion.esResponsable } });
          relacionesExistentes++;
        } else {
          await prisma.usuarioArea.create({ data: { usuarioId: asignacion.usuarioId, areaId: area.id, esResponsable: asignacion.esResponsable } });
          relacionesNuevas++;
        }
      }
    }
  }

  console.log('');
  console.log('--- Verificacion ---');
  if (APPLY) {
    const sinResp = await prisma.area.count({ where: { activo: true, usuariosArea: { none: { esResponsable: true } } } });
    const conResp = await prisma.area.count({ where: { activo: true, usuariosArea: { some: { esResponsable: true } } } });
    console.log(`Areas activas:             ${areasActivas.length}`);
    console.log(`Areas con responsable:     ${conResp}`);
    console.log(`Areas sin responsable:     ${sinResp}`);
    console.log(`Relaciones nuevas:         ${relacionesNuevas}`);
    console.log(`Relaciones ya existentes:  ${relacionesExistentes}`);
    if (sinResp === 0) {
      console.log('');
      console.log('OK: Todas las areas activas tienen al menos un responsable.');
    } else {
      console.log('');
      console.log('ADVERTENCIA: Quedan areas activas sin responsable.');
    }
    console.log('');
    console.log(`Contrasena demo: ${CONTRASENA_DEMO}  (debeCambiarContrasena=true)`);
  } else {
    console.log(`Areas activas:                ${areasActivas.length}`);
    console.log(`Areas que tendran responsable: ${areasConResponsable}`);
    console.log(`Areas sin responsable (dry):  ${areasActivas.length - areasConResponsable}`);
    console.log(`Usuarios a crear/verificar:   ${USUARIOS_DEMO.length}`);
    console.log('');
    console.log('DRY RUN completado. Ningun cambio fue aplicado.');
    console.log('Ejecuta con --apply para aplicar.');
  }
  console.log('');
  console.log('SUPER_ADMIN NO modificado.');
  console.log('Datos historicos NO tocados.');
  console.log('====================================================');
  await prisma.$disconnect();
}

main().catch((err) => { console.error('Error en seed:', err); prisma.$disconnect(); process.exit(1); });