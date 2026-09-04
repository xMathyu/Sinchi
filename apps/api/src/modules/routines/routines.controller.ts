/**
 * La biblioteca, del lado del gimnasio.
 *
 * Misma reparticion que la oferta y los eventos: **escribir es del DUENO** —lo
 * que se publica hacia fuera es la cara de la escuela, y decidir que se regala y
 * que se guarda para alumnos es una decision comercial— y **leer es de todo el
 * staff**, porque a recepcion le preguntan por el video de la clase del sabado
 * tanto como por el precio.
 *
 * Publicar y cambiar el publico son rutas propias, no un campo mas del editor: a
 * las dos se llega desde la lista, con un toque, y son justo las que el dueno
 * cambia de opinion sobre ellas.
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession, OwnerOnly, StaffOnly } from '../../auth/auth.guard';
import { assertStaffSession, type Session } from '../../auth/session';
import { parseWith } from '../../common/zod.pipe';
import { RoutinesService } from './routines.service';

/**
 * Aqui solo se acota la FORMA. Que un enlace de YouTube sea valido, o que una
 * rutina sin video, sin explicacion y sin pasos no sea nada, vive en
 * `checkRoutineDraft` — en el dominio, porque la misma regla apaga el boton en
 * la app.
 */
const itemSchema = z.object({
  title: z.string().min(1).max(120),
  instructions: z.string().max(4000).nullable().default(null),
  videoUrl: z.string().max(600).nullable().default(null),
  /** El video subido. Que no venga junto con `videoUrl` lo decide el dominio. */
  videoAssetId: z.string().uuid().nullable().default(null),
  prescription: z.string().max(120).nullable().default(null),
});

const routineSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(1000).nullable().default(null),
  videoUrl: z.string().max(600).nullable().default(null),
  videoAssetId: z.string().uuid().nullable().default(null),
  level: z.enum(['beginner', 'intermediate', 'advanced']).nullable().default(null),
  visibility: z.enum(['public', 'members']),
  published: z.boolean().default(false),
  // El tope de verdad lo pone `ROUTINE_MAX_ITEMS`; este solo evita que un
  // cuerpo de diez mil pasos llegue a parsearse entero.
  items: z.array(itemSchema).max(100).default([]),
});

const statusSchema = z.object({ status: z.enum(['draft', 'published']) });

/**
 * Abrir una subida.
 *
 * `sizeBytes` es opcional y NO es la ultima palabra: sirve para rechazar un
 * archivo de 900 MB antes de gastar la subida entera. El tope de verdad va
 * firmado en la URL y lo aplica el almacenamiento.
 */
const uploadSchema = z.object({
  contentType: z.string().min(3).max(80),
  sizeBytes: z.number().int().positive().optional(),
  originalName: z.string().max(200).optional(),
});
const visibilitySchema = z.object({ visibility: z.enum(['public', 'members']) });

@StaffOnly()
@Controller('staff/routines')
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  /** Todas, borradores incluidos: son del local. */
  @Get()
  list(@CurrentSession() session: Session) {
    return this.routines.library(assertStaffSession(session).tenantId, 'staff');
  }

  @Get(':routineId')
  find(
    @CurrentSession() session: Session,
    @Param('routineId', ParseUUIDPipe) routineId: string,
  ) {
    return this.routines.view(assertStaffSession(session).tenantId, routineId, 'staff');
  }

  // -------------------------------------------------------------------------
  // Subir un video
  // -------------------------------------------------------------------------

  /**
   * Pide permiso para subir UN archivo y devuelve la URL firmada.
   *
   * El video no pasa por la api: el teléfono sube directo al bucket con esa URL.
   *
   * Va declarada ANTES que `POST :routineId`, y no es cuestión de orden de
   * lectura: Nest resuelve por orden de declaración, así que con `:routineId`
   * delante, «videos» entra ahí como si fuera un id y `ParseUUIDPipe` contesta
   * 400. Es la misma trampa que `/gyms/signup` documenta, y aquí la encontró el
   * e2e después de que un comentario afirmara justo lo contrario.
   */
  @OwnerOnly()
  @Post('videos')
  createUpload(
    @CurrentSession() session: Session,
    @Body(parseWith(uploadSchema)) body: z.infer<typeof uploadSchema>,
  ) {
    return this.routines.createUpload(assertStaffSession(session).tenantId, body);
  }

  /** «Ya subí». Se comprueba contra el almacenamiento, no se cree. */
  @OwnerOnly()
  @Post('videos/:assetId/ready')
  confirmUpload(
    @CurrentSession() session: Session,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.routines.confirmUpload(assertStaffSession(session).tenantId, assetId);
  }

  @OwnerOnly()
  @Post()
  create(
    @CurrentSession() session: Session,
    @Body(parseWith(routineSchema)) body: z.infer<typeof routineSchema>,
  ) {
    return this.routines.create(assertStaffSession(session).tenantId, body);
  }

  @OwnerOnly()
  @Post(':routineId')
  update(
    @CurrentSession() session: Session,
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Body(parseWith(routineSchema)) body: z.infer<typeof routineSchema>,
  ) {
    return this.routines.update(assertStaffSession(session).tenantId, routineId, body);
  }

  @OwnerOnly()
  @Post(':routineId/status')
  setStatus(
    @CurrentSession() session: Session,
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Body(parseWith(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    return this.routines.setStatus(assertStaffSession(session).tenantId, routineId, body.status);
  }

  /** De escaparate a contenido de alumnos, y al reves, sin abrir el editor. */
  @OwnerOnly()
  @Post(':routineId/visibility')
  setVisibility(
    @CurrentSession() session: Session,
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Body(parseWith(visibilitySchema)) body: z.infer<typeof visibilitySchema>,
  ) {
    return this.routines.setVisibility(
      assertStaffSession(session).tenantId,
      routineId,
      body.visibility,
    );
  }

  /** Solo si está sin publicar: ver `RoutinesService.remove`. */
  @OwnerOnly()
  @Delete(':routineId')
  remove(
    @CurrentSession() session: Session,
    @Param('routineId', ParseUUIDPipe) routineId: string,
  ) {
    return this.routines.remove(assertStaffSession(session).tenantId, routineId);
  }
}
