# Plan 009 — Ventas con Mercado Pago

## Decisiones técnicas

### D-A — El checkout vive en el frontend, los pedidos en el backend

El comprador completa el formulario de datos en el frontend. Al confirmar, el frontend llama a `POST /api/orders` con los datos + items. El backend crea el pedido y devuelve una `preference_id` de Mercado Pago. El frontend redirige al comprador a `https://www.mercadopago.com.ar/checkout/v1/redirect?preference-id=<id>`.

> **Por qué `/api/orders` y no `/api/pedidos`** (corrección a la primera versión de
> este plan): el módulo `modules/orders/` ya existe, con `GET /api/orders` y
> `PATCH /api/orders/:id`. Un `modules/pedidos/` aparte sería **el mismo
> pedido en dos módulos**, con el panel leyendo uno y el checkout escribiendo el
> otro. Es el motivo por el que `tsconfig.json` declara las variables en un
> bloque y no repetidas por paso.

`POST /api/orders` es **público**: a diferencia del `GET` y el `PATCH`, no lleva
`requireRole`, porque lo llama alguien sin sesión. Los tres conviven en el mismo
archivo y cada uno declara su propio `preHandler`.

**Alternativa descartada:** Que el frontend cree la Preference directamente con el Access Token de Mercado Pago. Eso expone la credencial en el bundle público — cualquier persona puede verla desde las DevTools y crear pedidos falsos. El Access Token vive solo en el backend.

### D-B — El webhook actualiza el estado, no el frontend

El frontend redirige al comprador de vuelta a la tienda con un query param (`?pago=aprobado`). Eso es solo cosmético: la confirmación real viene del webhook de Mercado Pago al backend.

**Alternativa descartada:** Que el frontend consulte el estado del pedido hasta ver si cambió. Innecesario: el webhook ya hace el trabajo, y si el comprador cierra la pestaña antes de volver, el pedido se actualiza igual.

### D-C — Los pedidos sin pagar expiran con un cron job

Un `setInterval` en el backend revisa cada minuto los pedidos con
`pago in ('no_iniciado', 'pendiente')` y más de 10 minutos de antigüedad, y les
pone `pago = 'expirado'`.

> **Corrección:** expirar **no** pone `status = 'expirado'`. `expirado` no existe
> en `OrderStatus` (D-7), y aunque existiera significaría "el envío se venció",
> que no es lo que pasó. El envío de un pedido sin pagar no se venció: no se
> mandó nunca.

**Alternativa descartada:** Expirar en el frontend al volver de Mercado Pago. No sirve: si el comprador no vuelve, nadie expira el pedido.

### D-D — El carrito se vacía solo cuando el pago es aprobado

El webhook recibe `payment.approved`, el backend pone `pago = 'aprobado'` en el pedido y suma el total en el `Customer`, y el frontend vacía el carrito al volver con `?pago=aprobado`.

**Alternativa descartada:** Vaciar el carrito al crear el pedido. Si el comprador no paga, perdió el carrito.

### D-E — El total lo recalcula el backend a partir de `Wine.price`

> **Corrección a la primera versión de este plan**, que hacía
> `sum(items.map(i => i.precioUnitario * i.cantidad))`. El carrito vive en el
> `localStorage`: cualquiera puede editarlo desde las DevTools y pagar un pedido
> de $150.000 con $2.

Del pedido llega **qué** vinos y **cuántos**. El precio lo pone el backend, leyéndolo
de la base. El resultado es **el mismo número** que se guarda en `Order.total` y
el que se manda a Mercado Pago — no se calculan dos veces, porque si difirieran
la webhook podría aprobar un monto que el panel nunca muestra.

### D-F — El detalle público del pedido no devuelve datos del comprador

> **Corrección a la primera versión**, que tenía un `GET /api/pedidos/:id`
> público devolviendo nombre, teléfono y dirección. Cualquiera que consiga el id
> —un `cuid`, que se puede adivinar o filtrar— leía los datos personales de un
> cliente que **no tiene cuenta en el sistema**. Un dato que nunca se pidió más
> de lo necesario sigue siendo un dato expuesto.

El `GET /api/orders/:id` que ya existe **sigue con `requireRole`**. Para la
confirmación del comprador hay dos caminos:

- **Preferido:** el frontend guarda el `orderId` en `sessionStorage` y la
  confirmación muestra solo el número y el total, sin pedir nada al backend.
- **Si hace falta releer del servidor:** un endpoint público que devuelve
  **solo** `id` y `total`, y que responde `404` a cualquier otro `orderId`
  cuando la sesión no corresponde.

**Alternativa descartada:** devolver los datos del comprador desde el endpoint
público, "porque el comprador ya los puso". Precisamente por eso hay que
devolverlos: uno que ya los escribió igual tiene que poder recargar la página.

---

## Archivos y responsabilidades

### Backend (`backend/src/`)

> **Corrección:** la primera versión creaba `modules/pedidos/` con cuatro
> archivos, y `Pedido`/`PedidoItem`/`Comprador` en el schema. Los tres ya existen
> como `Order`/`OrderItem`/`Customer`, y `modules/orders/` ya tiene las rutas que
> el panel usa. Un módulo paralelo dejaría **dos fuentes de pedidos**.

| Archivo | Estado | Responsabilidad |
|---|---|---|
| `modules/orders/routes.ts` | **se extiende** | + `POST /api/orders` (público) y `POST /api/orders/webhook` |
| `modules/orders/service.ts` | **se extiende** | Crear pedido con total recalculado, aplicar pago, expirar |
| `shared/schemas.ts` | **se extiende** | `orderCreateSchema` (datos del comprador + items) |
| `modules/pagos/proveedor.ts` | **nuevo** | Crear Preference en Mercado Pago con el Access Token |
| `modules/orders/cron.ts` | **nuevo** | Expira pedidos sin pagar cada minuto |
| `prisma/schema.prisma` | **se extiende** | **Solo** `pagoEstado` + `pagoId`. Nada más |

