# AGENTS.md

## Comandos de configuración

**Gestor de paquetes: npm** (el repo tiene `package-lock.json`; no usar pnpm).

- Instalar dependencias: `npm install`
- Iniciar servidor de desarrollo (frontend): `npm run dev`
- Iniciar servidor de desarrollo (backend): `cd backend && npm run dev`
- Ejecutar pruebas: `npm test` (usa `vitest run`, no watch)
- Verificar tipos: `npx tsc --noEmit`
- Lint: `npm run lint` (ESLint 9 flat config, `--max-warnings 0`)
- Build de producción: `npm run build` (ejecuta `tsc && vite build`)
- Regenerar datos mock: `node scripts/generar-mocks.mjs`
- Login panel admin: `POST /api/auth/login` con email + password (`admin@vinoteca.local` / `admin123` del seed)

**Backend (spec 004-b):**
- `cd backend && npm run db:migrate` — aplica migraciones Prisma
- `cd backend && npm run seed` — crea usuarios admin/gestor/vendedor
- `cd backend && npm run dev` — levanta Fastify en :3000
- `cd backend && npm run test` — tests unitarios (mock Prisma)
- `docker compose up -d db` — levanta PostgreSQL

## Estilo de código

- TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`)
- Comillas simples, sin puntos y comas
- Patrones funcionales; componentes puros de React
- No hardcodear colores hex en componentes: viven en `tailwind.config.js` (única excepción: `PALETA` en `herocanvas3d.tsx` para Three.js)

## Arquitectura clave (lo que un agente suele pasar por alto)

| Aspecto | Detalle |
|---------|---------|
| **Framework Frontend** | React 18 + Vite 5 + TypeScript (no Next.js) |
| **Framework Backend** | Fastify + Node 24 + PostgreSQL + Prisma (spec 004-b **COMPLETA**) |
| **Routing Frontend** | `react-router-dom` v7; `/admin` es hijo de `AdminLayout` (protege 5 rutas) |
| **Estado tienda** | `localStorage`: `vinoteca_wines` y `vinoteca_cart` (sin librería global) |
| **Estado admin (frontend)** | Sin estado local: `accessToken` solo en memoria del módulo `src/api/client.ts`, refresh en cookie httpOnly |
| **Auth real (backend)** | JWT access 15min + refresh rotativo 7d cookie httpOnly, roles admin/gestor/vendedor |
| **Permisos del panel (006)** | **Una tabla**: `src/utils/permisos.ts` → `puedeVer(rol, ruta)`, `seccionesVisibles(rol)`, `primeraVisible(rol)` |
| **Login con clave incorrecta (006)** | Un `401` de `/api/auth/login` **no** refresca; el gate traduce el `code` a texto. `/api/auth/me` **sí** refresca (gotcha 28) |
| **API real (frontend)** | Cliente HTTP propio en `src/api/client.ts`: intercepta 401 → refresh rotativo → reintenta una vez |
| **API real (backend)** | Fastify REST en `http://localhost:3000` (spec 004-b completa) |
| **Datos mock** | Generados con PRNG sembrado (`scripts/generar-mocks.mjs`) para consistencia |
| **Matriz de permisos (006)** | Dashboard **solo admin**; Catálogo/Clientes/Configuración admin+gestor; **Pedidos los tres**. El backend la aplica con `requireRole`; el frontend la *muestra* |
| **Gráficos** | Recharts con `import()` diferido (chunk aparte de ~376 kB) |
| **Tablas** | TanStack Table modo manual (`manualPagination/Sorting/Filtering`) |
| **Fechas** | `Date` nativo; **nunca `toISOString()` para `YYYY-MM-DD`** (UTC-3 rompe rangos). Usar `aIsoLocal` de `src/utils/fechas.ts` |
| **CSV** | Parser/escritor manual en `src/utils/csv.ts` (`papa-parse` da 404 en este registry) |
| **Animaciones** | Framer Motion; `AnimatedSection` usa `useInView`; degradación en móvil (< 640px) |

## Panel Admin (`/admin`) — spec 004-a (UI) + 004-b (API real) + 004-c (integrada)

**Frontend (actual, autenticado contra la API):**
- **Sin botón en la tienda pública**: se entra escribiendo `/admin`. Es la
  **regla**, no una descripción del estado — y `main` hoy **incumple**: tiene los
  tres botones. Ver gotcha 6, que explica por qué esta línea se lee como regla y
  no como hecho, y cómo verificarlo en un segundo.
- **Pantalla de login** (`AdminGate`), no redirect: pide email + contraseña reales
- **No hay clave en el bundle ni en `sessionStorage`**: el `accessToken` vive solo en memoria
  del módulo `src/api/client.ts` y el refresh viaja en cookie httpOnly
- **No existe flag `isAdmin` en `localStorage`** (era público y editable desde consola)

**Backend 004-b:**
- `POST /api/auth/login` → JWT access 15min + refresh rotativo 7d (cookie httpOnly)
- Roles: `admin` / `gestor` / `vendedor` (middleware `requireRole()`)
- Rate-limit login: 5 req/min/IP
- Swagger UI: `http://localhost:3000/api/docs`

**Común:**
- `AdminWine` extiende `Wine` (agrega `stock` y `activo`); formulario separado: `AdminWineForm` ≠ `ProductForm`
- 5 módulos: Dashboard, Catálogo, Pedidos, Clientes CRM, Configuración
- **Cada módulo se filtra por rol (spec 006)**: el sidebar lee
  `seccionesVisibles(user.role)` y `admin_layout.tsx` redirige a
  `primeraVisible(rol)` si la URL escrita a mano no la puede ver. **La defensa es
  el `requireRole` del backend**; la tabla es la vista, y se mantienen los dos
  lugares a propósito: si se desincronizan, el síntoma es un `403` visible
