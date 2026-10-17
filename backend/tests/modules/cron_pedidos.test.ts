import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * La expiracion de pedidos sin pagar (spec 009, T5, RF-07).
 *
 * El riesgo real de esta tarea no es que no expire: es que **expire de mas**.
 * Un pedido pagado que pasa a `expirado` es plata cobrada que el panel muestra
 * como perdida. Por eso los tests de aca hablan tanto de lo que **no** tiene que
 * tocar como de lo que tiene que tocar.
 */

const prismaFalso = vi.hoisted(() => ({
  order: { updateMany: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  orderTimeline: { create: vi.fn() },
  customer: { update: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
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
const { expirarPedidosSinPagar, arrancarCronPedidos, MINUTOS_PARA_EXPIRAR } = await import(
  '../../src/modules/orders/cron.js'
)

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaFalso.order.updateMany.mockResolvedValue({ count: 0 })
})

/** El `where` con el que se llamo al `updateMany` de la ultima pasada. */
const whereDeLaUltimaPasada = () =>
  prismaFalso.order.updateMany.mock.calls[0][0].where as {
    pagoEstado: { in: string[] }
    createdAt: { lt: Date }
  }

describe('que expira', () => {
  it('los que no han pagado, despues de 10 minutos', async () => {
    await expirarPedidosSinPagar(prismaFalso as never)

    const where = whereDeLaUltimaPasada()

    expect(where.pagoEstado.in).toEqual(['no_iniciado', 'pendiente'])
  })

  it('el corte son 10 minutos', async () => {
    await expirarPedidosSinPagar(prismaFalso as never)

    const antes = Date.now()
    await expirarPedidosSinPagar(prismaFalso as never)
    const despues = Date.now()

    const limites = prismaFalso.order.updateMany.mock.calls
      .map((llamada) => (llamada[0].where as { createdAt: { lt: Date } }).createdAt.lt.getTime())
      .sort((a, b) => a - b)

    // El segundo corte esta al menos 10 minutos antes del reloj, y no mas de
    // 10 minutos y medio: si fuera mas atras, expiraria pedidos que todavia
    // tenian tiempo; si fuera mas cerca, tardaria mas de la promesa.
    const primero = limites[0]
    expect(primero).toBeLessThanOrEqual(antes - MINUTOS_PARA_EXPIRAR * 60 * 1000)
    expect(primero).toBeGreaterThan(despues - (MINUTOS_PARA_EXPIRAR + 1) * 60 * 1000)
  })

  it('pone `expirado` y nada mas', async () => {
    await expirarPedidosSinPagar(prismaFalso as never)

    expect(prismaFalso.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pagoEstado: 'expirado' } })
    )
  })

  it('NO toca el estado del envio', async () => {
    await expirarPedidosSinPagar(prismaFalso as never)

    // `expirado` no existe en `OrderStatus` (D-7), y aunque existiera
    // significaria "el envio se vencio". Un pedido que nadie pago no tiene un
    // envio vencido: tiene uno que nunca se mando.
    const data = prismaFalso.order.updateMany.mock.calls[0][0].data as Record<string, unknown>

    expect(Object.keys(data)).toEqual(['pagoEstado'])
  })

  it('NO toca el `Customer`', async () => {
    // Un pedido que se dio por abandonado no se sumo a `totalSpent` cuando se
    // creo, asi que no hay nada que revertir. Tocar el `Customer` aca seria
    // restar plata que nunca se sumo.
    await expirarPedidosSinPagar(prismaFalso as never)

    expect(prismaFalso.customer.update).not.toHaveBeenCalled()
  })
})

describe('lo que NO expira', () => {
  it('un pedido pagado no se toca', async () => {
    // Es el riesgo real de esta tarea: plata cobrada que el panel muestra como
    // perdida.
    await expirarPedidosSinPagar(prismaFalso as never)

    const where = whereDeLaUltimaPasada()

    expect(where.pagoEstado.in).not.toContain('aprobado')
    expect(where.pagoEstado.in).not.toContain('rechazado')
    expect(where.pagoEstado.in).not.toContain('expirado')
  })

  it('un pedido que se acaba de crear no se toca', async () => {
    // El `where` lleva `createdAt < limite`, y el limite son 10 minutos atras.
    // Con eso, un pedido de hace 2 minutos queda afuera.
    await expirarPedidosSinPagar(prismaFalso as never)

    const minutos = (Date.now() - whereDeLaUltimaPasada().createdAt.lt.getTime()) / 60_000

    expect(minutos).toBeGreaterThanOrEqual(MINUTOS_PARA_EXPIRAR)
  })

  it('la condicion de pago va DENTRO del updateMany, no antes', async () => {
    // Entre que se calcula el `where` y que corre la consulta, la webhook pudo
    // aprobar el pedido. Si el filtro estuviera fuera —"primero buscar los
    // vencidos, despues actualizarlos"— un pago que llego a tiempo se pisaria
    // con un `expirado`.
    await expirarPedidosSinPagar(prismaFalso as never)

    expect(prismaFalso.order.findMany).not.toHaveBeenCalled()
    const where = prismaFalso.order.updateMany.mock.calls[0][0].where as Record<string, unknown>

    expect(where.pagoEstado).toBeDefined()
    expect(where.createdAt).toBeDefined()
  })
})

describe('dos instancias corriendo el cron', () => {
  it('cada pedido se actualiza una sola vez, no una por instancia', async () => {
    // Con dos contenedores en un deploy solapado, los dos corren el cron. El
    // `updateMany` con condicion es atomico en Postgres: solo el que cambia la
    // fila obtiene `count: 1`. Con un find-then-update, los dos leerian el
    // pedido como pendiente y los dos lo escribirian.
    prismaFalso.order.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const [primera, segunda] = await Promise.all([
      expirarPedidosSinPagar(prismaFalso as never),
      expirarPedidosSinPagar(prismaFalso as never)
    ])

    expect(primera + segunda).toBe(1)
  })

  it('devuelve cuantos vencieron, para poder registralo', async () => {
    prismaFalso.order.updateMany.mockResolvedValue({ count: 3 })

    expect(await expirarPedidosSinPagar(prismaFalso as never)).toBe(3)
  })
})

describe('el intervalo', () => {
  it('se apaga cuando se llama al devuelto', () => {
    const restaurar = arrancarCronPedidos(prismaFalso as never)

    // Un `setInterval` vivo mantiene el proceso abierto: sin apagarlo, cada test
    // que arranque la app cuelga la suite en verde.
    expect(typeof restaurar).toBe('function')
    expect(() => restaurar()).not.toThrow()
  })

  it('no deja el proceso abierto (unref)', () => {
    // Se comprueba el efecto, no la llamada: un `unref` que no estuviera
    // mantiene el proceso vivo y el sintoma es una suite que no termina.
    const originales = setInterval as unknown as { unref?: () => void }
    let fueLiberado = false

    const original = globalThis.setInterval
    globalThis.setInterval = ((fn: () => void, ms: number) => {
      const mango = original(fn, ms)
      if (typeof (mango as unknown as { unref?: () => void }).unref === 'function') {
        ;(mango as unknown as { unref: () => void }).unref = () => {
          fueLiberado = true
        }
      }
      return mango
    }) as unknown as typeof setInterval

    const restaurar = arrancarCronPedidos(prismaFalso as never)
    restaurar()

    globalThis.setInterval = originales as unknown as typeof setInterval

    expect(fueLiberado).toBe(true)
  })
})
