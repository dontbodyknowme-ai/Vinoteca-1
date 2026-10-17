# MEMORY.md

## Contexto del Proyecto
- **Nombre:** Vinoteca High-End E-Commerce
- **Proposito:** Sitio web interactivo para una vinoteca de alta gama con catalogo de productos, carrito de compras, carga de articulos en tiempo real y navegacion con animaciones de scroll.
- **Estado Actual:** **specs 001-006 COMPLETAS y mergeadas a `main`.** En producción en `$0/mes` (Neon + Render + Vercel + R2): tienda en `vinoteca-cava.vercel.app`, API en `vinoteca-cava.onrender.com`. Lo último: la **006 (permisos por rol)** — el `gestor` no ve el Dashboard, y hay tres usuarios con tres contraseñas distintas.
- **Sesión del panel (006):** `accessToken` **solo en memoria** del módulo `src/api/client.ts`; el refresh viaja en cookie `httpOnly` (`SameSite=None` + `Secure` en producción, porque la tienda y la API están en dominios distintos). No hay clave en el bundle ni en `sessionStorage`, y **no existe** ningún flag de admin en `localStorage`.
- **Los tres usuarios:** `admin@vinoteca.local` (Manuel, admin), `gestor@vinoteca.local` (Gestor), `vendedor@vinoteca.local` (Vendedor). Sus contraseñas salen de `backend/.env` (`SEED_*_PASSWORD`) y **nunca del repo**. El seed no las imprime, y re-correrlo **no** cambia el hash de nadie.
- **spec 009 (Mercado Pago) — IMPLEMENTADA, sin mergear**, en la rama `spec-009`. Las ocho tareas están hechas y verificadas una por una. **Falta el Access Token y el secreto de la webhook** para probarla contra la pasarela real, y **falta el merge explícito** (no se mergea sin que lo pidan). El comprador **no tiene cuenta**: no hay login ni registro, el formulario pide cinco datos y vuelve con `?pago=`.
- **Pago y envío son dos columnas** (D-7). `Order.status` es del envío y lo cambia el panel a mano; `Order.pagoEstado` es del pago y solo lo cambia la webhook. Los dos enumerados comparten el literal `pendiente` con significados **opuestos**, así que hay dos badges y no uno.
- **D-10 RESUELTA: el panel filtra por pago.** El usuario decidió que sí. Dos desplegables separados —`Envío` y `Pago`— porque un menú único con dos `Pendiente` sería un filtro que hay que adivinar. Se combinan con AND entre listas y OR adentro.
- **LA RAMA `spec-009` NO SE PUEDE DESPLEGAR TODAVÍA.** Sin `MERCADO_PAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET` la app levanta —las dos son opcionales a propósito, para que un deploy sin Mercado Pago no caiga— y el catálogo y el panel funcionan, pero **todo pago queda colgado esperando una webhook que nunca llega** y el cron lo expira a los 10 minutos. No mergear ni desplegar hasta que el usuario avise que ya están las credenciales.

## Decisiones de Arquitectura y Stack
- **Framework / Bundler:** React 18 con Vite 5 y TypeScript strict.
- **Gestor de paquetes:** **npm**, no pnpm. El repo tiene `package-lock.json` y todos los comandos de este proyecto son `npm`.
- **Estilos:** Tailwind CSS con paleta personalizada en modo oscuro.
- **Animaciones:** Framer Motion (efectos parallax, revela al hacer scroll, animaciones del carrito, modales y drawers).
- **Routing:** `react-router-dom` v7. El panel vive bajo `/admin` y el layout protege las cinco rutas hijas en un solo lugar.
- **Backend:** **Fastify + Node 24 + PostgreSQL + Prisma** (spec 004-b **COMPLETA**). API REST en `http://localhost:3000`. Desde 004-c el frontend **consume esa API real**; MSW quedo eliminado (`src/mocks/` y `public/mockServiceWorker.js` no existen mas).
- **Graficos:** Recharts, con `import()` diferido: queda en un chunk de 376 kB aparte, que el principal no carga.
- **Tablas:** TanStack Table en modo manual. Los filtros, el orden y la paginacion van como query params; el cliente nunca tiene la lista entera en memoria.
- **Manejo de fechas:** objeto `Date` nativo con los getters locales. **Nunca `toISOString()` para armar `YYYY-MM-DD`**: en UTC-3 un pedido del 15 a las 23:30 es del 16 en UTC y se cae fuera del rango que el usuario eligio.
- **CSV:** escrito a mano en `src/utils/csv.ts`. `papa-parse` devuelve 404 en este registry.
- **Almacenamiento:** `localStorage` para catalogo y carrito de la tienda; **`sessionStorage` para la sesion del panel**, para que el acceso no quede dado por semanas en una maquina compartida.
- **Gestion de Estado:** hooks de React. No hay libreria de estado global ni de fetching: no estan instaladas y no se agregaron.

### Decisiones de la spec 004-a que conviene no olvidar

1. **`AdminWine extends Wine`, no al revés.** `stock` y `activo` viven en el tipo del panel porque el catalogo publico no los necesita (RF-06 de la 004-b). No se pueden agregar a `Wine`: los tests preexistentes cierran `CAMPOS_REQUERIDOS` y `CAMPOS_OPCIONALES` por los dos lados.
2. **No hay boton de acceso al panel en la tienda.** Decision del usuario (2026-10-09), en contra de RF-01. Se entra escribiendo `/admin`.
3. **Sin sesion no hay redirect: hay pantalla de clave.** El enunciado pedia rebotar a `/`; se muestra el prompt en la misma URL, porque quien la escribio a proposito esta pidiendo entrar.
4. **La contrasena no es autenticacion.** Se compara en el navegador contra un valor del bundle. Se documento asi a proposito: un mock que aparente proteger algo es peor que uno que no.
5. **Configuracion es de solo lectura** salvo la seccion de datos. No hay endpoint de configuracion y la spec no define ninguno.

### Decisiones de la spec 004-c que conviene no olvidar

1. **`backend/` es una carpeta propia con su `package.json`, no un monorepo.** No se mueve: el
   Dockerfile, `docker-compose.yml` y las migraciones de Prisma ya apuntan ahi.
2. **`NodeNext` + extension `.js` en los imports relativos del backend.** Con `NodeNext` el
   compilador no resuelve `'./x'` a `x.ts`; sin la extension el build pasa en local y falla en CI.
3. **`price` en pesos enteros, no en centavos**, para que el contrato del backend sea el mismo que
   ya usaba el frontend. Los esquemas Zod de `shared/schemas.ts` rechazan `45000.5`.
4. **El carrito sigue en `localStorage`.** Es estado de la tienda, no del servidor: no hay endpoint
   de carrito en la 004-b y no se invento uno.
5. **`src/mocks/` y `public/mockServiceWorker.js` se eliminaron, no se desactivaron.** Un mock que
   queda en el repo es un mock que alguien vuelve a prender sin darse cuenta.
6. **`AuthModal.tsx` se creo y se borro.** No hay modal de login en la tienda: el acceso es por URL.

## Componentes y Estructura
- [x] `Navbar` - Navegacion fija con efecto de vidrio/opacidad al hacer scroll y contador de carrito en vivo. **Enlaces de navegación (Inicio, Catálogo, Contacto) con panel lateral en móvil implementado.**
- [x] `Hero` - Seccion principal en **disposicion partida**: texto a la izquierda (parallax), botella 3D a la derecha. Titular, copy y boton 'Explorar Cava'. Sin props.
- [x] `BotellasDestacadas` - Los 3 vinos mas caros, en **su propia seccion debajo del hero**, en flujo normal. Grid responsive, precio sobre la foto, entrada en cascada al hacer scroll.
- [x] `ProductCatalog` - Grilla e-commerce responsiva con filtros por tipo (Tinto, Blanco, Rosado, Espumante), cepa y rango de precio.
- [x] `ProductCard` - Tarjeta interactiva con zoom sutil en hover, detalles de bodega/cosecha, boton 'Agregar al Carrito' y boton 'Editar' (solo admin).
- [x] `ProductForm` - Modal/Formulario de carga/edicion de productos con soporte para URLs e subida de archivos de imagen (drag & drop). Modo edicion con carga de datos, titulo dinamico y validacion de precio > 0.
- [x] `CartDrawer` - Panel lateral deslizable animado con lista de productos, ajuste de cantidad y calculo de total.
- [x] `ProductDetailModal` - Vista rapida de producto con notas de cata, maridaje e imagen ampliada.
- [x] `Footer` - Informacion de contacto, horarios, redes sociales y aviso legal obligatorio (+18). **Agregado `id="contacto"` para navegación.**
- [x] `AnimatedSection` - Wrapper de animación scroll-reveal con Framer Motion (`useInView`), degradación a transiciones simples en móvil (< 640px).

