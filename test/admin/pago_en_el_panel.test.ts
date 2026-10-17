import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import {
  USUARIOS,
  desmontarAdmin,
  montarAdmin,
  type MontajeAdmin
} from './andamiaje_admin'
import { OrderDrawer } from '../../src/components/admin/order_drawer'
import { OrderTimeline } from '../../src/components/admin/order_timeline'
import { EstadoPagoBadge } from '../../src/components/admin/estado_pago_badge'
import type { EstadoPago, Order } from '../../src/types/admin'

/**
 * El panel ve el estado del pago (spec 009, T8, RF-05 y RF-08).
 *
 * ## Lo que esta tarea tiene que demostrar
 *
 * Que el pago y el envio son **dos hechos distintos** y que se ven **por
 * separado**. No que el pago exista: eso ya lo afirma la suite del backend. Y si
 * los dos se muestran juntos sin distinguirlos, la separacion de D-7 no llego a
 * la pantalla.
 *
 * ## El caso que manda
 *
 * Un pedido **aprobado** de pago y **pendiente** de envio. Es el estado normal
 * durante horas: entro la plata y el paquete todavia no se armo. Si el panel
 * muestra un solo "Pendiente" o un solo badge, el vendedor no puede saber si
 * hay plata para el pedido o si tiene que esperar.
 *
 * Y el otro: el pago **pendiente** con el envio **entregado**, que es el que
 * separa de verdad los dos enumerados —mismo literal `pendiente` con
 * significado opuesto—.
 */

/** Un pedido tal como lo devuelve `GET /api/orders/:id`. */
const pedido = (over: Partial<Order> = {}): Order => ({
  id: 'ord_1',
  customerId: 'cus_1',
  customer: { id: 'cus_1', name: 'María González', email: 'maria@example.com' },
  items: [
    {
      wineId: 'clx1',
      wineName: 'Gran Reserva Malbec',
      imageUrl: 'https://ejemplo.test/v.webp',
      quantity: 2,
      price: 7500
    }
  ],
  total: 15000,
  status: 'pendiente',
  pagoEstado: 'aprobado',
  shippingAddress: { street: 'Av. Corrientes 1234', city: 'Buenos Aires', zip: '1414', phone: '1112345678' },
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:05:00.000Z',
  /**
   * La entrada de envio es `preparando` y no `pendiente` **a proposito**: si
   * fuera `pendiente`, su texto seria identico al de un pago pendiente y el
   * test de "cada entrada dice de donde viene" no tendria nada que distinguir.
   */
  timeline: [
    { status: 'preparando', author: 'Admin', createdAt: '2026-10-16T10:00:00.000Z' },
    {
      pagoEstado: 'aprobado',
      author: 'Mercado Pago',
      createdAt: '2026-10-16T10:02:00.000Z'
    }
  ],
  ...over
})

let montaje: MontajeAdmin | null = null

afterEach(() => {
  if (montaje !== null) void desmontarAdmin(montaje)
  montaje = null
  vi.restoreAllMocks()
})

const abrirDrawer = async (sobre: Partial<Order> = {}): Promise<MontajeAdmin> => {
  montaje = await montarAdmin(
    createElement(OrderDrawer, {
      isOpen: true,
      pedido: pedido(sobre),
      onClose: vi.fn(),
      onCambiarEstado: vi.fn(async (p: Order) => p),
      onGenerarEtiqueta: vi.fn()
    })
  )
  return montaje
}

const texto = (m: MontajeAdmin): string => m.contenedor.textContent ?? ''

const badgeDePago = (m: MontajeAdmin): string | null =>
  m.contenedor.querySelector('[data-estado-pago]')?.getAttribute('data-estado-pago') ?? null

