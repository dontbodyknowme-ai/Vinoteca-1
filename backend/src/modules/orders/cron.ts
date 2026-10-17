import type { PrismaClient } from '@prisma/client'
import { logger } from '../../utils/logger.js'

/**
 * Expiracion de pedidos sin pagar (spec 009, T5, RF-07).
 *
 * ## Por que un cron y no el frontend
 *
 * Si expirara el frontend al volver de Mercado Pago, un comprador que cierra la
 * pestana sin pagar **no expira nunca**: su pedido queda en `pendiente` para
 * siempre, y si el vino tiene stock reservado, ese stock no vuelve. La unica
 * forma de cubrir al que se va es que el servidor lo haga solo.
 *
 * ## Que expira
 *
 * `pagoEstado in ('no_iniciado', 'pendiente')` con mas de 10 minutos. Un pedido
 * `aprobado` o `rechazado` no expira: ya tiene su resultado.
 *
 * ## Que NO toca
 *
 * **`Order.status`.** `expirado` no existe en `OrderStatus` (D-7), y aunque
 * existiera significaria "el envio se vencio" — que no es lo que paso. Un pedido
 * que nadie pago no tiene un envio vencido: tiene un envio **que nunca se
 * mando**.
 *
 * ## El intervalo
 *
 * Un minuto. Mas seguido no aporta nada (la ventana es de 10 minutos) y es una
 * consulta por minuto de por vida; menos seguido deja pedidos colgados hasta
 * casi el doble del plazo.
 */

/** Minutos que un pedido espera antes de darse por abandoned. */
export const MINUTOS_PARA_EXPIRAR = 10

const unMinutoEnMs = 60 * 1000

/** Cuantos pedidos vencieron en la ultima pasada. Devuelve el numero. */
export const expirarPedidosSinPagar = async (prisma: PrismaClient): Promise<number> => {
  const limite = new Date(Date.now() - MINUTOS_PARA_EXPIRAR * unMinutoEnMs)

  /**
   * `updateMany` y no `findMany` + `update` por cada uno.
   *
   * Ademas de ser una sola consulta, es **atomico**: si dos instancias del
   * backend corren el cron a la vez (que es lo que pasa en un deploy con
   * solapamiento), cada pedido lo actualiza **una** vez. Con el ciclo
   * find-then-update, las dos lo leerian y las dos lo escribirian, y cada una
   * sumaria su propio `totalSpent`.
   *
   * El `where` vuelve a llevar `pagoEstado in (...)`: entre que se calcula el
   * `where` y que corre la consulta, la webhook pudo aprobar el pedido. Sin el,
   * un pago que llego a tiempo se pisaria con un `expirado`.
   */
  const { count } = await prisma.order.updateMany({
    where: {
      pagoEstado: { in: ['no_iniciado', 'pendiente'] },
      createdAt: { lt: limite }
    },
    data: { pagoEstado: 'expirado' }
  })

  return count
}

/**
 * Arranca el cron y lo **apaga** cuando la app cierra.
 *
 * El `unref()` no es cosmetico: en Node, un `setInterval` vivo mantiene el
 * proceso abierto. Sin `unref`, el `npm test` de un archivo que arranque la app
 * **no termina nunca** —queda esperando que el intervalo se vacie— y el sintoma es
 * un test que pasa en verde y cuelga la suite.
 */
export const arrancarCronPedidos = (prisma: PrismaClient): (() => void) => {
  const intervalo = setInterval(() => {
    expirarPedidosSinPagar(prisma).catch((error: unknown) => {
      // Un fallo del cron **no** puede voltear la app: la app sigue atendiendo
      // pedidos aunque la expiracion falle. Se registra y se sigue; el proximo
      // minuto se reintenta solo.
      logger.error({ err: error }, 'el cron de expiracion fallo')
    })
  }, unMinutoEnMs)

  if (typeof intervalo.unref === 'function') intervalo.unref()

  return () => clearInterval(intervalo)
}
