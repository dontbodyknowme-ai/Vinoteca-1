import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TIENDA } from '../src/utils/tienda'

/**
 * La marca dice lo mismo **en todas partes**.
 *
 * ## Que paso
 *
 * El rebranding a 2920 se hizo en el logo, el hero, el pie y el `title` de
 * `index.html`. `TIENDA.nombre` se quedo en `'Cava & Co'` — y ese es el valor que
 * muestra **Configuracion**, o sea que un admin entrando al panel veia el nombre
 * viejo de la tienda. Y el drawer de movil no mostraba ningun nombre, asi que
 * "cual es el nombre del drawer" era una pregunta sin respuesta: no habia texto
 * que cambiar, habia que agregarlo.
 *
 * ## Por que un test y no "acordarse de buscarlo"
 *
 * Porque el rebranding se aplica en los lugares **que se ven** mirando la tienda.
 * El que nadie mira queda atras, y el unico que se entera es quien entra al
 * panel. Es exactamente el orden en que fallan las cosas: primero lo invisible,
 * despues lo que solo ve el admin.
 *
 * ## Que no puede hacer este test
 *
 * `index.html` es estatico y se sirve **antes** de que corra JavaScript, asi que
 * su `<title>` no puede salir de `TIENDA.nombre`. Lo unico que se puede es que
 * este test los compare y falle si se separan. Por eso compara en vez de
 * importar.
 */

const RAIZ = join(__dirname, '..')
const leer = (relativo: string): string => readFileSync(join(RAIZ, relativo), 'utf8')

/** Todos los `.ts`/`.tsx` de un directorio, con ruta relativa a la raiz. */
const archivosDe = (relativo: string): string[] => {
  const base = join(RAIZ, relativo)
  const encontrados: string[] = []

  for (const entrada of readdirSync(base, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      encontrados.push(...archivosDe(join(relativo, entrada.name)))
    } else if (/\.tsx?$/.test(entrada.name)) {
      encontrados.push(join(relativo, entrada.name).replace(/\\/g, '/'))
    }
  }

  return encontrados
}

describe('la marca es una sola', () => {
  it('`TIENDA.nombre` es el nombre de la tienda', () => {
    expect(TIENDA.nombre).toBe('2920')
  })

  it('el `<title>` de index.html dice lo mismo', () => {
    // Sin esto, el nombre del primer Thing que ve cualquiera al abrir la pagina
    // puede ser distinto del que dice el panel.
    const html = leer('index.html')
    const titulo = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ''

    expect(titulo).toContain(TIENDA.nombre)
  })

  it('el nombre de la barra NO esta escrito a mano', () => {
    // La barra tiene que leer `TIENDA.nombre`. Con el texto pegado, el
    // rebranding la deja atras y no hay forma de que el test lo note.
    const fuente = leer('src/components/barra_de_navegacion.tsx')

    expect(fuente).toContain('TIENDA.nombre')
    expect(fuente).not.toMatch(/>\s*2920\s*</)
  })

  it('el nombre del pie NO esta escrito a mano', () => {
    const fuente = leer('src/components/pie_de_pagina.tsx')

    expect(fuente).toContain('TIENDA.nombre')
    expect(fuente).not.toMatch(/>\s*2920\s*</)
  })

  it('el `alt` del logo NO esta escrito a mano', () => {
    // El `alt` es lo que lee un lector de pantalla y lo que se ve si la imagen no
    // carga. Un `alt` con el nombre viejo es peor que ninguno.
    for (const archivo of [
      'src/components/barra_de_navegacion.tsx',
      'src/components/hero.tsx'
    ]) {
      const fuente = leer(archivo)

      expect(fuente, archivo).not.toMatch(/alt=['"]2920['"]/)
    }
  })

  it('no queda el nombre viejo en NINGUN archivo de src/', () => {
    // La asercion que habria atrapado el bug original.
    //
    // Recorre **todos** los archivos, no una lista a mano: una lista escrita a
    // mano se desactualiza sola y el test sigue verde porque solo mira lo que
    // alguien se acordo de anotarle.
    //
    // Solo mira el **codigo**, no los comentarios: los comentarios mencionan el
    // nombre viejo justamente para explicar que se cambio, y buscarlos ahi
    // haria el test inutil.
    //
    // Y busca el **nombre**, no el dominio: `hola@cava-co.com` sigue en
    // `TIENDA.email` y es otra decision — un dominio de correo puede tener
    // el nombre para siempre, y cambiarlo manda los mensajes del pie a otro
    // lado. Esa queda como pregunta, no como error.
    const culpable = archivosDe('src').filter((archivo) => {
      const codigo = leer(archivo)
        .split('\n')
        .filter((linea) => !linea.trim().startsWith('*') && !linea.trim().startsWith('//'))
        .join('\n')

      return /Cava\s*&\s*Co|Cava\s+y\s*Co|CavaAndCo|Cava\s*Co\./i.test(codigo)
    })

    expect(culpable).toEqual([])
  })

  it('el email de contacto tiene la forma de un email', () => {
    // Lo unico que se afirma del dominio viejo. **No** se cambia solo: puede
    // tener el dominio para siempre, y cambiarlo manda los mensajes del pie a
    // otro lado sin avisar. Es una pregunta para el usuario.
    expect(TIENDA.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  })
})

describe('el drawer de movil', () => {
  const fuente = () => leer('src/components/barra_de_navegacion.tsx')

  it('muestra el nombre de la tienda', () => {
    // Antes decia solo "Navegacion": en el telefono no se sabia de que tienda
    // era el menu que se abria.
    const texto = fuente()

    expect(texto).toContain('TIENDA.nombre')
    expect(texto).toMatch(/alt=\{TIENDA\.nombre\}/)
  })

  it('el nombre del drawer esta en el `dialog`, no en el `nav` de los links', () => {
    // Si quedara adentro del `<nav>`, un lector de pantalla anunciaria el
    // nombre de la tienda como si fuera uno de los links de navegacion.
    const texto = fuente()

    const dialogo = texto.indexOf("aria-label='Menú de navegación'")
    const nav = texto.indexOf('aria-label=\'Navegación\'')

    expect(dialogo).toBeGreaterThan(-1)
    expect(nav).toBeGreaterThan(dialogo)
    // El nombre aparece **antes** del nav que se arma con `TIENDA.nombre`.
    const nombre = texto.indexOf('TIENDA.nombre', dialogo)

    expect(nombre).toBeGreaterThan(-1)
    expect(nombre).toBeLessThan(nav)
  })

  it('el `nav` de los links tiene nombre accesible propio', () => {
    // `Navegacion` paso a ser un `<h2>` de seccion, asi que el `nav` necesita su
    // propio `aria-label`: sin el, el lector de pantalla anuncia dos listas sin
    // decir de que son.
    expect(fuente()).toContain("aria-label='Navegación'")
  })
})
