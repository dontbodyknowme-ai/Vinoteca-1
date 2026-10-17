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

/**
 * Los estados de envío, en el orden en que avanza el pedido.
 *
 * Vive **aquí** y no en dos lugares porque el schema de la query y el
 * `include` del dropdown del panel necesitan la misma lista, y duplicada se
 * desincroniza sin que nadie lo note.
 */
export const ESTADOS_PEDIDO_VALIDOS = [
  'pendiente',
  'preparando',
  'enviado',
  'entregado',
  'cancelado',
  'devuelto'
] as const

export type EstadoPedidoValido = (typeof ESTADOS_PEDIDO_VALIDOS)[number]

/**
 * Los estados de **pago** del filtro (spec 009, D-10).
 *
 * Van en el mismo `where` y con la misma logica de lista que los de envio, pero
 * en **otro filtro**: el panel los muestra en desplegables separados porque
 * `pendiente` significa una cosa distinta en cada uno (D-7). Un desplegable unico
 * con dos "Pendiente" seria un filtro que habria que adivinar.
 *
 * Los dos se combinan con AND entre listas y OR adentro: "los expirados que
 * todavia estan pendientes de envio" es una consulta valida, y es la que se hace
 * todos los dias para liberar el vino reservado.
 */
export const ESTADOS_PAGO_VALIDOS = [
  'no_iniciado',
  'pendiente',
  'aprobado',
  'rechazado',
  'expirado'
] as const

export type EstadoPagoValido = (typeof ESTADOS_PAGO_VALIDOS)[number]

/**
 * Filtro por estado: una **lista**, no un valor.
 *
 * ## Que estaba roto y por que
 *
 * Era `z.enum([...])`, o sea **un** estado. Pero el filtro del panel es un
 * multi-select que manda `?status=pendiente,enviado` — una cadena con comas, que
 * no es ningun miembro del enum. O sea que **marcabas una casilla y andaba;
 * marcabas dos y la consulta daba 400**. El paneldefinio el multi-select en el
 * 004-a, el backend acepto un valor solo en el 004-b, y nadie cruzo los dos.
 *
 * ## Por que lista y no "partir la cadena por comas"
 *
 * El querystring **no lo valida Zod**: `app.ts` compila el
 * `toJsonSchema(orderQuerySchema)` y lo pasa a AJV, y `request.query` es el valor
 * que AJV dejo, no el del `transform` de Zod. O sea que un `transform` que parta
 * la cadena **nunca correria** — el `.transform` se compila a JSON Schema, que no
 * sabe de transformaciones.
 *
 * Y una cadena con comas no se puede expresar en un `enum` de JSON Schema: no
 * hay forma de decir "uno de estos, repetido, separado por comas". El formato
 * que si se expresa, y que es el estandar de REST, es el **parametro repetido**:
 *
 *     ?status=pendiente&status=enviado
 *
 * Con `z.array(z.enum(...))`, `zod-to-json-schema` produce
 * `{ type: 'array', items: { enum: [...] } }` y AJV —que corre con
 * `coerceTypes`— convierte `"pendiente"` en `["pendiente"]`. O sea que un solo
 * estado tambien anda, y un estado inventado sigue dando **400**.
 */
export const orderQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  status: z
    .array(z.enum(ESTADOS_PEDIDO_VALIDOS))
    .min(1, 'El filtro de estado no puede estar vacio')
    .max(ESTADOS_PEDIDO_VALIDOS.length, 'Se mandaron mas estados de los que existen')
    .optional(),
  /**
   * El filtro de **pago**, en su propio campo (D-10).
   *
   * No se mete dentro de `status` porque un estado de envio y uno de pago se
   * nombran igual y significan cosas distintas: un `status=pendiente` tiene que
   * decir "pendientes de envio" y no "pendientes de pago". Con un solo campo, la
   * consulta seria ambigua y habria que adivinar.
   */
  pagoEstado: z
    .array(z.enum(ESTADOS_PAGO_VALIDOS))
    .min(1, 'El filtro de pago no puede estar vacio')
    .max(ESTADOS_PAGO_VALIDOS.length, 'Se mandaron mas estados de pago de los que existen')
    .optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().optional()
})

export const orderIdParamSchema = z.object({ id: z.string().cuid() })

export const orderUpdateSchema = z.object({
  status: z.enum(['pendiente', 'preparando', 'enviado', 'entregado', 'cancelado', 'devuelto']).optional(),
  customerName: z.string().optional(),
  shippingAddress: z.record(z.unknown()).optional()
}).refine(data => Object.keys(data).length > 0, 'Al menos un campo requerido')

export type OrderQuery = z.infer<typeof orderQuerySchema>
export type OrderIdParam = z.infer<typeof orderIdParamSchema>
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>

