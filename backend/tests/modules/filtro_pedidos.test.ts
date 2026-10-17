import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import type { FastifyInstance } from 'fastify'

/**
 * El filtro de estados de `/admin/pedidos` acepta **varios**.
 *
 * ## Que estaba roto
 *
 * El panel es un multi-select desde el 004-a: se marcan varias casillas y se
 * quieren ver esos estados. El frontend mandaba `?status=pendiente,enviado` —una
 * cadena con comas— y el backend declaraba `z.enum([...])`, que es **un** valor.
 * Resultado: **una casilla andaba, dos daban 400**, y el panel se cerraba solo
 * sin mostrar nada.
 *
 * ## Por que estos tests van contra la app y no contra el schema
 *
 * El querystring **no lo valida Zod**: `app.ts` compila
 * `toJsonSchema(orderQuerySchema)` y lo pasa a AJV, y `request.query` es lo que
 * AJV dejo. Un test del schema habria pasado en verde mientras el endpoint
 * seguia dando 400, porque son dos capas distintas.
 *
 * Por eso se pide por HTTP contra el `where` que llega a Prisma: esa es la
 * pregunta que tiene respuesta.
 */

const USUARIO = {
  id: 'usr_1',
  email: 'admin@vinoteca.local',
  name: 'Admin',
  role: 'admin',
  passwordHash: 'hash',
  createdAt: new Date(),
  updatedAt: new Date()
}

const prismaFalso = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  order: { findMany: vi.fn(), count: vi.fn() },
  wine: { findMany: vi.fn() },
  customer: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  orderTimeline: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $on: vi.fn(),
  $disconnect: vi.fn(),
  $transaction: vi.fn()
}))

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(() => prismaFalso) }))

const env = await import('../../src/config/env.js').then((m) => m.env)
const { buildApp } = await import('../../src/app.js')
const { ProveedorPagosFalso, configurarProveedor } = await import(
  '../../src/modules/pagos/proveedor.js'
)

let app: FastifyInstance
let token: string

beforeAll(async () => {
  configurarProveedor(new ProveedorPagosFalso())
  app = await buildApp()
  await app.ready()
  token = jwt.sign({ sub: USUARIO.id, role: 'admin' }, env.JWT_SECRET, { expiresIn: '15m' })
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaFalso.user.findUnique.mockResolvedValue(USUARIO)
  prismaFalso.order.findMany.mockResolvedValue([])
  prismaFalso.order.count.mockResolvedValue(0)
})

const pedir = (query: string) =>
  app.inject({
    method: 'GET',
    url: `/api/orders?${query}`,
    headers: { authorization: `Bearer ${token}` }
  })

/** El `where` con el que se llamo a `findMany` en la ultima peticion. */
const where = (): Record<string, unknown> =>
  (prismaFalso.order.findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> })?.where ?? {}

describe('un solo estado', () => {
  it('filtra por ese estado', async () => {
    const res = await pedir('status=pendiente&page=1&limit=10')

    expect(res.statusCode).toBe(200)
    // `in` con una lista, no `=` con un string: el signo igual buscaria un
    // estado literal que es un array.
    expect(where().status).toEqual({ in: ['pendiente'] })
  })

  it('un solo estado es el caso de siempre y sigue andando', async () => {
    // O sea que el arreglo no rompio lo que ya funcionaba.
    const res = await pedir('status=entregado&page=1&limit=10')

    expect(res.statusCode).toBe(200)
    expect(where().status).toEqual({ in: ['entregado'] })
  })
})

describe('varios estados: el caso que estaba roto', () => {
  it('el multi-select del panel da 200, no 400', async () => {
    const res = await pedir('status=pendiente&status=enviado&page=1&limit=10')

    expect(res.statusCode).toBe(200)
  })

  it('busca por TODOS los marcados, con `in`', async () => {
    await pedir('status=pendiente&status=enviado&page=1&limit=10')

    expect(where().status).toEqual({ in: ['pendiente', 'enviado'] })
  })

  it('aguanta los seis estados a la vez', async () => {
    const todos = ['pendiente', 'preparando', 'enviado', 'entregado', 'cancelado', 'devuelto']
    const res = await pedir(`status=${todos.join('&status=')}&page=1&limit=10`)

    expect(res.statusCode).toBe(200)
    expect(where().status).toEqual({ in: todos })
  })

  it('el filtro se combina con busqueda y fechas', async () => {
    // Antes de este arreglo, marcar dos estados con una busqueda puesta tiraba
    // el 400 igual: el enum se evaluaba antes que todo lo demas.
    const res = await pedir(
      'status=pendiente&status=enviado&search=Maria&dateFrom=2026-10-01&dateTo=2026-10-16'
    )

    expect(res.statusCode).toBe(200)
    expect(where().status).toEqual({ in: ['pendiente', 'enviado'] })
    expect(where().OR).toBeDefined()
    expect((where().createdAt as Record<string, Date>).gte).toBeInstanceOf(Date)
  })
})

