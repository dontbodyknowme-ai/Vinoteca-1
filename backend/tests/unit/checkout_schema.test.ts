import { describe, expect, it } from 'vitest'
import { orderCreateSchema } from '../../src/shared/schemas.js'

/**
 * El cuerpo de `POST /api/orders` (spec 009, T2).
 *
 * ## Por que estos tests leen el schema y no llaman a la API
 *
 * El endpoint no existe todavia — es T3. Y aunque existiera, un test de API
 * para "el email se normaliza" necesita montar Fastify, mandar una peticion y
 * leer la respuesta, cuando lo que se quiere afirmar es **que el schema
 * transforma la entrada**. El schema es la frontera: si el baja mal, todo lo que
 * este arriba hereda el error.
 *
 * ## Lo que este archivo NO cubre
 *
 * Que el backend **ignore** el precio del cliente cuando arma el pedido. Aca solo
 * se afirma que el schema **rechaza** el campo; que el total salga de `Wine.price`
 * es de T3, y es un test distinto porque necesita base de datos.
 */

const VALIDO = {
  nombre: 'María',
  apellido: 'González',
  telefono: '11 1234-5678',
  email: 'maria@example.com',
  direccion: 'Av. Corrientes 1234, Buenos Aires',
  items: [{ vinoId: 'clx1234abcd', cantidad: 2 }]
}

/** `cuid()` de Prisma empieza con una letra minuscula. */
const CUID = 'clx1234abcd'

const base = (over: Record<string, unknown> = {}) => ({ ...VALIDO, ...over })

const ok = (over: Record<string, unknown> = {}) => orderCreateSchema.safeParse(base(over))

describe('un cuerpo válido pasa', () => {
  it('acepta los datos completos de un comprador', () => {
    expect(ok().success).toBe(true)
  })

  it('no pide DNI ni contraseña', () => {
    // RF-01: el comprador no tiene cuenta. Lo que no puede aparecer es un campo
    // que sugiera que hay que registrarse.
    const resultado = ok()

    expect(resultado.success).toBe(true)
    const datos = (resultado as { data: Record<string, unknown> }).data

    expect(Object.keys(datos).sort()).toEqual([
      'apellido',
      'direccion',
      'email',
      'items',
      'nombre',
      'telefono'
    ])
  })
})

describe('el precio del cliente se rechaza, no se ignora', () => {
  it('un `precioUnitario` en el item es un error', () => {
    // El motivo de que sea error y no "se borra en silencio": con `strip`, el
    // cliente mandaria `precioUnitario: 1`, el servidor lo descartaria y el
    // cliente creeria que compro al precio que quiso. RNF-01.
    const resultado = ok({
      items: [{ vinoId: CUID, cantidad: 2, precioUnitario: 1 }]
    })

    expect(resultado.success).toBe(false)
  })

  it('un `precio` en el item es un error', () => {
    expect(ok({ items: [{ vinoId: CUID, cantidad: 2, precio: 1 }] }).success).toBe(false)
  })

  it('un `total` en el cuerpo es un error', () => {
    // El mismo agujero por otro lado: un `total` en la raiz.
    expect(ok({ total: 1 }).success).toBe(false)
  })

  it('el item del schema no tiene forma de llevar precio', () => {
    // El test de tipos, hecho en tiempo de ejecucion: aunque alguien quite el
    // `.strict()`, el tipo `OrderCreateInput` no tiene donde poner un precio.
    const resultado = ok()
    const datos = (resultado as { data: { items: Record<string, unknown>[] } }).data

    expect(Object.keys(datos.items[0]).sort()).toEqual(['cantidad', 'vinoId'])
  })
})

describe('el email es obligatorio y se normaliza (D-9)', () => {
  it('sin email es error', () => {
    const cuerpo = base()
    delete (cuerpo as Record<string, unknown>).email

    expect(orderCreateSchema.safeParse(cuerpo).success).toBe(false)
  })

  it('un email vacío es error', () => {
    expect(ok({ email: '' }).success).toBe(false)
  })

  it('un email que no es email es error', () => {
    expect(ok({ email: 'no-es-un-email' }).success).toBe(false)
  })

  it('`Ana@Example.com` sale como `ana@example.com`', () => {
    // Es lo que evita partir a una persona en dos fichas: el `@unique` de
    // Postgres distingue mayusculas, asi que sin normalizar, la misma persona
    // con distinta capitalizacion seria dos clientes.
    const resultado = ok({ email: 'Ana@Example.COM' })

    expect(resultado.success).toBe(true)
    expect((resultado as { data: { email: string } }).data.email).toBe('ana@example.com')
  })

  it('los espacios alrededor se limpian antes de validar', () => {
    // `  Ana@Example.com  ` no es un email valido, y el error seria
    // "el email no es valido" cuando el problema real es un espacio de mas.
    const resultado = ok({ email: '  Ana@Example.com  ' })

    expect(resultado.success).toBe(true)
    expect((resultado as { data: { email: string } }).data.email).toBe('ana@example.com')
  })
})

