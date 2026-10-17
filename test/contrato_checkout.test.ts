import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Que el checkout de la tienda y el endpoint que lo atiende **seHablen**.
 *
 * ## Por que hace falta
 *
 * Cada mitad esta verificada por su lado: el backend tiene 43 tests de
 * `orderCreateSchema` y 27 de `POST /api/orders`, y el frontend tiene 61 del
 * checkout. Y las dos pueden estar bien y no entenderse: si el backend devuelve
 * `preferenceId` y el frontend lee `preferenceIdOk`, todo pasa en verde y el
 * comprador cae en `undefined`.
 *
 * Esa costura no la cubre ningun test, porque para cubrirla hace falta mirar
 * **las dos** definiciones a la vez, y un test vive en un solo lado.
 *
 * ## Por que se leen como texto y no se importan
 *
 * `backend/src/shared/schemas.ts` es un modulo de Node con `import` de
 * `.js`—los mismos que usa en produccion— y el `vitest` de aca no lo resuelve
 * sin tocar el `vite.config.ts`. Agregar un alias para que un test pueda
 * importar el backend es mas invasivo que lo que compra.
 *
 * Asi que se leen como texto, **con la misma regla de siempre**: si el patron no
 * matchea, el test falla. Un test que no encuentra la definicion y pasa igual
 * es peor que no tener test, porque te dice que el contrato esta bien en el
 * momento exacto en que dejo de estarlo.
 */

const RAIZ = join(__dirname, '..')

const leer = (relativo: string): string => readFileSync(join(RAIZ, relativo), 'utf8')

/**
 * Devuelve el contenido entre las llaves de un bloque, contando.
 *
 * Todo lo anterior usaba `[\s\S]*?\}\)` o `\}\}`, que corta en la **primer**
 * llave que cierra y se lleva el bloque equivocado: `orderCreateSchema` acaba
 * en `.strict()` y el corte se iba hasta el schema siguiente, trayendo las
 * claves de otro (`limit`, `page`, `tags`).
 *
 * Contar llaves no adivina. Y si el bloque no cierra, tira —que es lo que hay
 * que hacer, porque un extractor que devuelve "" en vez de fallar convierte
 * "el contrato cambio" en "el contrato no cambio".
 */
const bloqueDesde = (fuente: string, desde: number, que: string): string => {
  const abre = fuente.indexOf('{', desde)

  if (abre === -1) throw new Error(`No se encontro la llave de apertura de ${que}`)

  let nivel = 0

  for (let i = abre; i < fuente.length; i++) {
    const caracter = fuente[i]

    if (caracter === '{') nivel += 1

    if (caracter === '}') {
      nivel -= 1
      if (nivel === 0) return fuente.slice(abre + 1, i)
    }
  }

  throw new Error(`El bloque de ${que} no cierra`)
}

/** Saca las claves de un bloque, ignorando los comentarios. */
const clavesDe = (bloque: string): string[] => {
  return [...sinComentarios(bloque).matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*\??:/gm)].map((m) => m[1])
}

/**
 * Saca las lineas de comentario: las de `//` **y** las de bloque `*`.
 *
 * Existe por una asercion que se dejaba falsificar por un comentario: el bloque de
 * `checkoutItemSchema` tiene un comentario que **menciona** `` `.strict()` ``
 * para explicar por que esta ahi. Un `toContain('.strict(')` sobre el texto crudo
 * pasaba con la llamada borrada — el comentario la satisfacia — y el test
 * llevo tres versiones afirmando que los items rechazan campos extra sin
 * que eso estuviera en el codigo.
 *
 * Y despues el mismo error al reves: los componentes que se corrigieron
 * **explican** el cambio nombrando el campo viejo, y un test que lo busca lo
 * encuentra en su propia documentacion. Por eso saca los dos estilos: omitir
 * el de bloque habria dejado el helper a medias y el mismo bug volviendo.
 *
 * Un test que lee texto tiene que sacar el texto de los comentarios, o el
 * comentario decide por el.
 */
