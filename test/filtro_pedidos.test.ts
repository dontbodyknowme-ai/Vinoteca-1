import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  construirUrl,
  filtrosVacios,
  type FiltrosPedidos
} from '../src/hooks/usePedidos'

/**
 * Como viaja el filtro de estados del panel.
 *
 * ## Que estaba roto
 *
 * `?status=pendiente,enviado` —una cadena con comas— contra un backend que
 * declara **un** estado. El panel es multi-select desde el 004-a, asi que marcar
 * dos casillas daba **400**. Y no se veia: el filtro se cerraba solo y la tabla
 * seguia mostrando lo de antes, como si no hubiera pasado nada.
 *
 * ## Por que un archivo de texto y no el panel montado
 *
 * `construirUrl` esta **exportada** justamente para esto. Montar `PedidosAdmin`
 * para leer una query seria veinte lineas de andamiaje —proveer contexto,
 * interceptar la red, esperar el efecto— para afirmar un `append`.
 *
 * Y el otro lado, que el backend acepta la lista, lo verifica
 * `backend/tests/modules/filtro_pedidos.test.ts` **contra el `where` de Prisma**:
 * son dos capas y cada una necesita su propio lado.
 */

const filtros = (over: Partial<FiltrosPedidos> = {}): FiltrosPedidos => ({
  estados: [],
  pagos: [],
  dateFrom: '',
  dateTo: '',
  search: '',
  sortColumn: '',
  sortDirection: 'asc',
  ...over
})

const consulta = (url: string): URLSearchParams => new URL(url, 'http://x.test').searchParams

describe('el estado viaja REPETIDO, no joined', () => {
  it('un estado', () => {
    const params = consulta(construirUrl(filtros({ estados: ['pendiente'] }), 1, 10))

    expect(params.getAll('status')).toEqual(['pendiente'])
  })

  it('dos estados: el caso que rompia', () => {
    // La cadena con comas no es ningun miembro del enum del backend, y por eso
    // daba 400. Con el parametro repetido no hay ambiguedad.
    const params = consulta(construirUrl(filtros({ estados: ['pendiente', 'enviado'] }), 1, 10))

    expect(params.getAll('status')).toEqual(['pendiente', 'enviado'])
    // Y no queda ninguna cadena con comas que el backend pueda no entender.
    expect(params.get('status')).not.toContain(',')
  })

  it('los seis estados', () => {
    const todos = ['pendiente', 'preparando', 'enviado', 'entregado', 'cancelado', 'devuelto'] as const
    const params = consulta(construirUrl(filtros({ estados: [...todos] }), 1, 10))

    expect(params.getAll('status')).toEqual([...todos])
  })

  it('sin filtro no manda el parametro', () => {
    // Mandar `?status=` vacio haria que el backend recibiera `[""]` y un 400.
    const params = consulta(construirUrl(filtros(), 1, 10))

    expect(params.getAll('status')).toEqual([])
  })

  it('el orden de las casillas se respeta', () => {
    // El backend lo pasa tal cual a `in`, asi que da igual, pero fijarlo evita
    // que un `sort()` accidental Reine el orden de marcado y rompa una URL
    // guardada en un historial.
    const params = consulta(construirUrl(filtros({ estados: ['entregado', 'pendiente'] }), 1, 10))

    expect(params.getAll('status')).toEqual(['entregado', 'pendiente'])
  })
})

describe('lo demas de la query', () => {
  it('manda la busqueda, las fechas y el orden', () => {
    const params = consulta(
      construirUrl(
        filtros({
          search: '  Maria  ',
          dateFrom: '2026-10-01',
          dateTo: '2026-10-16',
          sortColumn: 'total',
          sortDirection: 'desc'
        }),
        2,
        25
      )
    )

    expect(params.get('search')).toBe('Maria')
    expect(params.get('dateFrom')).toBe('2026-10-01')
    expect(params.get('dateTo')).toBe('2026-10-16')
    expect(params.get('sortBy')).toBe('total')
    expect(params.get('sortDir')).toBe('desc')
    expect(params.get('page')).toBe('2')
    expect(params.get('limit')).toBe('25')
  })

  it('el filtro de estado convive con los otros', () => {
    // Antes, con busqueda o fechas puestas, marcar dos estados seguia dando 400:
    // el enum se evaluaba antes que todo lo demas.
    const params = consulta(
      construirUrl(
        filtros({ estados: ['pendiente', 'enviado'], search: 'Maria', dateFrom: '2026-10-01' }),
        1,
        10
      )
    )

    expect(params.getAll('status')).toEqual(['pendiente', 'enviado'])
    expect(params.get('search')).toBe('Maria')
    expect(params.get('dateFrom')).toBe('2026-10-01')
  })

  it('una busqueda solo de espacios no manda el parametro', () => {
    const params = consulta(construirUrl(filtros({ search: '   ' }), 1, 10))

    expect(params.get('search')).toBeNull()
  })
})