describe('lo que sigue dando error', () => {
  it('un estado que no existe sigue siendo 400', async () => {
    // El arreglo no puede abrir la puerta de atras: `?status=inventado` tiene
    // que seguir siendo un error, no una lista vacia.
    const res = await pedir('status=inventado&page=1&limit=10')

    expect(res.statusCode).toBe(400)
    expect(prismaFalso.order.findMany).not.toHaveBeenCalled()
  })

  it('un estado valido y uno inventado, juntos, tambien', async () => {
    const res = await pedir('status=pendiente&status=inventado')

    expect(res.statusCode).toBe(400)
  })

  it('la cadena con comas ahora da 400 en vez de filtrar mal', async () => {
    // Lo que mandaba el panel antes. Da 400 a proposito: es un formato que no
    // existe en el contrato, y dar 400 es mas honesto que ignorar el filtro en
    // silencio y mostrar **todos** los pedidos.
    const res = await pedir('status=pendiente,enviado')

    expect(res.statusCode).toBe(400)
  })
})

describe('sin filtro', () => {
  it('no pone nada en el where', async () => {
    const res = await pedir('page=1&limit=10')

    expect(res.statusCode).toBe(200)
    expect(where().status).toBeUndefined()
  })

  it('la paginacion sigue llegando como numero', async () => {
    // AJV corre con `coerceTypes`, asi que `?page=3` llega como `3` y no como
    // `"3"`. Si eso dejara de pasar, `skip` seria NaN y la pagina 2 no existiria.
    await pedir('page=3&limit=25')

    const llamada = prismaFalso.order.findMany.mock.calls[0][0] as Record<string, unknown>

    expect(llamada.skip).toBe(50)
    expect(llamada.take).toBe(25)
  })
})

describe('el filtro de PAGO (spec 009, D-10)', () => {
  it('filtra por estado de pago', async () => {
    const res = await pedir('pagoEstado=aprobado&page=1&limit=10')

    expect(res.statusCode).toBe(200)
    expect(where().pagoEstado).toEqual({ in: ['aprobado'] })
  })

  it('varios estados de pago', async () => {
    const res = await pedir('pagoEstado=pendiente&pagoEstado=expirado&page=1&limit=10')

    expect(res.statusCode).toBe(200)
    expect(where().pagoEstado).toEqual({ in: ['pendiente', 'expirado'] })
  })

  it('los CINCO estados de pago, que existen todos', async () => {
    // Si el schema tuviera uno menos que el enum de Prisma, el ultimo de la
    // lista daria 400 y el operador no podria filtrar por el.
    const todos = ['no_iniciado', 'pendiente', 'aprobado', 'rechazado', 'expirado']
    const res = await pedir(`pagoEstado=${todos.join('&pagoEstado=')}&page=1&limit=10`)

    expect(res.statusCode).toBe(200)
    expect(where().pagoEstado).toEqual({ in: todos })
  })

  it('los dos filtros juntos: envio AND pago', async () => {
    // La pregunta que se hace todos los dias: "los expirados que todavia estan
    // pendientes de envio" son los que hay que liberar. Prisma pone el AND solo
    // entre las claves de `where`.
    const res = await pedir('status=pendiente&pagoEstado=expirado&page=1&limit=10')

    expect(res.statusCode).toBe(200)
    expect(where().status).toEqual({ in: ['pendiente'] })
    expect(where().pagoEstado).toEqual({ in: ['expirado'] })
  })

  it('un estado de PAGO no llega al filtro de envio', async () => {
    // El bug de D-7 seria exactamente este: que `pagoEstado=expirado` terminara
    // filtrando `status`. Son dos campos distintos y cada uno va a su filtro.
    await pedir('pagoEstado=expirado&page=1&limit=10')

    expect(where().status).toBeUndefined()
    expect(where().pagoEstado).toEqual({ in: ['expirado'] })
  })

  it('un estado de ENVIO no llega al filtro de pago', async () => {
    // Y al reves: `enviado` es de envio, no un estado de pago. Prisma daria
    // error de validacion en tiempo de ejecucion si colara en un enum de pago.
    await pedir('status=enviado&page=1&limit=10')

    expect(where().pagoEstado).toBeUndefined()
  })

  it('un estado de pago inventado sigue siendo 400', async () => {
    const res = await pedir('pagoEstado=inventado')

    expect(res.statusCode).toBe(400)
    expect(prismaFalso.order.findMany).not.toHaveBeenCalled()
  })

  it('un estado de envio en el filtro de pago es 400', async () => {
    // `entregado` es de envio. Si el enum de pago lo aceptara, el operador
    // marcaria "Entregado" en el desplegable de Pago creyendo que filtra algo.
    const res = await pedir('pagoEstado=entregado')

    expect(res.statusCode).toBe(400)
  })
})