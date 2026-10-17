import { Check, Circle, CreditCard, X } from 'lucide-react'
import type { OrderStatus, OrderTimelineEntry } from '../../types/admin'
import { StatusBadge } from './status_badge'
import { EstadoPagoBadge } from './estado_pago_badge'

/**
 * Timeline de un pedido (RF-26, y los eventos de pago de la 009).
 *
 * Se dibuja sobre `OrderTimelineEntry[]`, que es lo que devuelve
 * `GET /api/orders/:id`. No recalcula los estados: si el registro de un pedido
 * dice tres eventos, el timeline muestra tres. Recalcularlo desde el estado
 * actual seria mentir cuando hubo un salto: CE-06 de la spec 004-b permite
 * pasar de `pendiente` a `entregado` sin pasar por `enviado`, y ese salto tiene
 * que quedar visible.
 *
 * ## Una entrada es de envio O de pago, nunca las dos
 *
 * Por eso `status` y `pagoEstado` son los dos opcionales y el componente decide
 * con cual de los dos vino. Una entrada con los dos seria una mentira: un
 * estado de envio que en realidad esconde un pago.
 *
 * Y una entrada **sin ninguno de los dos** no se renderiza: no hay nada que
 * mostrar y fingir un estado seria inventar historial. El backend no las escribe
 * —la de pago siempre trae `pagoEstado`, la de envio siempre trae `status`—, asi
 * que el filtro es una red, no una regla de negocio.
 */

const formatoFecha = (iso: string): string =>
  new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

/** El ultimo evento es el estado actual. */
const esUltimo = (indice: number, total: number): boolean => indice === total - 1

/** Pagos que no son "llego la plata": no llevan el check verde. */
const esPagoFallido = (entrada: OrderTimelineEntry): boolean =>
  entrada.pagoEstado === 'rechazado' || entrada.pagoEstado === 'expirado'

/** Envios que no son "llego el paquete": llevan la X. */
const esEnvioFallido = (entrada: OrderTimelineEntry): boolean =>
  entrada.status === 'cancelado' || entrada.status === 'devuelto'

interface OrderTimelineProps {
  entradas: readonly OrderTimelineEntry[]
}

export const OrderTimeline = ({ entradas }: OrderTimelineProps) => {
  const utiles = entradas.filter((e) => e.status !== undefined || e.pagoEstado !== undefined)

  if (utiles.length === 0) {
    return <p className='text-sm text-neutral-500'>Este pedido no tiene historial.</p>
  }

  return (
    <ol className='relative space-y-5 pl-7'>
      {/* La linea vertical que une los puntos. Va en el `ol` y no en cada
          item, asi que no hay que repetirla ni calcular donde termina. */}
      <span
        aria-hidden='true'
        className='absolute bottom-2 left-[9px] top-2 w-px bg-neutral-800'
      />

      {utiles.map((entrada, indice) => {
        const actual = esUltimo(indice, utiles.length)
        const fallido = esPagoFallido(entrada) || esEnvioFallido(entrada)
        /**
         * Se guarda en una variable y no como `const dePago = entrada.pagoEstado
         * !== undefined` porque el narrowing por alias solo funciona cuando la
         * condicion es una comprobacion directa; el error de tipo lo dice mejor
         * que el comentario.
         */
        const pago = entrada.pagoEstado

        return (
          <li
            key={`${entrada.pagoEstado ?? entrada.status}-${entrada.createdAt}`}
            className='relative'
          >
            <span
              aria-hidden='true'
              className={[
                'absolute -left-7 top-0.5 flex h-[19px] w-[19px] items-center justify-center rounded-full border',
                actual
                  ? fallido
                    ? 'border-wine-500 bg-wine-900'
                    : 'border-gold-500 bg-charcoal-900'
                  : 'border-neutral-700 bg-charcoal-950'
              ].join(' ')}
            >
              {fallido ? (
                <X className='h-3 w-3 text-wine-400' />
              ) : pago !== undefined ? (
                <CreditCard className='h-3 w-3 text-emerald-300' />
              ) : actual ? (
                <Check className='h-3 w-3 text-gold-400' />
              ) : (
                <Circle className='h-2 w-2 text-neutral-600' />
              )}
            </span>

            {/* El rotulo "Pago"/"Envio" va **siempre**, no solo cuando los dos
                estados coinciden. Dos "Pendiente" pegados no dicen nada; uno
                rotulado y el otro no, tampoco. */}
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-[10px] uppercase tracking-widest text-neutral-500'>
                {pago !== undefined ? 'Pago' : 'Envio'}
              </span>

              {pago !== undefined ? (
                <EstadoPagoBadge estado={pago} size='sm' />
              ) : (
                <StatusBadge estado={entrada.status as OrderStatus} size='sm' />
              )}

              {actual && (
                <span className='text-[10px] uppercase tracking-widest text-neutral-500'>
                  Estado actual
                </span>
              )}
            </div>

            <p className='mt-1 text-xs text-neutral-400'>{formatoFecha(entrada.createdAt)}</p>
            {entrada.note !== undefined && (
              <p className='mt-1 text-sm text-cream-300'>{entrada.note}</p>
            )}

            {/* El autor se muestra solo cuando **no** es "Admin": "Admin" al
                lado de cada cambio de envio es ruido, y lo que interesa es
                poder distinguir de un vistazo lo que escribio una webhook. */}
            {entrada.author !== 'Admin' && (
              <p className='mt-0.5 text-[10px] uppercase tracking-widest text-neutral-600'>
                {entrada.author}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Los estados que se ofrecen en el desplegable de cambio, en orden de avance. */
export const ORDEN_ESTADOS: readonly OrderStatus[] = [
  'pendiente',
  'preparando',
  'enviado',
  'entregado',
  'devuelto',
  'cancelado'
]