/** ============================================================
 *  Checkout — crear pedido (spec 009, T2)
 *  ============================================================ */

/**
 * Cuerpo de `POST /api/orders`, el endpoint **publico** del checkout.
 *
 * El comprador no tiene cuenta ni password (RF-01). Lo que se pide aca es lo
 * que se le preguntaria en un mostrador: nombre, apellido, telefono, email y
 * direccion.
 */

/**
 * Telefono, ya **sin espacios ni guiones**.
 *
 * ## Por que no se valida el numero argentino como tal
 *
 * La primera version de este regex era `^\+?54[\s-]?9?...$`, con el `54`
 * **obligatorio**. Funcionaba con `+54 9 11 1234-5678` y rechazaba
 * `11 1234-5678`, que es **como escribe el telefono casi todo el mundo** en la
 * Argentina: sin pais y sin el 9 de celular. O sea, la regex era correcta en su
 * propia logica y aun asi rechazaba al comprador tipico.
 *
 * Ahora: se limpian los separadores primero, y despues se exige una forma
 * razonable —signo opcional, pais opcional, 9 de celular opcional, y entre 9 y
 * 12 digitos. El 9 y el 54 son **opcionales** porque no son datos, son
 * convenciones de como se escribe.
 *
 * ## Lo que esto NO valida
 *
 * Que el numero exista. No se puede saber desde aca. Lo que evita es que
 * entren cosas que no son un numero: sin regex, `min(1)` deja pasar `"abc"` y el
 * pedido queda con un contacto con el que no se puede llamar a nadie.
 */
const TELEFONO_SIN_SEPARADORES = /^(\+54|54)?9?\d{9,12}$/

/**
 * **Un** item del carrito.
 *
 * Solo el **id** del vino y la cantidad. Deliberadamente no hay `precio` ni
 * `precioUnitario` (RNF-01): el carrito vive en el `localStorage` del
 * navegador, asi que cualquiera puede abrir las DevTools, poner `precio: 1` y
 * pedir un pedido de $150.000 por $2. El precio lo pone el backend leyendolo de
 * `Wine.price`.
 */
const checkoutItemSchema = z
  .object({
    vinoId: z.string().cuid(),
    cantidad: z.number().int().positive()
  })
  // `.strict()` y no la opcion `{ unknownKeys: 'strip' }` a proposito: con
  // `strip`, un `precioUnitario` de mas se borra en silencio y el cliente cree
  // que mando lo que queria. Rechazandolo se entera.
  .strict('El item no admite campos extra: el precio lo calcula el servidor')

export const orderCreateSchema = z
  .object({
    nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(100),
    apellido: z.string().trim().min(1, 'El apellido es obligatorio').max(100),
    /**
     * Se guardan **solo los digitos**, con el `+` si lo traia.
     *
     * Igual que el email: si `11 1234-5678` y `1112345678` quedan como dos
     * valores distintos en el CRM, el mismo telefono aparece partido. Y es el
     * unico dato de contacto que se puede normalizar sin perder nada.
     */
    telefono: z
      .string()
      .trim()
      .min(1, 'El telefono es obligatorio')
      // `.transform()` + `.pipe()` y no `.replace()`: en Zod 3.25 `replace` no
      // existe, y el `.regex()` tiene que correr **despues** de limpiar. Con
      // `transform` primero y `pipe` despues, el error sigue saliendo con el
      // camino `['telefono']`, que es lo que usa el frontend para marcar el
      // campo equivocado.
      .transform((telefono) => telefono.replace(/[\s().-]/g, ''))
      .pipe(
        z.string().regex(TELEFONO_SIN_SEPARADORES, 'El telefono no parece un numero valido')
      ),
    /**
     * **Obligatorio** y en minusculas (D-9).
     *
     * Es la identidad del comprador: si vuelve, se lo busca por este campo y se
     * reutiliza la ficha en vez de abrir un cliente nuevo.
     *
     * El `.toLowerCase()` va **dentro del schema** y no en el handler: la
     * busqueda y el guardado tienen que usar la misma forma, y si la
     * normalizacion quedara en dos lugares, uno de los dos se olvida y
     * `Ana@x.com` y `ana@x.com` terminan en dos fichas distintas — el
     * `@unique` de Postgres distingue mayusculas.
     */
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('El email no es valido')
      .max(254, 'El email es demasiado largo'),
    direccion: z.string().trim().min(1, 'La direccion es obligatoria').max(300),
    items: z.array(checkoutItemSchema).min(1, 'El carrito esta vacio')
  })
  .strict('El pedido no admite campos extra')

export type OrderCreateInput = z.infer<typeof orderCreateSchema>

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