describe('el filtro de PAGO viaja aparte del de envio (spec 009, D-10)', () => {
  it('un estado de pago, en su propio parametro', () => {
    const params = consulta(construirUrl(filtros({ pagos: ['aprobado'] }), 1, 10))

    expect(params.getAll('pagoEstado')).toEqual(['aprobado'])
    expect(params.getAll('status')).toEqual([])
  })

  it('varios estados de pago, repetidos', () => {
    const params = consulta(
      construirUrl(filtros({ pagos: ['pendiente', 'expirado'] }), 1, 10)
    )

    expect(params.getAll('pagoEstado')).toEqual(['pendiente', 'expirado'])
  })

  it('los dos filtros conviven en la misma query', () => {
    // "Los expirados que todavia estan pendientes de envio" es la pregunta que
    // se hace todos los dias para liberar el vino reservado.
    const params = consulta(
      construirUrl(
        filtros({ estados: ['pendiente'], pagos: ['expirado'] }),
        1,
        10
      )
    )

    expect(params.getAll('status')).toEqual(['pendiente'])
    expect(params.getAll('pagoEstado')).toEqual(['expirado'])
  })

  it('los `pendiente` de envio y de pago NO se mezclan', () => {
    // El mismo literal, dos filtros distintos. Si alguno de los dos se mandara
    // en el parametro del otro, el backend filtraria por el campo equivocado y
    // el operador veria "pendientes de pago" y le mostraria pendientes de envio.
    const params = consulta(
      construirUrl(
        filtros({ estados: ['pendiente'], pagos: ['pendiente'] }),
        1,
        10
      )
    )

    expect(params.getAll('status')).toEqual(['pendiente'])
    expect(params.getAll('pagoEstado')).toEqual(['pendiente'])
  })

  it('sin filtro de pago no manda el parametro', () => {
    // Mandar `?pagoEstado=` vacio haria que el backend recibiera `[""]` y un 400,
    // con lo que la lista **entera** dejaria de andar.
    const params = consulta(construirUrl(filtros({ estados: ['pendiente'] }), 1, 10))

    expect(params.getAll('pagoEstado')).toEqual([])
  })

  it('el CSV lleva el filtro de pago tambien', () => {
    // El archivo se pide con el mismo `construirUrl` mas `page=1&limit=100`. Si
    // el filtro de pago no llegara, se exportarian 100 pedidos sin filtrar, que
    // es peor que no exportar.
    const params = consulta(construirUrl(filtros({ pagos: ['expirado'] }), 1, 100))

    expect(params.getAll('pagoEstado')).toEqual(['expirado'])
  })
})

describe('"limpiar todo" limpia TODO (spec 009, D-10)', () => {
  /**
   * El sabotaje de esto existio: `limpiarTodo` armaba el objeto a mano y se le
   * habia olvidado `pagos`, que se agrego despues. Como `aplicarFiltros` hace
   * `{ ...previo, ...cambios }`, un campo olvidado **queda puesto**: el boton de
   * limpiar no limpia, el usuario lo aprieta, la tabla no cambia, y no hay
   * ningun error en ninguna parte.
   *
   * Estos tests dicen "no" al error de compilacion: anadir un filtro nuevo sin
   * vaciarlo aqui es un test rojo.
   */
  it('tiene TODAS las claves de `FiltrosPedidos`', () => {
    // Si `FiltrosPedidos` gana un campo y `filtrosVacios` no lo tiene, esto
    // falla. Y como el tipo de la funcion es `FiltrosPedidos` y no
    // `Partial<...>`, el typecheck ya lo habria dicho.
    const claves = Object.keys(filtrosVacios()).sort()

    expect(claves).toEqual([
      'dateFrom',
      'dateTo',
      'estados',
      'pagos',
      'search',
      'sortColumn',
      'sortDirection'
    ])
  })

  it('TODOS los valores empiezan vacios', () => {
    const vacios = filtrosVacios()

    expect(vacios.search).toBe('')
    expect(vacios.estados).toEqual([])
    expect(vacios.pagos).toEqual([])
    expect(vacios.dateFrom).toBe('')
    expect(vacios.dateTo).toBe('')
    expect(vacios.sortColumn).toBe('')
  })

  it('devuelve un objeto NUEVO cada vez', () => {
    // `aplicarFiltros` fusiona sobre el estado. Si `filtrosVacios()` devolviera
    // el mismo objeto y alguien lo mutara, los filtros de otro mount se moverian
    // con el.
    const uno = filtrosVacios()
    const otro = filtrosVacios()

    expect(uno).not.toBe(otro)
    expect(uno.estados).not.toBe(otro.estados)
    expect(uno.pagos).not.toBe(otro.pagos)
  })

  it('limpiar un filtro de pago borra la query entera', () => {
    // El efecto observable: con los filtros puestos y despues limpiados, la
    // query vuelve a no mandar ninguno. Es lo que el operador ve.
    const conFiltros = construirUrl(
      filtros({ estados: ['pendiente'], pagos: ['expirado'], search: 'Maria' }),
      1,
      10
    )
    const despues = construirUrl(filtrosVacios(), 1, 10)

    expect(consulta(conFiltros).getAll('status')).toEqual(['pendiente'])
    expect(consulta(conFiltros).getAll('pagoEstado')).toEqual(['expirado'])

    expect(consulta(despues).getAll('status')).toEqual([])
    expect(consulta(despues).getAll('pagoEstado')).toEqual([])
    expect(consulta(despues).get('search')).toBeNull()
  })
})

