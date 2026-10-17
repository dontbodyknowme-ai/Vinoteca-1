# Tareas 009 — Ventas con Mercado Pago

> Las tareas se reescribieron el 2026-10-16. La versión anterior pedía crear
> los modelos `Pedido`, `PedidoItem` y `Comprador`, que **ya existen** como
> `Order`, `OrderItem` y `Customer`, y usaba `Order.status` para el pago, cuando
> ese campo ya significa el estado del envío. Ver `spec.md` §2.3 y D-7.

## T1 — Campo del estado del pago

**Cubre:** RF-05, RF-06

**Hecho cuando:**
- `Order` tiene `pagoEstado` (enum `EstadoPago`: `no_iniciado`, `pendiente`,
  `aprobado`, `rechazado`, `expirado`), default `no_iniciado`
- `Order` tiene `pagoId String?` (el id del pago en Mercado Pago)
- **`Order.status` no se toca**: sigue siendo el del envío, con sus seis valores
- `OrderTimeline` ya existe y los cambios de pago se asientan ahí
- `npm run db:migrate` corre sin errores
- Test: el enum `EstadoPago` tiene exactamente esos cinco valores

> **Lo único que esta tarea agrega al schema.** Si también creara modelos
> paralelos, el panel dejaría de ver los pedidos nuevos: se guardarían en tablas
> que `GET /api/orders` no lee.

---

## T2 — Esquemas Zod para crear pedido

**Cubre:** RF-02

**Hecho cuando:**
- `orderCreateSchema` valida: nombre (no vacío), apellido (no vacío), teléfono
  (formato válido), email (**obligatorio**, formato válido), dirección (no
  vacía), items (array **no vacío** de `{ vinoId, cantidad > 0 }`)
- **El email se normaliza a minúsculas** dentro del schema, no en el handler
  (D-9). Si la normalización queda en dos lugares, uno de los dos se olvida
- **El schema rechaza `precioUnitario`** si viene. No es "lo ignoramos": es
  rechazarlo, así que un cliente viejo que lo mande se entera en vez de creer
  que pagó el precio que quiso
- Test: body sin `nombre` → 400
- Test: body sin `email` → 400 (**ya no es opcional**, D-9)
- Test: `Ana@X.com` sale del schema como `ana@x.com`
- Test: body con `items: []` → 400
- Test: body con `precioUnitario` → 400
- Test: `cantidad: 0` y `cantidad: -1` → 400
- Test: `vinoId` vacío → 400

---

## T3 — Crear pedido + Preference de Mercado Pago

**Cubre:** RF-03, RF-04, RF-05 · **RNF-01, RNF-04**

**Hecho cuando:**
- `POST /api/orders` es **público** (sin `requireRole`, a diferencia del `GET` y
  el `PATCH` del mismo archivo)
- El total se calcula **leyendo `Wine.price` de la base**. El precio del cliente
  no se mira
- El `total` guardado en `Order.total` y el que se manda a Mercado Pago son **el
  mismo número**, no dos cálculos
- Se crea la Preference con `excluded_payment_types` para **`credit_card` y
  `debit_card`** (si solo se excluye la primera, sigue apareciendo la otra)
- La `payer.address` va con el formato de Mercado Pago (`street_name`,
  `street_number`, `city_name`, `zip_code`), no como un string
- El access token **no** sale del backend (RNF-04)
- Test: mandando `precioUnitario: 1` el total sigue siendo el de la base
- Test: la Preference excluye las dos tarjetas
- Test: un token ajeno no alcanza para leer el pedido creado

---

## T4 — Webhook de Mercado Pago

**Cubre:** RF-06 · **RNF-02**

**Hecho cuando:**
- `POST /api/orders/webhook` valida la firma `x-signature` contra el secreto
- **El `status` del cuerpo no se confía**: se consulta `GET /v1/payments/:id` a
  Mercado Pago y se usa ese
- `approved` → `pagoEstado = 'aprobado'`; `rejected` → `'rechazado'`
- **Idempotente**: una webhook repetida no cambia el estado dos veces ni suma el
  total dos veces al `Customer`
- Al aprobar, actualiza `Customer.totalOrders`, `.totalSpent` y `.lastOrderAt`
- Test: firma inválida → 401
- Test: approved → `pagoEstado` en `aprobado`
- Test: la **misma** webhook dos veces → el `totalSpent` del `Customer` se suma
  **una sola vez**

---

## T5 — Expiración de pedidos sin pagar

**Cubre:** RF-07

**Hecho cuando:**
- Un cron corre cada minuto
- Pedidos con `pagoEstado in ('no_iniciado', 'pendiente')` y más de 10 minutos →
  `pagoEstado = 'expirado'`
