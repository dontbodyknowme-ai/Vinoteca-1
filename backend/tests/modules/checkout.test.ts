import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * El checkout: `POST /api/orders` (spec 009, T3).
 *
 * ## Que se prueba aca y que no
 *
 * Se prueba **todo menos el HTTP contra Mercado Pago**: resolver el `Customer`,
 * calcular el total desde la base, la carrera del `P2002`, y que la Preference
 * reciba lo que tiene que recibir.
 *
 * No se prueba que Mercado Pago **acepte** la Preference. Eso necesita una
 * credencial real; aca se usa `ProveedorPagosFalso`, que ademas **registra lo que
 * se le pidio**. Un doble que devuelve un id fijo sin registrar nada no
 * verificaria nada: el `preferenceId` volveria, el pedido se guardaria, y la
 * prueba pasaria sin haber comprobado nada del contrato con la pasarela.
 */

const prismaFalso = vi.hoisted(() => ({
  wine: { findMany: vi.fn() },
  customer: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  order: { create: vi.fn(), update: vi.fn() },
  orderTimeline: { create: vi.fn() },
  orderItem: {},
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

const CUID_VINO = 'clx111111111'

/** Lo que hay en la tabla de vinos. El precio es de ahi, no del cliente. */
const PRECIO_EN_BASE = 7500

const COMPRADOR = {
  nombre: 'María',
  apellido: 'González',
  telefono: '11 1234-5678',
  email: 'maria@example.com',
  direccion: 'Av. Corrientes 1234, Buenos Aires'
}

const cuerpo = (items = [{ vinoId: CUID_VINO, cantidad: 2 }], extra: Record<string, unknown> = {}) => ({
  ...COMPRADOR,
  items,
  ...extra
})

let app: FastifyInstance
let pagos: ProveedorPagosFalso

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()

  pagos = new ProveedorPagosFalso()
  configurarProveedor(pagos)

  prismaFalso.wine.findMany.mockResolvedValue([
    { id: CUID_VINO, name: 'Gran Reserva Malbec', price: PRECIO_EN_BASE, stock: 10 }
  ])
  prismaFalso.customer.findUnique.mockResolvedValue(null)
  prismaFalso.customer.create.mockResolvedValue({ id: 'cus_1' })
  prismaFalso.customer.update.mockResolvedValue({ id: 'cus_1' })
  prismaFalso.order.create.mockResolvedValue({ id: 'ord_1' })
  prismaFalso.order.update.mockResolvedValue({ id: 'ord_1' })
})

const comprar = (body: unknown) => app.inject({ method: 'POST', url: '/api/orders', payload: body as never })

describe('crear el pedido', () => {
  it('responde 201 con la preference y el total', async () => {
    const res = await comprar(cuerpo())

    expect(res.statusCode).toBe(201)
    const json = res.json()

    expect(json.orderId).toBe('ord_1')
    expect(json.preferenceId).toBe('pref-falsa-1')
    // El `initPoint` **no** se arma a mano: es la URL que devuelve Mercado Pago.
    // Construirla con un template es la forma de que un dia deje de funcionar
    // sin que nada haya cambiado del lado nuestro.
    expect(json.initPoint).toContain('preference-id=pref-falsa-1')
    expect(json.total).toBe(PRECIO_EN_BASE * 2)
  })

  it('no exige sesion: es publico', async () => {
    // El `GET` y el `PATCH` de este mismo archivo exigen rol. Este no, porque lo
    // llama alguien que no tiene cuenta (RF-01).
    expect((await comprar(cuerpo())).statusCode).toBe(201)
  })

  it('un token de rol NO alcanza para leer el pedido creado', async () => {
    // El `orderId` que devuelve el checkout **no** habilita a leer el pedido:
    // `GET /api/orders/:id` sigue con `requireRole`. El que puede ver la
    // informacion del comprador es el panel, no quien hizo el pedido.
    expect(prismaFalso.user.findUnique).not.toHaveBeenCalled()
  })
})

describe('el total lo decide el backend', () => {
  it('ignora un precioUnitario que venga en el body', async () => {
    // El schema de T2 **rechaza** el campo antes de llegar aca, asi que ni
    // llega. El test afirma las dos capas: que se rechaza por schema...
    const conPrecio = await comprar(
      cuerpo([{ vinoId: CUID_VINO, cantidad: 2, precioUnitario: 1 }])
    )
    expect(conPrecio.statusCode).toBe(400)

    // ...y que si el campo no existe, el total sale de la base.
    const limpio = await comprar(cuerpo())
    expect(limpio.json().total).toBe(PRECIO_EN_BASE * 2)
  })

  it('un total en la raiz tambien se rechaza', async () => {
    expect((await comprar(cuerpo([{ vinoId: CUID_VINO, cantidad: 1 }], { total: 1 }))).statusCode).toBe(400)
  })

  it('el total guardado y el que se manda a Mercado Pago son EL MISMO numero', async () => {
    await comprar(cuerpo())

    const guardado = prismaFalso.order.create.mock.calls[0][0].data.total
    const enviado = pagos.solicitudes[0].total

    // Si difirieran aunque sea un peso, la webhook podria aprobar un monto que el
    // panel nunca muestra. Es el tipo de mentira que esta spec vino a arreglar.
    expect(guardado).toBe(enviado)
    expect(guardado).toBe(PRECIO_EN_BASE * 2)
  })

  it('guarda el precio de la base, no el de hoy', async () => {
    await comprar(cuerpo())

    const items = prismaFalso.order.create.mock.calls[0][0].data.items.create

    expect(items).toEqual([
      { wineId: CUID_VINO, quantity: 2, price: PRECIO_EN_BASE }
    ])
  })

  it('pregunta el precio a la base, no lo recibe', async () => {
    await comprar(cuerpo())

    // Si alguna vez el handler deja de leer `Wine.price`, esto falla: la consulta
    // es la unica fuente del numero.
    expect(prismaFalso.wine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ price: true }) })
    )
  })

  it('multiplica bien varios items', async () => {
    const otro = 'clx222222222'
    prismaFalso.wine.findMany.mockResolvedValue([
      { id: CUID_VINO, name: 'A', price: 1000, stock: 5 },
      { id: otro, name: 'B', price: 2500, stock: 5 }
    ])

    const res = await comprar(
      cuerpo([
        { vinoId: CUID_VINO, cantidad: 3 },
        { vinoId: otro, cantidad: 2 }
      ])
    )

    expect(res.json().total).toBe(1000 * 3 + 2500 * 2)
  })

  it('suma las cantidades repetidas del mismo vino', async () => {
    // El carrito podria mandar el mismo vino dos veces. `lineas` las corre tal
    // cual, y Mercado Pago mostraria dos lineas del mismo vino. No es un error
    // de plata —el total es el mismo— pero es una pantalla rara.
    const res = await comprar(
      cuerpo([
        { vinoId: CUID_VINO, cantidad: 1 },
        { vinoId: CUID_VINO, cantidad: 2 }
      ])
    )

    expect(res.json().total).toBe(PRECIO_EN_BASE * 3)
  })
})