const sinComentarios = (bloque: string): string =>
  bloque
    .split('\n')
    .filter((linea) => {
      const limpia = linea.trim()

      return !limpia.startsWith('//') && !limpia.startsWith('*') && !limpia.startsWith('/*')
    })
    .join('\n')

/** Las claves de un `export interface Nombre { ... }`. */
const camposDeInterface = (fuente: string, nombre: string): string[] => {
  const desde = fuente.indexOf(`export interface ${nombre} {`)

  if (desde === -1) {
    throw new Error(
      `No se encontro "export interface ${nombre} {" en el archivo. Si la renombraron, este test hay que actualizarlo: el nombre es el contrato. Ojo con el "{" al final, sin el "Order" matchea "OrderItem".`
    )
  }

  return clavesDe(bloqueDesde(fuente, desde, nombre))
}

/** Las claves de un `export const NOMBRE = z.object({ ... })`. Acepta sin `export`. */
const clavesDeSchema = (fuente: string, nombre: string): string[] => {
  // `checkoutItemSchema` **no** esta exportado: se busca el nombre pelado. Por
  // eso el `${nombre}` va al principio de la linea y no despues de `export`.
  const desde = new RegExp(`^(?:export )?const ${nombre}\\b`, 'm').exec(fuente)?.index

  if (desde === undefined || desde === -1) throw new Error(`No se encontro "const ${nombre}"`)

  return clavesDe(bloqueDesde(fuente, desde, nombre))
}

/**
 * Las `properties` del 201 de `orders.create`.
 *
 * Entra **dos** niveles adentro: el 201 es un objeto y sus `properties` son
 * otro. Si setomara el primer bloque, saldrian `type`, `properties` y
 * `additionalProperties` — que son del schema, no del pedido.
 */
const propiedadesDel201 = (fuente: string): string[] => {
  const desde = fuente.indexOf('  orders: {')

  if (desde === -1) throw new Error('No se encontro el bloque `orders:` en json-schemas.ts')

  const bloque = bloqueDesde(fuente, desde, 'orders')

  const enCreate = bloque.indexOf('create:')
  if (enCreate === -1) throw new Error('No se encontro `create:` dentro de orders')

  const bloqueCreate = bloqueDesde(bloque, enCreate, 'orders.create')

  const en201 = bloqueCreate.indexOf('201:')
  if (en201 === -1) throw new Error('No se encontro el 201 dentro de orders.create')

  const bloque201 = bloqueDesde(bloqueCreate, en201, 'orders.create 201')

  const enProperties = bloque201.indexOf('properties:')
  if (enProperties === -1) throw new Error('El 201 no declara `properties`')

  return clavesDe(bloqueDesde(bloque201, enProperties, 'orders.create 201 properties'))
}