### Back-Office (spec 004-a, implementada 2026-10-09) + Backend Real (spec 004-b, 2026-10-10)

**Acceso:** panel en `/admin`. **No hay boton de acceso en la tienda publica**: se entra escribiendo la URL, que pide una contrasena. La sesion vive en `sessionStorage`. 

- **Frontend (actual):** login real contra la API (`POST /api/auth/login`, email + password). El `accessToken` vive **solo en memoria del modulo** `src/api/client.ts`; el refresh viaja en cookie httpOnly, asi que no hay nada que leer desde `sessionStorage` ni desde la consola.
- **Backend 004-b (listo para 004-c):** `POST /api/auth/login` → JWT + refresh rotativo en cookie httpOnly, roles `admin`/`gestor`/`vendedor`, rate-limit 5 req/min.

- [x] `AdminGate` - Pantalla de pedido de contrasena (`/admin` sin sesion).
- [x] `AvisoOffline` - Banner permanente de modo offline, con "Reintentar". Marca los datos como desactualizados.
- [x] `AdminLayout` - Sidebar colapsible en escritorio / drawer en movil, header, `<Outlet>`. Es el unico lugar de proteccion: cubre las cinco rutas hijas.
- [x] `AdminSidebar` / `AdminHeader` - Navegacion del panel y "Cerrar sesion".
- [x] `DataTable` - Tabla generica sobre TanStack Table, **paginada y filtrada en el servidor** (`manualPagination`/`manualSorting`/`manualFiltering`). Estados vacio y de carga.
- [x] `MetricCard` / `MetricCardSkeleton` - Tarjetas de metricas del dashboard.
- [x] `StatusBadge` - Badge de color semantico para estados de pedido, de producto y etiquetas de cliente.
- [x] `OrderTimeline` - Historial de estados de un pedido. **Dibuja el registro, no lo recalcula** (ver CE-03).
- [x] `ConfirmDialog` - Confirmacion modal.
- [x] `DateRangePicker` - Rango de fechas sobre react-day-picker v9, tema oscuro, dos meses.
- [x] `AdminWineForm` - Alta/edicion de vino del panel. **Separado de `ProductForm` a proposito**: produce `AdminWine` (con `stock` y `activo`), no `Wine`.
- [x] `OrderDrawer` - Detalle de pedido: items, cliente, direccion, estado, timeline, etiqueta y devolucion.
- [x] `CustomerDrawer` - Detalle de cliente en 3 pestanas (pedidos/notas/datos) mas `ChipTag`.
- [x] Paginas: `dashboard.tsx`, `catalogo.tsx`, `pedidos.tsx`, `clientes.tsx`, `configuracion.tsx`.

### Backend (spec 004-b, implementada 2026-10-10)

```
backend/
├── src/
│   ├── config/env.ts           # Zod env validation
│   ├── main.ts                 # Entry point
│   ├── app.ts                  # Fastify factory + error handler
│   ├── routes.ts               # Registro centralizado módulos
│   ├── plugins/index.ts        # helmet, cors, rate-limit, swagger
│   ├── utils/errors.ts         # AppError hierarchy
│   ├── utils/logger.ts         # Pino structured logs
│   ├── modules/
│   │   ├── auth/               # JWT + refresh rotativo, roles
│   │   ├── wines/              # CRUD + import CSV + público
│   │   ├── orders/             # Timeline + roles
│   │   ├── customers/          # Search + tags + notas
│   │   ├── metrics/            # Agregaciones paralelas
│   │   ├── upload/             # Sharp → WebP → S3 signed URL
│   │   └── health/             # /health endpoint
├── prisma/schema.prisma        # 8 modelos (User, Wine, Order, etc.)
├── scripts/seed.ts             # Admin/gestor/vendedor
├── scripts/migrate-from-localstorage.ts
├── tests/setup.ts              # Defaults de process.env + Prisma (solo con DATABASE_URL_TEST)
├── tests/unit/esquemas.test.ts     # 20 tests de los schemas Zod
├── tests/modules/autenticacion.test.ts # 12 tests de authService (Prisma mockeado)
├── tests/modules/roles.test.ts       # 10 tests de authenticate/requireRole
├── vitest.config.ts            # OJO: `css.postcss: { plugins: [] }` es obligatorio
├── Dockerfile                  # Multi-stage (node:24-alpine)
├── docker-compose.yml          # DB + backend
└── .github/workflows/ci.yml    # GitHub Actions CI
```

### Utilidades y datos (spec 004-a)

- [x] `src/mocks/` - API falsa con MSW v2 (`handlers`, `data`, `filtros`, `importar_vinos`, `vino_schema`, `browser`).
- [x] `scripts/generar-mocks.mjs` - Genera `data.ts` con PRNG sembrado, para que el historial de clientes y las metricas se deriven de los pedidos y no se desincronicen.
- [x] `src/hooks/` - `useApi`, `useMediaQuery`, `useCatalogo`, `usePedidos`, `useClientes`.
- [x] `src/utils/csv.ts` - Parser y escritor de CSV **escrito a mano** (`papa-parse` da 404 en este registry; ver D-12). Maneja comillas, comas internas, CRLF y BOM.
- [x] `src/utils/csv_export.ts` - Generadores de CSV del panel, compartidos por las tablas y por Configuracion.
- [x] `src/utils/fechas.ts` - `aIsoLocal`, compartida por el DateRangePicker y por el filtro del servidor (mismo criterio de dia).
- [x] `src/utils/metricas.ts` - `tendenciaDe`. Devuelve `undefined` cuando no hay con que comparar, nunca `0`.
- [x] `src/utils/tienda.ts` - Identidad de la tienda, fuente unica (la usa el footer y Configuracion).
- [x] `src/utils/offline.ts` - Respaldo en `localStorage` indexado por URL, estado global y suscriptores. `exigirConexion()` hace fallar las escrituras sin servidor.
- [x] `src/utils/admin_acceso.ts` - Contrasena y sesion del panel.
- [x] `src/types/admin.ts` - `AdminWine`, `Order`, `Customer`, `Metrics`, `Paginated`, `ImportResult`, `OrderStatus`.

## Convenciones y Preferencias
- Estilo de codigo configurado en `AGENTS.md`:
  - TypeScript strict mode
  - Comillas simples
  - Sin puntos y comas (no semicolons)
  - Patrones funcionales
  - Gestor de paquetes: `npm`
- Paleta de colores (fuente unica en `tailwind.config.js`):
  - Superficies: `charcoal` negro carbon neutro (`#2E2E2E` → `#0A0A0A`); fondo de pagina `charcoal-950` `#0A0A0A`, cards `#1E1E1E`/`#121212`, `body` `#121212`. **Decidido 2026-10-09:** al usuario no le gusto el fondo rojo de un primer pase y pidio "volver al negro carbon en vez de rojo".
  - Acento rojo: los 9 rojos de la imagen, `wine` 400→950 (botones, bordes, badges, estados seleccionados).
  - Blanco (agregado a pedido del usuario): rampa `white` (`#ffffff`, 100-300). Definida para que `bg-white`/`text-white` resuelvan; el texto largo sobre oscuro sigue en `cream` (`#FDFBF7`), menos fatigante.
  - Dorado (acento de la marca): `gold` (`#F0D98C`, `#E5C158`, `#D4AF37`, `#AA8C2C`).
  - Neutros: grises puros, mas claros que los de Tailwind para alcanzar WCAG AA (> 4.5:1) sobre el negro carbon.
  - Excepcion a "sin hex en componentes": `PALETA` en `herocanvas3d.tsx` (Three.js no lee el config).