- `DataTable` genérica con paginación/filtrado/orden en servidor (backend real)
- `DateRangePicker` con react-day-picker v9 (tema oscuro, dos meses)
- Offline: `src/utils/offline.ts` guarda último response por URL; banner `AvisoOffline` + "Reintentar"

## Checkout con Mercado Pago — spec 009 (rama `spec-009`)

**El comprador NO tiene cuenta.** No hay login de comprador, ni registro, ni
contraseña. El formulario pide cinco datos (nombre, apellido, teléfono, email,
dirección) y vuelve con `?pago=aprobado|fallido|pendiente`. El email es
**obligatorio** (D-9): es la identidad con la que el backend resuelve el
`Customer`, reutilizando el existente o creando uno nuevo.

**D-7: pago y envío son dos columnas, no una.** `Order.status` sigue siendo el
estado del **envío** (lo cambia el panel a mano cuando un vendedor entrega) y
`Order.pagoEstado` el del **pago** (solo lo cambia la webhook). Los dos
enumerados comparten el literal `pendiente` con significados **opuestos**, así
que hay **dos badges** (`StatusBadge` y `EstadoPagoBadge`) y no uno parametrizado:
con un `Record<EstadoAdmin, Estilo>` la clave `pendiente` sería una sola y
TypeScript aceptaría los dos usos sin reclamar.

**Backend:**
- `POST /api/orders` — **público** (a diferencia del GET y el PATCH de ese mismo
  archivo, que exigen rol). El total sale de `Wine.price` en la base y es **el
  mismo número** que se guarda y el que se manda a Mercado Pago. `.strict()` en
  `orderCreateSchema` **y** en `checkoutItemSchema`: un precio pegado al item
  colaría por el schema del pedido si el item no lo rechazara solo.
- `POST /api/orders/webhook` — pública, y por eso **no se fía del cuerpo**:
  valida la firma (HMAC SHA256 de `id:{id};request-id:{x-request-id};ts:{ts};`
  con `timingSafeEqual`), **pregunta** `GET /v1/payments/:id` el estado real, y
  es **idempotente** con un `updateMany` condicional (`WHERE pagoEstado <> destino`)
  — que en Postgres es atómico y no tiene la carrera del "leer y decidir".
- Cron de expiración **dentro del proceso** (Render free no tiene cronjobs):
  `no_iniciado|pendiente` con más de 10 min → `expirado`. **No toca
  `Order.status`.** `unref()` en el intervalo, o la suite cuelga en verde.
- **Mercado Pago detrás de una interfaz** (`modules/pagos/proveedor.ts`): el
  handler depende de `ProveedorPagos` y los tests usan `ProveedorPagosFalso`, que
  **registra lo que se le pidió**. El proveedor real se registra en `app.ts`, no en
  el módulo.
- **Sin token no se registra nada** y el checkout falla con un mensaje explícito.
  Un proveedor mudo que devuelve un id falso haría parecer que funciona y dejaría
  cada pago colgado esperando una webhook que nunca llega.
- `MERCADO_PAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET` son **opcionales y
  validadas**: que no sean obligatorias evita que un deploy sin Mercado Pago no
  levante; declararlas evita que sean variables sueltas que nadie encuentra.

**Frontend:**
- `/checkout` renderiza el **mismo `App`** que decide con `useLocation()`. El
  carrito vive en el estado de `App`, no en un contexto, así que el formulario no
  tendría qué mandar si fuera su propia página.
- El carrito **no** se vacía al apretar "Finalizar Pedido": se vacía **solo con el
  pago aprobado** (D-D). El sandbox de Mercado Pago manda a cancelar seguido.
- La confirmación lee número y total del **`sessionStorage`** (no de un endpoint
  público — D-F: devolvería nombre, teléfono y dirección de alguien sin cuenta).
  Si no hay resumen **no inventa un total**.

**La rama NO se puede desplegar todavía.** Sin las dos variables la app levanta
—son opcionales a propósito, para que un deploy sin Mercado Pago no tire el
catálogo— y todo lo demás funciona, pero **cada pago queda colgado esperando una
webhook que nunca llega** y el cron lo expira a los 10 minutos.

**D-10 (resuelta): el panel filtra por pago.** Dos desplegables separados, `Envío`
y `Pago`, porque los dos tienen un `Pendiente` con significado opuesto y en un
menú único habría que adivinar cuál se está filtrando. En el backend,
`pagoEstado` va en su **propio** campo del `where` con `in`; Prisma pone el AND
entre claves solo, así que "expirados **y** pendientes de envío" no necesita un
`AND` explícito.

**`aplicarFiltros` fusiona.** Hace `{ ...previo, ...cambios }`, así que un literal
es un filtro **parcial disfrazado**: lo que no nombre, queda como estaba. Por eso
"limpiar todo" usa `filtrosVacios()`, que tiene tipo `FiltrosPedidos` y no
`Partial<FiltrosPedidos>` — olvidar un campo ahí es un error de compilación. El
resto de los filtros (toggles, rango, orden) sí usan literales parciales, y están
bien: para eso existe el merge.

**Lo que NO se pudo probar:** que Mercado Pago acepte la Preference y que la
webhook llegue de verdad. Necesita credencial real.

## Paleta de colores (fuente única: `tailwind.config.js`)

