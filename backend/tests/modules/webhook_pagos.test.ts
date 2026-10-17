import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * La webhook de Mercado Pago (spec 009, T4).
 *
 * Es la **unica ruta publica del proyecto que no puede fiarse de su cuerpo**.
 * Es publica porque Mercado Pago no tiene sesion de nadie, y por eso las tres
 * reglas de aca son todas sobre "no creas lo que te mandan":
 *
 * 1. la firma se valida contra el secreto
 * 2. el estado se pregunta a Mercado Pago, no se lee del cuerpo
 * 3. una reentrega no aplica dos veces
 */

const prismaFalso = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  orderTimeline: { create: vi.fn() },
  customer: { update: vi.fn() },
  wine: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
  $on: vi.fn(),
  $disconnect: vi.fn(),
  $transaction: vi.fn()
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => prismaFalso)
}))

const { buildApp } = await import('../../src/app.js')
const { ProveedorPagosFalso, configurarProveedor } = await import(
  '../../src/modules/pagos/proveedor.js'
)
const { firmarWebhook } = await import('../../src/modules/orders/firma.js')

const SECRETO = 'secreto-de-la-webhook-para-los-tests'
const PAGO_ID = '99887766'
const REQUEST_ID = 'req-1234'

let app: FastifyInstance
let pagos: ProveedorPagosFalso
const secretoOriginal = process.env.MERCADO_PAGO_WEBHOOK_SECRET

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = SECRETO

  pagos = new ProveedorPagosFalso()
  configurarProveedor(pagos)

  prismaFalso.order.findUnique.mockResolvedValue({
    id: 'ord_1',
    customerId: 'cus_1',
    total: 15000,
    pagoEstado: 'pendiente'
  })
  prismaFalso.order.updateMany.mockResolvedValue({ count: 1 })
  prismaFalso.orderTimeline.create.mockResolvedValue({})
  prismaFalso.customer.update.mockResolvedValue({})
})

afterEach(() => {
  if (secretoOriginal === undefined) delete process.env.MERCADO_PAGO_WEBHOOK_SECRET
  else process.env.MERCADO_PAGO_WEBHOOK_SECRET = secretoOriginal
})

/** Una notificacion **bien firmada**, con el estado que se le pida. */
const notificar = async (estadoRemoto: string, opciones: { firmar?: boolean } = {}) => {
  const ts = '1730000000'
  pagos.estados[PAGO_ID] = { id: PAGO_ID, estado: estadoRemoto, monto: 15000, fechaAprobacion: null }

  const headers: Record<string, string> = { 'content-type': 'application/json' }

  if (opciones.firmar !== false) {
    headers['x-signature'] = firmarWebhook({ id: PAGO_ID, requestId: REQUEST_ID, ts }, SECRETO)
    headers['x-request-id'] = REQUEST_ID
  }

  return app.inject({
    method: 'POST',
    url: '/api/orders/webhook',
    headers,
    // El cuerpo **miente a proposito**: dice que el pago no esta aprobado,
    // aunque el estado real diga que si. Si el handler le creyera al cuerpo, el
    // test de "aprobado" pasaria igual y no probaria nada.
    payload: { type: 'payment', action: 'payment.updated', data: { id: PAGO_ID }, status: 'rejected' }
  })
}