- **`Order.status` no se toca**
- Test: pedido de 11 minutos sin pagar → `expirado`, y `status` sigue `pendiente`

---

## T6 — Formulario de checkout en el frontend

**Cubre:** RF-01, RF-02, RF-03

**Hecho cuando:**
- `FormularioCheckout` con nombre, apellido, teléfono, **email** y dirección.
  **No pide DNI ni contraseña**
- El email es un campo requerido y el error sale debajo del campo, como el
  resto (la spec 004-a ya fijó esa convención en el login)
- Los cuatro obligatorios no pueden estar vacíos
- Al confirmar → `POST /api/orders` con los datos + `{ vinoId, cantidad }` del
  carrito. **Sin precios**
- Con la `preferenceId` → redirige a
  `https://www.mercadopago.com.ar/checkout/v1/redirect?preference-id=<id>`
- Test del componente: el botón no se habilita con campos vacíos

---

## T7 — Pantalla de confirmación post-pago

**Cubre:** RF-09

**Hecho cuando:**
- Al volver con `?pago=aprobado`, muestra el número y el total desde
  `sessionStorage`
- **No consulta un endpoint público** para releer los datos del comprador (D-F)
- Se vacía el carrito
- Al volver con `?pago=fallido`, avisa y ofrece reintentar
- Test: sin `orderId` en `sessionStorage`, la página no rompe ni inventa un total

---

## T8 — El panel ve el estado del pago

**Cubre:** RF-05, RF-08

**Hecho cuando:**
- `order_drawer.tsx` muestra **estado del pago** y **estado del envío**, juntos
  pero separados: "Pago: aprobado" y "Envío: en camino" son dos hechos distintos
- El filtro del módulo sigue filtrando por **envío**. Filtrar por pago es
  abierto (D-G)
- **Un `vendedor` puede seguir pasando un pedido a `Entregado`** — esto ya
  funciona y esta tarea no puede romperlo
- Test: un `vendedor` sigue viendo el selector de estado del envío
- Test: el drawer muestra el pago y el envío por separado

---

## Al terminar

- [x] `npm run typecheck && npm run lint && npm test` en verde — **305 tests**, 17 archivos
- [x] `cd backend && npm run typecheck && npm run test` en verde — **326 tests**, 22 archivos
- [x] Los criterios de `spec.md` §7 — 6 de 8; los 2 restantes son las credenciales
- [x] `AGENTS.md` y `MEMORY.md` actualizados
- [x] Merge **solo** si lo pide el usuario — el usuario dijo que **no**, y por qué

## Antes de empezar

- [ ] **Access Token de Mercado Pago** — externo, no lo puede crear el agente
- [ ] **Secreto de la webhook** y la URL pública configurada

> Sin los dos, T1, T2, T5, T6, T7 y T8 se pueden hacer y verificar enteras. T3 y
> T4 se escriben pero no se pueden probar contra la pasarela real.

---

## Estado al 2026-10-16

**T1 a T8 hechas y verificadas una por una**, con sabotage en cada una. Después
del plan original se agregaron, por cosas que aparecieron al verificar:

| Commit | Qué |
|---|---|
| `218588e` | T6 y T7 — el checkout y la confirmación |
| `09be4e3` | T8 — el panel ve el pago y el envío por separado |
| `e412a18` | La costura entre las dos puntas, y el bug de `Invalid Date` |
| `d36b58c` | El nombre de la tienda seguía siendo "Cava & Co" en Configuración |
| `602b0c8` | El nombre del cliente salía vacío en tabla, drawer y CSV |
| `30d9cd5` | El filtro multi-select no andaba con dos estados (`400`) |
| `48282e7` | D-10 resuelta — el panel filtra por pago |

**Nada de esto estaba en el plan y los tres primeros eran bugs de producción
preexistentes** (004-c) que aparecieron al verificar la integración. No se
arreglaron de paso: se pararon, se midieron, y se documentaron por separado.

## Lo que falta, en orden

1. **`MERCADO_PAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET`** en `backend/.env`.
   Sin esto la app **levanta** y todo funciona menos los pagos, que quedan colgados
   esperando una webhook que nunca llega.
2. **Registrar la `notification_url`** en el panel de Mercado Pago apuntando a
   `https://vinoteca-cava.onrender.com/api/orders/webhook` (ver `spec.md` §2.6).
3. **Aplicar dos migraciones** en Neon: `20261016132000_pago_estado_y_pago_id` y
   `20261016190000_timeline_pagos`. Están en el Postgres local y **no** en producción.
4. **Probar contra la pasarela** un pago completo, con sandbox.
5. **Merge**, cuando lo pida. No antes.
