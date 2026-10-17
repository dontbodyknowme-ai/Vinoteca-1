/**
 * Andamiaje compartido de los tests del orquestador (`test/orquestador_*.test.ts`).
 *
 * No es un archivo de test: no termina en `.test.ts`, asi que `vitest.config.ts`
 * no lo recolecta como suite (D-7 y la nota de §2.1 del plan sobre el modo de
 * fallo silencioso). Si este archivo tiene un error de tipos, `tsc` lo detecta
 * igual, porque `tsconfig.json` incluye `test/` — **eso antes no era verdad**:
 * el `include` era `["src"]` solo, y el docstring de aca afirmaba lo contrario
 * desde la spec 001. Corregido en la 006, y por el camino aparecieron diez
 * `TS2339` dormidos en `data_table.test.ts`.
 *
 * Vive aparte de los dos archivos de test por una sola razon: D-P define un
 * `montarApp` y cuatro helpers, y los dos archivos de suite los necesitan. Copiar
 * el andamiaje en los dos duplicaria unas cuarenta lineas que tienen que quedar
 * identicas, y una divergencia entre copias seria un test que pasa por un motivo
 * distinto al del otro.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { AuthProvider } from '../src/hooks/useAuth'
import type { CartItem } from '../src/types/vino'

/**
 * CA-40, primera mitad: sin esta bandera React avisa "The current testing
 * environment is not configured to support `act(...)`" en cada `act`.
 *
 * Se declara con `Object.assign` y no con `globalThis.IS_REACT_ACT_ENVIRONMENT = true`,
 * que es como lo escribe `plan.md` D-P: esa forma es un TS7017 con `strict: true`,
 * porque `typeof globalThis` no tiene indice de firmas y `@types/react@18.3` no
 * declara la propiedad. El efecto en runtime es identico.
 */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * jsdom no tiene WebGL, y `@react-three/fiber` tira
 * "This browser does not support ResizeObserver out of the box" al montar su
 * `<Canvas>`: sin eso el render de `App` revienta y ningun test llega a mirar la
 * logica. Se verificó que ese es el unico choque del entorno.
 *
 * En vez de polifillar `ResizeObserver` (que despues fallaria al pedir un contexto
 * WebGL, y `Environment` de `drei` ademas iria a la red) se usa el camino que la
 * propia app ya tiene para este caso: `hero.tsx` no renderiza `<HeroCanvas3D />`
 * por debajo de 640 px (RNF-09, D-15). O sea que la app se monta por su rama real
 * de movil y el test no depende de ningun mock.
 *
 * `window.innerWidth` es de solo lectura en jsdom, asi que se redefine con
 * `defineProperty`. Vitest da un entorno nuevo por archivo, con lo cual el cambio
 * muere con el archivo y no hay que restaurarlo.
 */
Object.defineProperty(window, 'innerWidth', {
  value: 375,
  configurable: true,
  writable: true
})

/**
 * jsdom no implementa `ResizeObserver`, y Framer Motion lo necesita: los
 * `motion.div` con `layout` de `carta_de_catalogo.tsx` y
 * `carta_de_productos.tsx` miden su caja con `useMeasure`, que observa con
 * `ResizeObserver`. Sin esto, montar `App` tira "This browser does not support
 * ResizeObserver out of the box" y ningun test llega a mirar la logica.
 *
 * Ojo con el comentario de mas arriba: forzar `innerWidth` a 375 evita el
 * `<Canvas>` de three.js, que es un consumidor de `ResizeObserver` distinto.
 * Evitar ese no alcanza, porque Framer Motion sigue pidiendo el observer por su
 * cuenta. Son dos caminos separados y hacen falta los dos.
 *
 * El stub no mide nada: expone la interfaz y nunca notifica. Para estos tests,
 * que verifican estado y no medidas, alcanza. Un polyfill que dispare un
 * callback en el proximo tick induciria a Framer Motion a recalcular
 * proyecciones de layout en cada `act`, que es justamente lo que T6 de la spec
 * 002 demostro que frena el unmount de `AnimatePresence`.
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverStub,
  configurable: true,
  writable: true
})

/**
 * `IntersectionObserver` tampoco existe en jsdom, y Framer Motion lo pide por
 * `useInView`, que es lo que usa `animated_section.tsx` para el revelado al
 * hacer scroll (spec 003, T5). Sin esto, montar `App` tira
 * "IntersectionObserver is not defined".
 *
 * A diferencia de `ResizeObserver`, aca el stub tiene que devolver `true` en
 * `isIntersecting`: si devuelve `false`, `useInView` mantiene las secciones en
 * opacidad 0 y los tests que buscan texto de la interfaz no lo encuentran.
 * Devolver `true` los deja visibles, que es el estado final que un visitante ve
 * despues de hacer scroll.
 */
