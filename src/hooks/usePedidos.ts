import { useCallback, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useApi } from './useApi'
import { csvPedidos, descargarComo } from '../utils/csv_export'
import { exigirConexion } from '../utils/offline'
import type { EstadoPago, Order, OrderStatus, Paginated } from '../types/admin'

/**
 * Estado y operaciones de la tabla de pedidos.
 *
 * Igual que `useCatalogo`: los filtros, el orden y la paginacion viven en el
 * servidor. Cada cambio de filtro vuelve a la pagina 1, porque la pagina 5 de
 * un conjunto filtrado no existe y dejaria al usuario en un estado vacio con
 * resultados disponibles.
 */

export const ESTADOS_PEDIDO: ReadonlyArray<{ valor: OrderStatus; etiqueta: string }> = [
  { valor: 'pendiente', etiqueta: 'Pendiente' },
  { valor: 'preparando', etiqueta: 'Preparando' },
  { valor: 'enviado', etiqueta: 'Enviado' },
  { valor: 'entregado', etiqueta: 'Entregado' },
  { valor: 'cancelado', etiqueta: 'Cancelado' },
  { valor: 'devuelto', etiqueta: 'Devuelto' }
]

/**
 * Los estados de **pago** del filtro (spec 009, D-10).
 *
 * Va en su propio multi-select y no mezclado con el de envio, por lo de D-7:
 * `pendiente` significa "estamos armando el paquete" en una lista y "abrio
 * Mercado Pago y no termino" en la otra. En un desplegable unico, marcar
 * "Pendiente" seria ambiguo y habria que adivinar cual de los dos se filtraba.
 *
 * El orden es el del **proceso**: no se pagó, se esta pagando, se pagó, no se
 * pudo, se fue.
 */
export const ESTADOS_PAGO: ReadonlyArray<{ valor: EstadoPago; etiqueta: string }> = [
  { valor: 'no_iniciado', etiqueta: 'Sin iniciar' },
  { valor: 'pendiente', etiqueta: 'Pendiente' },
  { valor: 'aprobado', etiqueta: 'Aprobado' },
  { valor: 'rechazado', etiqueta: 'Rechazado' },
  { valor: 'expirado', etiqueta: 'Expirado' }
]

export interface FiltrosPedidos {
  search: string
  /** Vacio = todos los estados. Varios = OR entre ellos. */
  estados: OrderStatus[]
  /**
   * Estados de **pago**. Separate de `estados` a proposito, y con las dos listas
   * combinandose con AND entre ellas y OR adentro: "los **expirados** que
   * ademas esten **pendientes** de envio" es la pregunta que se hace todos los
   * dias — son los que hay que liberar.
   */
  pagos: EstadoPago[]
  dateFrom: string
  dateTo: string
  sortColumn: string
  sortDirection: 'asc' | 'desc'
}

/**
 * Los filtros, todos vacios.
 *
 * **Devuelve un objeto nuevo cada vez** y por eso es una funcion y no una
 * constante: `aplicarFiltros` hace `{ ...previo, ...cambios }`, asi que un objeto
 * compartido se mutaria entre llamadas y un filtro puesto apareceria en otro
 * pedido.
 *
 * ## Por que el tipo es `FiltrosPedidos` y no `Partial<FiltrosPedidos>`
 *
 * Por el bug que casi fue: `limpiarTodo` armaba el objeto a mano y se le
 * **olvido** el `pagos`, que seagrego despues. Con `aplicarFiltros` fusionando, no
 *limpiar el filtro de pago — el boton de "limpiar todo" no limpia todo, y el
 * usuario ve que lo aprieto y la tabla no cambia.
 *
 * Con el tipo completo, omitir un campo es un **error de compilacion**, no una
 * duda. Que se note al escribir y no cuando el operador este buscando pedidos
 * expirados.
 */
export const filtrosVacios = (): FiltrosPedidos => ({
  search: '',
  estados: [],
  pagos: [],
  dateFrom: '',
  dateTo: '',
  sortColumn: '',
  sortDirection: 'desc'
})

/**
 * Las fechas viajan en `YYYY-MM-DD`.
 *
 * El endpoint compara contra `createdAt`, que es un ISO completo. Si mandara
 * `new Date().toISOString()`, el `T00:00:00Z` que trae cortaria el dia por la
 * zona horaria: en Argentina (UTC-3) un pedido de las 20:00 pertenece al dia
 * anterior en UTC, y el admin veria pedidos fuera del rango que eligio.
 */
/**
 * Arma la query de la lista.
 *
 * **Exportada** y no metida adentro del hook: es la unica forma de afirmar como
 * viaja el filtro sin montar el panel. Con todo privado, comprobar que el
 * multi-select manda dos estados seria montar la pagina entera, escribir en el
 * buscador y leer la red — veinte lineas de andamiaje para afirmar un `append`.
 */