## Bitacora de Cambios / Notas
- *2026-10-11:* **Spec 004-d: verificacion end-to-end. El backend arranco en Windows y aparecio el bug mas caro del proyecto.** Rama `spec-004-d-verificacion-e2e`.
  - **El puerto 3000 nunca fue el problema.** Mi hipotesis de que Hyper-V/WSL2 reservaban el rango era falsa: `netsh interface ipv4 show excludedportrange` no lista el 3000. El servidor arranca y escucha bien (`0.0.0.0:3000`, `GET /api/docs` → 200).
  - **La causa real era `localhost` en la `DATABASE_URL`.** En Windows `localhost` resuelve a `::1` (IPv6) y el motor de Prisma no conecta por ahi, aunque el puerto este publicado: `Can't reach database server at localhost:5432` tras ~5 s, con `netstat` y `Test-NetConnection` en verde. Con `127.0.0.1` funciona al instante. En Linux/CI `localhost` anda, asi que nunca se manifesto alla.
  - **`response.schema` de Fastify CORTA los datos — y todo respondia 200.** Fastify no serializa con `JSON.stringify`: compila el schema con `fast-json-stringify`, que descarta lo no declarado, y los schemas de `json-schemas.ts` eran placeholders `{ type: 'object' }` (que no declara ninguna propiedad). Resultado: `login` → `"user":{}`, `metrics` → `{}`, `wines.create` → `{}`, y tambien `orders.get/update` y `customers.get/update`. **Sin un solo error ni en el log.** El efecto en el panel: `hasRole('admin')` daba `false`, asi que el boton "Panel Admin" no aparecia al loguearse y **si aparecia al recargar** (cuando entra por `/auth/me`, que si tenia schema completo). El dashboard leia todas las tarjetas en cero. Fix: helper `objetoLibre()` (`additionalProperties: true`) en todos los responses.
  - **Test de regresion** `tests/unit/json_schemas.test.ts`: arma una app de Fastify real con cada `response.schema` y verifica que la respuesta conserve los datos. Probado en contra: sacando `additionalProperties` fallan 7 de 11, exactamente los endpoints rotos.
  - **Leccion:** 147 tests unitarios, 0 errores de typecheck, lint limpio, build OK, CI verde — y la app seguia rota. Un test que verifica el codigo de respuesta HTTP es distinto de uno que verifica el status.
  - **Bug del login (lo reporto el usuario como "no me deja entrar con admin123").** La password era correcta: el backend contestaba 200 con token y cookie. El problema es que `AdminGate` llamaba a `api.auth.login()` **crudo** en vez de `useAuth().login()`. La llamada cruda devuelve los tokens pero no toca estado: el `accessToken` vive en el modulo `api` y el `user` en el `AuthProvider`, y los dos los setea el hook. Con la llamada directa, `isAuthenticated` queda en `false`, `AdminLayout` (linea 73: `if (!autorizado) return <AdminGate />`) vuelve a renderizar el gate y el formulario se limpia -> **bucle infinito con la password correcta**. Era el unico lugar del proyecto que llamaba a la API de auth por fuera del hook.
  - **Bug 3 y 4, encontrados leyendo el log del server (no por tests).**
    - **`setErrorHandler` convertia TODO error de cliente en 500.** Solo manejaba `ZodError` y `AppError`; JSON malformado, body vacio y schema que no valida caian en el `500 INTERNAL_ERROR`. El admin veia "Error interno del servidor" cuando el error era suyo. Ademas `request.log.error` salia del `logger: false` de Fastify -> **un 500 real no quedaba registrado en produccion**. Esa ultima parte se nota porque no habia forma de ver el error: hubo que prender el logger de Fastify a mano para encontrar el `FST_ERR_CTP_EMPTY_JSON_BODY`.
    - **`Content-Type: application/json` en un POST sin cuerpo rompe Fastify.** `/api/auth/logout` y `/api/auth/refresh` devolvian 500 justamente por eso: el cliente los llama sin body pero con el header. Con el accessToken solo en memoria, un 500 en `/auth/refresh` es lo que hace que a los 15 minutos el panel deje de funcionar. Arreglado de los dos lados: `request()` solo pone el header si hay cuerpo, y `buildApp` registra un parser que acepta el cuerpo vacio como `{}` (quitando el BOM, como hacia el parser original).
    - **Swagger:** `routePrefix` sin barra final hacia que el navegador pidiera `/api/static/...` y la pagina quedara sin estilos. Va `/api/docs/` + redirect explicito.
    - **El "500" del login valido al final era la base caida**, no un bug: el contenedor `vinoteca-1-db-1` estaba `Exited (0)`. `docker compose up -d db` y volvio a 200. Vale la pena notar que el error handler nuevo lo registro bien, que es justamente lo que el anterior no hacia.
  - **`LOGIN_RATE_MAX` sube a 1000 en `tests/setup.ts`** porque con el valor real (5/min) el sexto POST a `/api/auth/login` corta con 429 y el test falla por el motivo equivocado.
- *2026-10-11 (tarde):* **Verificacion de la imagen Docker: dos bugs quearian el deploy entero.** El job de Docker nunca habia corrido (siempre `Skipped` porque `needs: [frontend, backend]` fallaba). Al correrlo aparecieron dos cosas que ninguna otra forma de testing detecta:
  - **La imagen compilaba pero el contenedor no arrancaba nunca.** `node:24-alpine` + Prisma: `libquery_engine-linux-musl.so.node` pide `libssl.so.1.1` y Alpine usa musl con OpenSSL 3. `prisma generate` NO carga el engine, asi que el build pasaba limpio y el fallo aparecia recien al levantar el contenedor. Fix: `node:24-slim` + `openssl`/`ca-certificates`/`curl` en la etapa runner.
  - **`pino-pretty` es devDependency y en produccion no esta.** Con `NODE_ENV=development` (que es lo que dice `.env.example`, o sea el default) el logger pide el transporte pretty y tira `unable to determine transport target for "pino-pretty"` al importar el modulo. Fix: la guarda pasa a ser **disponibilidad** (`require.resolve('pino-pretty')`), no solo `NODE_ENV`.
  - **Leccion:** un Dockerfile que compila no es un Dockerfile que arranca. Los dos fallos只有在 `docker run` los ve; `npm run build` y los tests pasan los dos.
- *2026-10-11:* **CI arreglado.** Los 3 checks de GitHub Actions estaban rojos despues del merge de 004-c. Tres causas distintas, ninguna en el codigo de la app:
  - **Frontend — Node 20 vs `jsdom@30`.** El job moria en `Test` con `webidl.util.markAsUncloneable is not a function`, 6 unhandled errors y 0 tests corridos. `jsdom@30.1.2` exige `^22.22.2 || ^24.15.0 || >=26` y su `undici@8` llama a `util.markAsUncloneable`, que nacio en Node 22.13. Local pasaba porque el usuario corre Node 26. Node 24 fijado en `.nvmrc`, `NODE_VERSION` y las dos etapas del `backend/Dockerfile`.
  - **Backend — no habia tests.** `tests/` solo tenia `setup.ts`; `integration/` y `modules/` estaban vacias y git no trackea carpetas vacias, asi que `vitest run` salia con "No test files found" y codigo 1. Agregados **42 tests** (`unit/esquemas`, `modules/autenticacion`, `modules/roles`) con Prisma mockeado via `vi.hoisted`.
  - **Backend — fuga del `postcss.config.js` del frontend.** Vite busca la config de PostCSS subiendo directorios desde `backend/`, encontraba la de la raiz y pedia `tailwindcss`. Local se resolvía desde el `node_modules` de la raiz; en CI el job de backend solo instala `backend/node_modules`. Fix: `css.postcss: { plugins: [] }` en `backend/vitest.config.ts` (Vite solo saltea la busqueda en disco si `css.postcss` es un objeto plano).
  - De paso: el typecheck del CI paso de `npx tsc` a `npm run typecheck`, porque con `node_modules` ausente `npx` baja el paquete `tsc@2.0.4` (que no es TypeScript) y el paso "pasa" sin compilar nada.
  - La leccion general: **los dos jobs fallaron por el entorno, no por el codigo**, y los dos bugs eran "funciona en mi maquina" — version de Node y `node_modules` de un proyecto hermano.