describe('la firma', () => {
  it('una firma valida se acepta', async () => {
    expect((await notificar('approved')).statusCode).toBe(200)
  })

  it('sin firma es 401', async () => {
    const res = await notificar('approved', { firmar: false })

    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('INVALID_SIGNATURE')
  })

  it('una firma de otro secreto es 401', async () => {
    const ts = '1730000000'
    pagos.estados[PAGO_ID] = { id: PAGO_ID, estado: 'approved', monto: 1, fechaAprobacion: null }

    const res = await app.inject({
      method: 'POST',
      url: '/api/orders/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': firmarWebhook({ id: PAGO_ID, requestId: REQUEST_ID, ts }, 'otro-secreto'),
        'x-request-id': REQUEST_ID
      },
      payload: { data: { id: PAGO_ID } }
    })

    expect(res.statusCode).toBe(401)
  })

  it('una firma de OTRO id es 401', async () => {
    // La firma cubre el `data.id`. Si alguien cambia el id en el camino para
    // apuntar a otro pedido, la firma deja de coincidir: es lo que la protege.
    const ts = '1730000000'
    pagos.estados['111'] = { id: '111', estado: 'approved', monto: 1, fechaAprobacion: null }

    const res = await app.inject({
      method: 'POST',
      url: '/api/orders/webhook',
      headers: {
        'content-type': 'application/json',
        // Firmada para el pago 111, pero el cuerpo dice que es el 99887766.
        'x-signature': firmarWebhook({ id: '111', requestId: REQUEST_ID, ts }, SECRETO),
        'x-request-id': REQUEST_ID
      },
      payload: { data: { id: PAGO_ID } }
    })

    expect(res.statusCode).toBe(401)
  })

  it('sin secreto configurado es 503, no 401', async () => {
    // Sin secreto **no se acepta ninguna** notificacion, ni una legitima. Aceptar
    // sin poder validar es el escenario que esta ruta existe para evitar.
    delete process.env.MERCADO_PAGO_WEBHOOK_SECRET

    const res = await notificar('approved')

    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('WEBHOOK_NOT_CONFIGURED')
  })

  it('el cuerpo se lee, pero **nada** se actualiza sin firma valida', async () => {
    await notificar('approved', { firmar: false })

    expect(pagos.consulted).toEqual([])
    expect(prismaFalso.order.updateMany).not.toHaveBeenCalled()
    expect(prismaFalso.customer.update).not.toHaveBeenCalled()
  })
})

describe('el estado sale de Mercado Pago, no del cuerpo', () => {
  it('pregunta a la pasarela por el estado real', async () => {
    await notificar('approved')

    // El cuerpo decia `rejected` en todos los tests, a proposito.
    expect(pagos.consulted).toEqual([PAGO_ID])
  })

  it('approved queda aprobado aunque el cuerpo diga rejected', async () => {
    const res = await notificar('approved')

    expect(prismaFalso.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pagoEstado: 'aprobado' } })
    )
    expect(res.json().estado).toBe('aprobado')
  })

  it('rejected queda rechazado', async () => {
    await notificar('rejected')

    expect(prismaFalso.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pagoEstado: 'rechazado' } })
    )
  })

  it.each(['in_process', 'pending', 'authorized'])(
    '%s NO es un rechazo: el pedido queda pendiente',
    async (estado) => {
      // El comprador puede estar esperando que el banco confirme. Marcarlo
      // `rechazado` seria mentir, y `aprobado` seria peor.
      await notificar(estado)

      expect(prismaFalso.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { pagoEstado: 'pendiente' } })
      )
    }
  )

  it('un estado desconocido deja el pedido como esta, y responde 200', async () => {
    // Devolver 4xx haria que Mercado Pago reintentara una notificacion que no
    // vamos a entender nunca.
    const res = await notificar('un_estado_del_futuro')

    expect(res.statusCode).toBe(200)
    expect(res.json().applied).toBe(false)
    expect(prismaFalso.order.updateMany).not.toHaveBeenCalled()
  })
})

describe('el pago aprobado mueve las metricas del cliente', () => {
  it('suma el total y cuenta el pedido', async () => {
    await notificar('approved')

    expect(prismaFalso.customer.update).toHaveBeenCalledWith({
      where: { id: 'cus_1' },
      data: {
        totalOrders: { increment: 1 },
        totalSpent: { increment: 15000 },
        lastOrderAt: expect.any(Date)
      }
    })
  })

  it('un pago rechazado NO suma nada al cliente', async () => {
    // El comprador no compro. Sumar `totalSpent` aca seria el CRM mostrando
    // plata que la tienda no cobro.
    await notificar('rejected')

    expect(prismaFalso.customer.update).not.toHaveBeenCalled()
  })

  it('deja entrada en el historial, blaming a Mercado Pago', async () => {
    await notificar('approved')

    expect(prismaFalso.orderTimeline.create).toHaveBeenCalledWith({
      data: { orderId: 'ord_1', pagoEstado: 'aprobado', origen: 'Mercado Pago' }
    })
  })

  it('la entrada de pago NO lleva `status` de envio', async () => {
    // Meter un estado de envio en una entrada de pago seria hacer que la
    // columna signifique dos cosas otra vez, que es lo que la spec vino a
    // separar. Y `status` es opcional justamente para esto.
    await notificar('approved')

    const entrada = prismaFalso.orderTimeline.create.mock.calls[0][0].data

    expect(entrada.pagoEstado).toBe('aprobado')
    expect(entrada).not.toHaveProperty('status')
  })
})

