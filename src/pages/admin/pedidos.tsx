import { useState } from 'react'
import { CreditCard, Eye, Truck, X } from 'lucide-react'
import { DataTable, columnaConFiltro, columnaHelper } from '../../components/admin/data_table'
import { StatusBadge } from '../../components/admin/status_badge'
import { EstadoPagoBadge } from '../../components/admin/estado_pago_badge'
import { OrderDrawer } from '../../components/admin/order_drawer'
import { DateRangePicker } from '../../components/admin/date_range_picker'
import {
  ESTADOS_PAGO,
  ESTADOS_PEDIDO,
  filtrosVacios,
  usePedidos
} from '../../hooks/usePedidos'
import type { EstadoPago, Order, OrderStatus } from '../../types/admin'

/**
 * Gestion de pedidos: la segunda de las tres tablas del panel.
 *
 * El filtro de estados es multi-select y se comporta como un OR: marcar
 * "pendiente" y "enviado" muestra los dos. El filtro de fechas, en cambio, es un
 * rango cerrado y se aplica con el boton "Aplicar" del calendario, no en cada
 * click: cada dia que el usuario toca recargaria la tabla y la haria parpadear
 * debajo del calendario que esta usando.
 */

const dinero = (valor: number): string =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(valor)

const soloFecha = (iso: string): string =>
  new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  })

const columnas = [
  columnaHelper<Order>().accessor('id', {
    header: 'Pedido',
    cell: (info) => <span className='font-mono text-xs text-cream-100'>{info.getValue()}</span>
  }),
  /**
   * `customer.name`, no `pedido.customerName`.
   *
   * El accessor va sobre `customer` y el `cell` baja a `.name`: el accessor es
   * la columna por la que se **ordena**, y ordenar por un string anidado en
   * TanStack hay que resolverlo a mano. Como el backend manda `orderBy` en
   * servidor, la columna es de solo lectura y no se puede ordenar desde aca —
   * pero el accessor tiene que existir y ser un camino real.
   */
  columnaHelper<Order>().accessor('customer', {
    header: 'Cliente',
    enableSorting: false,
    cell: (info) => (
      <div className='min-w-0'>
        <span className='block truncate font-semibold text-cream-100'>
          {info.getValue().name}
        </span>
        <span className='block truncate text-xs text-neutral-500'>
          {info.getValue().email ?? ''}
        </span>
      </div>
    )
  }),
  columnaHelper<Order>().accessor('createdAt', {
    header: 'Fecha',
    cell: (info) => <span className='whitespace-nowrap'>{soloFecha(info.getValue())}</span>
  }),
  columnaHelper<Order>().accessor('total', {
    header: 'Total',
    cell: (info) => (
      <span className='whitespace-nowrap font-semibold text-cream-100'>
        {dinero(info.getValue())}
      </span>
    )
  }),
  columnaConFiltro(
    columnaHelper<Order>().accessor('status', {
      header: 'Envio',
      cell: (info) => <StatusBadge estado={info.getValue()} size='sm' />
    }),
    ESTADOS_PEDIDO.map((estado) => ({ valor: estado.valor, etiqueta: estado.etiqueta }))
  ),
  /**
   * El estado del pago, **sin filtro** (spec 009, D-G).
   *
   * Que aparezca no resuelve D-G —D-G es sobre el *filtro*— pero sin la columna
   * el panel no puede responder "cuanto cobre hoy" sin abrir pedido por pedido,
   * que es exactamente el problema que la seccion 2.5 de `spec.md` describe.
   *
   * Sin filtro a proposito: `GET /api/orders` hoy solo acepta `?status=`, que es
   * el **envio**. Agregar el filtro obliga a cambiar el endpoint, el
   * `orderQuerySchema`, el `usePedidos` y la matriz de coherencia de permisos, y
   * eso es otra decision. La columna es de solo lectura y no toca nada de eso.
   *
   * `columnaHelper` sin `columnaConFiltro` a proposito: el encabezado no debe
   * ofrecer un menu de filtro que el backend no acepta.
   */
  columnaHelper<Order>().accessor('pagoEstado', {
    header: 'Pago',
    cell: (info) => <EstadoPagoBadge estado={info.getValue()} size='sm' />
  })
]