- *2026-10-10:* **Spec 004-b (Backend API Real) COMPLETA.** 9 tareas, 33 archivos backend, 9726 líneas agregadas. Commit `0bafd9c` pusheado a `main`.
  - T1: Infra (Prisma 8 modelos, Docker, seed, migraciones)
  - T2: Auth JWT + refresh rotativo, roles admin/gestor/vendedor, rate-limit, Swagger
  - T3: Vinos admin CRUD + import CSV streaming (papaparse, upsert por id)
  - T4: Vinos públicos `GET /api/wines/public` (solo activos)
  - T5: Pedidos CRUD + timeline atómico, roles vendedor restringido
  - T6: Clientes search+tags, notas append-only, tags replace
  - T7: Métricas agregaciones paralelas, shape `Metrics` exacto frontend
  - T8: Upload Sharp→WebP→S3 signed URL, validaciones mimetype/tamaño
  - T9: Script migración localStorage→PostgreSQL, GitHub Actions CI, Docker multi-stage
  - TypeScript strict, build OK, typecheck OK, migraciones aplicadas, seed OK

- *2026-10-09 (noche):* **Fondo y superficies de vuelta al negro carbon.** Al usuario no le gusto el fondo rojo del primer pase (`#35030F`) y pidio "volver al negro carbon en vez de rojo". Los 9 rojos siguen como acento; solo cambia la superficie:
  - `charcoal` deja de ser los 5 rojos mas oscuros y vuelve al gris neutro: `#2E2E2E`/`#262626`/`#1E1E1E`/`#121212`/`#0A0A0A`. `charcoal-800/900/950` recuperan los valores previos a la paleta (`#1e1e1e`/`#121212`/`#0a0a0a`); `600/700` (que codigo usa para hovers y no existian antes) se definen como grises.
  - `neutral` pierde el tinte vino y pasa a grises puros (`400` `#a3a3a3`, `500` `#8f8f8f` = 5.15:1 sobre `#1e1e1e`), manteniendo WCAG AA sobre las superficies carbon.
  - `src/index.css`: `:root` y `body` vuelven a `#121212` (el valor previo a la paleta; habian quedado en `#35030F`).
  - No cambian `wine` (9 rojos), `gold`, `white` ni `cream`. La 3D no toca el fondo (el canvas es alfa, la botella sigue siendo roja/vino como marca).
  - Reauditado en navegador: 0 fallas de contraste en `/` y las 5 rutas de `/admin`. 224/224 tests, `tsc` 0, `lint` 0, `build` OK.
- *2026-10-09 (noche):* **Paleta de la marca aplicada** (los 9 rojos de la imagen + blanco y dorado, a pedido del usuario).
  - **`tailwind.config.js` quedo como fuente unica de la paleta.** Se elimino el bloque `@layer utilities` de `src/index.css` que pisaba las utilidades de Tailwind con hex hardcodeados y ya divergentes (`wine-900` era `#3d0a16` en CSS contra `#3a0a1a` en el config; `gold-500`, `#c9a02e` contra `#d4af37`). Ese bloque, agregado sin avisar en un commit de la spec 003, es la razon de que hasta ahora "cambiar la paleta" no cambiara nada.
  - Rampas nuevas: `wine` con los 9 rojos (400→950); `charcoal` = los 5 rojos mas oscuros, para que las superficies tengan temperatura de vino en vez de gris; `white` (`#ffffff` + 100-300) agregada a pedido del usuario; `gold-300` (el codigo ya la usaba sin estar definida); `neutral` sobreescrito con grises calidos **mas claros**, porque el fondo nuevo (`#35030F`) es mas claro que el viejo (`#0a0a0a`) y con el gris de Tailwind el texto secundario caia por debajo de AA.
  - `PALETA` en `herocanvas3d.tsx` duplica los hex: Three.js no puede leer el config. Documentado ahi y en `AGENTS.md`.
  - **Auditoria de contraste en navegador (medicion de estilos computados, no capturas):** 0 fallas en `/` y en las 5 rutas de `/admin` despues de tres arreglos, ninguno introducido por la paleta sino expuesto por ella:
    1. Aviso +18 del footer: `text-wine-500/80` daba **1.73:1**, ilegible (ya estaba roto con la paleta anterior: era `#800020` sobre `#0a0a0a`, 1.8:1) → `text-gold-400` (10.3:1).
    2. "CAVA & CO. v1.0" del sidebar: `text-neutral-700` a **2.13:1** a 10 px → `text-neutral-500`.
    3. `neutral-500` ajustado de `#9b858d` a `#A08B93`: daba 4.46:1 sobre `bg-charcoal-800`, **0.04 por debajo** de AA. El `neutral-400` (`#ad979e`) sigue siendo mas claro, asi que la rampa no se invierte.
  - La paleta en si quedo commiteada por el usuario (`c3cf120`, "botella"); los tres arreglos y esta documentacion estan en el working tree.
  - 224/224 tests, `tsc` 0, `lint` 0, `build` OK.
- *2026-10-09:* **Spec 004-a (Back-Office) completa.** 10 tareas, 200 tests, `tsc` 0, `lint` 0, `build` 0. Rama `spec-004-a`.
  - **T1** Infra: `react-router-dom` v7, MSW v2, tipos `AdminWine`/`Order`/`Customer`/`Metrics`, mocks generados por `scripts/generar-mocks.mjs` con PRNG sembrado. Arregladas 3 regresiones de la spec 003 que nunca seHabian detectado (`loadWines`/`loadCart` sin guardas RF-34, mensaje de checkout, `VistaRapidaProducto` caido de `App.tsx`).
  - **T2** Layout: `AdminLayout`, `AdminSidebar`, `AdminHeader`, `useMediaQuery`. La proteccion vive en el layout y no en el router: es el unico ancestro comun de las cinco rutas hijas.
  - **T3** Componentes compartidos: `DataTable`, `MetricCard`, `StatusBadge`, `OrderTimeline`, `ConfirmDialog`, `utils/csv.ts`.
  - **T4** Dashboard: metricas, grafico Recharts en chunk aparte, top 5 y actividad. `tendenciaDe` devuelve `undefined` cuando no hay dato, nunca `0%` falso.
  - **T5** Catalogo: CRUD completo, import/export CSV. **6 bugs del mock corregidos**: el importador de CSV nunca funciono (desestructuraba un objeto como tupla, y ademas tenia su propio parser con `split(',')`), no aceptaba los encabezados en espanol que genera el export, el export no llevaba `id` (reimportar duplicaba el catalogo), `Boolean("no")` daba `true`, y `duplicar` mandaba el `id` del original (borrar la copia borraba el original).
  - **T6** Pedidos: multi-estado, `DateRangePicker` con react-day-picker v9, drawer con timeline, etiqueta y devolucion. **Bugs**: el filtro multi-estado comparaba contra la cadena entera y no encontraba nada; las fechas se comparaban por el dia UTC y un pedido del 15 a la noche caia fuera del rango del 15; el rango invertido no se corregia; el calendario no se reabria en el mes correcto (`defaultMonth` solo aplica al primer montaje); el drawer mostraba el pedido viejo al cambiar el estado.
  - **T7** Clientes CRM: drawer de 3 pestanas, notas, tags. **Bugs**: los tags de los mocks estaban capitalizados (`'VIP'`) y el filtro normaliza a minusculas, asi que no encontraba ninguno; no habia ni un cliente sin email, asi que CE-04 no se podia ver; la busqueda de pedidos no buscaba por `customerId` y la pestana de pedidos salia siempre en 0.
  - **T8** Configuracion: 4 secciones, 3 exports y 1 import. Se extrajo la logica de CSV a `utils/csv_export.ts` porque estaba triplicada en los hooks y habria sido una cuarta copia. Se creo `utils/tienda.ts` porque el footer tenia el email escrito dos veces en el mismo componente.
  - **T9** Acceso por contrasena. **Decision del usuario: no hay boton de acceso al panel en la tienda publica** (contra RF-01). Se entra escribiendo `/admin`, que pide contrasena. Sesion en `sessionStorage`. Se elimino el flag `isAdmin` de `localStorage`, que era un flag publico que cualquiera ponia en `true` desde la consola.
  - **T10** Verificacion integral y documentacion. **`npm run lint` encontre 4 archivos con problemas que no se habian revisado en 9 tareas**: genericos vestigiales en una augmentation de TanStack, un helper sin uso en un test, un BOM invisible escrito como caracter literal en `csv.ts` (en vez de `﻿`, que ademas no compila sin flag `u`), y el service worker generado de MSW linteado. Ademas: **`date-fns` se importaba sin declararse como dependencia**, funcionando solo por hoisting; ahora es dependencia directa (RNF-04 la aprobaba). **CA-37/CE-05 (fallback offline) quedo sin implementar**: se reporta en el task.md.
  - **Correccion de encabezado:** T8 decia cubrir "RF-19, RF-20, RF-33". RF-33 es de tags (hecho en T7) y los RF de CSV son RF-20, RF-21 y RF-34, ya implementados en T5 y T7. T8 no cubria ningun RF sin hacer.
