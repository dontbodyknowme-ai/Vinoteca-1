import { FastifyInstance } from 'fastify'
import { jsonSchemas } from '../../shared/json-schemas.js'
import { requireRole } from '../auth/middleware.js'
import { orderCreateSchema } from '../../shared/schemas.js'
import { crearPedido, aplicarPago } from './service.js'
import { verificarFirmaWebhook } from './firma.js'

export const ordersRoutes = async (fastify: FastifyInstance): Promise<void> => {
  const { prisma } = fastify

  /**
   * `POST /api/orders/webhook` — la notificacion de Mercado Pago (spec 009, T4).
   *
   * **Publica**, y por eso es la unica del proyecto que **no** puede fiarse de su
   * cuerpo. Es publica porque Mercado Pago no tiene sesion de nadie.
   *
   * Las tres reglas, en orden de por que:
   *
   * 1. **Valida la firma.** Sin esto, cualquiera que descubra la URL pone
   *    `aprobado` en un pedido que no se pago. Eso no es un bug de permisos, es
   *    un pedido gratis.
   * 2. **No cree el `status` del cuerpo.** La webhook solo dice *que* cambio;
   *    el estado real se pregunta a `GET /v1/payments/:id`. Un cuerpo sin
   *    validar seria una segunda puerta de entrada al mismo problema.
   * 3. **Es idempotente.** Mercado Pago reintenta. Una segunda notificacion no
   *    puede sumar dos veces el total al `Customer`.
   */
  fastify.post(
    '/api/orders/webhook',
    { schema: jsonSchemas.orders.webhook },
    async (request, reply) => {
      const cuerpo = request.body as { type?: string; action?: string; data?: { id?: string } }
      const pagoId = cuerpo.data?.id

      /**
       * Sin `data.id` **no hay nada que aplicar**, asi que se responde antes de
       * autenticar.
       *
       * No es una puerta abierta: lo que sale de esta rama es un `202` y nada
       * mas — no se toca la base, no se llama a Mercado Pago, no cambia ningun
       * pedido. Mercado Pago manda eventos asi (los de prueba del panel de
       * configuracion, por ejemplo) y contestarles `401` los haria reintentar
       * para siempre por algo que jamas vamos a procesar.
       *
       * La regla que si se respeta: **se autentica todo lo que actua**. Un
       * `data.id` presente y una firma invalida es `401`, sin excepciones.
       */
      if (pagoId === undefined || pagoId === '') {
        return reply.status(202).send({ received: true, applied: false })
      }

      const secreta = process.env.MERCADO_PAGO_WEBHOOK_SECRET

      if (secreta === undefined || secreta.trim() === '') {
        // Sin secreto **no se acepta ninguna notificacion**, ni siquiera una
        // legitima. Aceptar sin poder validar seria hacerlo a ciegas, que es el
        // escenario que esta ruta existe para evitar.
        return reply.status(503).send({
          code: 'WEBHOOK_NOT_CONFIGURED',
          message: 'La webhook de Mercado Pago no esta configurada'
        })
      }

      const valida = verificarFirmaWebhook(
        request.headers as Record<string, string | undefined>,
        pagoId,
        secreta
      )

      if (!valida) {
        return reply.status(401).send({
          code: 'INVALID_SIGNATURE',
          message: 'Firma de la notificacion invalida'
        })
      }

      const resultado = await aplicarPago(prisma, pagoId)

      return reply.status(200).send({
        received: true,
        applied: resultado.aplicado,
        estado: resultado.estado
      })
    }
  )

  /**
   * `POST /api/orders` — el checkout. **Publico**, a diferencia del `GET` y el
   * `PATCH` de este mismo archivo: lo llama alguien que no tiene sesion, porque
   * no tiene cuenta (spec 009, RF-01).
   *
   * El unico chequeo es el **shape**: que mande vinoId y cantidad, no precios.
   * Todo lo demas lo decide `service.ts`.
   */
  fastify.post(
    '/api/orders',
    { schema: jsonSchemas.orders.create },
    async (request, reply) => {
      const cuerpo = orderCreateSchema.safeParse(request.body)

      if (!cuerpo.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Datos invalidos',
          details: cuerpo.error.flatten()
        })
      }

      // La webhook necesita una URL **absoluta** y publica. `PUBLIC_API_URL` es
      // del backend; si no esta (que no deberia pasar, `env.ts` la exige), el
      // checkout falla con un error claro en vez de mandar una Preference sin
      // `notification_url`, que es el fallo invisible: el pedido queda esperando
      // pago para siempre sin que nadie sepa por que.
      const webhookUrl = `${process.env.PUBLIC_API_URL ?? ''}/api/orders/webhook`

      const resultado = await crearPedido(prisma, request.body, webhookUrl)

      return reply.status(201).send(resultado)
    }
  )

  fastify.get(
    '/api/orders',
    {
      preHandler: requireRole('admin', 'gestor', 'vendedor'),
      schema: jsonSchemas.orders.list
    },
    async (request) => {
      const { page, limit, status, pagoEstado, dateFrom, dateTo, search } = request.query as any
      const where: any = {}

      /**
       * `in` y no `=`, y **si o si** `in`.
       *
       * El filtro del panel es un multi-select, asi que `status` llega como
       * lista: `?status=pendiente&status=enviado`. Con `=` se buscaria un
       * estado literal que es un array, Prisma no matchea nada y la tabla sale
       * vacia **sin ningun error** — el peor sintoma posible, porque parece que
       * no hay pedidos.
       *
       * Y antes de esto era peor: el backend declaraba un `z.enum` de un valor y
       * el panel mandaba `"pendiente,enviado"`, asi que marcar dos casillas daba
       * un **400**. Ver el comentario de `orderQuerySchema`.
       */
      if (status !== undefined) where.status = { in: status }

      /**
       * El filtro de pago (spec 009, D-10), con `in` y en su propio campo.
       *
       * Los dos filtros se combinan solos: Prisma pone un AND entre las claves
       * de `where`, asi que "expirados **y** pendientes de envio" sale de
       * `{ status: { in: [...] }, pagoEstado: { in: [...] } }` sin escribir un
       * `AND` explicito.
       *
       * Y si los dos se dejan sin tocar, `where` queda vacio y se ve todo: no
       * hay un `where` "por defecto" que de fato que se note.
       */
      if (pagoEstado !== undefined) where.pagoEstado = { in: pagoEstado }

      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = new Date(dateFrom + 'T00:00:00')
        if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59')
      }
      if (search) {
        where.OR = [
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { id: { contains: search } }
        ]
      }

      const [data, total] = await Promise.all([
        prisma.order.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: { select: { id: true, name: true, email: true } },
            items: { include: { wine: { select: { name: true, imageUrl: true } } } }
          }
        }),
        prisma.order.count({ where })
      ])

      return {
        data: data.map(order => ({
          ...order,
          items: order.items.map(item => ({
            wineId: item.wineId,
            wineName: item.wine.name,
            imageUrl: item.wine.imageUrl,
            quantity: item.quantity,
            price: item.price
          }))
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  )

  fastify.get(
    '/api/orders/:id',
    {
      preHandler: requireRole('admin', 'gestor', 'vendedor'),
      schema: jsonSchemas.orders.get
    },
    async (request, reply) => {
      const { id } = request.params as any

      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          customer: true,
          items: { include: { wine: { select: { name: true, imageUrl: true } } } },
          timeline: { orderBy: { createdAt: 'asc' } }
        }
      })

      if (!order) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Pedido no encontrado' })
      }

      return {
        ...order,
        items: order.items.map(item => ({
          wineId: item.wineId,
          wineName: item.wine.name,
          imageUrl: item.wine.imageUrl,
          quantity: item.quantity,
          price: item.price
        }))
      }
    }
  )

  fastify.patch(
    '/api/orders/:id',
    {
      preHandler: requireRole('admin', 'gestor', 'vendedor'),
      schema: jsonSchemas.orders.update
    },
    async (request, reply) => {
      const { id } = request.params as any
      const body = request.body as any
      const user = request.user!

      if (user.role === 'vendedor' && Object.keys(body).some(k => k !== 'status')) {
        return reply.status(403).send({ code: 'INSUFFICIENT_ROLE', message: 'Rol sin permiso para esta operación' })
      }

      const order = await prisma.order.findUnique({ where: { id } })
      if (!order) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Pedido no encontrado' })
      }

      if (body.status && order.status === body.status) {
        const full = await prisma.order.findUnique({
          where: { id },
          include: {
            customer: true,
            items: { include: { wine: { select: { name: true, imageUrl: true } } } },
            timeline: { orderBy: { createdAt: 'asc' } }
          }
        })
        return full!
      }

      await prisma.$transaction([
        prisma.order.update({
          where: { id },
          data: { status: body.status }
        }),
        ...(body.status ? [prisma.orderTimeline.create({
          data: { orderId: id, status: body.status, author: user.name }
        })] : [])
      ])

      const full = await prisma.order.findUnique({
        where: { id },
        include: {
          customer: true,
          items: { include: { wine: { select: { name: true, imageUrl: true } } } },
          timeline: { orderBy: { createdAt: 'asc' } }
        }
      })

      return full!
    }
  )
}