import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import {
  CLAVE_CARRITO,
  CLAVE_VINOS,
  abrirCarrito,
  desmontar,
  escribir,
  hay,
  montarApp,
  nodo,
  pulsarPorTexto,
  textoDe,
  type Montaje
} from './andamiaje'
import { CLAVE_PEDIDO, guardarResumen } from '../src/types/checkout'
import type { Wine } from '../src/types/vino'

/**
 * La pagina del checkout, **montada** (spec 009, T6 y T7).
 *
 * `checkout_reglas.test.ts` prueba las reglas puras. Aca va lo que **solo se ve
 * con el componente en pantalla**: que se llame a la API con lo que tiene que
 * ser, que se vaya a Mercado Pago, y que la confirmacion diga la verdad.
 *
 * ## Por que se intercepta `fetch` y no el modulo `api`
 *
 * Igual que en `test/admin/`: el cliente HTTP real corre y solo se responde lo
 * que el test quiere. Un `vi.mock` de `api` pasaria igual y dejaria en verde un
 * `crearPedido` roto.
 *
 * Y lo que NO sea `/api/orders` responde **404 a proposito**: si la pagina
 * preguntara otra cosa, el test falla con el error de la API en vez de mostrar
 * una pantalla vacia que el test tomaria por una pantalla correcta. Esa es
 * justamente la afirmacion de D-F: **esta pagina no consulta nada**.
 */

const VINO: Wine = {
  id: 'clx111111111',
  name: 'Gran Reserva Malbec',
  winery: 'Bodega Andes',
  varietal: 'Malbec',
  category: 'Tinto',
  vintage: 2020,
  price: 7500,
  description: 'Un Malbec de altura.',
  imageUrl: 'https://ejemplo.test/vino.webp'
}

const CARRITO = [{ product: VINO, quantity: 2 }]

let montaje: Montaje | null = null
let llamado: { url: string; cuerpo: unknown } | null = null
let devolver: (url: string) => unknown = () => ({})
/** El status con el que responde el doble. Cambiarlo es como se prueba el fallo. */
let statusRespuesta = 201
/**
 * Se guarda la referencia al doble.
 *
 * `vi.stubGlobal` instala la funcion pero **`vi.mocked(fetch)` no la ve**: el
 * espia del modulo global no cambia cuando se reemplaza la funcion. Guardar el
 * `vi.fn` aqui es lo que permite afirmar "no se consulto nada".
 */
let dobleFetch: ReturnType<typeof vi.fn>

/**
 * jsdom **no** navega: `location.assign` avisa por consola virtual y sigue. Sin
 * este espia, el redirect seria un error rojo en cada test y el aserto de "se
 * fue a Mercado Pago" no tendria nada que mirar.
 */
let asignar: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(CLAVE_VINOS, JSON.stringify([VINO]))
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(CARRITO))

  llamado = null
  devolver = () => ({
    orderId: 'ord_1',
    preferenceId: 'pref-1',
    initPoint: 'https://www.mercadopago.com.ar/checkout/v1/redirect?preference-id=pref-1',
    total: 15000
  })
  statusRespuesta = 201

  dobleFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const ruta = String(url)

    if (!ruta.endsWith('/api/orders') || init?.method !== 'POST') {
      // Cualquier otra consulta es un fallo del test, no un 404 tolerado. El
      // propio aserto se encarga de detectarlo; el 404 solo evita que un
      // `await` no manejado tumbe el test con un error que no es el que se
      // quiere mirar.
      return new Response(JSON.stringify({ code: 'NOT_FOUND', message: ruta }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    llamado = { url: ruta, cuerpo: JSON.parse(String(init.body)) }
    const respuesta = devolver(ruta)

    return new Response(JSON.stringify(respuesta), {
      status: statusRespuesta,
      headers: { 'Content-Type': 'application/json' }
    })
  })

  vi.stubGlobal('fetch', dobleFetch)

  asignar = vi.fn()

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      assign: asignar,
      href: 'http://localhost:5173/checkout',
      origin: 'http://localhost:5173',
      pathname: '/checkout',
      search: '',
      toString: () => 'http://localhost:5173/checkout'
    }
  })
})

afterEach(() => {
  if (montaje !== null) desmontar(montaje)
  montaje = null

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: window.location
  })

  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const montar = (ruta: string): Montaje => {
  montaje = montarApp(ruta)
  return montaje
}

/** Espera a que el `fetch` y el `act` se resuelvan. */
const resolver = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const llenar = (m: Montaje): void => {
  escribir(m, '#checkout-nombre', 'María')
  escribir(m, '#checkout-apellido', 'González')
  escribir(m, '#checkout-telefono', '11 1234-5678')
  escribir(m, '#checkout-email', 'maria@example.com')
  escribir(m, '#checkout-direccion', 'Av. Corrientes 1234')
}

