import Fastify, { FastifyInstance, FastifyError, FastifyRequest, FastifyReply, onRequestHookHandler } from 'fastify'
import { ZodError } from 'zod'
import { registerPlugins } from './plugins/index.js'
import { AppError } from './utils/errors.js'
import { env } from './config/env.js'
import { registerRoutes } from './routes.js'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { logger } from './utils/logger.js'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
  interface FastifyRequest {
    requestId: string
    startTime: number
  }
}

const requestContextHook: onRequestHookHandler = async (request, reply) => {
  request.requestId = (request.headers['x-request-id'] as string) || randomUUID()
  request.startTime = Date.now()

  reply.header('x-request-id', request.requestId)

  const logRequest = () => {
    const duration = Date.now() - request.startTime
    logger.info({
      requestId: request.requestId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration,
      userId: (request.user as { id?: string } | undefined)?.id
    }, 'request completed')
  }

  reply.raw.on('finish', logRequest)
  reply.raw.on('close', logRequest)
}

/**
 * Traducciones de los errores de Fastify a algo que el panel pueda mostrar.
 *
 * El `error.message` de Fastify esta escrito para developers ("Body cannot be
 * empty when content-type is set to 'application/json'"). Se devuelve el
 * mensaje real igual - es informacion sobre la peticion del cliente, no un
 * secreto del servidor - pero estos casos se traducen porque son los que el
 * frontend produce por costumbre y los que un admin tiene que entender.
 */
const MENSAJES_FASTIFY: Record<string, string> = {
  FST_ERR_CTP_EMPTY_JSON_BODY: 'La peticion no lleva cuerpo',
  FST_ERR_CTP_INVALID_JSON_BODY: 'El cuerpo no es JSON valido',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'Formato de contenido no soportado',
  FST_ERR_VALIDATION: 'Datos inválidos',
  FST_ERR_RATE_LIMIT: 'Demasiadas peticiones, espera un momento'
}