- *2026-10-09 (tarde):* **Cerrada la spec 004-a.** Se implemento **CA-37 / CE-05 (fallback offline)**, que T10 habia reportado como pendiente.
  - `src/utils/offline.ts` guarda en `localStorage` lo ultimo que llego del servidor, **indexado por URL**. Por URL y no por recurso: las tablas piden distinto segun filtro y pagina, y con una clave por recurso el fallback mostraria la pagina 3 sin filtro bajo el titulo "Tinto".
  - `src/components/admin/aviso_offline.tsx`: banner permanente que marca los datos como desactualizados, con boton "Reintentar". El `alert('Modo offline')` que pide CE-05 se dispara **una vez por paso a offline**, no en cada fetch.
  - **Las escrituras no se encolan**: offline, crear o editar falla con mensaje explicito. Encolar traeria conflictos sin resolver (el servidor pudo cambiar entre que se guarda y que se manda).
  - **Bug encontrado al implementarlo:** `useApi` dejaba los datos viejos en pantalla cuando el fetch fallaba sin respaldo. Con un filtro nuevo, la tabla mostraba las filas del filtro anterior debajo del mensaje de error, como si fueran el resultado.
  - Tests: **224 de 224**, `tsc` 0, `lint` 0, `build` OK.
  - Anotado en `specs/003-mejoras-ux/spec.md` (sin tocar codigo): **el hero quedo cargado.** El titulo "CAVA & CO." tapa la animacion 3D y la fila de botellas destacadas compite por el mismo espacio de un `min-h-screen`. El usuario quiere volver a la interfaz anterior sin destacadas, pero decidio **anotarlo y dejarlo para despues**.
- *2026-10-09 (tarde):* **Hero rediseñado a disposicion partida.** A pedido del usuario: "poné las botellas destacadas más abajo, que no queden encima de nada; el hero a la izquierda y el HeroCanvas3D a la derecha, como en las versiones anteriores".
  - **No hay version previa que restaurar**: `hero.tsx` en el primer commit (6a45f39) esta truncado en 124 bytes, y `interfaz`, `main` y `spec-003` tienen la misma version de 4394 bytes que la de antes del cambio. La disposicion se reconstruyo desde cero.
  - Hero en `lg:grid-cols-2`: texto a la izquierda, canvas a la derecha. El canvas ya no esta en `absolute inset-0`. Titulo de `text-8xl` a `text-6xl`.
  - Las botellas destacadas se movieron a `src/components/botellas_destacadas.tsx`, en su propia seccion debajo, en flujo normal. `Hero` dejo de recibir props y ahora es `Hero()`. RF-22/23/24 siguen cumplidas: cambia **donde**, no **que**.
  - La flecha de scroll estaba en `absolute bottom-12` centrada, encima de las botellas; ahora cuelga del boton.
  - Se saco el hero de su `AnimatedSection`: es la primera pantalla y el reveal por scroll lo dejaba fuera de vista al cargar.
  - Verificado en navegador: titulo `left 80→640`, canvas `left 712→1296`, sin interseccion. En movil se apila sin scroll horizontal.
  - Se muestran 2 botellas y no 3 porque `INITIAL_WINES` tiene 2 vinos. Los 12 del panel son mock de MSW.
