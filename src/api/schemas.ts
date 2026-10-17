import { z } from 'zod'

/** ============================================================
 *  Auth
 *  ============================================================ */

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

export const refreshSchema = z.object({})

export const logoutSchema = z.object({})

export type LoginInput = z.infer<typeof loginSchema>
export type RefreshInput = z.infer<typeof refreshSchema>
export type LogoutInput = z.infer<typeof logoutSchema>

/** ============================================================
 *  Vinos — Admin
 *  ============================================================ */

const wineBaseSchema = z.object({
  id: z.string().cuid().optional(),
  name: z.string().min(1).max(200),
  winery: z.string().min(1).max(200),
  varietal: z.string().min(1).max(100),
  category: z.enum(['Tinto', 'Blanco', 'Rosado', 'Espumante']),
  vintage: z.number().int().min(1900).max(2100),
  price: z.number().int().positive(),
  description: z.string().max(5000).optional(),
  tastingNotes: z.string().max(5000).optional(),
  foodPairing: z.string().max(5000).optional(),
  imageUrl: z.string().url(),
  stock: z.number().int().nonnegative().default(0),
  activo: z.boolean().default(true)
})

export const wineCreateSchema = wineBaseSchema.omit({ id: true })
export const wineUpdateSchema = wineBaseSchema.partial().omit({ id: true })
export const wineImportSchema = wineBaseSchema.required({ id: true })
export const wineIdParamSchema = z.object({ id: z.string().cuid() })

export const wineQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  category: z.enum(['Tinto', 'Blanco', 'Rosado', 'Espumante']).optional(),
  varietal: z.string().optional(),
  status: z.enum(['activo', 'inactivo']).optional()
})

export type WineCreateInput = z.infer<typeof wineCreateSchema>
export type WineUpdateInput = z.infer<typeof wineUpdateSchema>
export type WineImportInput = z.infer<typeof wineImportSchema>
export type WineIdParam = z.infer<typeof wineIdParamSchema>
export type WineQuery = z.infer<typeof wineQuerySchema>

/** CSV Import */
export const importResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  errors: z.array(z.object({
    row: z.number().int().positive(),
    field: z.string(),
    message: z.string()
  }))
})

export type ImportResult = z.infer<typeof importResultSchema>

/** ============================================================
 *  Vinos — Público
 *  ============================================================ */

export const publicWineQuerySchema = z.object({})

/** ============================================================
 *  Pedidos
 *  ============================================================ */

export const orderQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  status: z.enum(['pendiente', 'preparando', 'enviado', 'entregado', 'cancelado', 'devuelto']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().optional()
})

export const orderIdParamSchema = z.object({ id: z.string().cuid() })

export const orderUpdateSchema = z.object({
  status: z.enum(['pendiente', 'preparando', 'enviado', 'entregado', 'cancelado', 'devuelto']).optional(),
  customerName: z.string().optional(),
  shippingAddress: z.record(z.string(), z.unknown()).optional()
}).superRefine((data, ctx) => {
  if (Object.keys(data).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Al menos un campo requerido'
    })
  }
})

export type OrderQuery = z.infer<typeof orderQuerySchema>
export type OrderIdParam = z.infer<typeof orderIdParamSchema>
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>

/** ============================================================
 *  Clientes
 *  ============================================================ */

export const customerQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  tags: z.string().optional()
})

export const customerIdParamSchema = z.object({ id: z.string().cuid() })

export const customerUpdateSchema = z.object({
  notes: z.string().optional(),
  tags: z.array(z.string()).optional()
}).refine(data => Object.keys(data).length > 0, 'Al menos un campo requerido')

export type CustomerQuery = z.infer<typeof customerQuerySchema>
export type CustomerIdParam = z.infer<typeof customerIdParamSchema>
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>

/** ============================================================
 *  Métricas
 *  ============================================================ */

export const metricsQuerySchema = z.object({})

