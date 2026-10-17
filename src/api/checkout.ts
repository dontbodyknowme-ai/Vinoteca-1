import { api } from './client'
import type { DatosDelComprador, ItemDelCheckout, PedidoCreado } from '../types/checkout'

/**
 * `POST /api/orders` — el checkout.
 *
 * ## Lo que NO viaja
 *
 * **Ningun precio.** El carrito vive en el `localStorage` del navegador, asi que
 * quien quiera puede abrir las DevTools y mandarnos el pedido a $2. El backend
 * lee `Wine.price` de la base e ignora lo que venga.
 *
 * Por eso la funcion recibe `{ vinoId, cantidad }` y no el `Wine` entero: aunque
 * el `Wine` que tiene el `price` adentro, **no se manda**. La firma de la
 * funcion es la primera linea de defensa, y la de la red es el schema del
 * backend, que **rechaza** el campo en vez de ignorarlo.
 */
export const crearPedido = async (
  comprador: DatosDelComprador,
  items: ItemDelCheckout[]
): Promise<PedidoCreado> => {
  const res = await api.post<PedidoCreado>('/api/orders', {
    ...comprador,
    items
  })

  return res
}

/** El mensaje de un error de la API, o el generico si no se puede leer. */
export const mensajeDeErrorDeCheckout = (error: unknown): string => {
  if (typeof error === 'object' && error !== null) {
    const conCodigo = error as { message?: unknown }
    if (typeof conCodigo.message === 'string' && conCodigo.message !== '') {
      return conCodigo.message
    }
  }

  return 'No pudimos crear el pedido. Intenta de nuevo.'
}