- *2026-10-08:* Implementada Tarea 8 (T8) - Verificación integral y documentación. Todas las tareas de la spec 003 completadas: T1 (Filtros por precio y cepa), T2 (Edición de productos), T3 (Carga de imagen por archivo drag & drop), T4 (Enlaces de navegación), T5 (AnimatedSection scroll-reveal), T6 (Parallax en Hero), T7 (Botellas destacadas). Verificación: `npx tsc --noEmit` y `npm run build` pasan. No se instalaron dependencias nuevas. Se actualizó `MEMORY.md` y `AGENTS.md`.
- *2026-10-08:* Implementada Tarea 4 (T4) - Enlaces de navegación. Se agregaron enlaces a la barra de navegación (Inicio, Catálogo, Contacto) con scroll suave y offset para no tapar el encabezado por la barra fija. En móvil se implementó panel lateral (drawer) con Framer Motion (`AnimatePresence` + `motion.aside`) que anima desde la derecha, se cierra al hacer click en enlace, en la X o en el fondo. Se creó componente `Footer` (`pie_de_pagina.tsx`) con `id="contacto"` como destino de navegación. Se actualizó `App.tsx` para incluir el Footer.
- *2026-10-08:* Implementada Tarea 2 (T2) - Edicion de productos (solo admin). Se extendio `ProductForm` con props `onUpdateWine` y `wineToEdit`, agregado `useEffect` para cargar datos del vino a editar, titulo dinamico ('Editar Vino' / 'Cargar Nuevo Vino'), boton 'Guardar Cambios' en modo edicion, validacion de precio > 0. En `App.tsx` agregado estado `vinoAEditar` y funcion `actualizarWine`. En `ProductCard` agregado boton 'Editar' visible cuando se pasa `onEditWine`. Conectado flujo completo: click en 'Editar' en tarjeta -> abre formulario en modo edicion -> guarda con `actualizarWine` manteniendo mismo ID.
- *2026-10-08:* Implementada Tarea 1 (T1) - Filtros por precio y cepa. Se agregaron: `src/utils/filtros.ts` con funcion `filtrarVinos`, extendido `WineFilterState` en `src/types/vino.ts` con `minPrice`, `maxPrice` y `selectedVarietals`, actualizado `carta_de_catalogo.tsx` con inputs numericos para precio minimo/maximo, chips toggle para cepas disponibles, botones "Limpiar" para restablecer filtros, y conectado todo en `App.tsx` con nuevos props y estado.
- *2026-10-05:* Creado el archivo AGENTS.md en espanol con la especificacion completa del proyecto y los comandos `pnpm`.
- *2026-10-05:* Configurado MEMORY.md sincronizado con el stack tecnico (Vite + React + TS, Tailwind CSS, Framer Motion y Zustand/Context).
- *2026-10-05:* Creado y ubicado el documento de gobernanza en `docs/constitution.md`.
- *2026-10-12:* **Primer despliegue real a produccion (spec 005, T6).** Railway + Postgres + Cloudflare R2. **Se dejo a medias: el backend responde pero con el dominio viejo y falta el seed.**
  - **Cuatro bugs reales encontrados en el camino, ninguno en el codigo de negocio:**
    1. `package-lock.json` desincronizado del `package.json` (la CLI de prisma se habia movido a `dependencies`) rompia `npm ci` del job de backend. El CI moria en 36 s, antes de compilar. Localmente no se notaba porque un `npm install` de rutina acomoda el lock solo.
    2. `/health` contestaba `"db":"disconnected"` sin decir por que: `catch {}` en la ruta y `new PrismaClient()` **sin `log`**, que es el default de Prisma. Dos capas de silencio.
    3. `npm run seed` no podia correr en el contenedor: `tsx` en `devDependencies` (la imagen final instala con `--omit=dev`) **e** import de `../src/config/env.js`, que el contenedor no tiene porque solo lleva `dist/`. El import ademas estaba sin usar, y sobrevivio porque `scripts/` no esta en el `include` del tsconfig.
    4. **El mas caro:** agregar `tsconfig.scripts.json` rompia el build sin que se notara, porque el Dockerfile hacia `COPY tsconfig.json ./` (un archivo) y no lo copiaba. **Un build fallido deja sirviendo el deploy anterior con exito**: `/health` daba 200, la API respondia, y lo unico raro era que los cambios del repo "no aplican".
  - **Test que faltaba y se agrego:** el de deploy recorre `db:deploy`, `start` y `seed`, resuelve los `npm run` anidados y falla si alguno arranca con una herramienta de `devDependencies`. Cubre la clase de bug, no el caso. Tambien uno que compara los `tsconfig*.json` **que existen en disco** contra los patrones `COPY` del Dockerfile, en vez de una lista escrita a mano.
  - **93 -> 94 tests backend**, `tsc`/`lint`/`build` en verde.
  - **Pendiente para retomar:**
    - `Settings -> Source -> Root Directory` tiene que ser `backend`. **El schema de `railway.json` no permite declarar el contexto de build** (solo `dockerfilePath`), asi que esto vive solo en el panel y se resetea al renombrar el servicio o recargar el repo.
    - **Fix estructural propuesto:** mover el `Dockerfile` a la raiz del repo copiando desde `backend/`. Con el Dockerfile en la raiz el contexto es la raiz por definicion y desaparece el unico ajuste que puede resetearse a escondidas.
    - `PUBLIC_API_URL` apunta a un dominio que dio 404 al renombrar el servicio. Renombrar un servicio **libera su dominio autogenerado**.
    - Falta correr el seed (`railway ssh -s Vinoteca-1` y `npm run seed`).
    - T7 (Vercel) y T8 (verificacion integral) sin empezar.
- *2026-10-13 (tarde):* **spec 005 T6 CERRADA. Primera API en produccion, verificada de punta a punta.**
  - **Plataforma final: Neon (base) + Render (API) + Vercel (front) + R2 (imagenes). Todo $0.** Se salteo Koyeb porque su consola renderizaba vacia en este navegador, aunque su status estaba en verde (99,9% de uptime, sin avisos en 7 dias).
  - **Verificado desde afuera:**
    ```
    /health          {"status":"ok","db":"connected","uptime":65.4}
    /api/docs/       200 (Swagger)
    /api/auth/login  accessToken + user con role: admin y email reales
    ```
    El `user` poblado es la prueba de que el arreglo de 004-d (los `response.schema` de Fastify que truncaban las respuestas) sigue en pie en produccion.
  - **Cuatro bugs mas en el camino de hoy, todos del mismo tipo: algo mal configurado que no se ve hasta que corre en produccion.**
    1. `Dockerfile` sin `COPY backend/scripts`. `tsconfig.scripts.json` pide `scripts/seed.ts` -> `error TS18003: No inputs were found`. **El build entero moria por un archivo que no participa de la app y el error no menciona al seed**, asi que Render solo pudo decir "Exited with status 1".
    2. `CORS_ORIGIN` definida pero **vacia**: `z.string()` acepta `''`, el arranque pasaba, `/health` daba 200 y **cada request** devolvia 500 con `Invalid CORS origin option`. Tres capas de silencio.
    3. `STORAGE_PUBLIC_URL` faltaba en `tests/setup.ts`. Localmente lo tapaba el `.env`; en CI (que solo define `DATABASE_URL` y no tiene `.env` porque esta gitignored) el job de backend moria al importar `env.ts`. **Encontrado revisando, no porque fallara.**
    4. `ZodError` crudo al arrancar: 40 lineas de JSON con dos mitades que se pisan y corchetes sin cerrar, todo embarrado por `pino-pretty`. Ahora es una lista que nombra cada variable.
  - **Regla nueva que sale de hoy:** toda variable de entorno tiene que **nombrarse a si misma** cuando falla. Un error de arranque que no dice cual variable falla obliga a adivinar entre 13.
  - **Tests: 105 backend** (+15). Los dos que mas Travelingdan pesan: "cada COPY apunta a algo que existe en el repo" y "todo lo que los tsconfig declaran como entrada entra a la imagen". El segundo existe porque el primero no veia un COPY que **faltaba** (no apuntaba a algo inexistente: faltaba).
  - **Verificacion sin Docker:** se simulo el layout del build (copia de lo que el Dockerfile copia + junction a `node_modules`) y se corrieron los dos `tsc` de verdad. Con `scripts/`: exit 0. Sin: TS18003. Docker Desktop estaba apagado y esperar un ciclo de Render por cada teoria no era una opcion.
  - **Pendiente:** T7 (Vercel) y T8 (verificacion integral). En T7 hay que corregir dos variables de Render que quedaron apuntando a dominios que no existen: `CORS_ORIGIN` (hoy `http://localhost:5173`) y `PUBLIC_API_URL`.
