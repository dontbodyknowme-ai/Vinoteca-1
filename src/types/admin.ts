import type { Wine } from './vino'

/**
 * El vino como lo ve el panel de administracion.
 *
 * `stock` y `activo` viven ACA y no en `Wine`, y eso es deliberado:
 *
 * - `stock` es un dato interno de la operacion. No hay razon para mandarlo al
 *   navegador de un visitante, y RF-06 de la spec 004-b define que el endpoint
 *   publico los omite. Que el tipo loimponga desde el lado del admin hace que
 *   unificar los dos sea un error de compilación, no una forgotencia.
 * - `activo` decide si el vino aparece en el catalogo. Es lo que permite sacarlo
 *   de la venta sin borrarlo del historial de pedidos.
 *
 * La alternativa era agregar los dos campos a `Wine`, y se descarto: los tests
 * preexistentes fijan el contrato de `Wine` y lo cierran por los dos lados.
 * `CAMPOS_REQUERIDOS` no puede incluirlos porque los fixtures de
 * `test/validadores.test.ts` arman un `Wine` sin ellos y RNF-05 protege su
 * contenido. Y `CAMPOS_OPCIONALES` tampoco, porque
 * `test/integridad_datos_vino.test.ts` exige que `esCampoOpcionalValido(0)` y
 * `esCampoOpcionalValido(false)` den `false`, y `stock: 0` y `activo: false` son
 * valores legitimos. Las dos listas quedan fuera, asi que el campo tiene que
 * vivir en un tipo aparte.
 */
export interface AdminWine extends Wine {
  /** Unidades disponibles. 0 es un valor valido, no "desconocido". */
  stock: number
  /** Si el vino se ofrece en el catalogo. */
  activo: boolean
}

// Estados de pedido. Fijos por D-15 de la spec 004-a: no son configurables.
export type OrderStatus =
  | 'pendiente'
  | 'preparando'
  | 'enviado'
  | 'entregado'
  | 'cancelado'
  | 'devuelto'

/**
 * Estado del **pago** (spec 009, D-7).
 *
 * ## Por que es un tipo aparte y no otro miembro de `OrderStatus`
 *
 * Porque **no son la misma pregunta**. `pendiente` aqui es "abrió Mercado Pago y
 * no terminó"; `pendiente` en `OrderStatus` es "estamos armando el paquete". El
 * mismo texto con dos significados opuestos es exactamente el problema que la
 * spec vino a separar, y no se arregla abriendo otro valor: se arregla poniendo
 * la pregunta en otro campo.
 *
 * Por eso el panel tiene **dos badges distintos** y no uno parametrizado: con un
 * solo componente, TypeScript aceptaria `'pendiente'` en los dos sitios y el
 * color dependeria de cual de los dos literales llego primero.
 */
export type EstadoPago =
  | 'no_iniciado'
  | 'pendiente'
  | 'aprobado'
  | 'rechazado'
  | 'expirado'

export interface AdminUser {
  isAdmin: boolean
  name: string
  email: string
}

export interface OrderItem {
  wineId: string
  wineName: string
  imageUrl: string
  quantity: number
  price: number
}

/**
 * Un evento del pedido: **del envio o del pago**, nunca los dos.
 *
 * `status` es opcional porque una entrada de pago no cambia el envio: si fuera
 * obligatorio, el unico modo de registrar "Mercado Pago aprobo esto" seria meter
 * un estado de envio falso, que miente en el historial y en `Order.status`.
 *
 * Por eso el backend cambio `status` a nullable en la misma migracion, y por eso
 * el `GET /api/orders/:id` tiene que devolverlo sin cortarlo (gotcha 11 de
 * `AGENTS.md`: un `status: { type: 'string' }` descarta el `null`).
 */