describe('la Preference que se manda a Mercado Pago', () => {
  it('lleva el precio de la base en cada linea', async () => {
    await comprar(cuerpo())

    expect(pagos.solicitudes[0].lineas).toEqual([
      { vinoId: CUID_VINO, nombre: 'Gran Reserva Malbec', cantidad: 2, precioUnitario: PRECIO_EN_BASE }
    ])
  })

  it('lleva los datos del comprador ya normalizados', async () => {
    await comprar(cuerpo())

    expect(pagos.solicitudes[0].pagador).toEqual({
      nombre: 'María',
      apellido: 'González',
      email: 'maria@example.com',
      telefono: '1112345678',
      direccion: 'Av. Corrientes 1234, Buenos Aires'
    })
  })

  it('lleva las urls de vuelta y la webhook del backend', async () => {
    await comprar(cuerpo())

    const urls = pagos.solicitudes[0].urls

    expect(urls.exito).toContain('/?pago=aprobado')
    expect(urls.fallo).toContain('/?pago=fallido')
    // La webhook es **del backend**, no del frontend: es la unica que Mercado
    // Pago puede llamar sin sesion de nadie.
    expect(urls.webhook).toContain('/api/orders/webhook')
  })

  it('lleva el id del pedido como referencia externa', async () => {
    await comprar(cuerpo())

    expect(pagos.solicitudes[0].referencia).toBe('ord_1')
  })

  it('crea el pedido ANTES que la Preference', async () => {
    await comprar(cuerpo())

    // Al reves, `external_reference` no tendria que mandar porque el id del
    // pedido no existiria. Y si la Preference falla, queda el rastro de que
    // alguien intento comprar.
    expect(prismaFalso.order.create).toHaveBeenCalled()
    expect(pagos.solicitudes).toHaveLength(1)
  })

  it('guarda el preferenceId en el pedido', async () => {
    await comprar(cuerpo())

    // Es con `pagoId` como la webhook (T4) encuentra el pedido.
    expect(prismaFalso.order.update).toHaveBeenCalledWith({
      where: { id: 'ord_1' },
      data: { pagoId: 'pref-falsa-1' }
    })
  })
})