- **Superficies**: `charcoal` = negro carbón neutro (`#2E2E2E` → `#0A0A0A`); fondo página `charcoal-950` `#0A0A0A`, cards `charcoal-800/900`
- **Acento rojo**: `wine` 400→950 (9 tonos, `#AD0021` a `#4F0718`) — botones, bordes, badges
- **Dorado**: `gold` (`#F0D98C` → `#AA8C2C`) — acento de marca
- **Blanco**: `white` (`#ffffff` + 100-300) para `bg-white`/`text-white`
- **Texto largo**: `cream` (`#FDFBF7`) — menos fatigante sobre oscuro
- **Neutros**: grises puros más claros que Tailwind para WCAG AA (> 4.5:1) sobre `#0A0A0A`

## Tests

> **Regla general:** un test que afirma cubrir algo que no cubre es **peor que
> no tener test**. Se verifica en contra: se sabotea el código y se comprueba
> que el test falla. Ya pasó cuatro veces (ver gotchas 28-31).

### Frontend (`npm test` → `vitest run`)

- **Ubicación**: `test/**/*.test.ts` (no `.test.tsx`; JSX no compila en `.ts`)
- **Entorno**: jsdom con stubs para `ResizeObserver`, `IntersectionObserver`,
  `matchMedia` (006), `innerWidth=375` (evita Three.js). Todos en `test/andamiaje.ts`.
  El stub de `matchMedia` **lee `innerWidth`**, no devuelve `false` fijo: si
  devuelve `false`, el panel se prueba siempre como en un monitor de 2000 px y el
  drawer de móvil no se ve nunca
- **Montaje**: `montarApp(rutaInicial?)` en `test/andamiaje.ts` (sin StrictMode;
  evita doble sincronización a localStorage). **Monta los dos providers** —
  `AuthProvider` y `MemoryRouter`, lo mismo que `main.tsx` — porque `App` usa
  `useLocation()` y la barra y el catálogo usan `useAuth()`. Un test que monta la
  app recortando providers mide un árbol que en producción no existe.
- **`localStorage` NO existe sin importar `test/andamiaje.ts`** (gotcha 33): el
  stub va en el import, no en un `setupFiles`.
- **Helpers**: `pulsar`, `escribir`, `esperarSalidas` (700 ms para `AnimatePresence`)
- **Cobertura**: 305 tests en 17 archivos (`csv`, `data_table`, `dashboard`,
  `date_range`, `integridad_datos_vino`, `validadores`, `permisos`,
  `admin/sidebar`, `admin/layout_rutas`, `admin/login_fallido`,
  `admin/pago_en_el_panel`, `admin/cliente_del_pedido`, `checkout_reglas`,
  `checkout_pagina`, `contrato_checkout`, `filtro_pedidos`, `marca`);
  `npm test` pasa en modo no interactivo (`watch: false`)
- **Nota 004-c**: se borraron los tests que dependían de `src/mocks/*` y de `admin_acceso.ts`.
  Con MSW eliminado no queda nada que probar ahí; la cobertura de API real vive en el backend.
- **Nota 006**: `tsconfig.json` incluye `test/` **desde la 006**. Antes era
  `["src"]` solo y el docstring de `test/andamiaje.ts` afirmaba lo contrario
  desde la spec 001 — era falso. Al incluirlo aparecieron diez `TS2339` dormidos
  en `data_table.test.ts`.

### El test de contrato (`test/contrato_checkout.test.ts`)

Es el único test que mira **las dos puntas a la vez**: lee
`backend/src/shared/schemas.ts` y `backend/src/shared/json-schemas.ts` como texto
y compara los nombres de campo con los del frontend. Existe porque las dos mitades
pueden estar bien y no entenderse — si el backend devuelve `preferenceId` y el
frontend lee `preferenceIdOk`, **todo pasa en verde**.

Tres reglas que lo hacen confiable y que cualquier extractor de texto debería
copiar (gotcha 35): **si no encuentra un bloque, tira** (devolver `""` convierte
"el contrato cambió" en "el contrato no cambió"); **cuenta llaves** en vez de
`[\s\S]*?\}\)` (que corta en la primera llave que cierra y se lleva las claves del
schema siguiente); y **saca los comentarios** antes de comparar, o el comentario
decide por el test.

### Tests del panel (`test/admin/`)

Montan componentes de verdad. El camino no es montando `App` (necesita un
servidor) sino **interceptando `fetch`**, no el módulo `api`:

- `test/admin/andamiaje_admin.ts`: `montarAdmin`, `montarLayout`, `montarGate`,
  `fetchDeSesion`, `fetchConLogin`, `entrarPorElGate`
- Se intercepta `fetch` y no `api` a propósito: el `AuthProvider` real corre y el
  cliente HTTP real corre, y solo la red se responde con lo que el test quiere.
  Un `vi.mock` del cliente pasaría igual y dejaría en verde un `useAuth` roto
- Lo que no sea `/api/auth/*` responde **404 a propósito**: si una página pide
  datos, el test falla con el error de la API en vez de mostrar una pantalla
  vacía que el test tomaría por una pantalla correcta
- `montarGate()` existe **sin** el `AdminLayout` alrededor, y no es redundante:
  dentro del layout, mandar al gate a `/admin` y mandar a `primeraVisible(rol)`
  dan el mismo lugar en pantalla, porque el layout redirige igual. Aislado, el
  gate es lo único que decide y la pregunta tiene respuesta (comprobado: con el
  gate saboteado, los tests de punta a punta pasaban en verde)
