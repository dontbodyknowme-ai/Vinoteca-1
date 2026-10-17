import type { PrismaClient } from '@prisma/client'
import { orderCreateSchema, type OrderCreateInput } from '../../shared/schemas.js'
import { AppError } from '../../utils/errors.js'
import { obtenerProveedor } from '../pagos/proveedor.js'

/**
 * Crear un pedido desde el checkout (spec 009, T3).
 *
 * Vive aparte de `routes.ts` a proposito: el modulo de pedidos tiene una sola
 * logica —leer y cambiar estados desde el panel— y esta es otra, con reglas
 * distintas. `routes.ts` traduce HTTP; aca pasan las cosas.
 */

/** El `P2002` de Prisma: violacion de una restriccion unica. */
const ES_UNIQUE = 'P2002'

export interface ResultadoCheckout {
  orderId: string
  preferenceId: string
  initPoint: string
  total: number
}

/** El origen publico del frontend, para armar las `back_urls`. */
const origenPublico = (): string => process.env.PUBLIC_API_URL ?? ''

/**
 * Resuelve el `Customer` del comprador (D-9).
 *
 * **Busca por email en minusculas**; si existe, reutiliza la ficha y le actualiza
 * el telefono; si no, crea una.
 *
 * ## Por que el `P2002` no se ignora
 *
 * Dos checkouts del mismo email al mismo tiempo: los dos buscan, los dos no
 * encuentran, los dos insertan, y **uno se lleva una violacion de unico**.
 *
 * Lo tipico seria dejar que reviente: el 500 le diria al comprador que "algo
 * fallo" y no tendria forma de reintentar sin perder el carrito. Ademas el
 * `P2002` puede venir por **cualquier** unico de la tabla —una clave ajena que
 * quedara—there que no es una carrera y no se debe reintentar.
 *
 * Por eso se mira **que** unico salto: si fue `Customer.email`, es la carrera y
 * se reintenta la busqueda; cualquier otro `P2002` se propaga.
 */
const resolverCustomer = async (
  prisma: PrismaClient,
  entrada: OrderCreateInput
): Promise<{ id: string }> => {
  const buscar = () =>
    prisma.customer.findUnique({ where: { email: entrada.email }, select: { id: true } })

  const nombreCompleto = `${entrada.nombre} ${entrada.apellido}`.trim()

  const existente = await buscar()
  if (existente !== null) {
    // El telefono es el unico dato que se corrige solo: la persona lo escribe
    // de otra forma cada vez y el CRM necesita la ultima version.
    await prisma.customer.update({
      where: { id: existente.id },
      data: { phone: entrada.telefono }
    })
    return existente
  }

  try {
    const creado = await prisma.customer.create({
      data: {
        name: nombreCompleto,
        email: entrada.email,
        phone: entrada.telefono
      },
      select: { id: true }
    })
    return creado
  } catch (error: unknown) {
    if (!esViolacionDeUnicoEn(error, 'email')) throw error

    // Carrera: otro checkout creo la ficha entre nuestra busqueda y nuestro
    // insert. Reintentamos la busqueda. Si tampoco lo encontramos, la exception
    // original es la que explica el problema.
    const despuesDeLaCarrera = await buscar()
    if (despuesDeLaCarrera === null) throw error
    return despuesDeLaCarrera
  }
}

/**
 * ¿Este error es la violacion de unicidad de **este** campo?
 *
 * El campo es **obligatorio** y no opcional a proposito: la primera version lo
 * tenia opcional y se llamaba sin argumento, asi que `campo === undefined`
 * devolvia `true` para **cualquier** `P2002`. El efecto era que un conflicto de
 * otra columna se tomaba por una carrera, se reintentaba la busqueda, y el
 * error real quedaba escondido dos operaciones mas adentro. Un parametro que
 * uno se puede olvidar es un parametro que uno se olvida; que lo obligatorio lo
 * convierta en un error de compilacion.
 */
const esViolacionDeUnicoEn = (error: unknown, campo: string): boolean => {
  if (typeof error !== 'object' || error === null) return false

  const codigo = (error as { code?: unknown }).code
  if (codigo !== ES_UNIQUE) return false

  // `meta.target` viene como array de columnas (`['email']`) en unas versiones y
  // como nombre de la restriccion (`'Customer_email_key'`) en otras. Se cubren
  // las dos comparando en minusculas.
  const meta = (error as { meta?: { target?: unknown } }).meta
  const objetivo = Array.isArray(meta?.target)
    ? meta?.target.join(',')
    : String(meta?.target ?? '')

  return objetivo.toLowerCase().includes(campo.toLowerCase())
}