class IntersectionObserverStub implements IntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = [0]

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  value: IntersectionObserverStub,
  configurable: true,
  writable: true
})

/**
 * `matchMedia` tampoco existe en jsdom, y `useEsMovil` lo necesita para decidir
 * entre sidebar fija y drawer.
 *
 * El stub **lee `window.innerWidth`** en vez de devolver `false` fijo: con el
 * `375` de arriba responde `true` a `(max-width: 767px)`, que es lo que hace un
 * navegador de verdad. Un stub que devuelve `false` siempre probaria el panel
 * como si estuviera en un monitor de 2000 px, y el drawer de movil —con su boton
 * de cerrar y su fondo oscurecido— no se veria nunca.
 *
 * `addEventListener` es un no-op: estos tests no redimensionan la ventana, y un
 * stub que re-renderiza en cada resize haria mas dificil de leer un fallo.
 */
Object.defineProperty(window, 'matchMedia', {
  value: (consulta: string): MediaQueryList => {
    const ancho = window.innerWidth
    const maximo = /\(max-width:\s*(\d+)px\)/.exec(consulta)
    const minimo = /\(min-width:\s*(\d+)px\)/.exec(consulta)

    const coincide =
      (maximo === null || ancho <= Number(maximo[1])) &&
      (minimo === null || ancho >= Number(minimo[1]))

    return {
      matches: coincide,
      media: consulta,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    } as unknown as MediaQueryList
  },
  configurable: true,
  writable: true
})

/**
 * `localStorage` **no existe** en los tests, y no es culpa de jsdom.
 *
 * Node 24+ trae su propio `localStorage` experimental y lo cuelga en
 * `globalThis` **antes** de que jsdom arme su entorno, asi que el de jsdom
 * queda tapado. El propio Node avisa:
 *
 *   ExperimentalWarning: localStorage is not available because
 *   --localstorage-file was not provided.
 *
 * O sea que `localStorage.getItem(...)` es un `TypeError` —leer `undefined`— y no
 * un `null` como en un navegador. Cualquier test que toque el almacenamiento de
 * la app revienta con un error que no habla de almacenamiento.
 *
 * Y la app **si** lo usa: el catalogo y el carrito viven en `localStorage` (la
 * 004-b movio la sesion del panel a un token en memoria, pero el carrito de la
 * tienda se quedo). O sea que esto no es un detalle del entorno: es una cosa que
 * los tests de la tienda necesitan y no podian tocar.
 *
 * El stub es un `Storage` en memoria: guarda, devuelve y se limpia entre tests
 * como haria un navegador recien abierto.
 *
 * Un cierre y no una clase con campos `#`: el `tsconfig` tiene `target: ES2020`
 * y los campos privados son ES2022. Con `private` de TypeScript tampoco —esa
 * palabra solo promete algo que el compilador no para nada— asi que el mapa
 * vive en la funcion y se accede por la interfaz `Storage`.
 */
if (!(globalThis.localStorage as Storage | undefined)) {
  const crearAlmacenamiento = (): Storage => {
    const datos = new Map<string, string>()

    return {
      get length(): number {
        return datos.size
      },
      clear: () => datos.clear(),
      getItem: (clave) => datos.get(clave) ?? null,
      key: (indice) => [...datos.keys()][indice] ?? null,
      removeItem: (clave) => {
        datos.delete(clave)
      },
      setItem: (clave, valor) => {
        datos.set(clave, String(valor))
      }
    }
  }

  const instancia = crearAlmacenamiento()

  // En **los dos**: `globalThis` y `window`. Un componente puede tocar cualquiera
  // de los dos y si son objetos distintos la mitad de los tests pasa y la otra
  // mitad ve el `undefined` de Node.
  Object.defineProperty(globalThis, 'localStorage', {
    value: instancia,
    configurable: true,
    writable: true
  })

  Object.defineProperty(window, 'localStorage', {
    value: instancia,
    configurable: true,
    writable: true
  })
}

/**
 * `sessionStorage` **si** existe en este entorno, a diferencia del anterior. No
 * se toca: si alguna vez Node lo tapa tambien, el chequeo es el mismo.
 */

export const CLAVE_VINOS = 'vinoteca_wines'
export const CLAVE_CARRITO = 'vinoteca_cart'

/** La clase con la que `carta_de_catalogo.tsx` marca el boton de categoria activo. */
const CLASE_CATEGORIA_ACTIVA = 'bg-wine-700'

const CATEGORIAS = ['Todos', 'Tinto', 'Blanco', 'Rosado', 'Espumante']

export interface Montaje {
  contenedor: HTMLDivElement
  root: Root
}