- Las páginas del panel son **de mentira** (`<p id="pagina">`) salvo
  `montarLayoutReal`, que usa el `Dashboard` real. Va por la API, no por el DOM:
  "el dashboard no se monta ni un instante" es una afirmación sobre el frame
  intermedio, y ese frame ya pasó cuando el test mira el DOM. Con la página real
  la pregunta es "¿se pidió `/api/metrics`?", que sí tiene respuesta

### Backend (`cd backend && npm run test` → `vitest run`)

- **Ubicación**: `backend/tests/**/*.test.ts`; entorno `node`
- **Prisma siempre mockeado** con `vi.mock('@prisma/client')` + `vi.hoisted` (el factory del
  mock corre antes que los `const`; sin `hoisted` revienta por TDZ)
- **`tests/setup.ts`** pone los defaults de `process.env` **antes** de importar el servidor:
  `config/env.ts` valida el entorno de forma eager y sin ellos no arranca ningún test
- **Cobertura**: 326 tests en 22 archivos
- `backend/tsconfig.json` incluye solo `src/**/*`: los tests **no** entran al `typecheck` ni al `build`.
  Es a propósito (el build de la imagen no debe typecheckear tests) y **no** es el
  olvido que había en el frontend. Si se cambia, va un `tsconfig` aparte, no
  agregar `tests` al de `src`
- Integraciones reales (con `DATABASE_URL_TEST`) se limpian en `beforeEach` por orden de FK
- **Los mocks de Prisma necesitan `$on`** (gotcha 22): Prisma lanza si emite un
  evento sin listener
- **`coherencia_permisos.test.ts`** cruza la tabla del frontend con los
  `requireRole` del backend, y fija los 14 contra una lista escrita a mano. El
  parser parte por declaraciones `fastify.<método>(`, **sin límite de distancia**:
  la versión anterior emparejaba con `[\s\S]{0,400}?` y un comentario de ocho
  líneas dejó `/api/metrics` sin leer, con el test en verde (gotcha 30)

## Convenciones de archivos

- `@/*` alias a `src/*` (configurado en `vite.config.ts` y `tsconfig.json`)
- Componentes en `src/components/` y `src/components/admin/`
- Páginas admin en `src/pages/admin/`
- Hooks en `src/hooks/` (`useApi`, `useCatalogo`, `usePedidos`, `useClientes`, `useMediaQuery`)
- Utilidades en `src/utils/`
- Tipos en `src/types/` (`vino.ts`, `admin.ts`)
- Datos iniciales en `src/datos/vino.ts`
- Cliente HTTP en `src/api/` (`client.ts`, `schemas.ts`); **no hay `src/mocks/`** (eliminado en 004-c)

## Reglas de gobernanza

- `docs/CONSTITUCION.md` es la fuente de verdad para arquitectura, UI/UX y calidad
- Actualizar `MEMORY.md` y `AGENTS.md` tras cada cambio (ver protocolo en MEMORY.md)
- No agregar dependencias sin necesidad demostrada (ej. `date-fns` se agregó como dep directa tras detectarse hoisting)

## Gotchas operativos

1. **`npm run lint` lintea `*.ts` y `*.js` en raíz** (incluye `vitest.config.ts`, `tailwind.config.js`)
2. **`hero.tsx` no renderiza `<HeroCanvas3D />` por debajo de 640px** (evita WebGL en tests/jsdom)
3. **`VistaRapidaProducto` se monta SIEMPRE**; su `AnimatePresence` interno decide visibilidad (montar condicionalmente rompe animación de salida)
4. **`loadWines`/`loadCart` tienen guardas contra `localStorage` corrupto** (`{}` o `[]` vacían catálogo/carrito)
5. **Escrituras offline fallan explícitamente** (no se encolan; evitaría conflictos sin resolver)
6. **La tienda pública NO tiene enlace al panel; se entra escribiendo `/admin`** (regla, no estado). Un botón en el navbar es una promesa de que la sesión del panel existe, y quien no la tiene recibe un `403` al llegar: el botón lo ven todos y el panel solo lo pueden usar tres.
    **Ojo con cómo se redacta esta nota.** La primera versión decía *"Login button removido del navbar (T2 004-c)"* como si fuera un hecho, y **`main` tenía los tres botones** ("Panel Admin" y "+ Cargar Vino" de escritorio y de drawer): 004-c los había **agregado**, no quitado, y dos rediseños posteriores los dejaron. El documento afirmaba algo que el código no cumplía — el gotcha 29 aplicado a sí mismo— y alguien leyó la nota, fue a verificar y encontró el botón.
    Por eso va como **regla** y no como "estado actual": así es cierta tanto en `main` como después de `spec-011`, y no hay que actualizarla cada vez que un rediseño toca el navbar. Cuando toques ese componente, **verificá que los tres botones sigan sin estar**:
    ```powershell
    git show main:src/components/barra_de_navegacion.tsx | Select-String 'Panel Admin|Cargar Vino'
    ```
7. **MSW eliminado** (T7 004-c): `src/mocks/`, `public/mockServiceWorker.js` eliminados; `msw` movido a `devDependencies`
8. **Node 24 es el piso, no una preferencia** (fix CI 2026-10-11). `jsdom@30` exige `^22.22.2 || ^24.15.0 || >=26`
   y su `undici@8` llama `util.markAsUncloneable`, que no existe en Node 20: con Node 20 el job del frontend
   muere en `Test` con "unhandled errors" y **cero tests corridos**. La versión está fijada en `.nvmrc`,
   en `NODE_VERSION` del CI y en las dos etapas del `backend/Dockerfile`. Si se toca una, se tocan las tres.
