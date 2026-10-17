# Spec 009 — Ventas con Mercado Pago

**Estado:** `implementada, sin mergear` (rama `spec-009`, 18 commits adelante de `main`)
**Spec:** `009`
**Creada:** 2026-10-15
**Gobernada por:** `docs/CONSTITUCION.md`
**Spec previa:** `specs/006-permisos-rol/` (completa)
**Spec siguiente:** ninguna. La `010-catalogo-real` que se anunciaba acá **se borró**: sus decisiones abiertas se pasaron a esta spec antes de escribir una línea de código, y con esa fusión ya no quedaba nada que justifique un `specs/010-`.

---

## 1. Objetivo

Permitir que un visitante compre productos de la tienda sin necesidad de registrarse, pagando a través de Mercado Pago con cualquier medio de pago excepto tarjeta de crédito. El envío se coordina aparte con el cliente.

### 1.1 Definiciones

- **Comprador:** Persona que visita la tienda, agrega productos al carrito y paga. No tiene cuenta de usuario en el sistema.
- **Pedido:** Registro de una compra confirmada o pendiente de pago.
- **Webhook:** Notificación que Mercado Pago envía al backend cuando el estado de un pago cambia.
- **Medio de pago:** Forma en que el comprador paga (efectivo, transferencia, Mercado Pago balance, etc.).

---

## 2. Contexto

### 2.1 Estado actual

| Aspecto | Valor |
|---|---|
| Catálogo | 12 vinos mock generados con PRNG sembrado |
| Carrito | `localStorage` con `vinoteca_cart` |
| Backend | Fastify en `:3000`, spec 004-b completa |
| Auth | JWT access 15min + refresh rotativo 7d cookie httpOnly (solo admin/gestor/vendedor) |
| Pedidos (admin) | Existe módulo de pedidos en el panel, pero no hay flujo de compra del lado del cliente |

### 2.2 Decisiones confirmadas

| # | Decisión | Estado |
|---|---|---|
| D-1 | El comprador NO necesita login ni cuenta | Confirmada |
| D-2 | Se usa Mercado Pago como pasarela de pago | Confirmada |
| D-3 | NO se acepta tarjeta de crédito ni pagos en cuotas | Confirmada |
| D-4 | El envío se coordina aparte con el cliente (no lo calcula Mercado Pago) | Confirmada |
| D-5 | El backend debe estar expuesto con dominio + HTTPS para recibir webhooks | **Cumplida sin hacer nada** — ver §2.6 |
| D-6 | La migración del catálogo real **no** se hace en esta spec | Confirmada — ver §2.6 |
| D-7 | El estado del pago va en un **campo nuevo**; `Order.status` sigue siendo del envío | **Confirmada** (usuario, 2026-10-16) |
| D-8 | Se **reutilizan** `Order`, `OrderItem` y `Customer`. No se crean modelos paralelos | **Confirmada** — ver §2.3 |
| D-9 | Un comprador que vuelve es el **mismo `Customer`**, y el email es **obligatorio** | **Confirmada** (usuario, 2026-10-16) |
| D-10 | El panel **filtra por estado de pago**, en un desplegable aparte del de envío | **Confirmada** (usuario, 2026-10-16) — ver §2.5 |
| D-11 | ¿Mercado Pago se implementa de una o en dos partes? | 🟡 **ABIERTA** — ver `task.md` |

### 2.4 D-9 — Un comprador que vuelve es el mismo `Customer`

**Decisión (usuario, 2026-10-16): ficha de cliente, con email obligatorio.**

El checkout **busca por email**; si existe, reutiliza la ficha. Si no, crea una.
Un comprador que compra dos veces tiene **dos pedidos y una** ficha, y
`totalOrders` / `totalSpent` crecen. Es lo que el módulo CRM ya asume.

**Por qué el email pasó a obligatorio.** La versión anterior lo tenía opcional
(RF-02), y eso rompe la decisión por dos lados:

- **Choca con el `@unique`.** Dos compradores con el mismo email son la misma
  persona, y uno sin email no es nadie. Con email opcional, la ficha no tiene
  forma de decir a quién pertenece.
- **Sin email no hay identidad.** Dos compradores que no dejan email **no se
  pueden distinguir nunca**. Cada compra abriría un cliente distinto, el CRM
  mostraría el mismo nombre dozens de veces, y `totalSpent` sería la suma de
  compras de gente que no sabemos quién es.

Es un costo —se pide un dato que antes no se pedía— a cambio de que el resto del
sistema funcione. **RF-02 se actualizó** y los casos límite también.

Tres detalles que la decisión obliga, y que se implementan en T2:

| Detalle | Qué hay que hacer |
|---|---|
| **Mayúsculas** | `Ana@x.com` y `ana@x.com` son el mismo correo para cualquiera, pero **distintos** para el `@unique` de Postgres. Se guarda **siempre en minúsculas**. Sin eso, una persona se parte en dos fichas por escribir su email con otra capitalización |
| **Carrera** | Dos checkouts del mismo email a la vez: los dos buscan, los dos no encuentran, los dos insertan, y uno se lleva un `P2002` de violation de unique. Se captura y se reintenta la búsqueda |
| **Teléfono** | `Customer.phone` es `String?` y **se actualiza** con el valor nuevo cuando la persona escribe uno distinto. Es el único dato de contacto que se corrige solo |

### 2.5 D-10 — ¿El panel filtra por estado de pago? — **RESUELTA**

**Decisión (usuario, 2026-10-16): sí, y en un desplegable aparte.**

El filtro de `/admin/pedidos` ya era por **estado de envío** y consultaba
`?status=`. Con el pago en campo nuevo, el panel **no podía filtrar "cuánto
cobraron hoy"** sin abrir pedido por pedido — y con Mercado Pago eso es lo grave:
el 90 % de los pedidos quedan en `Pendiente` de envío mientras su pago está en
cinco estados distintos. Para el local, lo que hay que encontrar es *"los
expirados, hay que liberar el vino"* y *"los aprobados sin enviar, hay que
preparar"*.

**Por qué dos desplegables y no uno.** `pendiente` significa *"estamos armando el
paquete"* en el filtro de envío y *"abrió Mercado Pago y no terminó"* en el de
pago. En un menú único habría que adivinar cuál de los dos se está filtrando:
exactamente la ambigüedad que D-7 vino a separar.

**Cómo se combinan.** `pagoEstado` va en su **propio** campo del `where` con
`in`, y Prisma pone el AND entre claves solo: "expirados **y** pendientes de
envío" no necesita un `AND` escrito a mano. Adentro de cada lista es OR.

**Lo que esta decisión NO incluye.** No cambia el `requireRole`: el filtro usa el
mismo endpoint y los mismos tres roles que ya lo veían todo. No agrega un campo
de búsqueda nuevo ni reordena columnas.

### 2.6 D-5 y D-6 — Se cumplieron solas

**D-5 (dominio + HTTPS)** decía "pendiente de dominio". **No hizo falta comprar
ni configurar nada**: desde la 005 el backend ya está en
`vinoteca-cava.onrender.com`, que es un dominio propio de Render con HTTPS y
llegable desde internet. La `notification_url` **se arma sola** en el checkout,
sin hardcodearla:

```ts
const webhookUrl = `${process.env.PUBLIC_API_URL ?? ''}/api/orders/webhook`
```

O sea que la URL es correcta siempre que `PUBLIC_API_URL` esté bien en Render. Y
**ese "siempre que" hay que verificarlo**: la variable ya rompió en silencio dos
veces — una al renombrar el servicio, otra por tener `NODE_ENV` mal puesto— y
ninguna dio error (gotchas 23 y 27 de `AGENTS.md`). Con la variable vacía,
`notification_url` queda con una ruta relativa, Mercado Pago **no puede
notificar**, y el síntoma es exactamente "los pagos no se actualizan solos".