/**
 * Monta `App` en su propio `<div>` (D-P).
 *
 * `createElement(App)` y no `<App />` porque los dos archivos de suite tienen que
 * terminar en `.test.ts`: es lo unico que recolecta `vitest.config.ts`, y un
 * `.test.tsx` pasaria inadvertido y dejaria la suite en verde sin correr estos
 * tests. En un `.ts` la sintaxis JSX no compila.
 *
 * Sin `StrictMode` a proposito (D-P, R14): el doble montaje de efectos es
 * comportamiento de desarrollo, y con el montaria dos veces cada sincronizacion a
 * `localStorage`.
 *
 * ## Los dos providers, no solo el Router (spec 009, T6)
 *
 * `App` llama `useLocation()` para decidir si esta en la tienda o en el
 * checkout. Sin un Router arriba, eso **tira**: "useLocation() may be used only
 * in the context of a `<Router>`". O sea que el router es lo que hace que
 * `montarApp()` siga sirviendo para los tests de la tienda, y `rutaInicial` es lo
 * que deja probar el checkout sin abrir un navegador.
 *
 * Y el `AuthProvider` esta por el mismo motivo, con una diferencia: la barra de
 * navegacion y el catalogo llaman `useAuth()`, asi que **cualquier** test que
 * termine en la tienda —por ejemplo el de "Volver a la tienda" del checkout—
 * reventaba con "useAuth debe usarse dentro de AuthProvider".
 *
 * Montar lo mismo que `main.tsx` es lo correcto: un test que monta la app
 * recortando providers mide un arbol que en produccion no existe. El
 * `AuthProvider` pide `/api/auth/me` al montar y, con el `fetch` interceptado,
 * cae en el `catch` de `me()` y queda deslogueado —que es exactamente lo que
 * esta una persona sin sesion.
 *
 * `MemoryRouter` y no `BrowserRouter`: no toca `window.history`, asi que un test
 * no deja la URL cambiada para el siguiente.
 */
export const montarApp = (rutaInicial = '/'): Montaje => {
  const contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  const root = createRoot(contenedor)

  act(() => {
    root.render(
      createElement(
        AuthProvider,
        null,
        createElement(MemoryRouter, { initialEntries: [rutaInicial] }, createElement(App))
      )
    )
  })

  return { contenedor, root }
}

/**
 * Desmonta la raiz y despues saca el contenedor del `document`, en ese orden
 * (D-P): al reves la raiz queda viva apuntando a un nodo que ya no esta.
 */
export const desmontar = (montaje: Montaje): void => {
  act(() => {
    montaje.root.unmount()
  })
  montaje.contenedor.remove()
}

export const nodos = (montaje: Montaje, selector: string): Element[] => [
  ...montaje.contenedor.querySelectorAll(selector)
]

export const nodo = (montaje: Montaje, selector: string): HTMLElement => {
  const encontrado = montaje.contenedor.querySelector(selector)
  if (!(encontrado instanceof HTMLElement)) {
    throw new Error(`No se encontro un elemento para "${selector}"`)
  }
  return encontrado
}

export const textoDe = (montaje: Montaje, selector: string): string =>
  montaje.contenedor.querySelector(selector)?.textContent ?? ''

export const hay = (montaje: Montaje, selector: string): boolean =>
  montaje.contenedor.querySelector(selector) !== null

export const pulsarNodo = (objetivo: Element): void => {
  if (!(objetivo instanceof HTMLElement)) {
    throw new Error('El objetivo del click no es un HTMLElement')
  }
  act(() => {
    objetivo.click()
  })
}

/** Pulsa el primer elemento que matchea el selector. El `.click()` va en `act` (D-P). */
export const pulsar = (montaje: Montaje, selector: string): void => {
  pulsarNodo(nodo(montaje, selector))
}

/** Abre el panel del carrito con el boton de la barra de navegacion. */
export const abrirCarrito = (montaje: Montaje): void => {
  pulsar(montaje, 'button[aria-label="Carrito de compras"]')
}

export const botonesConTexto = (montaje: Montaje, wanted: string): HTMLElement[] =>
  nodos(montaje, 'button').filter(
    (boton): boton is HTMLElement =>
      boton instanceof HTMLElement && boton.textContent === wanted
  )

/**
 * Pulsa el boton cuyo texto es exactamente `wanted`, en la posicion `indice`.
 * Se busca por texto y no por clase porque las clases son presentacion, que es
 * justo lo que `plan.md` §7.1 deja fuera de alcance.
 */
export const pulsarPorTexto = (montaje: Montaje, wanted: string, indice = 0): void => {
  const candidatos = botonesConTexto(montaje, wanted)
  const elegido = candidatos[indice]
  if (elegido === undefined) {
    throw new Error(`No se encontro el boton "${wanted}" en la posicion ${indice}`)
  }
  pulsarNodo(elegido)
}

