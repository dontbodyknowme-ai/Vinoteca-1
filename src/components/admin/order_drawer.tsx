import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Mail, MapPin, Phone, Printer, Truck, Undo2, X } from 'lucide-react'
import { OrderTimeline } from './order_timeline'
import { StatusBadge } from './status_badge'
import { EstadoPagoBadge } from './estado_pago_badge'
import { ESTADOS_PEDIDO } from '../../hooks/usePedidos'
import type { Order, OrderStatus } from '../../types/admin'

/**
 * Drawer de detalle del pedido.
 *
 * Muestra el pedido **tal como lo devolvio el servidor**, incluido su
 * `timeline`. No recalcula el historial a partir del estado actual: CE-06 de la
 * spec 004-b permite pasar de `pendiente` a `entregado` sin pasar por `enviado`,
 * y un historial recalculado esconderia ese salto.
 */

interface OrderDrawerProps {
  isOpen: boolean
  pedido: Order | null
  onClose: () => void
  onCambiarEstado: (pedido: Order, estado: OrderStatus) => Promise<Order>
  /** RF-28: la etiqueta es mock, no se genera ningun PDF real. */
  onGenerarEtiqueta: (pedido: Order) => void
}

const dinero = (valor: number): string =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(valor)

const fecha = (iso: string): string =>
  new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