describe('idempotencia', () => {
  it('la misma webhook dos veces suma el total UNA sola vez', async () => {
    // Mercado Pago reintenta. El error tipico es sumar dos veces. Se comprueba
    // con `updateMany` devolviendo `count: 0` en la segunda, que es lo que hace
    // Postgres cuando la condicion `pagoEstado <> destino` ya no se cumple.
    pagos.estados[PAGO_ID] = { id: PAGO_ID, estado: 'approved', monto: 15000, fechaAprobacion: null }
    prismaFalso.order.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const ts = '1730000000'
    const headers = {
      'content-type': 'application/json',
      'x-signature': firmarWebhook({ id: PAGO_ID, requestId: REQUEST_ID, ts }, SECRETO),
      'x-request-id': REQUEST_ID
    }
    const payload = { data: { id: PAGO_ID } }

    const primera = await app.inject({ method: 'POST', url: '/api/orders/webhook', headers, payload })
    const segunda = await app.inject({ method: 'POST', url: '/api/orders/webhook', headers, payload })

    expect(primera.json().applied).toBe(true)
    expect(segunda.json().applied).toBe(false)
    expect(prismaFalso.customer.update).toHaveBeenCalledTimes(1)
    expect(prismaFalso.orderTimeline.create).toHaveBeenCalledTimes(1)
  })

  it('la transicion es una condicion, no un leer-y-decidir', async () => {
    // La forma tipica de evitar el doble —"leer el pedido, si ya esta aprobado,
    // salir"— tiene una carrera: dos notificaciones al mismo tiempo leen las
    // dos "no aprobado" y las dos suman. Por eso la condicion va **dentro** del
    // `updateMany`: en Postgres es atomico.
    await notificar('approved')

    expect(prismaFalso.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'ord_1', pagoEstado: { not: 'aprobado' } },
      data: { pagoEstado: 'aprobado' }
    })
  })

  it('un pago que no es nuestro se responde 200 sin tocar nada', async () => {
    // Una Preference vieja que ya expiro. No es un error que haya que reportar:
    // Mercado Pago reintentaria y no pasaria nada.
    prismaFalso.order.findUnique.mockResolvedValue(null)

    const res = await notificar('approved')

    expect(res.statusCode).toBe(200)
    expect(res.json().applied).toBe(false)
    expect(prismaFalso.customer.update).not.toHaveBeenCalled()
  })
})

describe('una notificacion que no nos interesa', () => {
  it('sin `data.id` se acepta y no se aplica', async () => {
    // Mercado Pago manda eventos asi (los de prueba del panel de configuracion).
    // Se responde 202 **antes** de autenticar, y sin firma no cambia nada: no se
    // toca la base, no se llama a la pasarela, no cambia ningun pedido.
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders/webhook',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'test', action: 'test' }
    })

    expect(res.statusCode).toBe(202)
    expect(prismaFalso.order.updateMany).not.toHaveBeenCalled()
    expect(pagos.consulted).toEqual([])
  })

  it('pero con `data.id` la firma sigue siendo obligatoria', async () => {
    // La regla es "se autentica todo lo que **actua**". Un id presente sin firma
    // valida es 401, sin excepciones.
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders/webhook',
      headers: { 'content-type': 'application/json' },
      payload: { data: { id: PAGO_ID } }
    })

    expect(res.statusCode).toBe(401)
    expect(prismaFalso.order.updateMany).not.toHaveBeenCalled()
  })
})