9. **El typecheck del CI es `npm run typecheck`, no `npx tsc`**. Con `node_modules` ausente, `npx` baja del
   registry el paquete `tsc@2.0.4` (que no es TypeScript) y el paso "pasa" sin compilar nada.
10. **`backend/vitest.config.ts` declara `css.postcss: { plugins: [] }` a propósito** (fix CI 2026-10-11).
    Sin eso, Vite busca `postcss.config.js` subiendo directorios desde `backend/`, encuentra el del
    frontend e intenta cargar `tailwindcss`. En local se resuelve desde el `node_modules` de la raíz y
    nadie ve el problema; en CI el job de backend solo instala `backend/node_modules` y el run muere con
    `Failed to load PostCSS config: Cannot find module 'tailwindcss'`. Vite solo saltea la búsqueda en
    disco si `css.postcss` es un objeto plano. **No borrar ese bloque.**
11. **`response.schema` en Fastify CORTA los datos** (fix 2026-10-11, el bug más caro del proyecto).
    Fastify no usa `JSON.stringify`: compila el schema con `fast-json-stringify`, que **descarta toda
    propiedad no declarada**. Un `{ type: 'object' }` a secas devuelve `{}`. Pasó con `login` (→ `user: {}`,
    sin rol: el botón "Panel Admin" no aparecía hasta recargar), `metrics` (→ `{}`: dashboard en cero),
    `wines.create/update`, `orders.get/update` y `customers.get/update`. Todo respondía **200/201 sin un
    solo error**. Por eso `json-schemas.ts` tiene `objetoLibre()` (`additionalProperties: true`) y
    `tests/unit/json_schemas.test.ts` lo verifica serializando con Fastify de verdad.
    **Nunca escribir `{ type: 'object' }` en un `response.schema`.**
12. **En Windows, `DATABASE_URL` con `localhost` no conecta** (2026-10-11). `localhost` resuelve a `::1`
    (IPv6) y el motor de Prisma no llega por ahí aunque el puerto esté publicado:
    `Can't reach database server at localhost:5432` tras ~5 s de timeout, con el puerto abierto en
    `netstat` y `Test-NetConnection` en verde. Usar **`127.0.0.1`**. En Linux/CI `localhost` sí funciona.
13. **La sesión se abre SIEMPRE por `useAuth().login()`, nunca por `api.auth.login()`** (fix 2026-10-11).
    `api.auth.login()` es una llamada cruda: devuelve los tokens pero no toca estado. El `accessToken` vive en
    el módulo `api` y el `user` en el `AuthProvider`; los dos los setea el hook. Si el gate llama a la API
    directo, `isAuthenticated` queda en `false`, `AdminLayout` vuelve a renderizar `<AdminGate />` y el
    formulario se limpia: **bucle infinito con la contraseña correcta**. Dos estados separados (módulo y
    contexto) que hay que setear juntos; por eso hay un solo camino para entrar al panel.
14. **Los errores de Fastify NO son todos 500** (fix 2026-10-11). `setErrorHandler` manejava `ZodError` y
    `AppError` y mandaba todo lo demás a `500 INTERNAL_ERROR`. JSON malformado, body vacío y schema que no
    valida*daban 500. Además `request.log.error` salía del `logger: false` de Fastify: escribir ahí es
    escribir a la nada, así que un 500 real no quedaba registrado en producción. Ahora se usa el `logger`
    del proyecto y los 4xx de Fastify se devuelven con su status real.
15. **`Content-Type: application/json` en un POST sin cuerpo rompe Fastify** (fix 2026-10-11).
    `FST_ERR_CTP_EMPTY_JSON_BODY` → 500. Por eso `POST /api/auth/logout` y `/api/auth/refresh` devolvían
    500: el cliente manda esos POST **sin body**. Por eso `request()` en `client.ts` pone el header solo si
    hay cuerpo, y `buildApp` registra un parser que acepta el cuerpo vacío como `{}` (**quitando el BOM**,
    como hacía el parser original de Fastify).
16. **`routePrefix` de Swagger necesita barra final** (fix 2026-10-11). Swagger UI sirve el HTML con rutas
    relativas (`./static/…`); entrando en `/api/docs` sin barra el navegador pide `/api/static/…` y la
    página queda sin estilos ni JS. Va `/api/docs/` más un redirect explícito desde `/api/docs`.
17. **La imagen del backend es Debian slim, NO Alpine** (fix 2026-10-11). Con `node:24-alpine` el build
    pasaba y el contenedor **no arrancaba nunca**: `libquery_engine-linux-musl.so.node` pide `libssl.so.1.1`
    y Alpine usa musl con OpenSSL 3. `prisma generate` no carga el engine, así que el fallo aparece recién
    al arrancar, no al construir — por eso solo lo encuentra alguien que levanta la imagen.
18. **El logger no puede pedir `pino-pretty` a ciegas** (fix 2026-10-11). Es devDependency y en producción
    no está (`npm ci --omit=dev`): pedirlo tira `unable to determine transport target for "pino-pretty"` al
    importar el módulo y el backend no levanta. La guarda es **disponibilidad**, no solo `NODE_ENV` — si
    `NODE_ENV` queda en `development` (que es lo que dice `.env.example`) la app tampoco arranca.
    Por eso `logger.ts` hace `require.resolve('pino-pretty')` antes de usarlo.