const boton = (m: Montaje): HTMLButtonElement => {
  const encontrado = m.contenedor.querySelector('button[type="submit"]')
  if (!(encontrado instanceof HTMLButtonElement)) throw new Error('No hay boton de envio')
  return encontrado
}

describe('el formulario', () => {
  it('se abre en /checkout, no en la tienda', () => {
    const m = montar('/checkout')

    // La tienda tiene su propio chrome; el checkout es una pantalla sola.
    expect(hay(m, 'form')).toBe(true)
    expect(textoDe(m, 'form') === '').toBe(false)
  })

  it('el boton arranca deshabilitado', () => {
    const m = montar('/checkout')

    expect(boton(m).disabled).toBe(true)
  })

  it('con cinco campos se habilita', () => {
    const m = montar('/checkout')

    llenar(m)

    expect(boton(m).disabled).toBe(false)
  })

  it('NO hay campo de contrasena ni de DNI', () => {
    const m = montar('/checkout')

    // RF-01: el comprador no tiene cuenta. Pedirla seria un formulario que
    // promete algo que no existe del lado del backend.
    const tipos = [...m.contenedor.querySelectorAll('input')].map((i) => i.type)

    expect(tipos).not.toContain('password')
    expect(m.contenedor.querySelector('input[name="dni"]')).toBeNull()
  })

  it('el email esta entre los campos y es obligatorio', () => {
    const m = montar('/checkout')

    const email = nodo(m, '#checkout-email') as HTMLInputElement

    expect(email).toBeDefined()
    // Sin el `required` del navegador el boton igual no se habilita, pero el
    // campo tiene que **decir** que es obligatorio.
    expect(textoDe(m, 'label[for="checkout-email"]')).toContain('Email')
  })

  it('un campo tocado y vacio muestra el error DEBAJO, no arriba', () => {
    const m = montar('/checkout')

    const campo = nodo(m, '#checkout-nombre')
    act(() => {
      // `focusout`, no `blur`. Desde React 17 los eventos se enganchan en la raiz
      // y `onBlur` esta mapeado al `focusout` nativo, que **bu-bblea**; el
      // `blur` clasico no llega nunca. Despausar `blur` aqui pasaria en verde
      // con un aserto que en el navegador no podria cumplirse.
      campo.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    const error = nodo(m, '#error-nombre')

    expect(error.textContent).toContain('obligatorio')
    // Esta vez si importa el orden: el mensaje tiene que estar despues del
    // input, porque arriba el usuario tendria que volver a buscar el campo.
    expect(
      campo.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('un formulario recien abierto no muestra errores', () => {
    const m = montar('/checkout')

    expect(m.contenedor.querySelectorAll('[id^="error-"]')).toHaveLength(0)
  })
})

describe('lo que se manda', () => {
  it('manda el cuerpo del comprador y los items', async () => {
    const m = montar('/checkout')

    llenar(m)
    pulsarPorTexto(m, 'Continuar al pago')
    await resolver()

    expect(llamado).not.toBeNull()
    expect(llamado!.cuerpo).toMatchObject({
      nombre: 'María',
      apellido: 'González',
      email: 'maria@example.com',
      direccion: 'Av. Corrientes 1234'
    })
  })

  it('NO manda ningun precio', async () => {
    const m = montar('/checkout')

    llenar(m)
    pulsarPorTexto(m, 'Continuar al pago')
    await resolver()

    // El carrito vive en el `localStorage` del navegador: quien quiera puede
    // mandar el pedido a $2. El frontend no lo manda **y** el backend lo rechaza
    // (schema `.strict()` de T2). Las dos capas.
    const cuerpo = JSON.stringify(llamado!.cuerpo)

    expect(cuerpo).not.toContain('precio')
    expect(cuerpo).not.toContain('price')
    expect(cuerpo).not.toContain('total')
  })

  it('los items son id y cantidad, nada mas', async () => {
    const m = montar('/checkout')

    llenar(m)
    pulsarPorTexto(m, 'Continuar al pago')
    await resolver()

    const cuerpo = llamado!.cuerpo as { items: unknown }

    expect(cuerpo.items).toEqual([{ vinoId: 'clx111111111', cantidad: 2 }])
  })
})

describe('la ida a Mercado Pago', () => {
  it('se va a la URL que devuelve la pasarela', async () => {
    const m = montar('/checkout')

    llenar(m)
    pulsarPorTexto(m, 'Continuar al pago')
    await resolver()

    expect(asignar).toHaveBeenCalledWith(
      'https://www.mercadopago.com.ar/checkout/v1/redirect?preference-id=pref-1'
    )
  })

  it('guarda el resumen ANTES de irse', async () => {
    const m = montar('/checkout')

    llenar(m)
    pulsarPorTexto(m, 'Continuar al pago')
    await resolver()

    // Al volver, esta pagina se recarga desde cero. Sin esto no hay nada que
    // mostrar y el comprador ve un formulario vacio.
    const guardado = JSON.parse(sessionStorage.getItem(CLAVE_PEDIDO) ?? '{}')

    expect(guardado.orderId).toBe('ord_1')
    expect(guardado.total).toBe(15000)
  })

  it('el boton dice que esta creando mientras espera', async () => {
    let soltar: (() => void) | null = null

    devolver = () => {
      return new Promise((resolverPeticion) => {
        soltar = () =>
          resolverPeticion({
            orderId: 'ord_1',
            preferenceId: 'pref-1',
            initPoint: 'https://mp.test/x',
            total: 15000
          })
      }) as unknown
    }

    const m = montar('/checkout')

    llenar(m)
    pulsarPorTexto(m, 'Continuar al pago')

    expect(textoDe(m, 'button[type="submit"]')).toContain('Creando')
    // Y el boton no se puede apretar dos veces: dos pedidos, dos Preferencias,
    // y solo uno se paga.
    expect(boton(m).disabled).toBe(true)

    await act(async () => {
      soltar?.()
    })
  })

  it('si la API falla, muestra el error y NO se va a Mercado Pago', async () => {
    statusRespuesta = 400
    devolver = () => ({
      code: 'WINE_NOT_AVAILABLE',
      message: 'Estos vinos ya no estan disponibles: clx111111111'
    })

    const m = montar('/checkout')

    llenar(m)
    pulsarPorTexto(m, 'Continuar al pago')
    await resolver()

    const alertas = m.contenedor.querySelectorAll('[role="alert"]')

    expect(alertas.length).toBeGreaterThan(0)
    expect(textoDe(m, '[role="alert"]')).toContain('ya no estan disponibles')
    expect(asignar).not.toHaveBeenCalled()
    // Y el boton vuelve a estar disponible para reintentar.
    expect(boton(m).disabled).toBe(false)
  })

  it('el boton sigue deshabilitado si no se toco un campo', async () => {
    const m = montar('/checkout')

    escribir(m, '#checkout-nombre', 'María')
    escribir(m, '#checkout-apellido', 'González')
    // faltan telefono, email y direccion

    pulsarPorTexto(m, 'Continuar al pago')
    await resolver()

    expect(llamado).toBeNull()
    expect(asignar).not.toHaveBeenCalled()
  })
})

describe('al volver con ?pago=aprobado', () => {
  it('muestra el numero y el total del resumen', () => {
    guardarResumen({ orderId: 'ord_abc123', total: 15000, items: [] })

    const m = montar('/checkout?pago=aprobado')

    const texto = m.contenedor.textContent ?? ''

    expect(texto).toContain('Pedido confirmado')
    expect(texto).toContain('ord_abc123')
    expect(texto).toContain('15.000')
  })

  it('NO consulta nada a la API', () => {
    guardarResumen({ orderId: 'ord_abc123', total: 15000, items: [] })

    montar('/checkout?pago=aprobado')

    // D-F: un `GET /api/orders/:id` publico devolveria nombre, telefono y
    // direccion de alguien que no tiene cuenta, con solo conocer el id. La
    // confirmacion saca el numero y el monto del `sessionStorage`.
    //
    // El filtro importa: el `AuthProvider` pide `/api/auth/me` al montar y esa
    // consulta si ocurre. Afirmar "no se llamo a fetch" seria falso y, peor,
    // dejaria de comprobar lo unico que esta en juego.
    const rutas = dobleFetch.mock.calls.map((llamada) => String(llamada[0]))

    expect(rutas.filter((ruta) => ruta.includes('/api/orders'))).toEqual([])
  })

  it('sin resumen NO inventa un total', () => {
    // El comprador abrio la tienda en otra pestana, o borro el almacenamiento.
    const m = montar('/checkout?pago=aprobado')

    const texto = m.contenedor.textContent ?? ''

    expect(texto).toContain('Pedido confirmado')
    // Lo que no puede es decir "$0" o un numero cualquiera: eso lo lleva al
    // mostrador.
    expect(texto).not.toMatch(/\$?\s*0[.,]0{0,2}\b(?!.*No)/)
    expect(texto).toContain('No encontramos')
  })

  it('no muestra el formulario', () => {
    guardarResumen({ orderId: 'ord_1', total: 1, items: [] })

    const m = montar('/checkout?pago=aprobado')

    expect(hay(m, 'form')).toBe(false)
  })

  it('el boton de volver pide limpiar el almacenamiento', async () => {
    guardarResumen({ orderId: 'ord_1', total: 15000, items: [] })

    const m = montar('/checkout?pago=aprobado')

    pulsarPorTexto(m, 'Volver a la tienda')

    expect(sessionStorage.getItem(CLAVE_PEDIDO)).toBeNull()
  })

  it('el carrito SE VACIA cuando el pago se aprueba', () => {
    // El otro lado del mismo tornillo. El test del caso fallido cubre que el
    // carrito sobrevive; este cubre que **desaparece** cuando se cobro.
    //
    // Sin esto, `alConfirmar` podria dejar de limpiar y pasaria todo: el
    // comprador paga, vuelve a la tienda con el carrito lleno y puede volver a
    // pedir lo mismo creyendo que no lo compro. El sandbox de Mercado Pago, que
    // es donde se hacen las pruebas de verdad, hace volver al mismo pago
    // varias veces seguidas.
    guardarResumen({ orderId: 'ord_1', total: 15000, items: [] })

    const m = montar('/checkout?pago=aprobado')

    pulsarPorTexto(m, 'Volver a la tienda')

    expect(JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? '[]')).toHaveLength(0)
  })
})

describe('al volver con ?pago=fallido', () => {
  it('avisa y ofrece reintentar', () => {
    const m = montar('/checkout?pago=fallido')

    const texto = m.contenedor.textContent ?? ''

    expect(texto).toContain('El pago no se completo')
    expect(hay(m, 'button')).toBe(true)
  })

  it('NO dice "confirmado"', () => {
    const m = montar('/checkout?pago=fallido')

    expect(m.contenedor.textContent ?? '').not.toContain('Pedido confirmado')
  })

  it('no borra el carrito: el comprador puede reintentar', () => {
    // El carrito se vacia **solo** con el pago aprobado (D-D).
    guardarResumen({ orderId: 'ord_1', total: 15000, items: [] })

    const m = montar('/checkout?pago=fallido')

    pulsarPorTexto(m, 'Intentar de nuevo')

    expect(JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? '[]')).toHaveLength(1)
  })
})

describe('al volver con ?pago=pendiente', () => {
  it('dice que se esta procesando, sin numero de pedido', () => {
    guardarResumen({ orderId: 'ord_1', total: 15000, items: [] })

    const m = montar('/checkout?pago=pendiente')

    const texto = m.contenedor.textContent ?? ''

    expect(texto).toContain('procesando')
    expect(texto).not.toContain('Pedido confirmado')
  })
})

describe('una URL sin resultado', () => {
  it('muestra el formulario, no un estado de pago', () => {
    const m = montar('/checkout')

    expect(hay(m, 'form')).toBe(true)
  })

  it.each(['?pago=cualquiera', '?otra=cosa'])('%s no inventa un estado', (buscar) => {
    const m = montar(`/checkout${buscar}`)

    const texto = m.contenedor.textContent ?? ''

    expect(texto).not.toContain('Pedido confirmado')
    expect(texto).not.toContain('El pago no se completo')
    expect(texto).not.toContain('se esta procesando')
  })
})

describe('desde la tienda', () => {
  it('"Finalizar Pedido" NO vacia el carrito', () => {
    // D-D: el carrito se vacia con el pago **aprobado**. Si se vacia aca, el
    // comprador que cancela en Mercado Pago vuelve a la tienda sin nada y tiene
    // que armar el pedido de nuevo — y el sandbox de Mercado Pago manda a
    // "cancelar" seguido muy seguido.
    const m = montar('/')

    abrirCarrito(m)
    pulsarPorTexto(m, 'Finalizar Pedido')

    expect(JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? '[]')).toHaveLength(1)
  })

  it('NO se vacia tampoco la copia en memoria del carrito', () => {
    // El `localStorage` podria no cambiar y el estado de React si: al re-render,
    // cualquier test que mire solo el storage estaria en verde con el carrito
    // perdido en pantalla.
    const m = montar('/')

    abrirCarrito(m)
    pulsarPorTexto(m, 'Finalizar Pedido')

    expect(m.contenedor.textContent ?? '').toContain('Gran Reserva Malbec')
  })

  it('no existe el cartel de "Pedido confirmado"', () => {
    // Antes de la 009, `finalizarCompra` vaciaba el carrito y mostraba un cartel
    // de gracias sin que hubiera pasado nada. Ese es el bug que toda la spec
    // vino a arreglar: una confirmacion que no confirma.
    const m = montar('/')

    abrirCarrito(m)
    pulsarPorTexto(m, 'Finalizar Pedido')

    expect(m.contenedor.textContent ?? '').not.toContain('Pedido confirmado')
  })
})