export const construirUrl = (
  filtros: FiltrosPedidos,
  page: number,
  limit: number
): string => {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('limit', String(limit))

  if (filtros.search.trim() !== '') params.set('search', filtros.search.trim())

  /**
   * El estado va **repetido**, no joined con comas.
   *
   * `?status=pendiente,enviado` no es ningun miembro del enum del backend, asi
   * que el multi-select del panel —que marca varias casillas y siempre marcar
   * varias— daba **400** en cuanto marcabas la segunda. Y no se veia en el
   * panel: el filtro se cerraba solo y la tabla seguia mostrando lo de antes,
   * como si no hubiera pasado nada.
   *
   * Con `append`, uno solo y dos dan lo mismo:
   *
   *     ?status=pendiente
   *     ?status=pendiente&status=enviado
   */
  for (const estado of filtros.estados) params.append('status', estado)
  for (const pago of filtros.pagos) params.append('pagoEstado', pago)

  if (filtros.dateFrom !== '') params.set('dateFrom', filtros.dateFrom)
  if (filtros.dateTo !== '') params.set('dateTo', filtros.dateTo)
  if (filtros.sortColumn !== '') {
    params.set('sortBy', filtros.sortColumn)
    params.set('sortDir', filtros.sortDirection)
  }

  return `/api/orders?${params.toString()}`
}

export interface EstadoPedidos {
  pedidos: Order[]
  total: number
  totalPaginas: number
  isLoading: boolean
  error: string | undefined
  page: number
  limit: number
  filtros: FiltrosPedidos
  setPage: (page: number) => void
  setLimit: (limit: number) => void
  setSearch: (valor: string) => void
  aplicarFiltros: (cambios: Partial<FiltrosPedidos>) => void
  alternarEstado: (pedido: Order, estado: OrderStatus) => Promise<Order>
  exportarCsv: () => Promise<void>
  recargar: () => void
}

export const usePedidos = (): EstadoPedidos => {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  // `filtrosVacios()` y no la constante: el estado inicial **deberia** ser el
  // mismo objeto en todos los mounts, y un objeto compartido que alguien
  // mutee se lleva los filtros de otro mount. La funcion devuelve uno nuevo.
  const [filtros, setFiltros] = useState<FiltrosPedidos>(filtrosVacios)

  const url = useMemo(() => construirUrl(filtros, page, limit), [filtros, page, limit])
  const { data, isLoading, error, refetch } = useApi<Paginated<Order>>(url, { respaldo: 'pedidos' })

  const refrescar = useCallback(() => {
    refetch()
  }, [refetch])

  const setSearch = useCallback((valor: string) => {
    setPage(1)
    setFiltros((previo) => ({ ...previo, search: valor }))
  }, [])

  const aplicarFiltros = useCallback((cambios: Partial<FiltrosPedidos>) => {
    setPage(1)
    setFiltros((previo) => ({ ...previo, ...cambios }))
  }, [])

  const alternarEstado = useCallback(
    async (pedido: Order, estado: OrderStatus): Promise<Order> => {
      exigirConexion()

      const actualizado = await api.patch<Order>(
        `/api/orders/${encodeURIComponent(pedido.id)}`,
        { status: estado }
      )

      // El PATCH devuelve el pedido entero con el timeline actualizado, asi que
      // se puede reemplazar en la lista sin volver a pedir la pagina. El refetch
      // de todas formas, para que el orden por `updatedAt` del servidor no
      // difiera de lo que hay en pantalla.
      refrescar()
      return actualizado
    },
    [refrescar]
  )

  const exportarCsv = useCallback(async (): Promise<void> => {
    // Se pide el **total filtrado**, no la pagina que se ve: exportar las 10
    // filas de la pantalla cuando el filtro dice 240 seria peor que no
    // exportar.
    const params = new URLSearchParams({ page: '1', limit: '100' })
    if (filtros.search.trim() !== '') params.set('search', filtros.search.trim())
    // Repetido, igual que en `construirUrl`. Exportar con el filtro puesto es
    // lo que hace que el CSV sirva: si el estado no llegara, se exportarian los
    // 100 primeros sin filtrar, que es peor que no exportar.
    for (const estado of filtros.estados) params.append('status', estado)
    for (const pago of filtros.pagos) params.append('pagoEstado', pago)
    if (filtros.dateFrom !== '') params.set('dateFrom', filtros.dateFrom)
    if (filtros.dateTo !== '') params.set('dateTo', filtros.dateTo)

    const cuerpo = await api.get<Paginated<Order>>(`/api/orders?${params.toString()}`)

    descargarComo('pedidos', csvPedidos(cuerpo.data))
  }, [filtros])

  return {
    pedidos: data?.data ?? [],
    total: data?.total ?? 0,
    totalPaginas: data?.totalPages ?? 1,
    isLoading,
    error,
    page,
    limit,
    filtros,
    setPage,
    setLimit,
    setSearch,
    aplicarFiltros,
    alternarEstado,
    exportarCsv,
    recargar: refrescar
  }
}