Queda **una** cosa, y no es un dominio: registrar la URL en el panel de Mercado
Pago para que la integración empiece a notificar. Va con las credenciales.

> **Riesgo del plan free que conviene tener anotado.** Render free apaga el
> servicio tras un rato de inactividad, así que el primer webhook puede caer en
> un *cold start* y tardar decenas de segundos. Mercado Pago espera una respuesta
> rápida y reintenta. **La webhook es idempotente justamente por eso** — la
> transición la hace un `updateMany` condicional y la segunda entrega no suma dos
> veces al `Customer`—, así que un reintento es el caso previsto y no un bug. No
> se pagó ningún Cold Start Off: cuesta plata y el diseño ya aguanta.

**D-6** decía "la migración del catálogo real se hace en la spec 010". La `010`
**no existe**: se borró porque sus decisiones abiertas se pasaron a esta spec. La
migración de los datos mock a un catálogo real sigue **sin escribirse**, y es
spec nueva cuando haga falta — no es un pendiente de esta.

### 2.3 Corrección: los modelos ya existen

La primera versión de esta spec proponía crear los modelos `Pedido`, `PedidoItem`
y `Comprador`. **Los tres ya existen, con otros nombres**, y están completos para
el checkout:

| Lo que la spec pedía | Lo que ya existe |
|---|---|
| `Pedido` con estado, total y dirección | `Order` — `total Int`, `status OrderStatus`, `shippingAddress Json` |
| `PedidoItem` | `OrderItem` |
| `Comprador` con nombre, teléfono y email | `Customer` — `name`, `phone?`, `email?`, `totalOrders`, `totalSpent` |

Crear modelos paralelos **dejaría al panel sin ver los pedidos nuevos**: se
guardarían en tablas que `GET /api/orders` no lee. Es el mismo patrón de "la
interfaz promete algo que el backend no tiene", pero al revés.

**Lo único que esta spec agrega al schema es el campo del pago.**

---

## 3. Requisitos funcionales

### RF-01 — El comprador puede iniciar el pago sin estar logueado

CUANDO un visitante tiene productos en el carrito y pulsa "Pagar", EL SISTEMA debe permitirle continuar **sin cuenta, sin contraseña y sin registro previo**. Pregunta sus datos de contacto como se pregunta en un local —nombre, teléfono, dirección, email— y con eso alcanza; no hay nada que crear ni que recordar después.

### RF-02 — Datos del comprador

CUANDO el comprador pulsa "Pagar", EL SISTEMA debe pedirle:

| Campo | Obligatorio | Validación |
|---|---|---|
| Nombre | Sí | No vacío |
| Apellido | Sí | No vacío |
| Teléfono | Sí | Formato telefónico válido |
| Email | **Sí** | Formato email válido. Se guarda en **minúsculas** (D-9) |
| Dirección de envío | Sí | No vacío |

**El DNI no se pide.**

> **Cambio respecto de la versión anterior:** el email era opcional. Con D-9 pasó
> a obligatorio: es lo que identifica al comprador y lo que evita partirlo en dos
> fichas. Ver §2.4.

**Antes de crear el pedido, el backend resuelve el `Customer`** (RF-05): busca
por email en minúsculas; si existe, lo reutiliza y actualiza su teléfono; si no,
lo crea.

### RF-03 — El pago se procesa a través de Mercado Pago

CUANDO el comprador confirma sus datos, EL SISTEMA debe redirigirlo a Mercado Pago para completar el pago en un solo pago (sin cuotas).

### RF-04 — No se ofrece tarjeta de crédito

CUANDO el comprador está en el checkout de Mercado Pago, EL SISTEMA debe ocultar la opción de tarjeta de crédito. Cualquier otro medio de pago (efectivo, transferencia, balance de Mercado Pago) debe estar disponible.