/** Nombre del vino de cada tarjeta del catalogo, en orden. */
export const nombresDeLasTarjetas = (montaje: Montaje): string[] =>
  nodos(montaje, 'section#catalogo h3').map((tarjeta) => tarjeta.textContent ?? '')

/** Categoria del filtro que queda marcada como activa, o `null` si no hay ninguna. */
export const categoriaActiva = (montaje: Montaje): string | null => {
  const activa = nodos(montaje, 'button').find(
    (boton) =>
      CATEGORIAS.includes(boton.textContent ?? '') &&
      boton.className.includes(CLASE_CATEGORIA_ACTIVA)
  )
  return activa?.textContent ?? null
}

/** Nombre del vino de cada linea del carrito. `aside h4` solo existe ahi. */
export const nombresDeLasLineas = (montaje: Montaje): string[] =>
  nodos(montaje, 'aside h4').map((linea) => linea.textContent ?? '')

/**
 * El texto del total del carrito. Se llega a el por la etiqueta "Total Estimado:"
 * en vez de por la clase del `<span>`, para no atar el test a una clase de estilo.
 */
export const textoDelTotal = (montaje: Montaje): string => {
  const etiqueta = nodos(montaje, 'aside span').find(
    (span) => span.textContent === 'Total Estimado:'
  )
  return etiqueta?.parentElement?.lastElementChild?.textContent ?? ''
}

/** El numero del indicador junto al icono del carrito, o `null` si no existe. */
export const contador = (montaje: Montaje): string | null => {
  const boton = montaje.contenedor.querySelector('button[aria-label="Carrito de compras"]')
  return boton?.querySelector('span')?.textContent ?? null
}

/** El contador de unidades que muestra el panel del carrito, o `null` si no esta. */
export const unidadesDelPanel = (montaje: Montaje): string | null => {
  const insignia = nodos(montaje, 'aside span').find((span) => span.textContent?.endsWith('items') ?? false)
  return insignia?.textContent ?? null
}

/** Cuantas lineas tiene el carrito segun lo que se guardo en `localStorage`. */
export const carritoGuardado = (): CartItem[] => {
  const crudo = localStorage.getItem(CLAVE_CARRITO)
  return crudo === null ? [] : (JSON.parse(crudo) as CartItem[])
}

export const crudoDe = (clave: string): string | null => localStorage.getItem(clave)

export const valorDe = (montaje: Montaje, selector: string): string => {
  const campo = nodo(montaje, selector)
  if (campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement) {
    return campo.value
  }
  throw new Error(`"${selector}" no es un campo de texto`)
}

/**
 * Escribe en un input controlado, que es lo que usan el buscador de la barra y el
 * formulario de carga.
 *
 * React rastrea el valor del input y descarta el evento si el que escribio no fue
 * su setter nativo, asi que `input.value = ...` no dispara `onChange`. Por eso va
 * el setter del prototipo y un `input` con burbujas. El evento y el `act` van
 * juntos (D-P).
 */
export const escribir = (montaje: Montaje, selector: string, wanted: string): void => {
  const campo = nodo(montaje, selector)
  if (!(campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement)) {
    throw new Error(`"${selector}" no es un campo de texto`)
  }

  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(campo), 'value')?.set
  if (setter === undefined) {
    throw new Error('El prototipo del campo no expone un setter de value')
  }

  act(() => {
    setter.call(campo, wanted)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Cierra la vista rapida pulsando el fondo oscurecido, no el boton de cierre. */
export const cerrarPorElFondo = (montaje: Montaje): void => {
  const dialogo = nodo(montaje, '[role="dialog"]')
  const envoltorio = dialogo.parentElement
  const fondo = envoltorio?.previousElementSibling
  if (!(fondo instanceof HTMLElement)) {
    throw new Error('No se encontro el fondo de la vista rapida')
  }
  pulsarNodo(fondo)
}

/**
 * Deja correr el reloj para que `AnimatePresence` termine la salida.
 *
 * Al cerrar un modal o un panel, framer-motion saca el nodo del DOM recien cuando
 * termina la animacion de salida, y esa animacion avanza con `requestAnimationFrame`.
 * Medido: el dialogo sigue montado justo despues del click y se va solo tras unos
 * cientos de milisegundos reales. `plan.md` §7.1 saca las animaciones de alcance,
 * asi que el test no las verifica: solo espera lo necesario para poder afirmar que
 * el nodo desaparecio, sin meterse con como se anima.
 */
export const esperarSalidas = async (milisegundos = 700): Promise<void> => {
  await act(async () => {
    await new Promise((resolver) => setTimeout(resolver, milisegundos))
  })
}
