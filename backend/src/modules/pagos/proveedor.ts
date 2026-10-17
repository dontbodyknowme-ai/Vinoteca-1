/**
 * Mercado Pago, aislado detrás de una interfaz (spec 009, T3).
 *
 * ## Por que una interfaz y no llamadas sueltas a `fetch`
 *
 * El 90 % de T3 —resolver el `Customer`, calcular el total desde `Wine.price`,
 * capturar la carrera del `P2002`, crear el pedido— **no necesita Mercado Pago**.
 * Lo unico que necesita la pasarela es el `preferenceId`.
 *
 * Si el `fetch` a `api.mercadopago.com` estuviera escrito en el handler, esos
 * tests tambien necesitarian la pasarela: sin access token no hay Preference,
 * sin Preference no hay `POST /api/orders` que probar, y la unica forma de
 * probarlo seria contra produccion con plata de verdad.
 *
 * Con la interfaz, el handler depende de `ProveedorPagos` y los tests usan un
 * doble. **El doble se registra en `configurarProveedor`** asi que el handler
 * usa **el mismo camino de codigo** que en produccion: no hay una rama
 * "si estamos en test".
 *
 * ## Lo que sigue sin poder probarse
 *
 * Que Mercado Pago acepte la Preference. Eso necesita una credencial real y se
 * verifica recien cuando exista —es T3 a medias, y lo anoto en `task.md`.
 */

/** Lo que el checkout necesita saber del comprador, ya validado y normalizado. */
export interface DatosPagador {
  nombre: string
  apellido: string
  email: string
  telefono: string
  direccion: string
}

/** Una linea del pedido, **con el precio ya resuelto desde la base**. */
export interface LineaPagada {
  vinoId: string
  nombre: string
  cantidad: number
  /** Pesos enteros, leido de `Wine.price`. Nunca del cliente. */
  precioUnitario: number
}

/**
 * Lo unico que la pasarela necesita saber, y **nada mas**.
 *
 * Notar que no viaja el pedido: Mercado Pago no necesita el id de nuestro
 * pedido, y mandarselo seria poner nuestra informacion interna en un cuerpo que
 * viaja por internet. La relacion se hace al reves, en T4, con `pagoId`.
 */
export interface SolicitudPreference {
  pagador: DatosPagador
  lineas: LineaPagada[]
  /** El total ya calculado por el backend. Mercado Pago lo vuelve a sumar. */
  total: number
  /**
   * A donde vuelve el comprador y donde notifica Mercado Pago.
   *
   * `webhook` es la direccion **del backend**, no la del frontend: es la unica
   * que Mercado Pago puede llamar sin sesion de nadie. Sin ella, el estado del
   * pago solo se actualiza si el comprador vuelve a la tienda, que es
   * justamente lo que T4 viene a evitar.
   */
  urls: { exito: string; fallo: string; pendiente: string; webhook: string }
  /** Id del pedido. Va en `external_reference` para poder cruzar los logs. */
  referencia: string
}

/**
 * Lo que devuelve Mercado Pago.
 *
 * `initPoint` es la URL a la que hay que mandar al comprador. No se construye
 * a mano con un template: Mercado Pago devuelve la URL exacta y **cambia el
 * formato segun la region y la version de la API**. Armarla a mano es la forma
 * de que un dia deje de funcionar sin que nada haya cambiado del lado nuestro.
 */
export interface PreferenceCreada {
  id: string
  initPoint: string
}

/**
 * El contrato del proveedor de pagos.
 *
 * `estadoDe(pagoId)` lo usa la webhook (T4) y es la pieza que hace que el
 * estado del pago **nunca** se lea del cuerpo de la notificacion: se pregunta
 * a Mercado Pago.
 */
export interface ProveedorPagos {
  crearPreference(solicitud: SolicitudPreference): Promise<PreferenceCreada>
  estadoDe(pagoId: string): Promise<EstadoPagoRemoto>
}

/** Lo que Mercado Pago responde cuando se pregunta por un pago. */
export interface EstadoPagoRemoto {
  id: string
  /** `approved`, `rejected`, `pending`, `in_process`, `cancelled`… */
  estado: string
  monto: number
  fechaAprobacion: string | null
}