export const OrderDrawer = ({
  isOpen,
  pedido,
  onClose,
  onCambiarEstado,
  onGenerarEtiqueta
}: OrderDrawerProps) => {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [devolucionAbierta, setDevolucionAbierta] = useState(false)
  const [errorDevolucion, setErrorDevolucion] = useState('')
  const [motivo, setMotivo] = useState('')
  const [itemsElegidos, setItemsElegidos] = useState<string[]>([])

  // El error de un cambio de estado anterior no debe quedar pegado en el
  // siguiente pedido que se abra. El modal de devolucion tambien arranca
  // cerrado y sin motivo: dejarlo abierto al cambiar de pedido mandaria el
  // motivo de uno a otro.
  useEffect(() => {
    if (isOpen) {
      setError('')
      setErrorDevolucion('')
    }
  }, [isOpen, pedido?.id])

  useEffect(() => {
    if (isOpen) return
    setDevolucionAbierta(false)
    setMotivo('')
    setItemsElegidos([])
  }, [isOpen])

  const cambiarEstado = async (estado: OrderStatus): Promise<void> => {
    if (pedido === null) return

    setGuardando(true)
    setError('')
    try {
      await onCambiarEstado(pedido, estado)
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo actualizar')
    } finally {
      setGuardando(false)
    }
  }

  const subtotal =
    pedido?.items.reduce((suma, item) => suma + item.price * item.quantity, 0) ?? 0
  const unidades = pedido?.items.reduce((suma, item) => suma + item.quantity, 0) ?? 0

  return (
    <AnimatePresence>
      {isOpen && pedido !== null && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className='fixed inset-0 z-50 bg-black/80 backdrop-blur-sm'
          />

          <div className='fixed inset-0 z-50 flex justify-end'>
            <motion.aside
              role='dialog'
              aria-modal='true'
              aria-label={`Pedido ${pedido.id}`}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className='flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-wine-900/60 bg-charcoal-900 text-cream-100 shadow-2xl'
            >
              <div className='flex items-start justify-between gap-4 border-b border-neutral-800 px-6 py-4'>
                <div>
                  <h2 className='font-serif text-xl font-bold'>{pedido.id}</h2>
                  <p className='mt-0.5 text-xs text-neutral-400'>
                    {fecha(pedido.createdAt)}
                  </p>
                </div>
                <button
                  type='button'
                  onClick={onClose}
                  aria-label='Cerrar detalle del pedido'
                  className='rounded-lg p-2 text-neutral-400 transition-colors hover:bg-charcoal-800 hover:text-cream-100'
                >
                  <X className='h-5 w-5' aria-hidden='true' />
                </button>
              </div>

              <div className='flex-1 space-y-6 px-6 py-5'>
                {/* --- Cliente --- */}
                <section>
                  <h3 className='mb-2 text-[10px] uppercase tracking-widest text-neutral-400'>
                    Cliente
                  </h3>
                  <p className='font-semibold text-cream-100'>{pedido.customer.name}</p>
                  <p className='mt-1 flex items-center gap-2 text-sm text-neutral-400'>
                    <Mail className='h-4 w-4 shrink-0' aria-hidden='true' />
                    {/* `email` es `string | null`: el `Customer.email` de la base
                        es opcional, y un `?? ''` con un guion da menos informacion
                        que nada. */}
                    <span className='truncate'>{pedido.customer.email ?? '—'}</span>
                  </p>
                </section>

                {/* --- Direccion --- */}
                <section>
                  <h3 className='mb-2 text-[10px] uppercase tracking-widest text-neutral-400'>
                    Envio
                  </h3>
                  <p className='flex items-start gap-2 text-sm text-neutral-300'>
                    <MapPin className='mt-0.5 h-4 w-4 shrink-0 text-neutral-500' aria-hidden='true' />
                    <span>
                      {pedido.shippingAddress.street}
                      <br />
                      {pedido.shippingAddress.city} ({pedido.shippingAddress.zip})
                    </span>
                  </p>
                  <p className='mt-1.5 flex items-center gap-2 text-sm text-neutral-400'>
                    <Phone className='h-4 w-4 shrink-0' aria-hidden='true' />
                    <span>{pedido.shippingAddress.phone}</span>
                  </p>
                </section>

                {/* --- Items --- */}
                <section>
                  <h3 className='mb-2 text-[10px] uppercase tracking-widest text-neutral-400'>
                    Productos ({unidades} {unidades === 1 ? 'unidad' : 'unidades'})
                  </h3>
                  <ul className='space-y-3'>
                    {pedido.items.map((item) => (
                      <li
                        key={item.wineId}
                        className='flex items-center gap-3 rounded-xl border border-neutral-800 bg-charcoal-800/40 p-3'
                      >
                        <img
                          src={item.imageUrl}
                          alt=''
                          className='h-11 w-11 shrink-0 rounded-lg object-cover'
                        />
                        <div className='min-w-0 flex-1'>
                          <p className='truncate text-sm font-semibold text-cream-100'>
                            {item.wineName}
                          </p>
                          <p className='text-xs text-neutral-500'>
                            {item.quantity} x {dinero(item.price)}
                          </p>
                        </div>
                        <span className='shrink-0 text-sm font-semibold text-cream-100'>
                          {dinero(item.price * item.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <dl className='mt-4 space-y-1 border-t border-neutral-800 pt-3 text-sm'>
                    <div className='flex justify-between'>
                      <dt className='text-neutral-400'>Subtotal</dt>
                      <dd className='text-neutral-200'>{dinero(subtotal)}</dd>
                    </div>
                    <div className='flex justify-between'>
                      <dt className='text-neutral-400'>Envio</dt>
                      <dd className='text-neutral-200'>
                        {dinero(Math.max(0, pedido.total - subtotal))}
                      </dd>
                    </div>
                    <div className='flex justify-between pt-1 text-base'>
                      <dt className='font-semibold text-cream-100'>Total</dt>
                      <dd className='font-bold text-gold-400'>{dinero(pedido.total)}</dd>
                    </div>
                  </dl>
                </section>

                {/* --- Pago y envio: DOS hechos distintos (D-7) ---
                    Los dos badges van juntos y cada uno con su rotulo, porque un
                    pedido puede estar "aprobado" de pago y "pendiente" de envio:
                    la plata entro y el paquete todavia no se armo. Puestos sin
                    rotulo se leen como una sola cosa, que es el bug que la 009
                    vino a separar. */}
                <section>
                  <h3 className='mb-2 text-[10px] uppercase tracking-widest text-neutral-400'>
                    Pago
                  </h3>
                  <div className='flex flex-wrap items-center gap-3'>
                    <EstadoPagoBadge estado={pedido.pagoEstado} />

                    {pedido.pagoEstado === 'expirado' && (
                      <p className='text-xs text-neutral-500'>
                        Vencio esperando el pago. Nadie rechazo nada.
                      </p>
                    )}

                    {pedido.pagoEstado === 'aprobado' && pedido.status !== 'entregado' && (
                      <p className='text-xs text-neutral-500'>
                        La plata entro. Falta coordinar el envio.
                      </p>
                    )}
                  </div>
                </section>

                {/* --- Envio --- */}
                <section>
                  <h3 className='mb-2 text-[10px] uppercase tracking-widest text-neutral-400'>
                    Envio
                  </h3>
                  <div className='flex flex-wrap items-center gap-3'>
                    <StatusBadge estado={pedido.status} />
                    <label htmlFor='order-status' className='sr-only'>
                      Cambiar estado del envio
                    </label>
                    <select
                      id='order-status'
                      value={pedido.status}
                      disabled={guardando}
                      onChange={(e) => void cambiarEstado(e.target.value as OrderStatus)}
                      className='rounded-xl border border-neutral-700 bg-charcoal-800 px-3 py-2 text-sm text-cream-100 focus:border-gold-500 focus:outline-none disabled:opacity-50'
                    >
                      {ESTADOS_PEDIDO.map((estado) => (
                        <option key={estado.valor} value={estado.valor}>
                          {estado.etiqueta}
                        </option>
                      ))}
                    </select>
                  </div>

                  {error !== '' && (
                    <p
                      role='alert'
                      className='mt-2 rounded-xl border border-wine-500/50 bg-wine-900/40 px-3 py-2 text-sm'
                    >
                      {error}
                    </p>
                  )}
                </section>

                {/* --- Acciones de operacion (RF-28, RF-29) --- */}
                <section>
                  <h3 className='mb-2 text-[10px] uppercase tracking-widest text-neutral-400'>
                    Operaciones
                  </h3>
                  <div className='flex flex-wrap gap-2'>
                    <button
                      type='button'
                      onClick={() => onGenerarEtiqueta(pedido)}
                      className='flex items-center gap-2 rounded-xl border border-neutral-700 px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-gold-500 hover:text-cream-100'
                    >
                      <Printer className='h-4 w-4' aria-hidden='true' />
                      Generar etiqueta
                    </button>
                    <button
                      type='button'
                      onClick={() => setDevolucionAbierta(true)}
                      disabled={pedido.status === 'devuelto'}
                      className='flex items-center gap-2 rounded-xl border border-neutral-700 px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-wine-500 hover:text-cream-100 disabled:cursor-not-allowed disabled:opacity-40'
                    >
                      <Undo2 className='h-4 w-4' aria-hidden='true' />
                      Iniciar devolucion
                    </button>
                  </div>
                  {pedido.status === 'devuelto' && (
                    <p className='mt-2 text-xs text-neutral-500'>
                      Este pedido ya fue devuelto.
                    </p>
                  )}
                </section>

                {/* --- Historial --- */}
                <section>
                  <h3 className='mb-3 flex items-center gap-2 text-[10px] uppercase tracking-widest text-neutral-400'>
                    <Truck className='h-3.5 w-3.5' aria-hidden='true' />
                    Historial
                  </h3>
                  <OrderTimeline entradas={pedido.timeline} />
                </section>
              </div>

              {/* --- Modal de devolucion (RF-29) --- */}
              {devolucionAbierta && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  role='dialog'
                  aria-modal='true'
                  aria-label='Iniciar devolucion'
                  className='absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm'
                >
                  <div className='w-full max-w-md rounded-2xl border border-neutral-700 bg-charcoal-900 p-5 shadow-2xl'>
                    <h3 className='font-serif text-lg font-bold'>
                      Devolver {pedido.id}
                    </h3>
                    <p className='mt-1 text-sm text-neutral-400'>
                      Elegi los productos y el motivo. El estado del pedido pasa a
                      "devuelto".
                    </p>

                    <fieldset className='mt-4'>
                      <legend className='mb-2 text-[10px] uppercase tracking-widest text-neutral-400'>
                        Productos a devolver
                      </legend>
                      <div className='space-y-2'>
                        {pedido.items.map((item) => (
                          <label
                            key={item.wineId}
                            className='flex cursor-pointer items-center gap-2.5 rounded-xl border border-neutral-800 bg-charcoal-800/40 px-3 py-2 text-sm transition-colors hover:bg-charcoal-800'
                          >
                            <input
                              type='checkbox'
                              checked={itemsElegidos.includes(item.wineId)}
                              onChange={() =>
                                setItemsElegidos((previas) =>
                                  previas.includes(item.wineId)
                                    ? previas.filter((id) => id !== item.wineId)
                                    : [...previas, item.wineId]
                                )
                              }
                              className='h-4 w-4 accent-gold-500'
                            />
                            <span className='min-w-0 flex-1 truncate'>{item.wineName}</span>
                            <span className='shrink-0 text-xs text-neutral-500'>
                              {item.quantity}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div className='mt-4'>
                      <label
                        htmlFor='motivo-devolucion'
                        className='mb-1 block text-[10px] uppercase tracking-widest text-neutral-400'
                      >
                        Motivo
                      </label>
                      <textarea
                        id='motivo-devolucion'
                        rows={2}
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder='Empaque danado, vino que no taste bien...'
                        className='w-full resize-none rounded-xl border border-neutral-700 bg-charcoal-800 px-3 py-2 text-sm focus:border-gold-500 focus:outline-none'
                      />
                    </div>

                    {/* El motivo es obligatorio: una devolucion sin motivo deja al
                        resto del equipo sin forma de saber que hacer con el
                        stock que vuelve. */}
                    {errorDevolucion !== '' && (
                      <p
                        role='alert'
                        className='mt-3 rounded-xl border border-wine-500/50 bg-wine-900/40 px-3 py-2 text-sm'
                      >
                        {errorDevolucion}
                      </p>
                    )}

                    <div className='mt-5 flex gap-3'>
                      <button
                        type='button'
                        onClick={() => {
                          setDevolucionAbierta(false)
                          setMotivo('')
                          setItemsElegidos([])
                        }}
                        className='flex-1 rounded-xl border border-neutral-700 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-neutral-300 transition-colors hover:bg-charcoal-800'
                      >
                        Cancelar
                      </button>
                      <button
                        type='button'
                        disabled={guardando}
                        onClick={async () => {
                          if (itemsElegidos.length === 0) {
                            setErrorDevolucion('Elegi al menos un producto a devolver.')
                            return
                          }
                          if (motivo.trim() === '') {
                            setErrorDevolucion('Escribi el motivo de la devolucion.')
                            return
                          }

                          setGuardando(true)
                          setErrorDevolucion('')
                          try {
                            await onCambiarEstado(pedido, 'devuelto')
                            setDevolucionAbierta(false)
                            setMotivo('')
                            setItemsElegidos([])
                          } catch (fallo) {
                            setErrorDevolucion(
                              fallo instanceof Error ? fallo.message : 'No se pudo iniciar la devolucion'
                            )
                          } finally {
                            setGuardando(false)
                          }
                        }}
                        className='flex-1 rounded-xl border border-wine-500/40 bg-wine-700 px-4 py-3 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-wine-500 disabled:opacity-50'
                      >
                        {guardando ? 'Procesando...' : 'Confirmar'}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.aside>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
