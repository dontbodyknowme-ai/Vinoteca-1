import type { EstadoPago } from '../../types/admin'

/**
 * Badge del estado del **pago** (spec 009, RF-08).
 *
 * ## Por que NO es `StatusBadge` con otro parametro
 *
 * Porque los dos enumerados comparten el literal `pendiente` con **significados
 * opuestos**:
 *
 * - en `OrderStatus`, `pendiente` es "estamos armando el paquete"
 * - en `EstadoPago`, `pendiente` es "abrió Mercado Pago y no terminó"
 *
 * Con un solo componente, `Record<EstadoAdmin, Estilo>` tiene **una** clave
 * `pendiente`, y TypeScript aceptaria `'pendiente'` en los dos sitios sin que
 * nadie se entere: el badge del envio y el del pago se verian **identicos**, y
 * el que esta preparando un pedido ya cobrado leeria que todavia no esta pagado.
 *
 * O sea que el componente separado no es duplicacion: es lo que hace que la
 * separacion de D-7 se vea en pantalla y no solo en la base. Por eso los colores
 * estan duplicados aqui a proposito —cambiar uno obliga a mirar el otro— y no
 * hay un mapa comun que los "unifique" y lose justo de paso.
 *
 * ## Los colores
 *
 * Los mismos que usa `StatusBadge` para su familia, por la razon que esta
 * anotada alla: la paleta del tema cubre superficies, no estados del negocio.
 * `text-emerald-300`, `text-amber-300` y `text-wine-400` estan ahi a proposito.
 */

interface Estilo {
  fondo: string
  texto: string
  borde: string
}

const ESTILOS: Record<EstadoPago, Estilo> = {
  // Nadie abrio Mercado Pago todavia: el pedido esta esperando que el comprador
  // pulse el boton. Neutro, porque no es un fallo ni un exito — es "todavia no".
  no_iniciado: {
    fondo: 'bg-neutral-700/30',
    texto: 'text-neutral-400',
    borde: 'border-neutral-600/50'
  },
  // Pago abierto y sin confirmar. **Ambar**, igual que el envio en curso: la
  // diferencia la hace el rotulo ("Pago" vs "Envio"), no el color.
  pendiente: {
    fondo: 'bg-amber-500/15',
    texto: 'text-amber-300',
    borde: 'border-amber-500/40'
  },
  // Verde = plata recibida. Es el unico estado que se puede mostrar junto a un
  // pedido que el panel ya marco como entregado, y los dos tienen que poder
  // leerse a la vez sin que uno tape al otro.
  aprobado: {
    fondo: 'bg-emerald-500/15',
    texto: 'text-emerald-300',
    borde: 'border-emerald-500/40'
  },
  rechazado: {
    fondo: 'bg-wine-500/20',
    texto: 'text-wine-400',
    borde: 'border-wine-500/50'
  },
  // Vencio esperando. Distinto de `rechazado` a proposito: nadie rechazo nada,
  // el comprador se fue. En el CRM es una diferencia que cuenta.
  expirado: {
    fondo: 'bg-neutral-700/30',
    texto: 'text-neutral-400',
    borde: 'border-neutral-600/50'
  }
}

const ETIQUETAS: Record<EstadoPago, string> = {
  no_iniciado: 'Sin iniciar',
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  expirado: 'Expirado'
}

interface EstadoPagoBadgeProps {
  estado: EstadoPago
  size?: 'sm' | 'md'
}

/**
 * El `data-estado-pago` no es cosmetico: es el gancho que permite que un test
 * afirme **que estado se muestra** sin depender del texto. Y el texto no es una
 * garantia: "Pendiente" del pago y "Pendiente" del envio son la misma palabra.
 */
export const EstadoPagoBadge = ({ estado, size = 'md' }: EstadoPagoBadgeProps) => {
  const estilo = ESTILOS[estado]

  return (
    <span
      data-estado-pago={estado}
      className={[
        'inline-flex items-center rounded-full border font-semibold uppercase tracking-wider whitespace-nowrap',
        estilo.fondo,
        estilo.texto,
        estilo.borde,
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      ].join(' ')}
    >
      {ETIQUETAS[estado]}
    </span>
  )
}