/**
 * El doble que usan los tests.
 *
 * Registra lo que se le pidio, para que un test pueda afirmar **que se le paso a
 * Mercado Pago**, que es distinto de afirmar que el pedido quedo bien guardado.
 * Un `preferenceId` fijo que el test no inspecciona no verifica nada de la
 * integracion.
 */
export class ProveedorPagosFalso implements ProveedorPagos {
  readonly solicitudes: SolicitudPreference[] = []
  readonly consulted: string[] = []

  /** Se puede romper a proposito, para probar que el checkout degrada bien. */
  fallaAlCrear: Error | null = null
  estados: Record<string, EstadoPagoRemoto> = {}

  async crearPreference(solicitud: SolicitudPreference): Promise<PreferenceCreada> {
    this.solicitudes.push(solicitud)
    if (this.fallaAlCrear !== null) throw this.fallaAlCrear

    return {
      id: `pref-falsa-${this.solicitudes.length}`,
      initPoint: `https://www.mercadopago.com.ar/checkout/v1/redirect?preference-id=pref-falsa-${this.solicitudes.length}`
    }
  }

  async estadoDe(pagoId: string): Promise<EstadoPagoRemoto> {
    this.consulted.push(pagoId)
    const estado = this.estados[pagoId]
    if (estado === undefined) throw new Error(`el doble no conoce el pago ${pagoId}`)
    return estado
  }
}

/**
 * El proveedor que se usa cuando no se registro otro.
 *
 * `throw` y no un `return` mudo: si se llegara aca, el checkout crearia pedidos
 * sin Preference y **nadie se enteraria**, porque la unica senal seria que
 * Mercado Pago nunca devuelve el pago y el pedido expira a los 10 minutos sin
 * explicacion. Un error explicito en el arranque es mejor.
 */
const SIN_CONFIGURAR: ProveedorPagos = {
  async crearPreference() {
    throw new Error('Mercado Pago no esta configurado')
  },
  async estadoDe(pagoId: string) {
    throw new Error(`Mercado Pago no esta configurado (pago ${pagoId})`)
  }
}

let proveedor: ProveedorPagos = SIN_CONFIGURAR

export const configurarProveedor = (nuevo: ProveedorPagos): void => {
  proveedor = nuevo
}

export const obtenerProveedor = (): ProveedorPagos => proveedor

/** El proveedor real. Se crea una sola vez y solo si hay token. */
export const proveedorMercadoPago = (accessToken: string, baseUrl?: string): ProveedorPagos => {
  const base = baseUrl ?? 'https://api.mercadopago.com'

  const pedir = async <T>(ruta: string, metodo: string, cuerpo?: unknown): Promise<T> => {
    const respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: {
        // El token va solo en el header `Authorization`, **nunca en el cuerpo ni
        // en la query**: una query_string termina en los logs del servidor y en
        // el historial del proxy.
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    })

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '')
      throw new Error(`Mercado Pago respondio ${respuesta.status} en ${ruta}: ${detalle.slice(0, 200)}`)
    }

    return (await respuesta.json()) as T
  }

  return {
    async crearPreference(solicitud) {
      const respuesta = await pedir<{
        id: string
        init_point: string
      }>('/checkout/preferences', 'POST', cuerpoDePreference(solicitud))

      return { id: respuesta.id, initPoint: respuesta.init_point }
    },

    async estadoDe(pagoId) {
      const respuesta = await pedir<{
        id: number
        status: string
        transaction_amount: number
        date_approved: string | null
      }>(`/v1/payments/${encodeURIComponent(pagoId)}`, 'GET')

      return {
        id: String(respuesta.id),
        estado: respuesta.status,
        monto: respuesta.transaction_amount,
        fechaAprobacion: respuesta.date_approved
      }
    }
  }
}

