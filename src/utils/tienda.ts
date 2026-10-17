/**
 * Identidad de la tienda.
 *
 * **Un solo lugar.** El footer ya tenia el email de contacto hardcodeado dentro
 * del `mailto:` y del texto visible, o sea la misma direccion escrita dos veces
 * en el mismo componente. La pagina de Configuracion necesita mostrarla tambien.
 * Con tres copias, el primer cambio de dominio deja alguna desactualizada, y un
 * `mailto:` que no coincide con lo que se ve en pantalla manda el mensaje al
 * lugar equivocado sin avisar.
 *
 * ## El `nombre` estuvo desactualizado, y de la peor forma
 *
 * Aqui seguia `'Cava & Co'` despues del rebranding a **2920**, mientras el logo,
 * el hero, el pie y el `title` de `index.html` ya decian 2920. O sea que el
 * unico lugar que quedo atras era este, que es el que **muestra Configuracion**:
 * un admin entrando al panel veia el nombre viejo de la tienda, en un panel que
 * se ve todo lo demas bien.
 *
 * Y el drawer de movil no mostraba ningun nombre, ni el viejo ni el nuevo — por
 * eso "el nombre del drawer" era una pregunta sin respuesta: no habia texto que
 * cambiar, habia que agregarlo.
 *
 * Ese es el modo de falla que **no** se ve mirando la tienda: el rebranding se
 * hace en los componentes que se ven, se deja el que no se mira, y el unico que
 * se entera es quien admin. De ahi el test `marca.test.ts`, que afirma que
 * `index.html`, el drawer, el pie y `TIENDA.nombre` dicen lo mismo.
 *
 * **No se puede editar desde el panel.** Ver `configuracion.tsx`: no hay
 * endpoint de configuracion y la 004-a no define ninguno. Editar estos valores
 * seria un formulario que no guarda nada.
 */
export const TIENDA = {
  nombre: '2920',
  email: 'hola@cava-co.com',
  /**
   * Codigo ISO 4217. Se usa en todos los `Intl.NumberFormat` del panel y del
   * export CSV, asi que cambiarlo aca sin cambiar los formateadores dejaria
   * archivos en una moneda y textos en otra.
   */
  moneda: 'ARS',
  /**
   * Zona horaria de la tienda. **No se usa para convertir fechas**: el panel
   * opera en la zona local del navegador, que es lo que el usuario ve en el
   * calendario. Se muestra en Configuracion para que quede claro ante que zona
   * funcionan los dias.
   */
  zonaHoraria: 'America/Argentina/Mendoza'
} as const

/** La zona horaria donde el navegador del usuario opera ahora mismo. */
export const zonaHorariaLocal = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return TIENDA.zonaHoraria
  }
}