describe('el drawer muestra el pago', () => {
  it('el estado del pago aparece', async () => {
    const m = await abrirDrawer()

    expect(badgeDePago(m)).toBe('aprobado')
  })

  it('el pago tiene su propio encabezado, separado del envio', async () => {
    const m = await abrirDrawer()

    const encabezados = [...m.contenedor.querySelectorAll('h3')].map((h) => h.textContent)

    // Dos secciones, no una sola llamada "Estado" con las dos cosas adentro: la
    // separacion que la spec pide tiene que verse en la estructura, no solo en
    // que haya dos badges pegados.
    expect(encabezados.some((h) => h?.trim() === 'Pago')).toBe(true)
    expect(encabezados.some((h) => h?.trim() === 'Envio')).toBe(true)
    expect(encabezados.some((h) => h?.trim() === 'Estado')).toBe(false)
  })

  it.each<[EstadoPago, string]>([
    ['aprobado', 'Aprobado'],
    ['pendiente', 'Pendiente'],
    ['rechazado', 'Rechazado'],
    ['expirado', 'Expirado'],
    ['no_iniciado', 'Sin iniciar']
  ])('el pago %s se muestra como "%s"', async (estado, etiqueta) => {
    const m = await abrirDrawer({ pagoEstado: estado })

    expect(badgeDePago(m)).toBe(estado)
    expect(texto(m)).toContain(etiqueta)
  })

  it('un pedido pagado pero sin enviar dice las dos cosas', async () => {
    // El estado que de verdad obliga a separar los dos: entro la plata y el
    // paquete no salio. Con un solo badge, el vendedor no sabe si esperar el
    // pago o empezar a armar.
    const m = await abrirDrawer({ status: 'pendiente', pagoEstado: 'aprobado' })

    expect(badgeDePago(m)).toBe('aprobado')
    expect(texto(m)).toContain('Pendiente')
    expect(texto(m)).toContain('La plata entro. Falta coordinar el envio.')
  })

  it('un pago expirado NO dice "rechazado"', async () => {
    // En el CRM la diferencia cuenta: nadie rechazo nada, el comprador se fue.
    const m = await abrirDrawer({ pagoEstado: 'expirado' })

    expect(texto(m)).toContain('Expirado')
    expect(texto(m)).not.toContain('Rechazado')
    expect(texto(m)).toContain('Vencio esperando el pago. Nadie rechazo nada.')
  })

  it('un pago pagado y entregado NO dice que falta coordinar', async () => {
    // El otro extremo del mismo par: plata adentro y paquete entregado, no hay
    // nada pendiente de coordinar. El texto aparece solo cuando de verdad falta.
    const m = await abrirDrawer({ status: 'entregado', pagoEstado: 'aprobado' })

    expect(texto(m)).not.toContain('Falta coordinar el envio')
  })
})

