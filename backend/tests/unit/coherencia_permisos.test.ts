import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * La tabla de permisos del **frontend** contra los `requireRole` del **backend**.
 *
 * Los dos lados declaran la misma matriz y no se hablan. Es a proposito: el
 * backend la lee desde un JWT validado y el frontend desde un contexto de
 * React que puede no haberse cargado, y unificar los dos meteria al backend a
 * depender de algo que todavia no existe. `deploy.test.ts` ya lee archivos de
 * otros proyectos del repo por el mismo motivo.
 *
 * El costo de tenerlos separados es que se pueden desincronizar. Y el costo de
 * que se desincronicen no es un agujero: es un `403` visible, con la seccion
 * dibujada en el menu y un error al abrirla. Ese fallo se ve. El que no se ve
 * es el contrario — backend mas permisivo que la tabla — y **este test no lo
 * tapa**: para eso haria falta invocar la API con cada rol, que es integracion.
 *
 * Lo que si tapa: la tabla mostrando **mas** de lo que el backend permite. Que es
 * justo el bug que la spec 006 vino a arreglar.
 */

const RAIZ = join(__dirname, '..', '..', '..')

const leer = (ruta: string): string => readFileSync(join(RAIZ, ruta), 'utf8')

type Rol = 'admin' | 'gestor' | 'vendedor'

const METODOS = /fastify\.(get|post|patch|put|delete)\s*\(/g

/**
 * Los roles de cada **declaracion de ruta**, por metodo.
 *
 * La clave es `METODO ruta` y no la ruta sola, porque no todos los metodos de
 * una misma ruta permiten lo mismo: `PATCH /api/wines/:id` es admin+gestor y
 * `DELETE /api/wines/:id` es **solo admin**. Aplanar a la ruta pierde esa
 * distincion —y es justo la que importa cuando se pregunta "quien puede
 * borrar un vino".
 *
 * ## Por que no se usa un `[\s\S]{0,N}?` entre la ruta y el `requireRole`
 *
 * Porque el limite de distancia se rompe con un comentario. La primera version
 * de este archivo emparejaba `'/api/...'` con el `requireRole` de a 400
 * caracteres, y **un comentario de ocho lineas explicando por que el `gestor`
 * no ve la facturacion** —es decir, justo el comentario que explica el cambio
 * de la spec— dejo a `/api/metrics` sin leer. El test seguia verde: la tabla
 * del frontend y el backend "coincidian" porque el backend no estaba.
 *
 * Ahora se parte el archivo por declaraciones `fastify.<metodo>(` y se busca
 * el `requireRole` dentro del tramo, que no tiene tope.
 */
const leerRequireRole = (): Map<string, Set<Rol>> => {
  const porDeclaracion = new Map<string, Set<Rol>>()

  const modulos = readdirSync(join(RAIZ, 'backend', 'src', 'modules'), {
    withFileTypes: true
  })

  for (const mod of modulos) {
    const archivo = join(RAIZ, 'backend', 'src', 'modules', mod.name, 'routes.ts')

    /**
     * No todos los directorios de `modules/` tienen `routes.ts`: `pagos/` es un
     * proveedor, no un modulo HTTP, y la webhook vive en `orders/routes.ts` —que
     * es donde pertenece, porque actualiza pedidos.
     *
     * Sin este `continue`, agregar un proveedor rompe el test de coherencia con
     * un `ENOENT` que no dice nada de permisos. La lista de endpoints sale del
     * archivo `routes.ts` de cada modulo; un modulo sin routes no expone
     * endpoints, asi que no aporta ninguno.
     */
    if (!existsSync(archivo)) continue

    const fuente = readFileSync(archivo, 'utf8')

    const cortes = [...fuente.matchAll(METODOS)]

    for (const [indice, corte] of cortes.entries()) {
      const desde = (corte.index ?? 0) + corte[0].length
      const hasta = cortes[indice + 1]?.index ?? fuente.length
      const bloque = fuente.slice(desde, hasta)

      const ruta = /'([^']+)'/.exec(borrrar(bloque))?.[1]
      if (ruta === undefined || !ruta.startsWith('/')) continue

      const roles = /requireRole\(([^)]*)\)/.exec(bloque)
      if (roles === null) continue

      const lista = [...roles[1].matchAll(/'(admin|gestor|vendedor)'/g)].map((m) => m[1]) as Rol[]

      porDeclaracion.set(`${corte[1].toUpperCase()} ${ruta}`, new Set(lista))
    }
  }

  return porDeclaracion
}

