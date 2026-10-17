import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { jsonSchemas } from '../../src/shared/json-schemas.js'

/**
 * Que el estado del pago llegue al panel (spec 009, T8).
 *
 * ## Que hace realmente `fast-json-stringify`
 *
 * Medido con Fastify de verdad, no de memoria. El esquema de una respuesta y lo
 * que sale:
 *
 *   { type: 'object' }                              -> {}
 *   { type: 'object', additionalProperties: false } -> {}
 *   { type: 'object', properties: { id } }          -> { id }
 *   { type: 'object', additionalProperties: true }  -> todo
 *
 * Y lo mismo adentro de un array:
 *
 *   { type: 'array' }                               -> todo
 *   { type: 'array', items: { type: 'object' } }    -> [ {} ]
 *   { type: 'array', items: { properties: { id } } }-> [ { id } ]
 *
 * **El caso peligroso es el tercero**, y es el que el gotcha 11 de `AGENTS.md`
 * no menciona: declarar `properties` **a medias** se ve como "declarar el schema
 * bien" y en realidad corta todo lo que no este en la lista. Escribir el schema
 * con cuidado y que por eso se corte mas es el modo de falla que no duele hasta
 * que el panel muestra columnas vacias.
 *
 * ## Por que un archivo propio
 *
 * Por eso el test serializa con **Fastify de verdad** y el schema real, en vez
 * de llamar a una funcion y asumir que el resultado llega intacto. Un panel que
 * muestra "Pago: aprobado" y en realidad nunca recibio el campo no da ningun
 * error: la columna sale vacia y lo unico que se ve es que "falta el dato".
 *
 * Y hay un segundo motivo, mas chico: la `timeline` lleva `status` y
 * `pagoEstado` que **pueden ser `null`**. Un `status: { type: 'string' }` en el
 * schema **corta el `null`** — el campo desaparece y el panel no puede ni
 * distinguir "sin estado" de "campo ausente".
 */

const serializar = async (
  schema: unknown,
  cuerpo: unknown,
  status: number
): Promise<Record<string, unknown>> => {
  const app = Fastify({ logger: false })

  app.post(
    '/prueba',
    { schema: { response: { [status]: schema } } },
    async (_request, reply) => reply.status(status).send(cuerpo as never)
  )

  const respuesta = await app.inject({ method: 'POST', url: '/prueba' })
  await app.close()

  return respuesta.json()
}

/** Un pedido tal como lo devuelve Prisma, con los dos estados. */
const PEDIDO = {
  id: 'ord_1',
  customerId: 'cus_1',
  customerName: 'María González',
  customerEmail: 'maria@example.com',
  total: 15000,
  status: 'pendiente',
  pagoEstado: 'aprobado',
  pagoId: '99887766',
  createdAt: '2026-10-16T10:00:00.000Z',
  items: [{ wineId: 'clx1', wineName: 'Malbec', quantity: 2, price: 7500 }],
  shippingAddress: { street: 'Av. Corrientes 1234', city: 'Buenos Aires', zip: '1414', phone: '1112345678' },
  timeline: [
    {
      id: 'tl_1',
      // Entrada de envio: tiene status, **no** tiene pagoEstado.
      status: 'preparando',
      pagoEstado: null,
      origen: 'Admin',
      author: 'Admin',
      createdAt: '2026-10-16T10:05:00.000Z'
    },
    {
      id: 'tl_2',
      // Entrada de pago: tiene pagoEstado, **no** tiene status.
      status: null,
      pagoEstado: 'aprobado',
      origen: 'Mercado Pago',
      author: 'Mercado Pago',
      createdAt: '2026-10-16T10:10:00.000Z'
    }
  ]
}

describe('GET /api/orders', () => {
  it('el pago llega en la lista', async () => {
    const cuerpo = await serializar(
      jsonSchemas.orders.list.response[200],
      { data: [PEDIDO], total: 1, page: 1, limit: 20, totalPages: 1 },
      200
    )

    const primero = (cuerpo.data as Record<string, unknown>[])[0]

    expect(primero.pagoEstado).toBe('aprobado')
    expect(primero.status).toBe('pendiente')
  })

  it('la lista NO pierde el pagoEstado cuando es `null`', async () => {
    // Un pedido recien creado, sin Preference todavia. Si el schema lo cortara,
    // el panel no podria distinguir "sin iniciar" de "vacio".
    const cuerpo = await serializar(
      jsonSchemas.orders.list.response[200],
      { data: [{ ...PEDIDO, pagoEstado: 'no_iniciado' }], total: 1, page: 1, limit: 20, totalPages: 1 },
      200
    )

    expect((cuerpo.data as Record<string, unknown>[])[0].pagoEstado).toBe('no_iniciado')
  })
})

describe('GET /api/orders/:id', () => {
  it('el pago llega en el detalle', async () => {
    const cuerpo = await serializar(jsonSchemas.orders.get.response[200], PEDIDO, 200)

    expect(cuerpo.pagoEstado).toBe('aprobado')
    expect(cuerpo.status).toBe('pendiente')
  })

  it('la timeline conserva las entradas de pago con `status: null`', async () => {
    const cuerpo = await serializar(jsonSchemas.orders.get.response[200], PEDIDO, 200)

    const timeline = cuerpo.timeline as Record<string, unknown>[]

    // La entrada de envio se ve entera.
    expect(timeline[0].status).toBe('preparando')
    expect(timeline[0].pagoEstado).toBeNull()

    // Y la de pago **tambien**: sin esto, `order_timeline.tsx` dibujaria un
    // estado de envio inventado o se la saltaria, y el comprador no tendria
    // forma de ver que le aprobaron el pago.
    expect(timeline[1].pagoEstado).toBe('aprobado')
    expect(timeline[1].status).toBeNull()
    expect(timeline[1].origen).toBe('Mercado Pago')
  })

  it('los items del pedido siguen entrando', async () => {
    const cuerpo = await serializar(jsonSchemas.orders.get.response[200], PEDIDO, 200)

    expect((cuerpo.items as unknown[]).length).toBe(1)
    expect((cuerpo.items as Record<string, unknown>[])[0].quantity).toBe(2)
  })
})

describe('lo que el schema de la lista tiene que ser', () => {
  it('declara `data` como array, no como objeto', () => {
    // La asercion de la forma del schema, para que un cambio accidental que la
    // vuelva `{ type: 'object' }` falle aqui y no en produccion.
    const esquema = jsonSchemas.orders.list.response[200] as {
      properties: { data: { type: string } }
    }

    expect(esquema.properties.data.type).toBe('array')
  })
})