### RF-05 — El pedido se registra en el backend

CUANDO el comprador inicia el pago, EL SISTEMA debe registrar el pedido en la base de datos con:

- Datos del comprador (nombre, apellido, teléfono, email, dirección), **resueltos contra un `Customer` existente o nuevo** (RF-02, D-9)
- Productos del carrito (nombre, cantidad, precio unitario)
- Monto total en pesos argentinos enteros
- Estado del pago

### RF-06 — El estado del pago se actualiza según el resultado

El pago va en un **campo propio**, separado de `Order.status`.

> **Por qué no reusar `status`** (decisión del usuario, y corrección a la versión
> anterior de esta spec): `Order.status` ya significa **en qué anda el envío** —
> `pendiente`, `preparando`, `enviado`, `entregado`, `cancelado`, `devuelto` — y
> el panel lo cambia **a mano** cuando un vendedor entrega. Si el pago compartiera
> ese campo, un pedido en `cancelado` no diría si la plata entró, y el selector
> del panel mezclaría dos preguntas distintas en un solo control.

| `pago` | Significado | Quién lo cambia |
|---|---|---|
| `no_iniciado` | El comprador llenó el formulario, todavía no abrió Mercado Pago | El backend, al crear el pedido |
| `pendiente` | Abrió Mercado Pago y no terminó | La webhook |
| `aprobado` | Mercado Pago confirmó el pago | La webhook |
| `rechazado` | Mercado Pago rechazó el pago | La webhook |
| `expirado` | No se completó en 10 minutos | El cron |

`Order.status` arranca en `pendiente` **sin relación con el pago**: significa
"lo estamos armando".

CUANDO Mercado Pago notifica un cambio vía webhook, EL SISTEMA debe actualizar
el estado del **pago**, nunca el del envío.

### RF-07 — Los pedidos pendientes expiran a los 10 minutos

SI un pedido queda en estado `pendiente` por más de 10 minutos, ENTONCES EL SISTEMA debe marcarlo como `expirado`.

### RF-08 — El admin ve los pedidos en el panel

CUANDO un admin o gestor entra al módulo de pedidos, EL SISTEMA debe mostrarle:

- Nombre del comprador
- Email
- Teléfono
- Dirección de envío
- Productos del pedido
- Monto total
- Estado del pago

### RF-09 — El comprador recibe la confirmación del pedido

CUANDO el pago es aprobado, EL SISTEMA debe mostrar al comprador una confirmación con el número de pedido.

---

## 4. Requisitos no funcionales

### RNF-01 — El monto lo recalcula el backend, nunca lo manda el cliente

> **Corrección a la versión anterior de esta spec.** Decía *"el monto enviado debe
> ser la suma exacta de los precios de los productos en el carrito"*. Eso es un
> agujero: el carrito vive en el `localStorage` del navegador, así que quien
> quiera puede abrir la DevTools, poner `precioUnitario: 1` y pagar un pedido de
> $150.000 con $2.

EL SISTEMA debe **ignorar por completo los precios que mande el cliente** y
calcular el total a partir de `Wine.price` en la base. Del pedido solo se acepta
**qué** vinos y **cuántos**. El mismo número que se guarda en `Order.total` es el
que se manda a Mercado Pago: si se calcularan por separado, la webhook podría
aprobar un monto distinto del que el panel muestra.

Todos los precios son **pesos enteros**.

### RNF-02 — El webhook valida la autenticidad de la notificación

El backend debe verificar que la notificación del webhook realmente viene de Mercado Pago (validación de firma o token).

### RNF-03 — Los datos del comprador se guardan de forma segura

El teléfono y dirección del comprador se guardan en la base de datos con acceso restringido (solo admin/gestor).

---

## 5. Casos límite