/**
 * Arma el cuerpo de la Preference.
 *
 * Exportado aparte para poder verificarlo sin red: el **formato de la direccion**
 * es donde esto falla, porque Mercado Pago **rechaza** la Preference si no viene
 * `street_name` / `street_number` / `city_name` / `zip_code`, y manda la direccion
 * entera como texto no pasa.
 *
 * ## La direccion se parte a mano, y por que
 *
 * Mercado Pago no parsea `"Av. Corrientes 1234, Buenos Aires"`. Pide el callejon
 * y el numero por separado. Como el checkout pide una sola linea de texto, hay
 * que partirla aca, y **esa particion es una decision**, no un parseo: se toma
 * el ultimo grupo de digitos como numero y el resto como callejon.
 *
 * Lo que **no** se inventa: ciudad y codigo postal no se deducen de una linea de
 * texto. Si no vienen, se mandan vacios y es Mercado Pago el que decide si los
 * necesita para el medio de pago elegido —no para todos. Adivinarlos seria
 * mandar la direccion a otra provincia.
 */
export interface DireccionPartida {
  street_name: string
  street_number: string
  city_name: string
  zip_code: string
}

export const partirDireccion = (direccion: string): DireccionPartida => {
  const limpio = direccion.trim().replace(/\s+/g, ' ')

  /**
   * El **primer** grupo de digitos es el numero de calle.
   *
   * La primera version buscaba el numero **al final**, que es lo que se escribe
   * de memoria, y fallaba con `Av. Santa Fe 2500, Piso 3`: tomaba el `3` —el
   * piso— como numero de calle y mandaba "Av. Santa Fe 2500, Piso" a Mercado
   * Pago. El numero de calle va **despues** del nombre y antes del piso, asi que
   * el primero que aparece es el correcto.
   *
   * ## Que esto NO resuelve
   *
   * Es una **heuristica** sobre texto libre, no un parser de direcciones. Para
   * una linea como `Ruta 8 Km 45` no hay respuesta correcta. Se prefiere una
   * heuristica explicita y testeada antes que un parser que adivina: el dia que
   * Mercado Pago exija separar de verdad, el checkout tiene que pedir callejon y
   * numero por separado (RF-02 pide una sola linea hoy), y aca eso se cambia en
   * un solo lugar.
   */
  const conNumero = /^([^\d]*?)\s*(?:n[°ºo]\.?)?\s*(\d+[A-Za-z]?)/.exec(limpio)

  const streetName = conNumero !== null ? conNumero[1].trim() : limpio
  const streetNumber = conNumero !== null ? conNumero[2] : ''

  return {
    street_name: streetName,
    street_number: streetNumber,
    // Vacio a proposito: ver el comentario de arriba.
    city_name: '',
    zip_code: ''
  }
}

/**
 * Arma el cuerpo de la Preference.
 *
 * **Exportada** y no privados: es el contrato con la pasarela, y un test que
 * **reconstruya** el cuerpo en vez de importarlo estaria probando su propia copia
 * —pasaria en verde aunque el codigo real mandara otra cosa. Lo mismo aplica al
 * token: el test tiene que ver el `fetch` que se hace de verdad.
 */
export const cuerpoDePreference = (s: SolicitudPreference): Record<string, unknown> => {
  const direccion = partirDireccion(s.pagador.direccion)

  return {
    items: s.lineas.map((linea) => ({
      id: linea.vinoId,
      title: linea.nombre,
      quantity: linea.cantidad,
      unit_price: linea.precioUnitario,
      currency_id: 'ARS'
    })),
    payer: {
      name: s.pagador.nombre,
      surname: s.pagador.apellido,
      email: s.pagador.email,
      phone: { number: s.pagador.telefono },
      address: direccion
    },
    /**
     * **Las dos tarjetas.** Con solo `credit_card` excluida, la **debito** sigue
     * apareciendo —y RF-04 dice que no haya tarjetas. Es el mismo bug de "una
     * condicion a medias": el checkout dice "sin tarjeta" y el comprador igual
     * puede pagar con una.
     */
    payment_methods: {
      excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }]
    },
    back_urls: {
      success: s.urls.exito,
      failure: s.urls.fallo,
      pending: s.urls.pendiente
    },
    external_reference: s.referencia,
    notification_url: s.urls.webhook,
    auto_return: 'approved'
  }
}
