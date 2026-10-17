/**
 * El checkout (spec 009).
 *
 * ## Por que vive en `src/pages/` y no dentro de `App.tsx`
 *
 * `App.tsx` tiene el estado del carrito y el drawer. El checkout es un **paso
 * distinto**: tiene URL propia, se puede recargar, y al volver de Mercado Pago
 * el comprador llega por query param (`?pago=aprobado`) sin el carrito en memoria.
 *
 * Si viviera en `App.tsx`, recargar en `/checkout` perderia el carrito y el
 * comprador veria un formulario vacio sin saber que paso.
 */

/** Un item tal como lo manda el frontend: **id y cantidad, ningun precio**. */
export interface ItemDelCheckout {
  vinoId: string
  cantidad: number
}

/** Lo que el backend devuelve al crear el pedido. */
export interface PedidoCreado {
  orderId: string
  preferenceId: string
  /** La URL de Mercado Pago. Se usa tal cual: armarla a mano es fragile. */
  initPoint: string
  /** Pesos enteros. Es **el** numero, el mismo que guardo el backend. */
  total: number
}

/** Lo que pide el backend, sin precios. */
export interface DatosDelComprador {
  nombre: string
  apellido: string
  telefono: string
  email: string
  direccion: string
}

/**
 * La clave de `sessionStorage` donde queda el resumen del pedido.
 *
 * **`sessionStorage` y no `localStorage`** a proposito: esto es de **esta** compra.
 * En un computer compartido, un `localStorage` dejaria el numero de pedido de la
 * compra de otra persona a la vista del siguiente que abre la pestana —con el
 * nombre y el total dentro.
 *
 * Se borra en cuanto la confirmacion se muestra.
 */
export const CLAVE_PEDIDO = 'vinoteca_pedido'

/** Lo que se guarda mientras el comprador esta en Mercado Pago. */
export interface ResumenDelPedido {
  orderId: string
  total: number
  items: ItemDelCheckout[]
}

/**
 * Guarda el resumen para poder mostrar la confirmacion al volver.
 *
 * Se guarda **antes** de redirigir, porque al volver de Mercado Pago esta
 * pagina se recarga desde cero: sin esto, no hay nada que mostrar.
 */
export const guardarResumen = (resumen: ResumenDelPedido): void => {
  sessionStorage.setItem(CLAVE_PEDIDO, JSON.stringify(resumen))
}

export const leerResumen = (): ResumenDelPedido | null => {
  const crudo = sessionStorage.getItem(CLAVE_PEDIDO)
  if (crudo === null) return null

  try {
    const dato = JSON.parse(crudo) as unknown
    if (typeof dato !== 'object' || dato === null) return null

    const { orderId, total } = dato as Record<string, unknown>
    if (typeof orderId !== 'string' || typeof total !== 'number') return null

    return { orderId, total, items: [] }
  } catch {
    // Un JSON corrupto no puede romper la pagina: sin resumen, la confirmacion
    // dice que no lo encuentra. Inventarse un total seria peor.
    return null
  }
}

export const borrarResumen = (): void => {
  sessionStorage.removeItem(CLAVE_PEDIDO)
}

/** El estado del pago, tal como viene en el query param al volver. */
export type ResultadoDelPago = 'aprobado' | 'fallido' | 'pendiente' | null

export const resultadoDeLaUrl = (buscar: string): ResultadoDelPago => {
  const valor = new URLSearchParams(buscar).get('pago')
  if (valor === 'aprobado' || valor === 'fallido' || valor === 'pendiente') return valor
  return null
}