19. **El `Dockerfile` tiene que estar en la raiz del repo, no en `backend/`** (2026-10-12, corregido 2026-10-13). Railway y Render toman el **contexto de build** del "Root Directory", que es un ajuste **del panel**. Ninguno de los dos deja declararlo en un archivo (el schema de `railway.json` solo tiene `dockerfilePath`), asi que con el Dockerfile en `backend/` habia que configurarlo a mano: se reseteo solo tres veces.
    El reset es **silencioso**. El contexto cae a la raiz, donde `package.json`, `tsconfig.json` y `src/` existen **pero son los del frontend**, asi que el build los copia sin quejarse y solo revienta cuando llega a `prisma/`, que existe unicamente en `backend/`:
    ```
    failed to compute cache key: ... "/prisma": not found
    ```
    Con el `Dockerfile` en la raiz, el contexto es la raiz **por definicion** y no hay nada que configurar en ningun panel. Hay un test que resuelve **cada `COPY` contra el disco** y otro que comprueba que entre **todo lo que los `tsconfig` declaran como entrada**: ese segundo existe porque el `COPY backend/scripts` falto entero, y el primero no lo veia (no apuntaba a algo inexistente, faltaba). `.dockerignore` en la raiz es obligatorio (los dos `node_modules` son 663 MB) y **los patrones de archivos que existen en los dos lados van con `/` adelante**: sin barra matchean en cualquier nivel y un `src` a secas se lleva `backend/src`.
20. **Un build fallido deja sirviendo el deploy anterior, con exito** (2026-10-12). La plataforma no levanta la imagen nueva y conserva la vieja: `/health` da 200, la API responde y el panel dice "Deployment successful" —refiriéndose al deploy viejo. El unico sintoma es que **los cambios del repo "no aplican"**. Por eso "el healthcheck da 200" **no** significa "el deploy se aplicó".
21. **Un "redeploy" no es "traé lo nuevo"** (2026-10-12). El botón `Redeploy` de Railway re-ejecuta el **mismo commit**, no resuelve la cabeza de la rama: repetirlo da el mismo `snapshot sha256` y el mismo `image digest`, es literalmente el mismo build. Para traer un commit nuevo hay que disparar el deploy desde el evento del push.
22. **Prisma Client no loguea nada por defecto** (2026-10-12). `new PrismaClient()` sin `log` no emite ni los errores de conexion. Hay que registrar los eventos con `log: [{ emit: 'event', level: 'error' }]` **y** `$on(...)` listeners antes de la primera query, porque Prisma lanza si un evento se emite sin listener. Los listeners van al `logger` del proyecto, no a stdout, por el mismo motivo que `logger: false` en Fastify. Cuidado: los mocks de `@prisma/client` en los tests tienen que exponer `$on` o revientan.
23. **Renombrar un servicio libera su dominio autogenerado** (2026-10-12). El dominio viejo pasa a 404 y `PUBLIC_API_URL` queda apuntando a la nada. Si ya hay dominio cargado, renombrar es caro.
24. **Un healthcheck con `SELECT 1` no detecta que falten las tablas** (2026-10-13). Por eso las migraciones corren en el arranque y no a mano: con el esquema sin crear la base responde, el healthcheck pasa, el deploy queda "sano" y la primera consulta real revienta con `relation does not exist`. `prisma migrate deploy` toma un advisory lock, asi que correrlas en cada arranque es seguro.
25. **`prisma migrate deploy` necesita una conexión SIN pooler** (2026-10-13). El pooler de Neon es PgBouncer en modo *transaction*: la conexión real vuelve al pool al terminar cada transacción, y el **advisory lock de sesión** que toma la migración **se queda puesto** en ella. Queda una sesión `idle` retenida con el lock tomado y el siguiente `migrate deploy` revienta:
    ```
    Timed out trying to acquire a postgres advisory lock
    (SELECT pg_advisory_lock(72707369)). Elapsed: 10000ms.
    ```
    O sea que **el primer deploy funciona y el segundo muere siempre**. Se separa con `directUrl` en el datasource: la app usa `url` (pooled), las migraciones usan `directUrl`. Y si ya quedó un lock huérfano, hay que cerrarle la sesión a mano (`pg_terminate_backend`): los locks son de base de datos, no de conexión, así que **arreglar el código no deshace el estado que dejó el bug anterior**.