describe('campos obligatorios', () => {
  it.each([
    ['nombre', { nombre: '' }],
    ['nombre en blanco', { nombre: '   ' }],
    ['apellido', { apellido: '' }],
    ['telefono', { telefono: '' }],
    ['direccion', { direccion: '' }]
  ])('rechaza %s', (_caso, over) => {
    expect(ok(over).success).toBe(false)
  })

  it('el nombre en blanco se limpia antes de medir, y da error por vacio', () => {
    // Sin `.trim()` antes del `.min(1)`, `'   '` pasa: tiene tres caracteres.
    const resultado = ok({ nombre: '   ' })

    expect(resultado.success).toBe(false)
  })

  it('el nombre se devuelve limpio, sin espacios de los bordes', () => {
    const resultado = ok({ nombre: '  María  ' })

    expect(resultado.success).toBe(true)
    expect((resultado as { data: { nombre: string } }).data.nombre).toBe('María')
  })
})

describe('el telefono', () => {
  it.each([
    '11 1234-5678',
    '11-1234-5678',
    '1123456789',
    '(011) 1234-5678',
    '9 11 1234-5678',
    '91112345678',
    '+54 9 11 1234-5678',
    '5491112345678',
    '+5491112345678',
    '54 9 11 1234-5678'
  ])('acepta "%s"', (telefono) => {
    expect(ok({ telefono }).success).toBe(true)
  })

  it.each(['tres letras', '123', '12345', '++54 9 11'])('rechaza "%s"', (telefono) => {
    // Sin el regex, `min(1)` deja pasar cualquier cosa no vacia y el pedido
    // queda con un contacto con el que no se puede llamar.
    expect(ok({ telefono }).success).toBe(false)
  })

  it('se guarda sin espacios ni guiones', () => {
    // El mismo numero escrito de tres maneras no puede quedar partido en el
    // CRM: `11 1234-5678` y `1112345678` son la misma persona.
    const resultado = ok({ telefono: '11 1234-5678' })

    expect(resultado.success).toBe(true)
    expect((resultado as { data: { telefono: string } }).data.telefono).toBe('1112345678')
  })

  it('conserva el `+` si lo traia', () => {
    const resultado = ok({ telefono: '+54 9 11 1234-5678' })

    expect((resultado as { data: { telefono: string } }).data.telefono).toBe('+5491112345678')
  })
})

describe('los items', () => {
  it('un carrito vacío es error', () => {
    expect(ok({ items: [] }).success).toBe(false)
  })

  it('sin `items` es error', () => {
    const cuerpo = base()
    delete (cuerpo as Record<string, unknown>).items

    expect(orderCreateSchema.safeParse(cuerpo).success).toBe(false)
  })

  it.each([0, -1, 1.5])('rechaza `cantidad: %s`', (cantidad) => {
    // `1.5` es lo importante: sin `.int()`, un medio vino pasa y el total sale
    // con centavos que no existen en un mundo de pesos enteros.
    expect(ok({ items: [{ vinoId: CUID, cantidad }] }).success).toBe(false)
  })

  it('rechaza un `vinoId` que no es cuid', () => {
    expect(ok({ items: [{ vinoId: 'no-es-un-id', cantidad: 1 }] }).success).toBe(false)
  })

  it('acepta varios items', () => {
    expect(ok({ items: [{ vinoId: CUID, cantidad: 1 }, { vinoId: CUID, cantidad: 3 }] }).success).toBe(true)
  })
})

describe('el mensaje de error dice qué falta', () => {
  it('el campo faltante se nombra en el mensaje', () => {
    // Un `400` con "Invalid request" no le dice a nadie qué corregir. El frontend
    // muestra el mensaje crudo debajo del campo, asi que tiene que ser util.
    const resultado = ok({ telefono: 'tres letras' })

    expect(resultado.success).toBe(false)
    const issues = (resultado as { error: { issues: { path: string[]; message: string }[] } }).error.issues
    const delTelefono = issues.find((i) => i.path[0] === 'telefono')

    expect(delTelefono?.message).toBe('El telefono no parece un numero valido')
  })

  it('el camino del error es el campo, para que el frontend sepa dónde marcarlo', () => {
    const resultado = ok({ items: [{ vinoId: 'malo', cantidad: 1 }] })
    const issues = (resultado as { error: { issues: { path: string[] }[] } }).error.issues

    expect(issues[0].path).toEqual(['items', 0, 'vinoId'])
  })
})