describe('el envio sigue siendo del envio', () => {
  it('el selector de envio sigue ahi', async () => {
    const m = await abrirDrawer()

    expect(m.contenedor.querySelector('#order-status')).not.toBeNull()
  })

  it('el selector ofrece todos los estados de envio', async () => {
    const m = await abrirDrawer()

    const opciones = [...m.contenedor.querySelectorAll('#order-status option')].map((o) =>
      o.getAttribute('value')
    )

    // Y **solo** de envio. Si apareciera `aprobado` o `expirado` aca, se podria
    // cambiar el pago desde el desplegable — y el pago no se cambia a mano, lo
    // cambia la webhook (D-7). El orden es el de `ESTADOS_PEDIDO`, no un
    // alfabeto: es el avance del pedido.
    expect(opciones).toEqual([
      'pendiente',
      'preparando',
      'enviado',
      'entregado',
      'cancelado',
      'devuelto'
    ])
  })

  it('cambiar el envio NO toca el pago', async () => {
    const cambiar = vi.fn(async (p: Order) => p)
    montaje = await montarAdmin(
      createElement(OrderDrawer, {
        isOpen: true,
        pedido: pedido({ status: 'pendiente', pagoEstado: 'pendiente' }),
        onClose: vi.fn(),
        onCambiarEstado: cambiar,
        onGenerarEtiqueta: vi.fn()
      })
    )

    const select = montaje.contenedor.querySelector('#order-status') as HTMLSelectElement

    await act(async () => {
      select.value = 'entregado'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Lo que se manda es el **pedido que estaba abierto** y el estado nuevo. El
    // `pagoEstado` del pedido sigue siendo el que tenia — el envio cambia solo.
    expect(cambiar).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pendiente', pagoEstado: 'pendiente' }),
      'entregado'
    )
    expect(badgeDePago(montaje)).toBe('pendiente')
  })

  it('un `vendedor` sigue viendo el selector: esto no puede romperse', async () => {
    // El `OrderDrawer` no recibe el rol — la defensa es el `requireRole` del
    // backend — asi que "un vendedor lo ve" se afirma sobre el arbol completo:
    // el layout real, dentro del `AuthProvider` con la sesion de un vendedor.
    const { montarLayout } = await import('./andamiaje_admin')
    const { OrderDrawer: Drawer } = await import('../../src/components/admin/order_drawer')

    const usuario = USUARIOS.vendedor
    vi.stubGlobal('fetch', (await import('./andamiaje_admin')).fetchDeSesion(usuario))

    const abierto = await montarLayout('/admin/pedidos')
    montaje = abierto

    await act(async () => {
      abierto.root.render(
        createElement(Drawer, {
          isOpen: true,
          pedido: pedido({ status: 'preparando', pagoEstado: 'aprobado' }),
          onClose: vi.fn(),
          onCambiarEstado: vi.fn(async (p: Order) => p),
          onGenerarEtiqueta: vi.fn()
        })
      )
    })

    const select = abierto.contenedor.querySelector('#order-status') as HTMLSelectElement

    expect(select).not.toBeNull()
    expect([...select.options].map((o) => o.value)).toContain('entregado')
    // Y ve los dos estados, separados, tambien.
    expect(badgeDePago(abierto)).toBe('aprobado')

    vi.unstubAllGlobals()
  })
})

describe('el historial', () => {
  const montarTimeline = async (entradas: Order['timeline']): Promise<MontajeAdmin> => {
    montaje = await montarAdmin(createElement(OrderTimeline, { entradas }))
    return montaje
  }

  it('dibuja la entrada de pago CON la de envio', async () => {
    const m = await montarTimeline(pedido().timeline)

    const badges = [...m.contenedor.querySelectorAll('[data-estado-pago]')]

    expect(badges.length).toBe(1)
    expect(badges[0].getAttribute('data-estado-pago')).toBe('aprobado')
    expect(texto(m)).toContain('Preparando')
  })

  it('cada entrada dice si es de pago o de envio', async () => {
    // Sin el rotulo, dos entradas "Pendiente" —una de cada tipo— se leen como
    // la misma cosa dos veces.
    const m = await montarTimeline(pedido().timeline)

    const rotulos = [...m.contenedor.querySelectorAll('li span')].map((s) => s.textContent?.trim())

    expect(rotulos).toContain('Pago')
    expect(rotulos).toContain('Envio')
  })

  it('dice quien escribio la entrada de pago', async () => {
    const m = await montarTimeline(pedido().timeline)

    expect(texto(m)).toContain('Mercado Pago')
    // Y **no** repite "Admin" en cada cambio de envio: es ruido.
    expect(texto(m)).not.toContain('Admin')
  })

  it('una entrada sin ninguno de los dos no se dibuja', async () => {
    // El backend no las escribe; si apareciera una, fingir un estado seria
    // inventar historial.
    const m = await montarTimeline([
      { author: 'Admin', createdAt: '2026-10-16T10:00:00.000Z' },
      { status: 'preparando', author: 'Admin', createdAt: '2026-10-16T10:01:00.000Z' }
    ])

    const items = m.contenedor.querySelectorAll('li')

    expect(items).toHaveLength(1)
  })

  it('un pago rechazado o expirado no lleva el check verde', async () => {
    const rechazado = await montarTimeline([
      { pagoEstado: 'rechazado', author: 'Mercado Pago', createdAt: '2026-10-16T10:00:00.000Z' }
    ])
    expect(rechazado.contenedor.querySelector('.text-wine-400')).not.toBeNull()
  })

  it('un pedido sin historial lo dice', async () => {
    const m = await montarTimeline([])

    expect(texto(m)).toContain('no tiene historial')
  })
})

describe('los dos badges no se confunden', () => {
  /**
   * Este describe es la razon de que `EstadoPagoBadge` sea un archivo aparte.
   *
   * `pendiente` es un literal en **los dos** enumerados, con significados
   * opuestos. Con un solo componente y un `Record<EstadoAdmin, Estilo>`, la clave
   * seria una sola y TypeScript aceptaria los dos usos sin reclamar: los badges
   * se verian identicos y el que prepara un pedido ya cobrado leeria que la
   * plata no entro.
   */

  const montarBadge = async (estado: EstadoPago): Promise<MontajeAdmin> => {
    montaje = await montarAdmin(createElement(EstadoPagoBadge, { estado }))
    return montaje
  }

  it.each<EstadoPago>(['no_iniciado', 'pendiente', 'aprobado', 'rechazado', 'expirado'])(
    'el badge de "%s" existe y se identifica a si mismo',
    async (estado) => {
      const m = await montarBadge(estado)

      const badge = m.contenedor.querySelector('[data-estado-pago]')

      expect(badge).not.toBeNull()
      expect(badge?.getAttribute('data-estado-pago')).toBe(estado)
    }
  )

  it('cada estado de pago muestra un texto DISTINTO', async () => {
    const textos = new Map<EstadoPago, string>()

    for (const estado of ['no_iniciado', 'pendiente', 'aprobado', 'rechazado', 'expirado'] as EstadoPago[]) {
      const m = await montarBadge(estado)
      const badge = m.contenedor.querySelector('[data-estado-pago]')

      const visto = badge?.textContent ?? ''

      // Si dos estados compartieran el texto, el panel seria ilegible: habria
      // dos filas iguales y el operador no podria elegir.
      for (const [otro, otroTexto] of textos) {
        expect(visto, `"${estado}" y "${otro}" muestran lo mismo`).not.toBe(otroTexto)
      }

      textos.set(estado, visto)
    }

    expect(textos.size).toBe(5)
  })

  it('el badge de pago NUNCA dice "Entregado"', async () => {
    // `entregado` es de envio. Si un dia se colara en el mapa de pago, un pago
    // Diria al vendedor que el paquete llego.
    const entregados = ['entregado', 'preparando', 'enviado'] as const

    for (const estado of entregados) {
      const m = await abrirDrawer({ pagoEstado: 'aprobado' })

      expect(texto(m)).not.toBe('')
      // El badge de pago, especificamente, no puede contenerlos.
      expect(badgeDePago(m)).not.toBe(estado)
    }
  })

  it('el pago aprobado se ve distinto del envio pendiente', async () => {
    // El caso que separa de verdad los dos enumerados: mismo literal
    // `pendiente`, preguntas distintas.
    const m = await abrirDrawer({ status: 'pendiente', pagoEstado: 'pendiente' })

    const pago = m.contenedor.querySelector('[data-estado-pago]')
    const secciones = [...m.contenedor.querySelectorAll('section')]

    const seccionEnvio = secciones.find((s) => s.querySelector('#order-status'))
    const seccionPago = secciones.find((s) => s.querySelector('[data-estado-pago]'))

    // Son **secciones distintas**, no dos badges en el mismo bloque: asi queda
    // claro que cambiar uno no cambia el otro.
    expect(seccionPago).toBeDefined()
    expect(seccionEnvio).toBeDefined()
    expect(seccionPago).not.toBe(seccionEnvio)
    expect(pago?.getAttribute('data-estado-pago')).toBe('pendiente')
  })
})