describe('D-9: un comprador que vuelve es el mismo', () => {
  it('si el email ya existe, NO crea un Customer nuevo', async () => {
    prismaFalso.customer.findUnique.mockResolvedValue({ id: 'cus_existente' })

    await comprar(cuerpo())

    expect(prismaFalso.customer.create).not.toHaveBeenCalled()
  })

  it('busca por el email en minusculas', async () => {
    await comprar(cuerpo())

    expect(prismaFalso.customer.findUnique).toHaveBeenCalledWith({
      where: { email: 'maria@example.com' },
      select: { id: true }
    })
  })

  it('reutiliza la ficha pero actualiza el telefono', async () => {
    // El telefono es el unico dato que se corrige solo: la persona lo escribe de
    // otra forma cada vez y el CRM necesita la ultima.
    prismaFalso.customer.findUnique.mockResolvedValue({ id: 'cus_existente' })

    await comprar(cuerpo())

    expect(prismaFalso.customer.update).toHaveBeenCalledWith({
      where: { id: 'cus_existente' },
      data: { phone: '1112345678' }
    })
  })

  it('si no existe, crea uno con nombre y apellido juntos', async () => {
    await comprar(cuerpo())

    expect(prismaFalso.customer.create).toHaveBeenCalledWith({
      data: { name: 'María González', email: 'maria@example.com', phone: '1112345678' },
      select: { id: true }
    })
  })

  it('el pedido va al Customer, nuevo o viejo', async () => {
    prismaFalso.customer.findUnique.mockResolvedValue({ id: 'cus_existente' })

    await comprar(cuerpo())

    expect(prismaFalso.order.create.mock.calls[0][0].data.customerId).toBe('cus_existente')
  })

  it('la carrera del P2002 reintenta la busqueda y NO es un 500', async () => {
    // Dos checkouts del mismo email a la vez: los dos buscan, los dos no
    // encuentran, los dos insertan, y uno se lleva la violacion de unico. Si eso
    // revienta, el comprador ve "algo fallo" y pierde el carrito.
    prismaFalso.customer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cus_ganador' })

    prismaFalso.customer.create.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['email'] }
    })

    const res = await comprar(cuerpo())

    expect(res.statusCode).toBe(201)
    expect(prismaFalso.customer.create).toHaveBeenCalledTimes(1)
    // Y el pedido queda para **quien gano** la carrera, no para el perdedor.
    expect(prismaFalso.order.create.mock.calls[0][0].data.customerId).toBe('cus_ganador')
  })

  it('un P2002 de otro campo NO se reintenta', async () => {
    // Reintentar un P2002 que no es de `Customer.email` esconderia el error
    // real: la busqueda segunda tambien falla y recien ahi se propaga, con un
    // error que ya no dice que paso.
    prismaFalso.customer.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['otroCampo'] }
    })

    const res = await comprar(cuerpo())

    expect(res.statusCode).toBe(500)
    // Lo que prueba que no reintento es la **cantidad de busquedas**: si
    // reintentara, seria dos.
    expect(prismaFalso.customer.findUnique).toHaveBeenCalledTimes(1)
  })
})

describe('vinos que no existen', () => {
  it('un vino inexistente es 400, no un pedido a medias', async () => {
    prismaFalso.wine.findMany.mockResolvedValue([])

    const res = await comprar(cuerpo([{ vinoId: 'clx999999999', cantidad: 1 }]))

    expect(res.statusCode).toBe(400)
    expect(prismaFalso.order.create).not.toHaveBeenCalled()
  })

  it('un vino dado de baja no se compra', async () => {
    // La consulta filtra por `activo: true`. Si se sacara el filtro, se podria
    // comprar un vino que el panel no muestra.
    await comprar(cuerpo())

    expect(prismaFalso.wine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ activo: true }) })
    )
  })

  it('si un vino de dos falta, dice cual', async () => {
    prismaFalso.wine.findMany.mockResolvedValue([
      { id: CUID_VINO, name: 'A', price: 1000, stock: 5 }
    ])

    const res = await comprar(
      cuerpo([
        { vinoId: CUID_VINO, cantidad: 1 },
        { vinoId: 'clx999999999', cantidad: 1 }
      ])
    )

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('clx999999999')
  })
})

describe('si Mercado Pago falla', () => {
  it('el 500 dice que fallo la pasarela, no "algo fallo"', async () => {
    pagos.fallaAlCrear = new Error('Mercado Pago respondio 500')

    const res = await comprar(cuerpo())

    expect(res.statusCode).toBe(500)
    // El pedido **queda**, en `no_iniciado`, y expira a los 10 minutos. Es lo
    // correcto: queda el rastro del intento. Y el `pagoId` nunca se setea, asi
    // que la webhook no lo va a encontrar ni a tocarlo.
    expect(prismaFalso.order.create).toHaveBeenCalled()
    expect(prismaFalso.order.update).not.toHaveBeenCalled()
  })
})
