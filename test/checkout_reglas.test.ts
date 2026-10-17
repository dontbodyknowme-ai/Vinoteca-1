import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CAMPOS_VACIOS,
  erroresDe,
  estaCompleto,
  type DatosDelFormulario
} from '../src/components/checkout/formulario'
import {
  CLAVE_PEDIDO,
  borrarResumen,
  guardarResumen,
  leerResumen,
  resultadoDeLaUrl
} from '../src/types/checkout'
// Sin este import, `localStorage` no existe: Node 24+ cuelga el suyo
// experimental y tapa el de jsdom (ver el comentario en `andamiaje.ts`).
import './andamiaje'

/**
 * El checkout del lado del cliente (spec 009, T6 y T7).
 *
 * ## Que se prueba aca y que no
 *
 * Lo que se puede afirmar **sin montar**: que el boton exige los cinco campos,
 * que el resumen sobrevive al viaje a Mercado Pago, que se lee de
 * `sessionStorage` y no de la red, y que un resumen roto no inventa un total.
 *
 * Lo que necesita el componente montado —el `fetch`, el redirect, los mensajes en
 * pantalla— se verifica en `checkout_pagina.test.ts`.
 *
 * ## Por que estas funciones puras existen
 *
 * `estaCompleto` y `erroresDe` estan **exportadas** y no viven metidas en el
 * componente. Con todo adentro, el unico modo de probarlas es montar el
 * formulario, escribir en cinco campos y volver a leer el DOM: veinte lineas de
 * andamiaje para afirmar que un `&&` esta bien. Con la regla afuera, es una
 * linea de test.
 */

const COMPLETO: DatosDelFormulario = {
  nombre: 'María',
  apellido: 'González',
  telefono: '11 1234-5678',
  email: 'maria@example.com',
  direccion: 'Av. Corrientes 1234'
}

describe('el boton exige los cinco campos', () => {
  it('con todo lleno se puede mandar', () => {
    expect(estaCompleto(COMPLETO)).toBe(true)
  })

  it('con todo vacio no', () => {
    expect(estaCompleto(CAMPOS_VACIOS)).toBe(false)
  })

  it.each(Object.keys(CAMPOS_VACIOS) as (keyof DatosDelFormulario)[])(
    'falta %s y no se puede mandar',
    (campo) => {
      expect(estaCompleto({ ...COMPLETO, [campo]: '' })).toBe(false)
    }
  )

  it.each(Object.keys(CAMPOS_VACIOS) as (keyof DatosDelFormulario)[])(
    'un %s de solo espacios tampoco alcanza',
    (campo) => {
      // Sin `.trim()`, `"   "` cuenta como contenido y el boton se habilita
      // para un formulario que el backend va a rechazar.
      expect(estaCompleto({ ...COMPLETO, [campo]: '   ' })).toBe(false)
    }
  )

  it('el email cuenta: sin el, no se compra', () => {
    // Es lo que decidio D-9. Con el email opcional, dos compradores sin email
    // no se podrian distinguir nunca y cada compra abriria un cliente nuevo.
    expect(estaCompleto({ ...COMPLETO, email: '' })).toBe(false)
  })

  it('no hay campo de contrasena ni de DNI que completar', () => {
    // RF-01: el comprador no tiene cuenta. Si estos campos aparecieran, el
    // formulario estaria pidiendo algo que no existe del lado del backend.
    const campos = Object.keys(CAMPOS_VACIOS).join(',')
    expect(campos).not.toContain('password')
    expect(campos).not.toContain('clave')
    expect(campos).not.toContain('dni')
  })
})

describe('los errores de campo', () => {
  const ninguno = {
    nombre: false,
    apellido: false,
    telefono: false,
    email: false,
    direccion: false
  }

  it('un formulario recien abierto no muestra errores', () => {
    // Cinco campos en rojo al cargar parecen un formulario roto.
    expect(erroresDe(CAMPOS_VACIOS, ninguno)).toEqual({})
  })

  it('marca solo el campo que se toco y se dejo vacio', () => {
    const errores = erroresDe(
      { ...COMPLETO, telefono: '' },
      { ...ninguno, telefono: true }
    )

    expect(Object.keys(errores)).toEqual(['telefono'])
  })

  it('un campo tocado con contenido no da error', () => {
    const errores = erroresDe(COMPLETO, { ...ninguno, telefono: true })

    expect(errores).toEqual({})
  })
})

describe('el resumen del pedido', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('sobrevive al viaje a Mercado Pago', () => {
    // Al volver, esta pagina se recarga desde cero. Sin esto, no hay nada que
    // mostrar: se volveria a un formulario vacio con el comprador pensando que
    // perdio su compra.
    guardarResumen({ orderId: 'ord_1', total: 15000, items: [] })

    expect(leerResumen()).toEqual({ orderId: 'ord_1', total: 15000, items: [] })
  })

  it('va en sessionStorage, NO en localStorage', () => {
    guardarResumen({ orderId: 'ord_1', total: 1, items: [] })

    // En una maquina compartida, un `localStorage` dejaria el numero de pedido de
    // la compra de otra persona a la vista del siguiente que abre la pestana, con
    // el nombre y el total adentro.
    expect(sessionStorage.getItem(CLAVE_PEDIDO)).not.toBeNull()
    expect(localStorage.getItem(CLAVE_PEDIDO)).toBeNull()
  })

  it('se borra cuando ya se mostro', () => {
    guardarResumen({ orderId: 'ord_1', total: 1, items: [] })

    borrarResumen()

    expect(leerResumen()).toBeNull()
  })

  it('si no hay nada guardado, devuelve null', () => {
    expect(leerResumen()).toBeNull()
  })

  it('un JSON corrupto devuelve null en vez de romper', () => {
    sessionStorage.setItem(CLAVE_PEDIDO, '{esto no es json')

    expect(leerResumen()).toBeNull()
  })

  it.each([
    ['{}', 'sin campos'],
    ['{"orderId":"ord_1"}', 'sin total'],
    ['{"total":100}', 'sin orderId'],
    ['{"orderId":123,"total":100}', 'orderId que no es texto'],
    ['"un string"', 'la raiz no es un objeto'],
    ['null', 'la raiz es null']
  ])('%s devuelve null (%s)', (crudo) => {
    sessionStorage.setItem(CLAVE_PEDIDO, crudo)

    expect(leerResumen()).toBeNull()
  })
})

describe('el resultado de la URL', () => {
  it.each([
    ['?pago=aprobado', 'aprobado'],
    ['?pago=fallido', 'fallido'],
    ['?pago=pendiente', 'pendiente']
  ])('%s', (url, esperado) => {
    expect(resultadoDeLaUrl(url)).toBe(esperado)
  })

  it.each(['', '?otra=cosa', '?pago=cualquiera'])('%s no es un resultado', (url) => {
    // Un valor desconocido devuelve `null` y se muestra el formulario, no un
    // "pendiente" que no paso.
    expect(resultadoDeLaUrl(url)).toBeNull()
  })
})