export const buildApp = async (): Promise<FastifyInstance> => {
  const fastify = Fastify({
    // El log de Fastify va apagado a proposito: el proyecto tiene su propio
    // (`utils/logger.ts`) y los dos configurados a la vez es escribir cada
    // evento dos veces, en dos formatos. El error handler escribe al del
    // proyecto.
    logger: false,
    ajv: { customOptions: { strict: false } }
  })

  // Prisma Client **no loguea nada por defecto**. Sin esto, un fallo de
  // conexion a la base era literalmente invisible: en produccion el unico
  // sintoma era `/health` respondiendo `"db":"disconnected"` y un 503, sin
  // una sola linea que dijera por que.
  //
  // Los eventos van al logger del proyecto, por el mismo motivo que
  // `logger: false` mas arriba: una sola fuente de logs, no dos en formatos
  // distintos. Los listeners se registran aca y no despues, porque Prisma
  // lanza si un evento se emite antes de que exista alguien escuchando.
  const prisma = new PrismaClient({
    log: [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
  })

  prisma.$on('error', (evento) => {
    logger.error({ target: evento.target, message: evento.message }, 'prisma')
  })

  prisma.$on('warn', (evento) => {
    logger.warn({ target: evento.target, message: evento.message }, 'prisma')
  })

  fastify.decorate('prisma', prisma)

  // Fastify se niega a parsear un `application/json` vacio y responde
  // `FST_ERR_CTP_EMPTY_JSON_BODY`. Para `/api/auth/logout` y
  // `/api/auth/refresh`, que leen la cookie y no el cuerpo, un POST sin body
  // es la forma *correcta* de llamarlos: rechazarla obliga al cliente a
  // mandar un `{}` de adorno. Este parser acepta el cuerpo vacio como `{}` y
  // sigue fallando con el mismo error si el JSON esta mal formado.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      // El BOM se quita antes de parsear. El parser que trae Fastify lo hace
      // (por eso un archivo guardado con BOM en PowerShell andaba) y este hay
      // que replicarlo: un `JSON.parse` directo tira en `Unexpected token`.
      const limpio = typeof body === 'string' ? body.replace(/^\uFEFF/, '') : ''

      if (limpio.trim() === '') {
        done(null, {})
        return
      }
      try {
        done(null, JSON.parse(limpio))
      } catch (error) {
        // Se marca como 400 para que el error handler lo devuelva como peticion
        // invalida y no como "error interno del servidor".
        const parseError = error as Error & { statusCode?: number }
        parseError.statusCode = 400
        done(parseError, undefined)
      }
    }
  )

  await fastify.register(registerPlugins)
  fastify.addHook('onRequest', requestContextHook)

  fastify.addHook('onRequest', async (request) => {
    request.headers['x-request-id'] = request.requestId
  })

  fastify.setErrorHandler(async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Datos inválidos',
        details: error.flatten()
      })
    }

    if (error instanceof AppError) {
      request.log.warn(
        { code: error.code, statusCode: error.statusCode, requestId: request.requestId },
        error.message
      )
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && { details: error.details })
      })
    }

    // Errores propios de Fastify (parseo del cuerpo, validacion de schema,
    // rate limit) ya traen su `statusCode` correcto en 4xx. Antes caian todos
    // en el `500` de abajo, asi que un JSON malformado, un body vacio o un
    // `PATCH` sin campos se reportaban como "Error interno del servidor": el
    // cliente creia que se habia roto el backend cuando el error era suyo, y
    // el panel le mostraba un mensaje que no le servia para nada.
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      const conocido = MENSAJES_FASTIFY[error.code ?? '']

      request.log.warn(
        { code: error.code, statusCode: error.statusCode, requestId: request.requestId },
        error.message
      )
      return reply.status(error.statusCode).send({
        // El `code` tambien se traduce: el frontend y el panel comparan por
        // `code`, no por `message`, y `FST_ERR_VALIDATION` es un nombre
        // interno de Fastify que no tiene por que aparecerle a un usuario.
        code: error.code === 'FST_ERR_VALIDATION' ? 'VALIDATION_ERROR' : (error.code ?? 'BAD_REQUEST'),
        message: conocido ?? error.message,
        ...(error.validation !== undefined && { details: error.validation })
      })
    }

    // `request.log` sale del `logger: false` de arriba, asi que escribir por
    // ahi es escribir a la nada: un 500 sin registrar en produccion. Aca se
    // usa el logger del proyecto.
    logger.error(
      { err: error, requestId: request.requestId },
      'Error no manejado'
    )

    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor',
      ...(env.NODE_ENV === 'development' && { stack: error.stack })
    })
  })

  fastify.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).send({
      code: 'NOT_FOUND',
      message: `Ruta ${request.method} ${request.url} no encontrada`
    })
  })

  await registerRoutes(fastify)

  /**
   * El cron de expiracion (spec 009, T5).
   *
   * Corre **dentro del proceso**, no como un cron del sistema. Es la unica forma
   * que hay en Render free —que no tiene cronjobs— y es coherente con que las
   * migraciones tambien corran en el arranque: si el contenedor esta arriba, el
   * servidor esta; si no esta, no hay nadie a quien expirarle un pedido.
   *
   * El precio es que corre en cada instancia. Con dos en un deploy solapado, las
   * dos expiran — y por eso `expirarPedidosSinPagar` es un `updateMany`
   * condicional y no un find-then-update.
   */
  const { arrancarCronPedidos } = await import('./modules/orders/cron.js')
  const detenerCronPedidos = arrancarCronPedidos(fastify.prisma)

  /**
   * El proveedor de pagos se registra **aca**, y no dentro de `ordersRoutes`.
   *
   * La razon es que el modulo de pedidos no sabe nada de Mercado Pago: recibe un
   * `ProveedorPagos` y trabaja contra esa interfaz. Configurarlo aca deja la
   * decision de "que usar" en el arranque, donde se pueden ver las variables, y
   * deja los tests libres de registrar nada (usan el doble).
   */
  const { configurarProveedor, proveedorMercadoPago } = await import('./modules/pagos/proveedor.js')

  const token = env.MERCADO_PAGO_ACCESS_TOKEN
  if (token !== undefined && token.trim() !== '') {
    configurarProveedor(proveedorMercadoPago(token.trim()))
    logger.info('Mercado Pago configurado')
  } else {
    /**
     * Sin token **no** se registra nada, y el checkout va a fallar con
     * "Mercado Pago no esta configurado". Deliberado: un proveedor mudo que
     * devuelve un id falso haria que la app pareciera funcionar y que cada pago
     * quedara colgado esperando una webhook que nunca llega.
     */
    logger.warn(
      'MERCADO_PAGO_ACCESS_TOKEN no esta definido: el checkout va a fallar hasta que se ponga'
    )
  }

  fastify.addHook('onClose', async () => {
    // El cron se apaga **antes** de desconectar Prisma: si no, el intervalo
    // podria disparar una consulta contra una conexion ya cerrada y dejar un
    // rejection flotando.
    detenerCronPedidos()
    await fastify.prisma.$disconnect()
  })

  return fastify
}