### Frontend (`src/`)

| Archivo | Responsabilidad |
|---|---|
| `src/components/checkout/formulario.tsx` | Formulario de datos del comprador |
| `src/components/checkout/boton_pagar.tsx` | Botón que crea el pedido y redirige a Mercado Pago |
| `src/components/checkout/confirmacion.tsx` | Pantalla de confirmación post-pago |
| `src/components/admin/order_drawer.tsx` | **se extiende**: mostrar el estado del pago junto al del envío |

---

## Funciones y lógica

### 1. Crear pedido

```ts
// POST /api/orders            (público: sin requireRole)
// Body: { nombre, apellido, telefono, email?, direccion, items: [{ vinoId, cantidad }] }
// Res: { preferenceId, orderId }
```

> Del body **no** llega ningún precio. Solo qué vinos y cuántos (D-E).

1. Validar el body con Zod.
2. Resolver o crear el `Customer` (ver D-G de `spec.md`).
3. **Leer `Wine.price` de la base** y calcular el total. El precio del cliente no
   se mira: es un número que el usuario editó.
4. Crear la Preference en Mercado Pago:
   - `items`: `{ title, quantity, unit_price: <el precio de la base>, currency_id: 'ARS' }`
   - `payer`: `{ name, surname, email?, phone }` — **`address` va aparte y con el
     formato de Mercado Pago** (`street_name`, `street_number`, `city_name`,
     `zip_code`). Mandar la dirección como un string suelto la hace fallar.
   - `payment_methods.excluded_payment_types`: **`credit_card` y `debit_card`**.
     Si solo se excluye la primera, la segunda sigue apareciendo, y el usuario
     pidió que no haya tarjetas (RF-04).
   - `back_urls`: `{ success, failure, pending }` → al frontend con query param
5. Guardar el `Order` con `status: 'pendiente'` (envío) y
   `pagoEstado: 'no_iniciado'` (pago), y `total` con el número del paso 3.
6. Devolver `{ preferenceId, orderId }`.

### 2. Webhook de Mercado Pago

```ts
// POST /api/orders/webhook      (público, pero se valida la firma)
```

1. Validar la firma del header `x-signature` con el **secreto de la webhook**. Si
   no se valida, cualquiera que conozca la URL cambia el estado de cualquier
   pedido: hay que comparar contra el manifest y recién después mirar el body.
2. Consultar el pago con `GET /v1/payments/:id`. **El `status` del cuerpo de la
   webhook no se confía**: la webhook solo dice *qué* cambió.
3. Según ese `status`, poner `pagoEstado` en `aprobado` o `rechazado`.
4. **Idempotente:** si el pedido ya tiene ese `pagoEstado`, no se toca. Una
   webhook repetida no puede, por ejemplo, sumar dos veces el total al `Customer`.
5. Al aprobar, actualizar `Customer.totalOrders`, `.totalSpent` y `.lastOrderAt`.

### 3. Expirar pedidos sin pagar

```ts
// Cada minuto
const vencidos = await prisma.order.findMany({
  where: {
    pagoEstado: { in: ['no_iniciado', 'pendiente'] },
    createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) }
  }
})
await prisma.order.updateMany({
  where: { id: { in: vencidos.map((o) => o.id) } },
  data: { pagoEstado: 'expirado' }
})
```

> Se toca `pagoEstado`, **no** `status`. `Order.status` sigue siendo el del envío
> (D-7): un pedido que nadie pagó no tiene un envío vencido, tiene un envío que
> nunca se mandaron.

---

## Interfaz

### POST /api/orders  (público)

**Request:**
```json
{
  "nombre": "María",
  "apellido": "González",
  "telefono": "+5491112345678",
  "email": "maria@example.com",
  "direccion": "Av. Corrientes 1234, Buenos Aires",
  "items": [
    { "vinoId": "abc123", "cantidad": 2 }
  ]
}
```

**Response 201:**
```json
{
  "preferenceId": "123456789-abcdef",
  "orderId": "clx1234abcd",
  "total": 15000
}
```

> Sin `precioUnitario` en el `items`, sin `nombre` y sin `apellido`: es lo que
> ya no viaja. El backend los lee de la base y el `total` es su número.

### GET /api/orders/:id (el del panel, **con `requireRole`**)

Sin cambios: sigue exigiendo `admin`, `gestor` o `vendedor`, y sigue devolviendo
los datos del comprador. **Un `vendedor` sí puede verlos** — es su trabajo —, y es
el único dato del comprador que existe en el sistema.

**No hay un endpoint público que devuelva los datos del comprador** (D-F). La
confirmación post-pago se arma en el frontend con el `orderId` que dejó el
`POST`, guardado en `sessionStorage`.

---

## Estrategia de tests

| RF | Test |
|---|---|
| RF-01 | El comprador puede crear pedido sin token JWT |
| RF-02 | Nombre/apellido/teléfono/direccion obligatorios; email opcional |
| RF-03 | El pedido se crea con preference_id de Mercado Pago |
| RF-04 | La Preference excluye tarjeta de crédito |
| RF-05 | El pedido se guarda en DB con estado `pendiente` |
| RF-06 | El webhook marca pedido como `pagado` cuando payment es `approved` |
| RF-07 | Los pedidos pendientes expiran a los 10 minutos |
| RF-08 | El admin ve los datos del comprador en el listado |
| RF-09 | El frontend muestra confirmación con número de pedido |

---

## RF cubiertos

| RF | Se cubre en |
|---|---|
| RF-01 a RF-09 | Tareas T1 a T8 |