/** ============================================================
 *  Upload
 *  ============================================================ */

export const uploadIdParamSchema = z.object({ id: z.string().uuid() })

/** ============================================================
 *  Health
 *  ============================================================ */

export const healthQuerySchema = z.object({})

/** ============================================================
 *  Tipos de respuesta (shared con backend)
 *  ============================================================ */

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface Wine {
  id: string
  name: string
  winery: string
  varietal: string
  category: 'Tinto' | 'Blanco' | 'Rosado' | 'Espumante'
  vintage: number
  price: number
  description: string | null
  tastingNotes: string | null
  foodPairing: string | null
  imageUrl: string
  stock: number
  activo: boolean
  createdAt: string
  updatedAt: string
}

export interface PublicWine {
  id: string
  name: string
  winery: string
  varietal: string
  category: 'Tinto' | 'Blanco' | 'Rosado' | 'Espumante'
  vintage: number
  price: number
  description: string | null
  tastingNotes: string | null
  foodPairing: string | null
  imageUrl: string
}

export interface OrderItem {
  wineId: string
  wineName: string
  imageUrl: string
  quantity: number
  price: number
}

/**
 * Una entrada del historial (spec 009).
 *
 * `status` y `pagoEstado` son **`string | null`**, no `string`. El backend los
 * devuelve asi desde que un evento de pago no cambia el envio: la entrada de
 * pago viene con `status: null` y la de envio con `pagoEstado: null`.
 *
 * Declararlos `string` era una mentira que el compilador no podia ver —nadie
 * asigna estos tipos a una respuesta real— y que se weep al primer evento de
 * pago: el panel receive un `null` donde el tipo decia `string`.
 */
export interface OrderTimelineEntry {
  id: string
  status: string | null
  pagoEstado: string | null
  origen: string
  note: string | null
  author: string
  createdAt: string
}

export interface Order {
  id: string
  customerId: string
  customer: Customer
  items: OrderItem[]
  total: number
  status: 'pendiente' | 'preparando' | 'enviado' | 'entregado' | 'cancelado' | 'devuelto'
  /**
   * Estado del pago (spec 009, D-7). Viene del `Order.pagoEstado` de Prisma por
   * el `...order` del handler, asi que esta en la lista y en el detalle.
   */
  pagoEstado: 'no_iniciado' | 'pendiente' | 'aprobado' | 'rechazado' | 'expirado'
  /** Id del pago en Mercado Pago. `null` mientras no se armo la Preference. */
  pagoId: string | null
  shippingAddress: Record<string, unknown>
  timeline: OrderTimelineEntry[]
  createdAt: string
  updatedAt: string
}

export interface Customer {
  id: string
  name: string
  email: string | null
  phone: string | null
  totalOrders: number
  totalSpent: number
  lastOrderAt: string | null
  tags: string[]
  notes: Note[]
  orders: Order[]
  createdAt: string
  updatedAt: string
}

export interface Note {
  id: string
  text: string
  author: string
  customerId: string
  createdAt: string
}

export interface Metrics {
  salesToday: number
  salesWeek: number
  salesMonth: number
  abandonedCarts: number
  avgTicket: number
  conversion: number
  salesLast30Days: Array<{ date: string; total: number }>
  topProducts: Array<{ wineId: string; name: string; revenue: number; count: number }>
  recentActivity: Array<{
    id: string
    type: 'order' | 'customer'
    description: string
    timestamp: string
    amount?: number
  }>
}

export interface UploadResponse {
  id: string
  url: string
}

export interface HealthResponse {
  status: 'ok' | 'error'
  timestamp: string
  uptime: number
  db: 'connected' | 'disconnected'
}

/** ============================================================
 *  Auth
 *  ============================================================ */

export interface JwtPayload {
  sub: string
  role: 'admin' | 'gestor' | 'vendedor'
  email: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  user: PublicUser
}

export interface PublicUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'gestor' | 'vendedor'
}