- *2026-10-13 (noche):* **Sesion del panel arreglada y verificada en produccion. Se cierra el dia con 5 bugs reales encontrados deploying.**
  - **El bug mas caro: la sesion moria en cada recarga.** Login 200, panel abierto, F5 y el gate de vuelta. Causa: `sameSite: 'lax'` en la cookie de refresh. Con la tienda en `vercel.app` y la API en `onrender.com` son **sitios distintos**, y `Lax` solo manda la cookie en navegaciones de primer nivel, no en un `fetch`. En local (`localhost:5173` / `localhost:3000`) es el mismo sitio y **el bug no existe**. Necesita `SameSite=None` **con** `Secure`; los navegadores rechazan `None` sin `Secure`.
  - **El segundo mas caro: las migraciones deadloqueaban la base.** El build pasaba entero y el contenedor moria en el arranque con `Exited with status 1` y ni una linea de error en Render. El motivo estaba en el log del runtime, y reproduciendolo localmente salio:
    ```
    Timed out trying to acquire a postgres advisory lock (SELECT pg_advisory_lock(72707369)). Elapsed: 10000ms.
    ```
    El pooler de Neon es PgBouncer en modo *transaction*: la conexion real vuelve al pool al terminar cada transaccion **con el advisory lock de sesion puesto**. Queda una sesion `idle` retenida y el siguiente `migrate deploy` no lo puede tomar. **El primer deploy funciona y el segundo muere siempre.** Se separa con `directUrl` en el datasource (app usa `url` pooled, migraciones usan `directUrl`).
  - **La parte fea del segundo:** el fix era correcto y el deploy **sigo fallando igual**, porque el lock huerfano anterior seguia tomado. Los locks son de base de datos, no de conexion: **arreglar el codigo no deshace el estado que dejo el bug anterior**. Hubo que cerrar la sesion retenida a mano con `pg_terminate_backend`. Verificado con tres `migrate deploy` seguidos en verde.
  - **`NODE_ENV` faltaba en Render** y apagaba dos cosas en silencio: la cookie salia `Lax` sin `Secure` (por eso el fix del `sameSite` no tomaba efecto aunque estuviera el codigo bien) y `CORS_ORIGIN` dejaba de ser obligatoria. La senal de que algo pasaba era que la cookie no traia `Secure`.
  - **`CORS_ORIGIN` vacia** hacia fallar cada request con 500 (`Invalid CORS origin option`): `z.string()` acepta `''`, el arranque pasaba, `/health` daba 200. Ahora se valida de verdad y es obligatoria en produccion.
  - **`Render NO redeploya al guardar una variable de entorno.** El valor queda guardado y el contenedor sigue con el anterior. Sintoma: la tienda carga entera, el catalogo vacio, cero errores, `/health` en 200. Hay que apretar **Save Changes** y confirmar con el `uptime` de `/health` que el contenedor reinicio de verdad.
  - **Catalogo de demostracion cargado**: 12 vinos (10 activos) en Neon, idempotente por `id` con slug estable. Venian de `scripts/generar-mocks.mjs`, muerto desde 004-c.
  - **Verificado en navegador real, no con curl:** login -> panel -> F5 -> sigue adentro. `POST /api/auth/refresh` devuelve 200 donde antes daba 401.
  - **Tests: 116 backend, 105 frontend.** Los nuevos que mas pesan: los de la cookie (`refresh_cookie.test.ts`, que fuerza `NODE_ENV=production` porque con el default se verificaria la rama de desarrollo, que es justo la que no tiene el bug) y el aviso de `NODE_ENV` mal puesto.
  - **Leccion del dia:** *arreglar el codigo no deshace el estado que dejo el bug anterior*, y *una variable con el valor equivocado no rompe nada, apaga cosas*. Las dos serologistaron horas de deploy porque el sintoma era invisible desde el servidor.
  - **Pendiente:** T8 (verificacion integral) y el merge. Todo en `$0/mes`: Neon + Render + Vercel.
- *2026-10-14:* **T8 ejecutada. CI en verde por primera vez en tres commits.**
  - **`scripts/verificar-produccion.mjs`** (`npm run verificar:produccion`): corre los once chequeos de acceptance y sale con codigo 1 si alguno falla. Siete automatizables, cuatro marcados `manual` con el motivo, porque **un script que dice OK sin haber comprobado nada es peor que uno que dice manual**. Aguanta el cold start del plan free (despierta la API antes de medir; si no, CA-01 falla por timeout y parece un deploy roto).
  - **Lo que encontro: el CI estaba en rojo desde tres commits.** `DIRECT_URL` se agrego al datasource de Prisma y el workflow no la declaraba: `error: Environment variable not found: DIRECT_URL` (P1012). `prisma generate` y `migrate` **validan** el schema aunque no se conecten a nada, y el CI **no tiene `.env`**, asi que localmente no se veia. El frontend en verde y el backend en rojo durante tres pushes.
  - **Dos bugs mas en el mismo workflow, unbeknownst:** `npm run db:migrate` (= `migrate dev`, interactivo y con base sombra) en vez de `db:deploy`, contra D-B desde el principio; y `docker build ./backend` despues de mover el `Dockerfile` a la raiz.
  - **`prisma generate` corre DENTRO de la imagen**, asi que el `Dockerfile` declara placeholders de `DATABASE_URL` y `DIRECT_URL` en la etapa builder. Solo en esa etapa: la runner no los hereda.
  - **Tres tests nuevos** para que no se repita: el CI define todas las variables que el schema exige (toma los `env("X")` del `schema.prisma`), el CI construye desde la raiz, y el CI usa `migrate deploy`.
  - **CA-08 estaba mal especificado**: decia "origen no permitido recibe 403 de CORS". `@fastify/cors` con origen fijo no devuelve 403, omite la cabecera y el navegador bloquea. Un 403 seria peor: mezclaria "CORS te rechazo" con "tu sesion vencio".
  - **CA-06 armado, no se puede cerrar antes**: `scripts/armar-ca06.mjs` (`npm run armar:ca06`) subio una imagen real a las `2026-10-14T03:02:47Z`. Responde `200 image/webp` y la URL **no tiene firma ni caducidad** (D-G). Vence `2026-10-15T03:02:47Z`.
  - **DEPLOY.md reescrito** con los seis huecos que aparecieron al seguirlo de verdad: las dos URLs de Neon, `NODE_ENV=production` obligatorio, que Render no redeploya al guardar una variable, el cold start, y una tabla de troubleshooting de 16 filas con los errores reales que vimos.
  - **119 tests backend, 105 frontend.** CI verde en `a0375e7` con los tres jobs en `success`.
  - **Falta:** CA-06 mañana, y el merge (que espero pedido explicito).

- *2026-10-16:* **spec 009 completa: T3 a T8 escritas, verificadas una por una, y la costura entre las dos puntas.**
  - **Mercado Pago detras de una interfaz** (`modules/pagos/proveedor.ts`). El 90 % del checkout no necesita la pasarela —solo el `preferenceId`— asi que si el `fetch` estuviera en el handler, esos tests tambien necesitarian Mercado Pago y la unica forma de probarlos seria con plata de verdad. El doble **registra lo que se le pidio**; uno que devuelve un id fijo sin registrar nada deja pasar todo sin verificar nada del contrato.
  - **El total sale de `Wine.price` y es EL MISMO numero** que se guarda y el que se manda. No se calculan por separado: si difirieran aunque sea un peso, la webhook podria aprobar un monto que el panel nunca muestra, que es el tipo de mentira que esta spec vino a arreglar.
  - **El pedido se crea ANTES que la Preference.** Al reves, `external_reference` no tendria que mandar porque el id todavia no existe; y el fallo sale del lado correcto: si la Preference falla queda un pedido en `no_iniciado` que expira a los 10 minutos y deja el rastro del intento.
  - **La webhook no se fia de su cuerpo**: valida la firma (HMAC SHA256 del texto canonico que impone Mercado Pago, con `timingSafeEqual`), **pregunta** `GET /v1/payments/:id` el estado real, y la idempotencia es **un `updateMany` condicional** — atomico en Postgres, sin la carrera del "leer y decidir".
  - **El cron corre dentro del proceso** porque Render free no tiene cronjobs, y es coherente con que las migraciones tambien corran en el arranque. El intervalo lleva `unref()`: sin eso la suite cuelga **en verde**.
  - **El carrito no se vacia al apretar "Finalizar Pedido".** Se vacia solo con el pago aprobado. El sandbox de Mercado Pago manda a cancelar seguido, y el comprador tiene que encontrar su carrito intacto.
  - **El panel ve el pago y el envio por separado**, con dos badges y con rotulo. La tabla tiene una columna de pago de solo lectura —no un filtro, que es D-G y sigue abierta— porque sin ella no se puede responder "cuanto cobre hoy" sin abrir pedido por pedido.
  - **Todos los tests verificados en contra.** 16 sabotajes, todos muerden. Y dos **no** mordieron, que es lo importante: uno apuntaba a la primera ocurrencia (`wines.list`, no `orders.list`) y otro se satisfacia con un **comentario** que mencionaba `.strict()`.
  - **264 tests frontend (+104), 307 backend (+142).** Todo en verde, typecheck y lint de los dos lados.
  - **Verificacion de integracion: dos bugs que ninguna mitad podia ver.** `types/admin.Order` declaraba `timestamp`, `customerName` y `customerEmail`, y **nadie los llena nunca**: no hay capa de traduccion entre `api/schemas.ts` y `types/admin.ts`, y `api.get<T>()` no comprueba `T`, lo afirma el que llama. El historial mostraba **"Invalid Date"** en cada entrada y el nombre del cliente esta **vacio** en la tabla, el drawer y el CSV. Corregi la fecha (la 009 mete una entrada de pago nueva que lo habria hecho visible). **El `customerName` quedo abierto y documentado** en `contrato_checkout.test.ts`, en un bloque que se borra con el arreglo: es la decision que hay que tomar.
  - **`test/contrato_checkout.test.ts`**: el unico test que mira las dos puntas a la vez. Si el backend devuelve `preferenceId` y el frontend lee `preferenceIdOk`, todo pasa en verde. Verificado en contra con siete sabotajes.
  - **Dos cosas del entorno que estaban rotas y nadie sabia**: `localStorage` **no existe** en los tests (Node 24+ tapa el de jsdom con el suyo experimental, que es `undefined`), y `montarApp` no podia montar la app porque le faltaban `AuthProvider` y `MemoryRouter`.
  - **Me borre el `AGENTS.md` a mitad de camino.** Un `[System.IO.File]::WriteAllText` con `$null` —porque el `.NET current directory` de PowerShell no sigue al `cd`— escribe un archivo vacio. Recuperado con `git checkout`. Dos veces en una tarde, con un `src/app.ts` de 0 bytes antes. Gotcha 40.
  - **Pendiente:** el Access Token y el secreto de la webhook para probar contra la pasarela real, la decision del `customerName`, y el merge.

- *2026-10-16 (tarde):* **El filtro multi-select de pedidos estaba roto, y lo encontre revisando la pregunta de D-10.**
  - **Una casilla andaba; dos daban 400.** El panel es multi-select desde el 004-a y mandaba `?status=pendiente,enviado`; el backend declaraba `z.enum([...])`, que es **un** estado. La cadena con comas no es ningun miembro del enum y AJV la rechazaba antes del handler. En pantalla **no se veia nada**: el filtro se cerraba solo y la tabla seguia mostrando lo de antes.
  - **No era un `z.enum` que "no aceptaba varios": el querystring no lo valida Zod.** `app.ts` compila `toJsonSchema(...)` y lo pasa a **AJV**, y `request.query` es lo que AJV dejo. O sea que la idea de "partir la cadena en un `.transform()`" es escribir codigo que **no se ejecuta**, sin error de compilacion que lo delate.
  - **La forma que si funciona es el parametro repetido** — `?status=pendiente&status=enviado` con `z.array(z.enum([...]))`. `zod-to-json-schema` lo expresa, y AJV corre con `coerceTypes`, asi que un estado solo tambien anda y uno inventado sigue dando 400. En la ruta, `in` y no `=`: con `=` Prisma no matchea nada y la tabla sale vacia **sin error**.
  - **19 tests nuevos**, 11 de backend que piden por HTTP y miran el `where` de Prisma y 8 de frontend que miran la query. Van contra el endpoint y no contra el schema porque son dos capas: un test del schema habria pasado en verde mientras el endpoint seguia dando 400. Los seis sabotajes muerden, y **cada lado falla solo su lado** — que es la costura.
  - **272 frontend, 318 backend.** Gotchas 41 y 42 en `AGENTS.md`.
  - **Pendiente, esperando al usuario:** la decision de D-10 (filtro por pago), el nombre del cliente vacio en el panel, las credenciales de Mercado Pago, el nombre de la tienda en el drawer, y el merge.

- *2026-10-16 (tarde, segunda tanda):* **Las tres decisiones del usuario, ejecutadas.**
  - **D-10: si, el panel filtra por pago.** Dos desplegables separados (`Envío` y `Pago`) porque los dos tienen un `Pendiente` con significado opuesto. En el backend, `pagoEstado` en su propio campo del `where` con `in`. "Expirados **y** pendientes de envio" sale de dos lineas: Prisma pone el AND entre claves solo.
  - **El nombre del cliente.** `types/admin.Order.customerName`/`customerEmail` no existen en la respuesta de la API y nadie los armaba: nombre **vacio** en la columna de la tabla, en el drawer y en el **CSV**. Ahora es `Order.customer: ClienteDelPedido` —con solo `{ id, name, email }`, que es lo que el `select` manda— y el campo plano **no compila**, asi que no se puede reintroducir.
  - **El nombre de la tienda.** `TIENDA.nombre` seguia en `'Cava & Co'` mientras el logo, el hero, el pie y el `title` decia 2920. O sea que **Configuracion le mostrava el nombre viejo al admin**. Ademas el drawer de movil no mostraba ningun nombre, que es de donde salia la pregunta. Ahora `TIENDA.nombre` es la unica fuente (barra, drawer, hero, pie) y hay `test/marca.test.ts` que recorre **todos** los `.tsx` de `src/` buscando el nombre viejo.
  - **Un bug casi fue, y lo encontro el sabotage.** `aplicarFiltros` hace `{ ...previo, ...cambios }` —**fusiona**—, y `limpiarTodo` se habia olvidado del `pagos`: el boton de "limpiar todo" no limpia. Arreglado estructuralmente con `filtrosVacios()`, de tipo `FiltrosPedidos` y no `Partial<...>`, para que olvidar un campo sea **error de compilacion**.
  - **Tres tests mios que no afirmaban nada**, encontrados en contra: uno que se satisfacia con un **comentario** que mencionaba `.strict()`; uno que buscaba `customerName` y lo encontraba en los comentarios que **explicaban** el arreglo; y uno que afirmaba `not.toContain('undefined')` sobre un `null`, que React nunca imprime como tal.
  - **305 frontend, 326 backend.** Todo en verde, typecheck, lint y build de los dos lados.
  - **El usuario dijo NO mergear y que la rama todavia no se puede implementar** — por las credenciales. Queda anotado en `AGENTS.md` y `MEMORY.md`: sin los dos secretos la app levanta y todo funciona **menos los pagos**, que quedan colgados esperando una webhook que nunca llega.
  - **Pendiente:** `MERCADO_PAGO_ACCESS_TOKEN` y `MERCADO_PAGO_WEBHOOK_SECRET` (el usuario dijo "ahora tocamos ese tema", asi que queda para otra conversacion), y el merge cuando las haya.

- *2026-10-17:* **Un gotcha del `AGENTS.md` afirmaba algo que el codigo no cumplia — y el que lo encontro fue el usuario, leyendolo.**
  - El gotcha 6 decia *"Login button removido del navbar (T2 004-c)"* como hecho. **`main` tiene los tres botones**: "Panel Admin" y "+ Cargar Vino" de escritorio y de drawer. Verificado commit por commit: `575cb29` (004-c) los **agrega** —antes tenia cero ocurrencias— y dos rediseños posteriores los dejaron.
  - O sea que no era un forgotcha: 004-c **lo hizo al reves** de lo que la nota decia, y el documento nunca se actualizo. Es el gotcha 29 aplicado al propio gotcha 29, y de hecho el usuario lo habia detectado desde su otra PC: su rama `spec-011` los quita y el comentario del commit **cita el gotcha 6** — leyo la nota, fue a verificar, y encontro el boton.
  - **Reescrito como regla, no como estado.** Que diga "el navbar no tiene enlace al panel" es cierto en `main` y despues de `spec-011`; que diga "fue removido en 004-c" era falso hoy y va a volver a ser falso la proxima vez que un rediseno toque el navbar. La misma correccion se hizo en la linea del panel admin que repetia la mentira.
  - **Se verificaron las otras afirmaciones del mismo tipo** que salen cheaply: `src/mocks/` no existe, `public/mockServiceWorker.js` no existe, `msw` esta en `devDependencies` y no en `dependencies`, y nadie escribe un flag `isAdmin` en `localStorage`. Todas **certainas**.
  - **La rama `spec-011-cambios-frontend` mergea limpia con `spec-009`** (`git merge-tree` da 0). Toca tres archivos que yo tambien toque —`schema.prisma`, `App.tsx` y `barra_de_navegacion.tsx`— y se reparten sin conflicto. No se toco nada de esa rama.
  - **Pendiente de hacer desde la otra PC:** mergear `spec-011` a `main`, que es lo que deja `main` en regla con el gotcha 6.