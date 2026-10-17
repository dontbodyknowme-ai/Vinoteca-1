import { describe, expect, it, vi } from 'vitest'
import {
  ProveedorPagosFalso,
  cuerpoDePreference,
  partirDireccion,
  proveedorMercadoPago,
  type SolicitudPreference
} from '../../src/modules/pagos/proveedor.js'

/**
 * El cuerpo de la Preference de Mercado Pago (spec 009, T3).
 *
 * ## Por que un archivo aparte
 *
 * `checkout.test.ts` verifica que el handler **pide** lo correcto. Este verifica
 * que el cuerpo que sale hacia la pasarela tiene la **forma** que Mercado Pago
 * acepta. Son dos contratos distintos: uno es con nuestro codigo, el otro con el
 * de ellos.
 *
 * El segundo es el que **no se puede verificar fallando**: Mercado Pago no
 * devuelve un error que digamos "tu `street_name` esta mal", devuelve un 400 con
 * un mensaje en su jerga. Y el primero **tampoco**: si mandamos la direccion
 * entera como texto, la Preference se crea y el comprador falla despues, en la
 * pagina de Mercado Pago, pensando que el problema es suyo.
 */

const solicitud = (over: Partial<SolicitudPreference> = {}): SolicitudPreference => ({
  pagador: {
    nombre: 'María',
    apellido: 'González',
    email: 'maria@example.com',
    telefono: '1112345678',
    direccion: 'Av. Corrientes 1234, Buenos Aires'
  },
  lineas: [
    { vinoId: 'clx111', nombre: 'Gran Reserva Malbec', cantidad: 2, precioUnitario: 7500 }
  ],
  total: 15000,
  urls: {
    exito: 'https://tienda.example/?pago=aprobado',
    fallo: 'https://tienda.example/?pago=fallido',
    pendiente: 'https://tienda.example/?pago=pendiente',
    webhook: 'https://api.example/api/orders/webhook'
  },
  referencia: 'ord_1',
  ...over
})

/**
 * El cuerpo que se manda de verdad.
 *
 * Se **importa** de `proveedor.ts` y no se reconstruye aca. La primera version de
 * este archivo copiaba la construccion, o sea que probaba su propia copia:
 * habria pasado en verde aunque el codigo real mandara otra cosa. Un test que
 * no llama a la funcion que quiere verificar es decoracion.
 */
const cuerpo = cuerpoDePreference

describe('los medios de pago', () => {
  it('excluye LAS DOS tarjetas', () => {
    // Con solo `credit_card` excluida, la **debito** sigue apareciendo. Y RF-04
    // dice que no haya tarjetas. Es el mismo bug de "una condicion a medias": el
    // checkout dice "sin tarjeta" y el comprador igual puede pagar con una.
    const excluidos = cuerpo(solicitud()).payment_methods as {
      excluded_payment_types: { id: string }[]
    }

    expect(excluidos.excluded_payment_types.map((t) => t.id).sort()).toEqual([
      'credit_card',
      'debit_card'
    ])
  })
})

describe('la direccion', () => {
  it('parte el numero del final del callejon', () => {
    // Mercado Pago **rechaza** la Preference si no viene `street_name` /
    // `street_number` / `city_name` / `zip_code`. Mandar la linea entera como
    // texto no pasa.
    expect(partirDireccion('Av. Corrientes 1234')).toEqual({
      street_name: 'Av. Corrientes',
      street_number: '1234',
      city_name: '',
      zip_code: ''
    })
  })

  it.each([
    ['Av. Corrientes 1234', 'Av. Corrientes', '1234'],
    // El numero de calle va **despues** del nombre y antes del piso. La primera
    // version tomaba el ultimo grupo de digitos y mandaba "Av. Santa Fe 2500,
    // Piso" con numero 3 — el piso de una casa en lugar de su calle.
    ['Av. Santa Fe 2500, Piso 3', 'Av. Santa Fe', '2500'],
    ['San Martin 45', 'San Martin', '45'],
    ['Calle 12', 'Calle', '12'],
    ['Av. Corrientes n°1234', 'Av. Corrientes', '1234'],
    ['Av. Corrientes 1234, 3ro B', 'Av. Corrientes', '1234']
  ])('parte "%s"', (entrada, callejon, numero) => {
    const partes = partirDireccion(entrada)

    expect(partes.street_name).toBe(callejon)
    expect(partes.street_number).toBe(numero)
  })

  it('deja callejon vacio y numero vacio si no hay numero', () => {
    // No se inventa: si la persona no escribio un numero, mandar el texto
    // entero como callejon seria peor que mandar el numero vacio.
    const partes = partirDireccion('Barrio Norte')

    expect(partes.street_number).toBe('')
    expect(partes.street_name).toBe('Barrio Norte')
  })

  it('NO inventa la ciudad ni el codigo postal', () => {
    // Adivinarlos seria mandar la direccion a otra provincia. Van vacios y es
    // Mercado Pago el que decide si los necesita para el medio de pago elegido.
    const partes = partirDireccion('Av. Corrientes 1234, Buenos Aires')

    expect(partes.city_name).toBe('')
    expect(partes.zip_code).toBe('')
  })

  it('normaliza los espacios multiples', () => {
    const partes = partirDireccion('  Av.   Corrientes   1234  ')

    expect(partes.street_name).toBe('Av. Corrientes')
  })
})