describe('POST /api/orders: lo que manda el checkout', () => {
  const schemas = leer('backend/src/shared/schemas.ts')
  const checkout = leer('src/types/checkout.ts')

  it('el comprador manda exactamente los campos que el backend exige', () => {
    const delBackend = clavesDeSchema(schemas, 'orderCreateSchema').sort()
    const delFrontend = camposDeInterface(checkout, 'DatosDelComprador').sort()

    // El backend exige uno mas: `items`. No es un campo del comprador, asi que
    // se compara el subconjunto y despues se afirma `items` aparte.
    const soloDelComprador = delBackend.filter((clave) => clave !== 'items')

    expect(delFrontend).toEqual(soloDelComprador)
  })

  it('los items se llaman igual en los dos lados', () => {
    // `vinoId` y `cantidad`. Si el backend pasara a `wineId`, el pedido llega
    // con los items vacios y el total en cero — que es un 400, por suerte, pero
    // uno que dice "vinos no disponibles" y no "el campo se llama distinto".
    const claves = clavesDeSchema(schemas, 'checkoutItemSchema').sort()

    expect(claves).toEqual(['cantidad', 'vinoId'])
  })

  it('el ITEM rechaza campos extra, no solo el pedido entero', () => {
    // Son **dos** `.strict()` distintos y hacen falta los dos.
    //
    // El de `orderCreateSchema` alcanza para el `{ precioUnitario }` pegado al
    // pedido, pero el item tiene su **propio** objeto: `items: [{ vinoId, cantidad,
    // precioUnitario }]` es legal para el schema del pedido y colaria el precio
    // adentro de cada linea. El `service.ts` lo ignora —lee `Wine.price`— asi
    // que no habria plata perdida, pero el pedido devolveria un 201 con datos
    // que el backend **nunca leyo**, y depurar eso a las tres de la manana es
    // otra cosa.
    const desde = schemas.indexOf('const checkoutItemSchema')
    const hasta = schemas.indexOf('export const orderCreateSchema')

    expect(desde).toBeGreaterThan(-1)
    expect(hasta).toBeGreaterThan(desde)

    expect(sinComentarios(schemas.slice(desde, hasta))).toMatch(/\.strict\(/)
  })

  it('el frontend NO manda ningun precio y el backend NO los acepta', () => {
    // Las dos capas. Si se relajara cualquiera de las dos, el comprador podria
    // pedir el pedido a $2.
    expect(camposDeInterface(checkout, 'ItemDelCheckout').sort()).toEqual(['cantidad', 'vinoId'])

    const desde = schemas.indexOf('export const orderCreateSchema')
    const hasta = schemas.indexOf('export const', desde + 1)
    const declaracion = schemas.slice(desde, hasta === -1 ? undefined : hasta)

    // `.strict('...')` es lo que hace que un `precioUnitario` de mas sea un
    // **400** y no un campo que se descarta en silencio. Sin el, el comprador
    // mandaria lo que quisiera y nadie se enteraria.
    //
    // Con mensaje y no sin el: el regex es `\.strict\(` y no la cadena exacta,
    // porque el del backend lleva texto adentro.
    expect(sinComentarios(declaracion)).toMatch(/\.strict\(/)
  })
})

describe('POST /api/orders: lo que devuelve', () => {
  const jsonSchemas = leer('backend/src/shared/json-schemas.ts')
  const checkout = leer('src/types/checkout.ts')

  it('la respuesta 201 declara EXACTAMENTE los campos que el frontend lee', () => {
    // Sin `exactamente`: si el backend sumo un campo y el frontend no lo lee no
    // pasa nada, pero si el frontend **cambio** un nombre, el campo viejo
    // seguiria declarado y el test no se enteraria.
    const delBackend = propiedadesDel201(jsonSchemas).sort()
    const delFrontend = camposDeInterface(checkout, 'PedidoCreado').sort()

    expect(delFrontend).toEqual(delBackend)
  })

  it('el 201 declara `initPoint`: sin el, el frontend no tiene a donde ir', () => {
    // Es el campo del redirect. Si el schema lo perdiera, el backend seguiria
    // respondiendo 201 con el cuerpo cortado y el error apareceria en el
    // navegador, en el dominio del comprador, como una pagina en blanco.
    expect(propiedadesDel201(jsonSchemas)).toContain('initPoint')
  })
})

describe('el panel: los tipos que describen la respuesta', () => {
  const apiSchemas = leer('src/api/schemas.ts')
  const tiposAdmin = leer('src/types/admin.ts')

  it('el tipo de la API declara `pagoEstado`', () => {
    // `api/schemas.ts` es la forma que **declara** la API. Sin `pagoEstado`
    // aca, el panel tipa un campo que existe pero que el tipo no conoce, y
    // cualquier reader futuro lo va a agregar como si fuera nuevo.
    expect(camposDeInterface(apiSchemas, 'Order')).toContain('pagoEstado')
  })

  it('la entrada del historial declara los dos estados como opcionales', () => {
    const campos = camposDeInterface(apiSchemas, 'OrderTimelineEntry')

    expect(campos).toContain('status')
    expect(campos).toContain('pagoEstado')

    // Y no como `string`: el backend devuelve `null` en el que no aplica, y un
    // `status: string` obliga al panel a mentir sobre el tipo.
    const bloque = /export interface OrderTimelineEntry\s*\{([\s\S]*?)\n\}/m.exec(apiSchemas)
    expect(bloque?.[1]).toMatch(/status:\s*string\s*\|\s*null/)
    expect(bloque?.[1]).toMatch(/pagoEstado:\s*string\s*\|\s*null/)
  })

  it('el tipo del panel declara `pagoEstado` como obligatorio', () => {
    // Obligatorio a proposito: el backend siempre lo manda, con
    // `no_iniciado` si todavia no abrio Mercado Pago. Un opcional obligaria a
    // manejar `undefined` en cada badge para un caso que no existe.
    const campos = camposDeInterface(tiposAdmin, 'Order')

    expect(campos).toContain('pagoEstado')
  })

  it('la entrada del historial del panel usa `createdAt`, como la API', () => {
    // Antes se llamaba `timestamp` y **nadie lo llenaba**: no hay capa de
    // traduccion entre `api/schemas.ts` y `types/admin.ts`, asi que el panel
    // renderizaba "Invalid Date" en cada entrada del historial.
    const campos = camposDeInterface(tiposAdmin, 'OrderTimelineEntry')

    expect(campos).toContain('createdAt')
    expect(campos).not.toContain('timestamp')
  })
})

describe('el panel y la API dicen lo mismo del cliente', () => {
  /**
   * Este bloque **estaba al reves**: afirmaba que el panel declaraba
   * `customerName`, que la API no manda, y decia que se borraba junto con el
   * arreglo. Ese momento llego.
   *
   * `GET /api/orders` devuelve `customer: { id, name, email }` **anidado**, y el
   * panel leia `pedido.customerName` / `pedido.customerEmail`, que no existian y
   * que nadie armaba. O sea que el nombre del cliente salia **vacio** en la
   * columna de la tabla, en el drawer y en el CSV de `/admin/pedidos`.
   */
  const tiposAdmin = leer('src/types/admin.ts')

  it('el panel NO declara `customerName`: la API no lo manda', () => {
    const campos = camposDeInterface(tiposAdmin, 'Order')

    expect(campos).not.toContain('customerName')
    expect(campos).not.toContain('customerEmail')
  })

  it('los dos leen `customer` anidado, y es el mismo nombre', () => {
    expect(camposDeInterface(tiposAdmin, 'Order')).toContain('customer')
    expect(camposDeInterface(leer('src/api/schemas.ts'), 'Order')).toContain('customer')
  })

  it('`ClienteDelPedido` tiene SOLO lo que el endpoint envia', () => {
    // `GET /api/orders` hace `select: { id, name, email }`. Si el tipo del panel
    // declarara el `Customer` completo, el panel leeria `pedido.customer.tags` y
    // obtendria `undefined` en una columna que existe en el CRM y no aca: el
    // mismo bug al reves del que se acaba de corregir.
    const campos = camposDeInterface(tiposAdmin, 'ClienteDelPedido').sort()

    expect(campos).toEqual(['email', 'id', 'name'])
  })

  it('ningun componente del panel lee el nombre plano', () => {
    // El typecheck ya no alcanza: `customerName` no existe en el tipo, asi que
    // un lector nuevo no compila. Esto afirma lo mismo desde el otro lado, por
    // si alguien reintroduce el campo con un `as any`.
    //
    // Filtra comentarios, porque los componentes **explican** el cambio y
    // nombran el campo viejo al hacerlo. Sin el filtro, el test falla por sus
    // propios comentarios — que es el gotcha 35 del otro lado, y por eso el
    // helper existe.
    const lectores = [
      'src/pages/admin/pedidos.tsx',
      'src/components/admin/order_drawer.tsx',
      'src/utils/csv_export.ts'
    ]

    const culpables = lectores.filter((archivo) =>
      /\.customer(Name|Email)\b/.test(sinComentarios(leer(archivo)))
    )

    expect(culpables).toEqual([])
  })
})
