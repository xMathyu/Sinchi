/**
 * La marca, servida por la api.
 *
 * Existe por el correo: un cliente de correo no puede pintar una imagen de un
 * `data:` URI —Gmail las descarta— ni un SVG, así que el logo tiene que estar en
 * una URL pública y estable. Esta es la única que el proyecto ya tiene.
 *
 * Es la misma imagen que el icono de la app, no una copia distinta: que el
 * correo y el teléfono enseñen marcas diferentes es peor que no poner ninguna.
 */
import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard';
import { LOGO_PNG_BASE64 } from './mail/logo';

const LOGO = Buffer.from(LOGO_PNG_BASE64, 'base64');

@Controller('brand')
export class BrandController {
  @Public()
  @Get('logo.png')
  @Header('Content-Type', 'image/png')
  // Un año: la marca no cambia, y cada correo abierto pediría la imagen otra vez.
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  logo(@Res() res: Response) {
    res.end(LOGO);
  }
}
