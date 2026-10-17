import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * El estado del pago es un campo **nuevo**, y `Order.status` sigue siendo del
 * envío (spec 009, D-7).
 *
 * Por qué un test que lee el schema en vez de uno que usa Prisma: lo que hay que
 * proteger acá es una **relación entre dos columnas del mismo modelo**. El test
 * de "se crea un pedido con pago aprobado" verifica una fila; esto verifica que
 * las dos columnas siguen siendo cosas distintas, que es lo que se rompe si
 * alguien las unifica "porque `pendiente` significa lo mismo en las dos".
 *
 * No significa lo mismo: `status = pendiente` es "lo estamos armando" y lo
 * cambia una persona; `pagoEstado = pendiente` es "abrió Mercado Pago y no
 * terminó" y lo cambia la webhook.
 *
 * ## Lo que este test NO cubre
 *
 * Que la webhook escriba en `pagoEstado` y **no** en `status`. Eso es un test de
 * comportamiento de T4, y aca no hay forma de afirmarlo leyendo un archivo.
 */

const SCHEMA = readFileSync(
  join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
  'utf8'
)

/** El cuerpo de un bloque del schema, desde su llave hasta la llave de cierre. */
const bloque = (llave: string): string => {
  const inicio = SCHEMA.indexOf(llave)
  if (inicio === -1) throw new Error(`no se encontro ${llave} en el schema`)

  const fin = SCHEMA.indexOf('\n}', inicio)
  return SCHEMA.slice(inicio, fin)
}

/** Los valores de un enum del schema, en el orden en que estan declarados. */
const valoresDe = (nombre: string): string[] => {
  const cuerpo = bloque(`enum ${nombre} {`)
  const cuerpoSinComentarios = cuerpo.replace(/\/\/\/[^\n]*/g, '').replace(/\/\/.*$/gm, '')
  return [...cuerpoSinComentarios.matchAll(/^\s*([a-z_]+)\s*$/gm)].map((m) => m[1])
}

describe('el enum EstadoPago', () => {
  it('tiene exactamente los cinco estados de la spec', () => {
    expect(valoresDe('EstadoPago')).toEqual([
      'no_iniciado',
      'pendiente',
      'aprobado',
      'rechazado',
      'expirado'
    ])
  })

  it('arranca en `no_iniciado`, no en `pendiente`', () => {
    // El pedido se crea **antes** de que el comprador abra Mercado Pago. Con
    // default `pendiente`, un pedido recién creado diría "abrió Mercado Pago y
    // no terminó", que es mentira. Y `no_iniciado` evita el otro problema: el
    // cron de expiración (T5) busca `in ('no_iniciado','pendiente')`, y con un
    // solo valor inicial no habría forma de distinguir "no empezó" de "empezó y
    // no terminó" — que son justo los que expiran, pero por razones distintas.
    const order = bloque('model Order {')

    expect(order).toMatch(/pagoEstado\s+EstadoPago\s+@default\(no_iniciado\)/)
    expect(order).not.toMatch(/pagoEstado\s+EstadoPago\s+@default\(pendiente\)/)
  })
})

describe('Order.status NO se toco', () => {
  it('sigue siendo OrderStatus con default `pendiente`', () => {
    const order = bloque('model Order {')

    expect(order).toMatch(/status\s+OrderStatus\s+@default\(pendiente\)/)
  })

  it('OrderStatus conserva sus seis estados', () => {
    // En particular `entregado`: es el que un `vendedor` pone a mano cuando
    // entrega el pedido, y ya funciona. Si esta lista pierde un valor, el panel
    // deja de ofrecer algo que hoy sí ofrece.
    expect(valoresDe('OrderStatus')).toEqual([
      'pendiente',
      'preparando',
      'enviado',
      'entregado',
      'cancelado',
      'devuelto'
    ])
  })

  it('los dos campos son de enums distintos', () => {
    // Comparten el valor `pendiente` y significan cosas distintas. Prisma los
    // tipa por separado, así que TypeScript rechaza cruzarlos — pero solo si
    // siguen siendo enums separados y no un `String`.
    const order = bloque('model Order {')

    expect(order).toMatch(/status\s+OrderStatus/)
    expect(order).toMatch(/pagoEstado\s+EstadoPago/)
    expect(order).not.toMatch(/pagoEstado\s+String/)
  })
})

describe('pagoId', () => {
  it('es unico y opcional', () => {
    const order = bloque('model Order {')

    // Unico: es con lo que la webhook (T4) encuentra el pedido. Si dos pedidos
    // compartieran `pagoId`, la webhook actualizaria el equivocado sin error.
    // Opcional: el pedido existe antes de que haya Preference.
    expect(order).toMatch(/pagoId\s+String\?\s+@unique/)
  })

  it('tiene indice para la expiracion (pagoEstado + createdAt)', () => {
    // El cron de T5 consulta `pagoEstado IN (...) AND createdAt < X`. Con un
    // indice solo en `pagoEstado` o solo en `createdAt`, Postgres hace un seq
    // scan de la tabla entera una vez por minuto.
    expect(bloque('model Order {')).toContain('@@index([pagoEstado, createdAt])')
  })
})

describe('la timeline: envio o pago, nunca los dos', () => {
  it('los dos campos son opcionales', () => {
    // T1 dejo esto **sin tocar**, a proposito, y el commit lo explica: volver
    // `status` opcional obliga a cambiar en el mismo commit el schema JSON de la
    // respuesta —que declara `status: { type: 'string' }` y cortaria un `null`
    // (gotcha 11 de `AGENTS.md`)— y `order_timeline.tsx`.
    //
    // T4 es cuando se escribe el primer evento de pago, y entonces si. Este test
    // ya no afirma que este intacto: afirma **la regla**, que es la que importa y
    // la que va a seguir valiendo.
    const timeline = bloque('model OrderTimeline {')

    expect(timeline).toMatch(/status\s+OrderStatus\?/)
    expect(timeline).toMatch(/pagoEstado\s+EstadoPago\?/)
  })

  it('ninguno de los dos es obligatorio', () => {
    // Una entrada de envio no tiene `pagoEstado`, y una de pago no tiene
    // `status`. Si alguno fuera obligatorio, la mitad de las entradas no se
    // podrian escribir — que es volver a la columna que significa dos cosas.
    const timeline = bloque('model OrderTimeline {')

    expect(timeline).not.toMatch(/^\s*status\s+OrderStatus\s*$/m)
    expect(timeline).not.toMatch(/^\s*pagoEstado\s+EstadoPago\s*$/m)
  })

  it('la entrada dice de donde vino', () => {
    // Una entrada sin autor parece escrita a mano cuando la escribio una
    // webhook, que es justo lo que hace inyectable un pedido pagado a mano.
    expect(bloque('model OrderTimeline {')).toMatch(/origen\s+String\s+@default\("Admin"\)/)
  })
})

describe('lo que la spec NO creo', () => {
  it('no se creo ningun modelo paralelo', () => {
    // La primera version de la 009 pedia `Pedido`, `PedidoItem` y `Comprador`.
    // Crearlos dejaba al panel sin ver los pedidos nuevos: se guardaban en
    // tablas que `GET /api/orders` no lee.
    for (const modelo of ['model Pedido', 'model PedidoItem', 'model Comprador']) {
      expect(SCHEMA, modelo).not.toContain(modelo)
    }
  })
})