26. **`SameSite=Lax` mata la sesión en cuanto el frontend y la API están en dominios distintos** (2026-10-13). `Lax` manda la cookie solo en navegaciones de primer nivel, no en un `fetch` desde JavaScript. Con la tienda en `vercel.app` y la API en `onrender.com` (sitios distintos), `/api/auth/refresh` llegaba sin cookie → 401 → el gate volvía a pedir la contraseña en cada recarga. En local `localhost:5173` y `localhost:3000` son el mismo sitio y **el bug es invisible**. Necesita `SameSite=None` **con** `Secure`: los navegadores rechazan `None` sin `Secure`.
27. **Una variable de entorno con el valor equivocado no rompe nada, apaga cosas** (2026-10-13). `NODE_ENV` sin poner en Render hizo que la cookie saliera `SameSite=Lax` y sin `Secure`, y que `CORS_ORIGIN` dejara de ser obligatoria. Los dos fallos son silenciosos: la app levanta, `/health` da 200, y el síntoma aparece del lado del navegador. Por eso `env.ts` avisa por `stderr` cuando `NODE_ENV !== production` pero `PUBLIC_API_URL` es `https://`.
28. **Un `401` del login se reportaba como "sesión expirada"** (2026-10-14, spec 006/T7). `client.ts` refrescaba ante **todo** `401`. En `/api/auth/login` un `401` **es la respuesta**, no el síntoma: no hay sesión que renovar. El refresh fallaba y el `throw` tapaba el mensaje del backend, así que la contraseña incorrecta llegaba a pantalla como *"Sesión expirada. Inicie sesión nuevamente."* — que manda a recargar la página, justo lo que ya se hizo. Y el arreglo no era de una línea: `app.ts` manda `message: error.message`, y en `UnauthorizedError('INVALID_CREDENTIALS')` el `message` **es** el código, así que sin traducción el gate pasaba a mostrar `INVALID_CREDENTIALS`. La regla que quedó: **una persona nunca lee un identificador en este panel**. Y la condición es **por ruta**, no "si no hay token en memoria": después de un F5 no hay token, y esa es exactamente la razón por la que el refresh por cookie existe.
29. **`tsconfig.json` no incluía `test/`, y el docstring decía que sí** (2026-10-14, spec 006). `include` era `["src"]` desde el proyecto, y `test/andamiaje.ts` afirmaba que `tsc` detectaba los errores de tipos de los tests "porque `tsconfig.json` incluye `test/` (RF-10, CA-10)". No lo incluía. Se comprobó de la peor forma: un test llamaba a `entrarCon`, definido dentro de otro `describe`, y **`npm run typecheck` pasó en verde**; lo reventó `npm test` con un `ReferenceError`. Al incluir `test/` aparecieron diez `TS2339` dormidos en `data_table.test.ts` (`disabled` y `options` no existen en `HTMLElement`). **Un comentario que afirma algo que no existe es la misma mentira que la UI, y más chica: se lee una vez y no molesta a nadie.**
30. **El parser del cruce de permisos se rompió con un comentario** (2026-10-14, spec 006/T4). `coherencia_permisos.test.ts` emparejaba `'/api/...'` con el `requireRole` de a 400 caracteres. **El comentario de ocho líneas explicando por qué el `gestor` no ve la facturación dejó a `/api/metrics` sin leer.** El test seguía verde: la tabla del frontend y el backend "coincidían" porque el backend no estaba en el mapa. Además aplanaba a la ruta, y perdía que `DELETE /api/wines/:id` es **solo admin** mientras `PATCH /api/wines/:id` es admin+gestor. Ahora parte por declaraciones `fastify.<método>(`, sin tope. **Un parser que depende de la distancia entre dos cosas se rompe con el primer comentario útil.**
31. **Dos mecanismos redundantes hacen indistinguibles los tests** (2026-10-14, spec 006/T3). El layout redirige a `primeraVisible(rol)` y el gate navega al destino permitido: los dos dan **el mismo lugar en pantalla**. Un test de punta a punta ("entrar como gestor y ver dónde queda") pasaba en verde con cualquiera de los dos. Recién con el gate montado **aislado** (`montarGate()`, sin `AdminLayout`) la pregunta tuvo respuesta. Y hay un caso donde dos mecanismos se cubren: `return null` durante el redirect se verifica por la **API** ("¿se pidió `/api/metrics`?"), no por el DOM — el frame intermedio ya pasó cuando el test mira el DOM.
32. **`/admin/*` con `path: '*'` montaba el Dashboard para cualquiera** (2026-10-14, spec 006/T3). `router.tsx` tenía `{ path: '*', element: <Dashboard /> }` dentro del panel, así que `/admin/secreto` le daba el dashboard a un `vendedor`: una sección vedada servida por un atajo. `puedeVer` no conoce esa ruta y por eso redirige. Un `catchAll` que sirve contenido en vez de una página vacía es un permiso con otro nombre.
33. **`localStorage` NO existe en los tests, y no es culpa de jsdom** (2026-10-16, spec 009/T6). Node 24+ cuelga su propio `localStorage` experimental en `globalThis` **antes** de que jsdom arme su entorno, así que el de jsdom queda tapado y el de Node es `undefined`: `localStorage.getItem(...)` es un `TypeError`, no un `null`. El propio Node avisa `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided`. Y la app **sí** lo usa (catálogo y carrito), así que no es un detalle del entorno. El stub va **en `test/andamiaje.ts`**, no en un `setupFiles`: es donde ya viven los stubs de jsdom y se importa a mano. Además `vitest.config.ts` fija `environmentOptions.jsdom.url`, porque con `about:blank` el origen es opaco y no hay almacenamiento. **Si un test toca almacenamiento y no importa el andamiaje, el fallo dice `TypeError` y no dice "almacenamiento".**
34. **`onBlur` en React 18 escucha `focusout`, no `blur`** (2026-10-16, spec 009/T6). Desde React 17 los eventos se enganchan en la raíz y `onBlur` está mapeado al `focusout` nativo, que **bu-bblea**. Disparar `blur` a mano en un test no llega nunca: el aserto pasaría solo si el componente mostrara el error sin tocar el campo, que en el navegador no puede cumplirse. **Un test que dispara el evento equivocado puede pasar sin estar probando nada** — el caso más limpio de "verde y sin valor".
35. **Un test que lee texto como un comentario puede decidir el resultado** (2026-10-16, spec 009, `contrato_checkout.test.ts`). Una aserción `toContain('.strict(')` pasaba con la llamada **borrada**, porque el bloque de `checkoutItemSchema` tiene un comentario que menciona `` `.strict()` `` para explicar por qué está ahí. **Cualquier extractor de texto tiene que sacar los comentarios primero.** Y los otros dos: si no encuentra el bloque **tira** (devolver `""` convierte "el contrato cambió" en "el contrato no cambió"), y **cuenta llaves** en vez de `[\s\S]*?\}\)` (que corta en la primera llave que cierra y se lleva las claves del schema siguiente).
36. **Declarar `properties` a medias en un `response.schema` corta los datos, y parece lo contrario** (2026-10-16, spec 009/T8, amplía el gotcha 11). Medido con Fastify de verdad:
    ```text
    { type: 'object' }                              -> {}
    { type: 'object', additionalProperties: false } -> {}
    { type: 'object', properties: { id } }          -> { id }   <-- la peligrosa
    { type: 'object', additionalProperties: true }  -> todo
    ```
    El caso peligroso es el tercero: **escribir el schema con cuidado y que por eso se corte más** es el modo de falla que no duele hasta que el panel muestra columnas vacías. Por eso `pago_en_la_respuesta.test.ts` serializa con **Fastify de verdad** y el schema real, en vez de llamar a una función y asumir que el resultado llega intacto. Y dentro de un array: `items: { type: 'object' }` produce `[{}]`, `items` con `properties` parciales produce `[{ id }]`.