describe('lo que viaja a Mercado Pago', () => {
  it('lleva el precio de la base en cada linea, en ARS', () => {
    const items = cuerpo(solicitud()).items as Record<string, unknown>[]

    expect(items[0]).toEqual({
      id: 'clx111',
      title: 'Gran Reserva Malbec',
      quantity: 2,
      unit_price: 7500,
      currency_id: 'ARS'
    })
  })

  it('lleva el telefono como objeto, no como string', () => {
    // Mercado Pago espera `{ phone: { number } }`. Un string suelto se ignora en
    // silencio y el comprador no recibe ningun aviso.
    const payer = cuerpo(solicitud()).payer as Record<string, unknown>

    expect(payer.phone).toEqual({ number: '1112345678' })
  })

  it('lleva la webhook del backend como notification_url', () => {
    expect(cuerpo(solicitud()).notification_url).toBe('https://api.example/api/orders/webhook')
  })

  it('lleva el id del pedido como external_reference', () => {
    expect(cuerpo(solicitud()).external_reference).toBe('ord_1')
  })

  it('auto_return approved, para que el comprador vuelva solo al aprobar', () => {
    expect(cuerpo(solicitud()).auto_return).toBe('approved')
  })
})

describe('el proveedor real', () => {
  it('manda el token solo en el header Authorization', async () => {
    // Nunca en la query ni en el cuerpo: una query_string termina en los logs
    // del servidor y en el historial del proxy.
    const fetchFalso = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'p1', init_point: 'https://mp/checkout/1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchFalso)

    const proveedor = proveedorMercadoPago('token-secreto')
    const creada = await proveedor.crearPreference(solicitud())

    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit]
    const cabeceras = init.headers as Record<string, string>

    expect(url).not.toContain('token-secreto')
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences')
    expect(cabeceras.Authorization).toBe('Bearer token-secreto')
    expect(JSON.stringify(init.body ?? '')).not.toContain('token-secreto')
    expect(creada.initPoint).toBe('https://mp/checkout/1')

    vi.unstubAllGlobals()
  })

  it('un 400 de Mercado Pago dice que paso, no "undefined"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"street_name is required"}', { status: 400 }))
    )

    const proveedor = proveedorMercadoPago('token')

    await expect(proveedor.crearPreference(solicitud())).rejects.toThrow(/400/)
    await expect(proveedor.crearPreference(solicitud())).rejects.toThrow(/street_name/)

    vi.unstubAllGlobals()
  })

  it('el initPoint se usa tal cual viene, no armado a mano', async () => {
    // Mercado Pago devuelve la URL exacta y **cambia el formato segun la region
    // y la version de la API**. Construirla con un template es la forma de que
    // un dia deje de funcionar sin que nada haya cambiado del lado nuestro.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ id: 'p1', init_point: 'https://formato-nuevo/checkout/x' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )

    const creada = await proveedorMercadoPago('token').crearPreference(solicitud())

    expect(creada.initPoint).toBe('https://formato-nuevo/checkout/x')

    vi.unstubAllGlobals()
  })

  it('estadoDe consulta el pago y devuelve el estado de Mercado Pago', async () => {
    const fetchFalso = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 99,
          status: 'approved',
          transaction_amount: 15000,
          date_approved: '2026-10-16T10:00:00.000-04:00'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchFalso)

    const estado = await proveedorMercadoPago('token').estadoDe('99')

    expect(estado).toEqual({
      id: '99',
      estado: 'approved',
      monto: 15000,
      fechaAprobacion: '2026-10-16T10:00:00.000-04:00'
    })
    expect(String(fetchFalso.mock.calls[0][0])).toContain('/v1/payments/99')

    vi.unstubAllGlobals()
  })
})

describe('el doble', () => {
  it('registra lo que se le pidio', async () => {
    // Sin esto, un doble que devuelve un id fijo haria pasar todos los tests
    // sin verificar nada del contrato con la pasarela.
    const falso = new ProveedorPagosFalso()

    await falso.crearPreference(solicitud({ total: 9999 }))

    expect(falso.solicitudes).toHaveLength(1)
    expect(falso.solicitudes[0].total).toBe(9999)
  })
})