/** Un vino que el cliente pidio y no existe, o esta dado de baja. */
export class VinoNoDisponible extends AppError {
  constructor(vinos: string[]) {
    super(
      'WINE_NOT_AVAILABLE',
      400,
      `Estos vinos ya no estan disponibles: ${vinos.join(', ')}`
    )
  }
}

/**
 * Los estados de Mercado Pago que nos importan, y a que estado nuestro.
 *
 * `in_process`, `authorized`, `pending`, `cancelled` y los que no estan aca
 * **dejan el pedido donde esta**: no son un fallo y no son un pago. Pasarlos a
 * `rechazado` seria mentir —el comprador puede estar esperando que el banco lo
 * confirme— y pasar a `aprobado` seria peor.
 *
 * Cuando el pago vuelve a `pending` despues de `in_process`, que es lo normal,
 * el pedido queda en `pendiente` y el cron lo expira si no se concreta.
 */
const ESTADO_REMOTO_A_NUESTRO: Record<string, 'aprobado' | 'rechazado' | 'pendiente'> = {
  approved: 'aprobado',
  rejected: 'rechazado',
  cancelled: 'rechazado',
  charged_back: 'rechazado',
  pending: 'pendiente',
  in_process: 'pendiente',
  authorized: 'pendiente'
}

/**
 * Aplica un pago informado por la webhook (spec 009, T4).
 *
 * ## El estado NO viene del cuerpo de la webhook
 *
 * La notificacion dice *qué* cambio, no *en qué estado está*. Por eso se consulta
 * `GET /v1/payments/:id` a Mercado Pago. Si nos fiáramos del cuerpo, cualquiera
 * que descubra la URL mandaria `{ data: { id: <un pedido real> } }` con lo que
 * quiera adentro.
 *
 * ## Idempotencia: no hay "ya estaba aplicado"
 *
 * Mercado Pago **reintenta**, y el error tipico es sumar el total al `Customer`
 * dos veces. La forma tipica de evitarlo —leer el pedido, ver si ya esta
 * `aprobado`, y salir— tiene una carrera: dos notificaciones al mismo tiempo
 * leen las dos "no aprobado" y las dos suman.
 *
 * Por eso la transicion la hace **un unico `updateMany` condicional**, que en
 * Postgres es atomico: `WHERE pagoEstado <> 'aprobado'`. Solo el que cambia la
 * fila recibe `count === 1`, y solo ese toca el `Customer`. Los demas no tienen
 * que preguntar nada: el numero de filas afectadas lo dice.
 */
export const aplicarPago = async (
  prisma: PrismaClient,
  pagoId: string
): Promise<{ aplicado: boolean; estado: string }> => {
  // 1. El estado real, de la pasarela.
  const remoto = await obtenerProveedor().estadoDe(pagoId)

  const destino = ESTADO_REMOTO_A_NUESTRO[remoto.estado]
  if (destino === undefined) {
    // Un estado que no conocemos no se traduce: el pedido se queda como esta y
    // se responde 200. Devolver 4xx/5xx haria que Mercado Pago reintentara una
    // notificacion que no vamos a entender nunca.
    return { aplicado: false, estado: remoto.estado }
  }

  // 2. El pedido, por `pagoId`. Es la llave que puso el checkout.
  const pedido = await prisma.order.findUnique({
    where: { pagoId },
    select: { id: true, customerId: true, total: true, pagoEstado: true }
  })

  if (pedido === null) {
    // Una notificacion de un pago que no es nuestro, o de una Preference vieja
    // que ya expiro. No es un error que haya que reportar.
    return { aplicado: false, estado: remoto.estado }
  }

  // 3. La transicion, atomica.
  const transicion = await prisma.order.updateMany({
    where: { id: pedido.id, pagoEstado: { not: destino } },
    data: { pagoEstado: destino }
  })

  if (transicion.count === 0) {
    // Ya estaba en ese estado. **No** se toca el `Customer` ni se agrega una
    // segunda entrada al historial: una reentrega no es un segundo pago.
    return { aplicado: false, estado: destino }
  }

  await prisma.orderTimeline.create({
    data: { orderId: pedido.id, pagoEstado: destino, origen: 'Mercado Pago' }
  })

  // 4. Las metricas del cliente, **solo** al aprobar. Un rechazo no suma
  //    `totalSpent` ni `totalOrders`: el comprador no compro.
  if (destino === 'aprobado') {
    await prisma.customer.update({
      where: { id: pedido.customerId },
      data: {
        totalOrders: { increment: 1 },
        totalSpent: { increment: pedido.total },
        lastOrderAt: new Date()
      }
    })
  }

  return { aplicado: true, estado: destino }
}