37. **Un sabotaje que no muerde por apuntar mal se ve igual que uno que no muerde** (2026-10-16, spec 009/T8). `String.replace` cambia la primera ocurrencia, y `data: { type: 'array' }` aparece también en `wines.list`: el sabotaje decía "aplicado", rompió la lista de vinos y las pruebas de pedidos siguieron en verde. Igual con **CRLF**: un literal multilínea con `\n` no matchea nunca en el working copy, el sabotaje sale `NO ENCONTRADO` y la suite queda verde. **Los dos se ven exactamente igual que "el test no muerde" desde afuera.** Por eso los scripts de sabotaje usan anclas de una línea, y por qué hay que leer un `NO ENCONTRADO` como un fallo del sabotaje y no del test.
38. **`OrderTimeline.status` pasó a opcional y eso obliga a tocar tres cosas en el mismo commit** (2026-10-16, spec 009/T4). Una entrada de pago no cambia el envío, así que `status` tiene que poder ser `null`. Eso obliga a cambiar el schema JSON de la respuesta —que declara `status: { type: 'string' }` y **cortaría** el `null`— y `order_timeline.tsx`, que pasa `entrada.status` a `StatusBadge`. T1 lo dejó intacto a propósito y escribió un test que fallaba si se tocaba; T4 es cuando se escribe el primer evento de pago, y el test **cambió de regla**: ya no afirma que esté intacto, afirma que envío y pago **nunca** vienen juntos en una entrada.
39. **`api.get<T>()` no comprueba `T`: lo afirma el que llama** (2026-10-16, spec 009). `usePedidos` hace `api.get<Paginated<Order>>` con el `Order` de `types/admin`, pero la respuesta real trae `customer: { id, name, email }` **anidado** y la `timeline` con `createdAt`. No hay capa de traducción entre `api/schemas.ts` y `types/admin.ts`, así que **`types/admin.Order` declara `customerName`, `customerEmail` y `timestamp` que nadie llena nunca**: el panel muestra el nombre del cliente **vacío** en la tabla, en el drawer y en el CSV, y "Invalid Date" en cada entrada del historial. El de la fecha se corrigió en la 009 (la entrada de pago lo habría hecho visible en una pantalla nueva). **El del `customerName` quedó abierto y documentado** en el bloque "lo que el panel todavía NO usa" de `contrato_checkout.test.ts`: es la decisión que hay que tomar.
40. **`[System.IO.File]::WriteAllText` con `$null` BORRA el archivo** (2026-10-16). El `.NET current directory` de PowerShell **no** sigue al `cd`: un `[System.IO.File]::ReadAllText("src/app.ts")` desde `backend/` busca en la raíz y tira, `$c` queda en `$null`, y la línea siguiente escribe **un archivo vacío**. Pasó dos veces en una tarde: un `src/app.ts` de 0 bytes que rompía el typecheck con `TS1149: differs ... only in casing`, y **`AGENTS.md` de 0 bytes**. **Nunca escribir un archivo con una variable que pueda estar en `$null`, y siempre usar rutas absolutas en `[System.IO.File]`** — o mejor, la herramienta de edición, que no tiene ninguno de los dos problemas.
41. **El querystring NO lo valida Zod, y un `transform` suyo nunca corre** (2026-10-16, fix del filtro de pedidos). `app.ts` compila `toJsonSchema(schema)` y lo pasa a **AJV**; `request.query` es lo que AJV dejó, no el resultado de `zod.parse`. O sea que poner la lógica en un `.transform()` —partir una cadena, normalizar un enum— es escribir código que **no se ejecuta**, y el síntoma es un 400 o un filtro que no filtra, sin error de compilación que lo delate. Por eso los filtros de lista van como **lista**: `?status=pendiente&status=enviado` con `z.array(z.enum([...]))`, que `zod-to-json-schema` sí expresa, y AJV lo resuelve porque corre con `coerceTypes` (por eso `?page=3` llega como `3` y no como `"3"`). Una cadena con comas **no** se puede expresar en un `enum` de JSON Schema. Regla: **si el valor viene del query string, la lógica va en el handler, no en el schema.**
42. **Un filtro con dos mecanismos que se contradicen se rompe sin avisar** (2026-10-16). El filtro de estados era multi-select en el panel desde el 004-a y aceptaba **un** estado en el backend desde el 004-b. Una casilla andaba, dos daban 400, y en pantalla **no se veía nada**: el filtro se cerraba solo y la tabla seguía mostrando lo de antes. Un `400` en un fetch del panel es un error que el panel **no muestra**, porque `usePedidos` no distingue un fallo de red de un filtro mal armado. La defensa son los dos lados: un test que mira la **query que se arma** y otro que pide por HTTP y mira el **`where` de Prisma**.