export interface OrderTimelineEntry {
  status?: OrderStatus
  pagoEstado?: EstadoPago
  /** "Mercado Pago" en las de pago, "Admin" en las de envio. */
  author: string
  note?: string | null
  /**
   * Se llama `createdAt` y antes `timestamp`, y el nombre es el de la API.
   *
   * No habia ningun lugar que tradujera uno al otro —`GET /api/orders/:id`
   * devuelve las filas de `OrderTimeline` tal cual— asi que el nombre del panel
   * era un campo que **nadie llenaba**: `order_timeline.tsx` renderizaba
   * `Invalid Date` en cada entrada del historial. Renombrar el tipo es la
   * version corta de arreglarlo; la larga es una capa de traduccion que no
   * existe y que nadie pidio.
   *
   * Lo mismo con `customerName` / `customerEmail`: la API manda
   * `customer: { id, name, email }` anidado. Ese no se toco porque lo leen la
   * tabla, el drawer y el CSV, y cambiarlo es una decision aparte.
   */
  createdAt: string
}

export interface ShippingAddress {
  street: string
  city: string
  zip: string
  phone: string
}

/**
 * El cliente **tal como viene dentro de un pedido**.
 *
 * ## Por que no es el `Customer` del CRM
 *
 * Porque `GET /api/orders` incluye `customer: { select: { id, name, email } }`:
 * **tres campos**. Si el tipo dijera el `Customer` completo —con tags, notas y
 * `orders`—, el panel leeria `pedido.customer.tags` y obtendria `undefined` en
 * una columna que existe en el CRM y no aca. Es el mismo bug al reves del que
 * ya se corrigio con `createdAt`: **un tipo que promete campos que no llegan**.
 *
 * Y no se agranda el `select` para "que esten todos": el pedido lo lee el
 * vendedor veinte veces por pagina y los tags no los necesita nadie.
 *
 * ## Por que anidado y no `customerName` plano
 *
 * Porque es lo que la API manda. Antes el tipo pedia `customerName` y
 * `customerEmail` planos, y no habia ninguna capa que los armara: el panel
 * mostraba el **nombre del cliente en vacio** en la columna de la tabla, en el
 * drawer y en el CSV. Un solo nombre, un solo tipo.
 */
export interface ClienteDelPedido {
  id: string
  name: string
  email: string | null
}

export interface Order {
  id: string
  customerId: string
  /** Anidado, como lo manda la API. Antes se leia plano y salia `undefined`. */
  customer: ClienteDelPedido
  items: OrderItem[]
  total: number
  /** Estado del envio. Lo cambia el panel a mano cuando un vendedor entrega. */
  status: OrderStatus
  /** Estado del pago. Lo cambia la webhook de Mercado Pago. Nunca a mano. */
  pagoEstado: EstadoPago
  shippingAddress: ShippingAddress
  timeline: OrderTimelineEntry[]
  createdAt: string
  updatedAt: string
}

export interface CustomerNote {
  id: string
  text: string
  author: string
  createdAt: string
}

export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  totalOrders: number
  totalSpent: number
  lastOrderAt: string | null
  tags: string[]
  notes: CustomerNote[]
  createdAt: string
}

export interface DailySale {
  date: string
  revenue: number
  orders: number
}

export interface TopProduct {
  wineId: string
  name: string
  imageUrl: string
  units: number
  revenue: number
}

export interface RecentActivity {
  type: 'order' | 'customer'
  id: string
  description: string
  timestamp: string
}

// Los dos ultimos campos siempre valen 0 hasta que exista tracking de
// carritos y de sesiones, que esta fuera de alcance (RF-13 de la spec 004-b).
export interface Metrics {
  salesToday: number
  salesWeek: number
  salesMonth: number
  abandonedCarts: number
  avgTicket: number
  conversion: number
  salesLast30Days: DailySale[]
  topProducts: TopProduct[]
  recentActivity: RecentActivity[]
}

// Forma de la respuesta paginada de los endpoints de administracion.
export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface AdminFilters {
  search: string
  category: string
  varietal: string
  status: string
  dateFrom: string
  dateTo: string
}

export interface ImportResult {
  created: number
  updated: number
  errors: Array<{
    row: number
    field: string
    message: string
  }>
}

// Reexportado para que los componentes admin no tengan que importar de dos
// lugares distintos cuando solo necesitan el tipo del vino.
export type { Wine }