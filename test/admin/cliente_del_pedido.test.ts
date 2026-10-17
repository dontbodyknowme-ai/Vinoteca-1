import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { desmontarAdmin, montarAdmin, type MontajeAdmin } from './andamiaje_admin'
import { OrderDrawer } from '../../src/components/admin/order_drawer'
import { csvPedidos } from '../../src/utils/csv_export'
import type { Order } from '../../src/types/admin'

/**
 * El nombre del cliente **se ve**.
 *
 * ## Que pasaba
 *
 * `GET /api/orders` devuelve `customer: { id, name, email }` anidado y el panel
 * leia `pedido.customerName`, que no existe y que nadie armaba. O sea que la
 * columna Cliente de `/admin/pedidos` salia **vacia**, el drawer no mostraba
 * nombre ni email, y el CSV exportaba una columna de clientes en blanco.
 *
 * ## Por que el typecheck no era suficiente
 *
 * Con el tipo corregido, `customerName` deja de existir y **no compila**. O sea
 * que el arreglo ya no se puede deshacer por accidente. Este archivo existe
 * para afirmar lo otro: que el dato **llega a la pantalla**, no solo que el
 * campo tiene el nombre correcto.
 *
 * Y para el CSV, que es el caso donde el error duele mas: un archivo con una
 * columna de clientes en blanco se abre en Excel, se ve **completo**, y el que
 * lo pidio no tiene forma de saber que le falta la mitad de la informacion.
 */

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
  shippingAddress: {
    street: 'Av. Corrientes 1234',
    city: 'Buenos Aires',
    zip: '1414',
    phone: '1112345678'
  },
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:05:00.000Z',
  timeline: [],
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

describe('el drawer muestra el nombre del cliente', () => {
  it('el nombre esta en pantalla', async () => {
    const m = await abrirDrawer()

    expect(m.contenedor.textContent ?? '').toContain('María González')
  })

  it('el email tambien', async () => {
    const m = await abrirDrawer()

    expect(m.contenedor.textContent ?? '').toContain('maria@example.com')
  })

  it('un cliente sin email muestra un guion, no un hueco', async () => {
    // `Customer.email` es opcional en la base. Sin el `?? '—'`, React renderiza
    // el `null` como cadena vacia y la linea queda **indistinguible** de un
    // hueco del layout: no se sabe si el cliente no tiene email o si algo no
    // cargo.
    //
    // Y por eso el aserto es el guion y no `not.toContain('undefined')`: React
    // nunca imprime "undefined" por un `null`, asi que esa comprobacion pasa
    // con y sin el `??` — comprobada en contra: quitarlo deja el test en verde.
    const m = await abrirDrawer({
      customer: { id: 'cus_2', name: 'Sin Email', email: null }
    })

    const texto = m.contenedor.textContent ?? ''

    expect(texto).toContain('Sin Email')
    expect(texto).toContain('—')
  })
})

describe('el CSV exporta el nombre', () => {
  const cliente = (): string => {
    const csv = csvPedidos([pedido()])

    return csv
  }

  it('la fila tiene el nombre del cliente', () => {
    expect(cliente()).toContain('María González')
  })

  it('la fila tiene el email', () => {
    expect(cliente()).toContain('maria@example.com')
  })

  it('sin email, la celda queda vacia y el archivo sigue siendo valido', () => {
    const csv = csvPedidos([
      pedido({ customer: { id: 'cus_2', name: 'Sin Email', email: null } })
    ])

    expect(csv).toContain('Sin Email')
    expect(csv).not.toContain('undefined')
  })

  it('el nombre con coma no rompe las columnas', () => {
    // Un nombre con coma **parte la fila en dos** en un CSV sin comillas. El
    // comprador se llama asi de verdad: "González, María".
    const csv = csvPedidos([
      pedido({ customer: { id: 'cus_3', name: 'González, María', email: 'a@b.com' } })
    ])

    // Con el nombre entre comillas, la linea sigue teniendo el mismo numero de
    // campos que la cabecera.
    const lineas = csv.split('\n').filter((linea) => linea.trim() !== '')
    const cabecera = lineas[0].split(',').length

    for (const linea of lineas.slice(1)) {
      // Cuenta los campos respetando las comillas.
      const campos = (linea.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).filter(Boolean).length

      expect(campos, linea).toBe(cabecera)
    }
  })
})