const borrrar = (bloque: string): string => bloque.replace(/\/\*[\s\S]*?\*\//g, ' ')

/** La tabla del frontend, leida del fuente para no duplicarla aca. */
const leerTablaFrontend = (): Map<string, Set<Rol>> => {
  const fuente = leer('src/utils/permisos.ts')
  const porRuta = new Map<string, Set<Rol>>()

  const bloques = [...fuente.matchAll(/'(\/admin[^']*)':\s*\[([^\]]*)\]/g)]

  for (const [, ruta, roles] of bloques) {
    const lista = [...roles.matchAll(/'(admin|gestor|vendedor)'/g)].map((m) => m[1]) as Rol[]
    porRuta.set(ruta, new Set(lista))
  }

  return porRuta
}

/** Que endpoint del backend sirve cada seccion del panel. */
const RUTA_POR_SECCION: Record<string, string> = {
  '/admin': 'GET /api/metrics',
  '/admin/catalogo': 'GET /api/wines',
  '/admin/pedidos': 'GET /api/orders',
  '/admin/clientes': 'GET /api/customers',
  '/admin/configuracion': 'GET /api/wines'
}

describe('la tabla del frontend coincide con el requireRole del backend', () => {
  const backend = leerRequireRole()
  const frontend = leerTablaFrontend()

  it('se pudo leer la tabla del frontend', () => {
    // Si el formato del archivo cambia, esto falla aca y no con un
    // "todo bien" sobre una tabla vacia.
    expect(frontend.size).toBe(5)
  })

  for (const [seccion, endpoint] of Object.entries(RUTA_POR_SECCION)) {
    it(`"${seccion}" no promete mas que ${endpoint}`, () => {
      const permitidosBackend = backend.get(endpoint)
      const permitidosTabla = frontend.get(seccion)

      expect(permitidosBackend, `${endpoint} no se encontro en el backend`).toBeDefined()
      expect(permitidosTabla, `${seccion} no esta en la tabla`).toBeDefined()

      const deMas = [...(permitidosTabla as Set<Rol>)].filter(
        (rol) => !(permitidosBackend as Set<Rol>).has(rol)
      )

      expect(
        deMas,
        `la tabla deja ver ${seccion} a ${deMas.join(', ')}, pero ${endpoint} no lo permite`
      ).toEqual([])
    })
  }
})

/**
 * ## La lista exacta de roles por endpoint
 *
 * El test de arriba compara la tabla contra el backend, asi que los dos pueden
 * desincronizarse **juntos** y quedar de acuerdo en algo equivocado. Esto los
 * fija contra la lista escrita a mano.
 *
 * La razon de fijarlos: la spec 006 toco **una** linea de las siete. Un cambio
 * de rol en cualquiera de las otras seis no es un refactor, es una decision de
 * negocio —"dejar que el vendedor borre vinos" no es lo mismo que "arreglar un
 * typo"— y tiene que fallar el build para que alguien la tome a proposito.
 *
 * Ojo con el formato: sale de `leerRequireRole()`, que ya se leia para el test
 * de arriba. Si esa lectura se rompe, **los dos** tests avisan por la misma
 * razon y no por separado.
 */
describe('los roles de cada endpoint son los declarados aca', () => {
  /**
   * La lista completa de declaraciones con `requireRole`, escrita a mano.
   *
   * El test de arriba compara la tabla del frontend contra el backend, asi que
   * los dos pueden desincronizarse **juntos** y quedar de acuerdo en algo
   * equivocado. Esto los fija contra la lista.
   *
   * La razon de fijarlos: la spec 006 toco **una** linea de estas catorce. Un
   * cambio de rol en cualquiera de las otras trece no es un refactor, es una
   * decision de negocio —"dejar que el vendedor borre vinos" no es lo mismo que
   * "arreglar un typo"— y tiene que romper el build para que alguien la tome a
   * proposito.
   *
   * Dos asimetrías que parecen olvidos y **no lo son**:
   *
   * - `PATCH /api/wines/:id` es admin+gestor pero `DELETE` es **solo admin**.
   *   Editar un vino es parte del trabajo del gestor; borrarlo no.
   * - `POST /api/upload` es admin+gestor pero `DELETE /api/upload/:id` es **solo
   *   admin**. El gestor sube la foto de un vino nuevo; borrar imagenes es
   *   limpieza.
   *
   * Si alguna de las dos se quiere cambiar, se cambia **aca** y en el
   * `requireRole`, en el mismo commit.
   */
  const ESPERADO: Record<string, Rol[]> = {
    'GET /api/metrics': ['admin'],
    'GET /api/wines': ['admin', 'gestor'],
    'POST /api/wines': ['admin', 'gestor'],
    'PATCH /api/wines/:id': ['admin', 'gestor'],
    'DELETE /api/wines/:id': ['admin'],
    'POST /api/wines/import': ['admin', 'gestor'],
    'GET /api/orders': ['admin', 'gestor', 'vendedor'],
    'GET /api/orders/:id': ['admin', 'gestor', 'vendedor'],
    'PATCH /api/orders/:id': ['admin', 'gestor', 'vendedor'],
    'GET /api/customers': ['admin', 'gestor'],
    'GET /api/customers/:id': ['admin', 'gestor'],
    'PATCH /api/customers/:id': ['admin', 'gestor'],
    'POST /api/upload': ['admin', 'gestor'],
    'DELETE /api/upload/:id': ['admin']
  }

  const backend = leerRequireRole()

  it('se encontraron todas las declaraciones', () => {
    // Un `toEqual` sobre un objeto vacio pasa. Esto es lo que hace que los
    // tests de abajo no sean afirmaciones sobre nada: si el parser se rompe y
    // no lee ninguno, el mapa queda vacio y esto falla primero.
    expect([...backend.keys()].sort()).toEqual(Object.keys(ESPERADO).sort())
  })

  for (const [declaracion, roles] of Object.entries(ESPERADO)) {
    it(`${declaracion} es ${roles.join(', ')}`, () => {
      expect([...(backend.get(declaracion) as Set<Rol>)].sort(), declaracion).toEqual(
        [...roles].sort()
      )
    })
  }

  it('ninguna declaracion se queda sin requireRole', () => {
    // Una ruta de lectura sin `requireRole` devolveria el catalogo entero a
    // cualquier usuario autenticado. El token es valido, asi que no habria ni
    // un error en los logs: solo datos de mas.
    const sinProteccion = [...backend.entries()].filter(([, roles]) => roles.size === 0)

    expect(sinProteccion.map(([k]) => k)).toEqual([])
  })
})

