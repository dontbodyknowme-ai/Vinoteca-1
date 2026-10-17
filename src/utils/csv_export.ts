import { aTextoCsv } from './csv'
import { descargarCsv, nombreArchivoConFecha } from './csv'
import type { AdminWine, Customer, Order } from '../types/admin'

/**
 * Generadores de CSV del panel.
 *
 * **Viven aca y no dentro de los hooks** por una razon concreta: cada hook
 * tiene su propio `exportarCsv`, que ademas arma la URL con los filtros de su
 * pagina. Si la pagina de Configuracion tambien ofrece "Exportar Catalogo", esa
 * boton tiene que generar **el mismo archivo** que genera la del catalogo, y con
 * duplicar el codigo las dos copias divergen en el primer cambio: una gana una
 * columna y la otra no.
 *
 * Cada generador recibe los datos ya cargados y devuelve el texto. No pide
 * nada: pedir es responsabilidad de quien lo usa, porque cada pantalla pide con
 * filtros distintos.
 *
 * ## Por que el `id` va incluido
 *
 * El importador de CSV usa el `id` para decidir si una fila actualiza un vino
 * existente o crea uno nuevo. Un export sin `id` hacia que reimportar el
 * archivo duplicase el catalogo entero. Ver `src/mocks/importar_vinos.ts`.
 */

export const csvCatalogo = (vinos: readonly AdminWine[]): string => {
  const encabezados = [
    'Id',
    'Nombre',
    'Bodega',
    'Cepa',
    'Categoria',
    'Cosecha',
    'Precio',
    'Stock',
    'Activo',
    'Descripcion'
  ]

  const filas = vinos.map((vino) => [
    vino.id,
    vino.name,
    vino.winery,
    vino.varietal,
    vino.category,
    String(vino.vintage),
    String(vino.price),
    String(vino.stock),
    vino.activo ? 'si' : 'no',
    vino.description
  ])

  return aTextoCsv(filas, encabezados)
}

export const csvClientes = (clientes: readonly Customer[]): string => {
  const encabezados = [
    'Id',
    'Nombre',
    'Email',
    'Telefono',
    'Pedidos',
    'Total gastado',
    'Ultimo pedido',
    'Tags'
  ]

  const filas = clientes.map((cliente) => [
    cliente.id,
    cliente.name,
    cliente.email,
    cliente.phone,
    String(cliente.totalOrders),
    String(cliente.totalSpent),
    cliente.lastOrderAt === null ? '' : cliente.lastOrderAt.slice(0, 10),
    // Las tags van separadas por espacio y no por coma: la coma separa
    // columnas, asi que un cliente con dos tags partiria la fila en dos.
    cliente.tags.join(' ')
  ])

  return aTextoCsv(filas, encabezados)
}

export const csvPedidos = (pedidos: readonly Order[]): string => {
  const encabezados = [
    'Id',
    'Cliente',
    'Email',
    'Fecha',
    'Total',
    'Estado',
    'Unidades',
    'Ciudad'
  ]

  const filas = pedidos.map((pedido) => [
    pedido.id,
    // `customer.name`, no `pedido.customerName`: el campo plano no existe en la
    // respuesta de la API y el CSV salia con la columna vacia, que es peor que
    // no exportar — un archivo que parece completo y no lo esta.
    pedido.customer.name,
    pedido.customer.email ?? '',
    // `slice(0, 10)`: la fecha en `YYYY-MM-DD`. Es la fecha local del pedido,
    // por el mismo criterio que el filtro de fechas del panel.
    pedido.createdAt.slice(0, 10),
    String(pedido.total),
    pedido.status,
    String(pedido.items.reduce((suma, item) => suma + item.quantity, 0)),
    pedido.shippingAddress.city
  ])

  return aTextoCsv(filas, encabezados)
}

/** Descarga un CSV con nombre con fecha. Es el unico que toca el DOM. */
export const descargarComo = (base: string, contenido: string): void => {
  descargarCsv(nombreArchivoConFecha(base, new Date()), contenido)
}