| Caso | Comportamiento esperado |
|---|---|
| El comprador cierra la ventana de Mercado Pago sin pagar | El pedido queda como `pendiente` y expira a los 10 minutos |
| El pago es rechazado por Mercado Pago | El pedido queda como `rechazado` y el comprador puede reintentar |
| El webhook llega dos veces | El sistema no duplica el pedido ni cambia el estado dos veces |
| El carrito está vacío al pulsar "Pagar" | El sistema no permite avanzar al checkout |
| El comprador no ingresa email | **Ya no es un caso**: el email es obligatorio (D-9). El checkout no avanza y el mensaje dice qué falta |
| El mismo email compra dos veces | **Un** `Customer`, **dos** `Order`. `totalOrders` queda en 2 |
| `Ana@x.com` compra y después `ana@x.com` | **Un** `Customer`. El email se guarda en minúsculas al buscar y al escribir |
| Dos checkouts del mismo email al mismo tiempo | Uno crea la ficha y el otro se la lleva ya existente, no un error de base. Se captura el `P2002` y se reintenta la búsqueda |
| El comprador ya existía pero escribe otro teléfono | Se actualiza el `Customer`. Es el único dato que se corrige solo |
| El comprador ingresa un email inválido | El sistema no permite avanzar hasta corregirlo |

---

## 6. Fuera de alcance

- **Carga del catálogo real:** **No se hace acá.** El catálogo sigue siendo el mock con PRNG sembrado de la 001. La spec que lo migre **no está escrita** — la `010-catalogo-real` que se anunciaba en el encabezado se borró, y con ella la referencia (ver §2.6).
- **Cálculo de envío:** No se calcula en el checkout. Se coordina por fuera.
- **Facturación electrónica:** No se emite factura automática.
- **Cuentas de comprador:** No se crea cuenta de usuario para el comprador.
- **Devoluciones:** No se gestionan devoluciones en esta spec.
- **Pagos en cuotas:** No se ofrecen cuotas.

---

## 7. Criterios de finalización

Cada casilla marcada dice **qué la verifica**, porque una casilla sin nombre de
test es una casilla que nadie va a chequear. Los dos sin marcar **no están
fallando**: están a medias por una sola razón, que falta la credencial de
Mercado Pago.

- [x] Un visitante puede comprar sin estar logueado
      — `checkout_reglas.test.ts`, `checkout_pagina.test.ts`
- [x] El checkout pide nombre, apellido, teléfono, email y dirección; **no pide DNI ni contraseña**
      — `FormularioCheckout` no tiene esos inputs; hay un test que lo afirma
- [ ] ~~El pago se procesa a través de Mercado Pago~~ **sin ofrecer tarjeta de crédito ni cuotas**
      — **la mitad está**: el cuerpo de la Preference excluye **`credit_card` y
      `debit_card`** y eso tiene test directo (`proveedor_pagos.test.ts`).
      Falta que Mercado Pago **acepte** la Preference.
- [x] El pedido se registra en la base de datos con estado correcto
      — `checkout.test.ts`: total desde `Wine.price`, un solo número para guardar y para mandar
- [x] Los pedidos pendientes expiran a los 10 minutos
      — `cron_pedidos.test.ts`, con cinco sabotajes verificados en contra
- [ ] ~~El webhook actualiza el estado del pedido~~ **automáticamente**
      — **la lógica está**: valida la firma, pregunta el estado real a
      `GET /v1/payments/:id` y es idempotente (`webhook_pagos.test.ts`, con el
      doble de proveedor). Falta que la notificación **llegue** de verdad.
- [x] El admin ve los pedidos en el panel con todos los datos del comprador
      — `pago_en_el_panel.test.ts`, `cliente_del_pedido.test.ts`
- [x] El comprador recibe confirmación del pedido
      — `checkout_pagina.test.ts`: número y total, sin inventar nada si falta el resumen

**Las dos casillas sin marcar son la misma cosa:** `MERCADO_PAGO_ACCESS_TOKEN` y
`MERCADO_PAGO_WEBHOOK_SECRET`. Con las dos, se tildan sin escribir código.