export const PedidosAdmin = () => {
  const pedidos = usePedidos()

  const [pedidoAbierto, setPedidoAbierto] = useState<Order | null>(null)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [panelEstados, setPanelEstados] = useState(false)
  const [panelPagos, setPanelPagos] = useState(false)

  const alternarEstadoEnFiltro = (estado: OrderStatus): void => {
    const yaEsta = pedidos.filtros.estados.includes(estado)
    pedidos.aplicarFiltros({
      estados: yaEsta
        ? pedidos.filtros.estados.filter((otro) => otro !== estado)
        : [...pedidos.filtros.estados, estado]
    })
  }

  /**
   * Marca o desmarca un estado de **pago** (spec 009, D-10).
   *
   * Gemela de `alternarEstadoEnFiltro`, y separada a proposito: mezclarlas habria
   * que distinguir los dos tipos de estado en cada llamada, y la confusion entre
   * `pendiente` de envio y `pendiente` de pago es justo lo que D-7 vino a evitar.
   */
  const alternarPagoEnFiltro = (pago: EstadoPago): void => {
    const yaEsta = pedidos.filtros.pagos.includes(pago)

    pedidos.aplicarFiltros({
      pagos: yaEsta
        ? pedidos.filtros.pagos.filter((otro) => otro !== pago)
        : [...pedidos.filtros.pagos, pago]
    })
  }

  const hayFiltros =
    pedidos.filtros.search !== '' ||
    pedidos.filtros.estados.length > 0 ||
    pedidos.filtros.pagos.length > 0 ||
    pedidos.filtros.dateFrom !== '' ||
    pedidos.filtros.dateTo !== ''

  const limpiarTodo = (): void => {
    // `filtrosVacios()` y no un objeto a mano: `aplicarFiltros` fusiona, asi que
    // un campo olvidado **queda puesto**. Y el tipo de la funcion es completo, de
    // modo que olvidar un campo es un error de compilacion y no una sorpresa en
    // pantalla.
    pedidos.aplicarFiltros(filtrosVacios())
    setPanelEstados(false)
    setPanelPagos(false)
  }

  const cambiarEstado = async (pedido: Order, estado: OrderStatus): Promise<Order> => {
    try {
      const actualizado = await pedidos.alternarEstado(pedido, estado)
      // El drawer se actualiza con la respuesta del PATCH, que ya trae el estado
      // nuevo y el timeline con el evento agregado. Sin esto seguia mostrando
      // el `Order` viejo: el `select` volvia a "pendiente" y el historial no
      // mostraba el evento nuevo, al lado de un aviso que decia "enviado".
      setPedidoAbierto(actualizado)
      setAviso(`${pedido.id} ahora esta "${estado}".`)
      setError('')
      return actualizado
    } catch (fallo) {
      const mensaje = fallo instanceof Error ? fallo.message : 'No se pudo actualizar'
      setError(mensaje)
      throw fallo instanceof Error ? fallo : new Error(mensaje)
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='font-serif text-lg font-bold text-cream-100'>Pedidos</h2>
          <p className='text-sm text-neutral-500'>
            {pedidos.total} {pedidos.total === 1 ? 'pedido' : 'pedidos'}
            {hayFiltros ? ' con los filtros aplicados' : ' en total'}
          </p>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {/* --- Filtro de ENVIO, multi-select --- */}
          <div className='relative'>
            <button
              type='button'
              onClick={() => setPanelEstados((previo) => !previo)}
              aria-expanded={panelEstados}
              aria-label='Filtrar por estado de envío'
              className={[
                'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors',
                pedidos.filtros.estados.length > 0
                  ? 'border-gold-500 bg-gold-500/10 text-cream-100'
                  : 'border-neutral-700 bg-charcoal-800 text-neutral-300 hover:border-gold-500'
              ].join(' ')}
            >
              <Truck className='h-4 w-4 shrink-0' aria-hidden='true' />
              Envío
              {pedidos.filtros.estados.length > 0 && (
                <span className='rounded-full bg-gold-500 px-1.5 text-[10px] font-bold text-charcoal-950'>
                  {pedidos.filtros.estados.length}
                </span>
              )}
            </button>

            {panelEstados && (
              <>
                <div
                  aria-hidden='true'
                  onClick={() => setPanelEstados(false)}
                  className='fixed inset-0 z-30'
                />
                <div className='absolute right-0 z-40 mt-2 w-52 rounded-2xl border border-neutral-700 bg-charcoal-900 p-2 shadow-2xl'>
                  {ESTADOS_PEDIDO.map((estado) => {
                    const marcado = pedidos.filtros.estados.includes(estado.valor)
                    return (
                      <label
                        key={estado.valor}
                        className='flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-cream-100 transition-colors hover:bg-charcoal-800'
                      >
                        <input
                          type='checkbox'
                          checked={marcado}
                          onChange={() => alternarEstadoEnFiltro(estado.valor)}
                          className='h-4 w-4 accent-gold-500'
                        />
                        <span className='flex-1'>{estado.etiqueta}</span>
                        <StatusBadge estado={estado.valor} size='sm' />
                      </label>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* --- Filtro de PAGO, multi-select (spec 009, D-10) ---
              Va en un desplegable **propio** y no junto al de envio porque los
              dos tienen un "Pendiente" que significa cosas distintas (D-7). En un
              desplegable unico habria que adivinar cual de los dos se filtra.

              Abrir uno cierra el otro: con dos paneles abiertos al mismo tiempo
              el de pago tapa el de envio y no se ve que filtros hay puestos. */}
          <div className='relative'>
            <button
              type='button'
              onClick={() => {
                setPanelPagos((previo) => !previo)
                setPanelEstados(false)
              }}
              aria-expanded={panelPagos}
              aria-label='Filtrar por estado de pago'
              className={[
                'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors',
                pedidos.filtros.pagos.length > 0
                  ? 'border-gold-500 bg-gold-500/10 text-cream-100'
                  : 'border-neutral-700 bg-charcoal-800 text-neutral-300 hover:border-gold-500'
              ].join(' ')}
            >
              <CreditCard className='h-4 w-4 shrink-0' aria-hidden='true' />
              Pago
              {pedidos.filtros.pagos.length > 0 && (
                <span className='rounded-full bg-gold-500 px-1.5 text-[10px] font-bold text-charcoal-950'>
                  {pedidos.filtros.pagos.length}
                </span>
              )}
            </button>

            {panelPagos && (
              <>
                <div
                  aria-hidden='true'
                  onClick={() => setPanelPagos(false)}
                  className='fixed inset-0 z-30'
                />
                <div className='absolute right-0 z-40 mt-2 w-52 rounded-2xl border border-neutral-700 bg-charcoal-900 p-2 shadow-2xl'>
                  {ESTADOS_PAGO.map((pago) => {
                    const marcado = pedidos.filtros.pagos.includes(pago.valor)

                    return (
                      <label
                        key={pago.valor}
                        className='flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-cream-100 transition-colors hover:bg-charcoal-800'
                      >
                        <input
                          type='checkbox'
                          checked={marcado}
                          onChange={() => alternarPagoEnFiltro(pago.valor)}
                          className='h-4 w-4 accent-gold-500'
                        />
                        <span className='flex-1'>{pago.etiqueta}</span>
                        <EstadoPagoBadge estado={pago.valor} size='sm' />
                      </label>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <DateRangePicker
            desde={pedidos.filtros.dateFrom}
            hasta={pedidos.filtros.dateTo}
            onChange={(rango) => {
              pedidos.aplicarFiltros(rango)
              setAviso(
                rango.dateFrom === ''
                  ? 'Filtro de fechas limpiado.'
                  : `Mostrando del ${rango.dateFrom} al ${rango.dateTo}.`
              )
            }}
          />

          {hayFiltros && (
            <button
              type='button'
              onClick={limpiarTodo}
              aria-label='Limpiar filtros'
              className='flex items-center gap-1.5 rounded-xl border border-neutral-700 px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-wine-500 hover:text-cream-100'
            >
              <X className='h-4 w-4' aria-hidden='true' />
              Limpiar
            </button>
          )}
        </div>
      </div>

      {aviso !== '' && (
        <p
          role='status'
          className='rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-2.5 text-sm'
        >
          {aviso}
        </p>
      )}

      {error !== '' && (
        <p
          role='alert'
          className='rounded-xl border border-wine-500/50 bg-wine-900/40 px-4 py-2.5 text-sm'
        >
          {error}
        </p>
      )}

      {pedidos.error !== undefined && (
        <p
          role='alert'
          className='rounded-xl border border-wine-500/50 bg-wine-900/40 px-4 py-2.5 text-sm'
        >
          {pedidos.error}
        </p>
      )}

      <DataTable<Order>
        columns={columnas}
        data={pedidos.pedidos}
        total={pedidos.total}
        page={pedidos.page}
        limit={pedidos.limit}
        onPageChange={pedidos.setPage}
        onLimitChange={pedidos.setLimit}
        onSortChange={(orden) => {
          pedidos.aplicarFiltros({
            sortColumn: orden?.columna ?? '',
            sortDirection: orden?.direccion ?? 'desc'
          })
        }}
        onFilterChange={(filtros) => {
          pedidos.aplicarFiltros({
            estados:
              filtros.status === undefined || filtros.status === ''
                ? []
                : (filtros.status.split(',') as OrderStatus[])
          })
        }}
        searchValue={pedidos.filtros.search}
        onSearchChange={pedidos.setSearch}
        onExport={() => {
          void pedidos.exportarCsv()
        }}
        isLoading={pedidos.isLoading}
        getRowId={(pedido) => pedido.id}
        emptySingular='pedido'
        emptyPlural='pedidos'
        rowActions={(pedido) => (
          <div className='flex justify-end'>
            <button
              type='button'
              onClick={() => setPedidoAbierto(pedido)}
              aria-label={`Ver pedido ${pedido.id}`}
              title='Ver detalle'
              className='rounded-lg p-2 text-neutral-400 transition-colors hover:bg-charcoal-700 hover:text-gold-400'
            >
              <Eye className='h-4 w-4' aria-hidden='true' />
            </button>
          </div>
        )}
      />

      <OrderDrawer
        isOpen={pedidoAbierto !== null}
        pedido={pedidoAbierto}
        onClose={() => setPedidoAbierto(null)}
        onCambiarEstado={cambiarEstado}
        // RF-28: la etiqueta es mock a proposito. No se genera ningun PDF ni se
        // llama a un servicio de envios; el panel solo confirma la accion. El
        // toast dice "(mock)" justamente para que no parezca que se genero algo.
        onGenerarEtiqueta={(pedido) => setAviso(`Etiqueta generada (mock) para ${pedido.id}.`)}
      />
    </div>
  )
}