export const crearPedido = async (
  prisma: PrismaClient,
  cuerpo: unknown,
  webhookUrl: string
): Promise<ResultadoCheckout> => {
  // El schema **ya** rechazo los precios que vengan de mas (T2). Aca no se los
  // vuelve a mirar: no hay `precioUnitario` en el tipo, no hay de donde sacarlo.
  const entrada = orderCreateSchema.parse(cuerpo)

  const ids = [...new Set(entrada.items.map((item) => item.vinoId))]

  const vinos = await prisma.wine.findMany({
    where: { id: { in: ids }, activo: true },
    select: { id: true, name: true, price: true, stock: true }
  })

  const porId = new Map(vinos.map((vino) => [vino.id, vino]))

  const faltantes = ids.filter((id) => !porId.has(id))
  if (faltantes.length > 0) throw new VinoNoDisponible(faltantes)

  /**
   * El total sale de aca, de `Wine.price`, y es **el mismo numero** que se
   * guarda en `Order.total` y el que se manda a Mercado Pago.
   *
   * No se calculan por separado a proposito: si difirieran aunque sea un peso,
   * la webhook podria aprobar un monto que el panel nunca muestra, que es
   * exactamente el tipo de mentira que esta spec vino a arreglar.
   */
  const lineas = entrada.items.map((item) => {
    const vino = porId.get(item.vinoId)!

    return {
      vinoId: vino.id,
      nombre: vino.name,
      cantidad: item.cantidad,
      precioUnitario: vino.price
    }
  })

  const total = lineas.reduce((suma, linea) => suma + linea.precioUnitario * linea.cantidad, 0)

  if (total <= 0) {
    throw new AppError('EMPTY_ORDER', 400, 'El pedido no tiene monto')
  }

  const cliente = await resolverCustomer(prisma, entrada)

  /**
   * El pedido se crea **antes** de la Preference.
   *
   * Al reves —Preference y despues pedido— `external_reference` no tendria que
   * mandar, porque el id del pedido todavia no existe. Y el orden importa por el
   * fallo: si la Preference falla queda un pedido en `no_iniciado` sin
   * `pagoId`, que expira a los 10 minutos y el cron lo marca `expirado`. Eso es
   * correcto, y ademas deja el rastro de que alguien **intento** comprar.
   *
   * Al reves, si la Preference falla no queda nada, y el comprador solo ve un
   * error.
   */
  const pedido = await prisma.order.create({
    data: {
      customerId: cliente.id,
      total,
      shippingAddress: { direccion: entrada.direccion },
      items: {
        create: lineas.map((linea) => ({
          wineId: linea.vinoId,
          quantity: linea.cantidad,
          // El precio congelado **de la base**, no el que mandaba el cliente y no
          // el de hoy: es el que se cobró.
          price: linea.precioUnitario
        }))
      }
    },
    select: { id: true }
  })

  const origen = origenPublico()
  const preference = await obtenerProveedor().crearPreference({
    pagador: {
      nombre: entrada.nombre,
      apellido: entrada.apellido,
      email: entrada.email,
      telefono: entrada.telefono,
      direccion: entrada.direccion
    },
    lineas,
    total,
    urls: {
      exito: `${origen}/?pago=aprobado`,
      fallo: `${origen}/?pago=fallido`,
      pendiente: `${origen}/?pago=pendiente`,
      webhook: webhookUrl
    },
    referencia: pedido.id
  })

  await prisma.order.update({
    where: { id: pedido.id },
    data: { pagoId: preference.id }
  })

  return {
    orderId: pedido.id,
    preferenceId: preference.id,
    initPoint: preference.initPoint,
    total
  }
}
