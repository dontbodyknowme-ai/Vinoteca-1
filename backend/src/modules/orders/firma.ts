import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * La firma de la webhook de Mercado Pago (spec 009, T4).
 *
 * ## Que es "firmar"
 *
 * Mercado Pago manda tres headers en cada notificacion:
 *
 *   x-signature: ts=1730000000,v1=abc123...
 *   x-request-id: 1234-5678
 *
 * Y uno define como se calcula el `v1`: un **HMAC SHA256** de un texto
 * canonico, con el secreto de la webhook como clave.
 *
 * El texto canonico se arma con una plantilla que **Mercado Pago impone**:
 *
 *   `id:{data.id};request-id:{x-request-id};ts:{ts};`
 *
 * ## Por que el HMAC y no "un token que viene"
 *
 * La firma cubre **el contenido de esta notificacion**. Si el pedido cambia en
 * el camino —alguien intercepta y cambia el `data.id` por el de otro pedido— el
 * HMAC deja de coincidir. Un token fijo que Mercado Pago mandara por separado
 * solo probaria que la notificacion viene de Mercado Pago, no que diga lo que
 * dice.
 *
 * ## Comparacion en tiempo constante
 *
 * `timingSafeEqual`, y no `===`. Con `===`, comparar cadena por cadena devuelve
 * `false` en el primer caracter distinto, y el tiempo que tarda dice **cuantos**
 * caracteres correctos tenia. No es un ataque remoto facil, pero no cuesta nada
 * usar la funcion que existe para esto.
 *
 * **Y solo si las dos cadenas miden lo mismo**: `timingSafeEqual` tira si los
 * buffers tienen distinta longitud, y eso seria un `500` en vez de un `401`.
 */

/** El texto que Mercado Pago manda hashear. El orden lo pone el, no nosotros. */
export const plantillaDelManifest = (datos: {
  id: string
  requestId: string
  ts: string
}): string => `id:${datos.id};request-id:${datos.requestId};ts:${datos.ts};`

/** Desarma `ts=...,v1=...`. Viene como un solo header con dos partes. */
export const leerCabeceraFirma = (valor: string | undefined): { ts: string; v1: string } | null => {
  if (valor === undefined) return null

  const partes = new Map<string, string>()
  for (const trozo of valor.split(',')) {
    const [clave, ...resto] = trozo.trim().split('=')
    if (clave === undefined || resto.length === 0) continue
    partes.set(clave.trim(), resto.join('=').trim())
  }

  const ts = partes.get('ts')
  const v1 = partes.get('v1')

  if (ts === undefined || v1 === undefined) return null
  return { ts, v1 }
}

/**
 * Verifica la firma de una notificacion.
 *
 * El `id` llega como parametro y no se relee del cuerpo aca. No es purismo: es
 * que la firma cubre precisamente el `data.id`, asi que **el mismo valor** tiene
 * que entrar en el texto canonico y en la busqueda del pedido. Si cada uno lo
 * sacara del cuerpo por su cuenta, cada uno podria estar mirando algo distinto.
 */
export const verificarFirmaWebhook = (
  cabeceras: Record<string, string | undefined>,
  id: string | undefined,
  secreto: string
): boolean => {
  if (id === undefined) return false

  const firma = leerCabeceraFirma(cabeceras['x-signature'])
  const requestId = cabeceras['x-request-id']

  if (firma === null || requestId === undefined || requestId === '') return false

  const esperado = createHmac('sha256', secreto)
    .update(plantillaDelManifest({ id, requestId, ts: firma.ts }))
    .digest('hex')

  const a = Buffer.from(esperado, 'utf8')
  const b = Buffer.from(firma.v1.toLowerCase(), 'utf8')

  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

/** Firma una notificacion. Sirve para los tests y para probar en local. */
export const firmarWebhook = (
  datos: { id: string; requestId: string; ts: string },
  secreto: string
): string =>
  `ts=${datos.ts},v1=${createHmac('sha256', secreto)
    .update(plantillaDelManifest(datos))
    .digest('hex')}`