describe('el boton de limpiar usa `filtrosVacios()`', () => {
  /**
   * Una comprobacion **estatica**, y conviene decir que cubre y que no.
   *
   * Cubre: que `limpiarTodo` llame a `filtrosVacios()` y no arme un objeto a
   * mano. Es el sabotage 3, que los tests de comportamiento no ven porque ellos
   * miran `filtrosVacios()` y no a quien la llama — verificado: reemplazar la
   * llamada por un literal sin `pagos` deja la suite en verde.
   *
   * NO cubre: que el boton, montado y apretado, llegue a `aplicarFiltros`. Eso
   * pediria montar `PedidosAdmin` entero, con su tabla paginada y la red
   * interceptada, para comprobar dos lineas que ya estan escritas. Se acepta el
   * hueco a cambio de no tener veinte lineas de andamiaje.
   *
   * Y el riesgo real de la combinacion es bajo justamente porque
   * `filtrosVacios()` esta cubierta de forma exhaustiva: si el objeto esta bien,
   * solo queda que se lo pasen completo.
   */
  const fuente = (): string =>
    readFileSync(join(__dirname, '..', 'src', 'pages', 'admin', 'pedidos.tsx'), 'utf8')

  /**
   * El cuerpo de `limpiarTodo`.
   *
   * Va recortado a la funcion y no a todo el archivo porque `aplicarFiltros`
   * **esta disenada** para tomar parciales: los toggles de estado, el rango de
   * fechas, el orden y "quitar el filtro de estado" pasan literales y estan
   * bien, porque un parcial es exactamente lo que quieren.
   *
   * La excepcion es `limpiarTodo`, que promete limpiar **todo**: ahi un literal
   * parcial es siempre un bug.
   */
  const cuerpoDeLimpiarTodo = (): string => {
    const desde = fuente().indexOf('const limpiarTodo')
    const hasta = fuente().indexOf('\n  const ', desde + 1)

    expect(desde).toBeGreaterThan(-1)
    expect(hasta).toBeGreaterThan(desde)

    return fuente().slice(desde, hasta)
  }

  it('`limpiarTodo` llama a `filtrosVacios()`', () => {
    expect(cuerpoDeLimpiarTodo()).toContain('pedidos.aplicarFiltros(filtrosVacios())')
  })

  it('`limpiarTodo` NO arma un objeto a mano', () => {
    // El bug real: un literal sin `pagos`. Como `aplicarFiltros` fusiona, el
    // filtro de pago sobrevive al "limpiar todo" y el usuario ve que aprieta el
    // boton y la tabla no cambia.
    expect(cuerpoDeLimpiarTodo()).not.toMatch(/aplicarFiltros\(\s*\{/)
  })

  it('`limpiarTodo` cierra los dos paneles', () => {
    // Si solo cerrara el de envio, el de pago queda abierto con sus casillas
    // marcadas y parece que el filtro sigue puesto.
    const cuerpo = cuerpoDeLimpiarTodo()

    expect(cuerpo).toContain('setPanelEstados(false)')
    expect(cuerpo).toContain('setPanelPagos(false)')
  })
})