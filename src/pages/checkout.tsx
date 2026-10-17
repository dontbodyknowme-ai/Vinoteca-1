import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { FormularioCheckout, type DatosDelFormulario } from '../components/checkout/formulario'
import { crearPedido, mensajeDeErrorDeCheckout } from '../api/checkout'
import {
  borrarResumen,
  guardarResumen,
  leerResumen,
  resultadoDeLaUrl
} from '../types/checkout'
import type { CartItem } from '../types/vino'

/**
 * La pagina del checkout (spec 009, T6 y T7).
 *
 * Son **tres estados en la misma pagina**, y por que:
 *
 * - **formulario** — el visitante lleno el carrito y pulsa "Finalizar Pedido"
 * - **pagando** — se creo el pedido y estamos mandando a Mercado Pago
 * - **confirmacion / error** — el comprador volvio de Mercado Pago
 *
 * Que sea una sola pagina y no tres rutas importa porque **al volver de Mercado
 * Pago el comprador llega por query param** (`?pago=aprobado`) y no tiene el
 * carrito en memoria: si la confirmacion fuera otra ruta, el `sessionStorage`
 * seria lo unico que la sostenga.
 */
interface CheckoutProps {
  /** El carrito, para poder mandarlo. Viene de `App`. */
  items: CartItem[]
  /** Se llama cuando el pago se aprobo, para vaciar el carrito. */
  alConfirmar: () => void
}

export const Checkout = ({ items, alConfirmar }: CheckoutProps) => {
  const navegar = useNavigate()
  const [parametros] = useSearchParams()
  const resultado = resultadoDeLaUrl(parametros.toString())

  const [enviando, setEnviando] = useState(false)
  const [errorServidor, setErrorServidor] = useState('')

  // Se lee **una vez**, al montar. Y se borra despues: el resumen es de esta
  // compra, y dejarlo da al siguiente que abra la pestana en el mismo
  // navegador el numero de pedido de otra persona.
  const [resumen] = useState(() => leerResumen())

  if (resultado !== null) {
    return (
      <ResultadoDelPago
        resultado={resultado}
        resumen={resumen}
        alVolver={() => {
          borrarResumen()
          alConfirmar()
          navegar('/')
        }}
        alReintentar={() => {
          borrarResumen()
          navegar('/')
        }}
      />
    )
  }

  const enviar = async (datos: DatosDelFormulario) => {
    setEnviando(true)
    setErrorServidor('')

    try {
      const pedido = await crearPedido(
        {
          nombre: datos.nombre,
          apellido: datos.apellido,
          telefono: datos.telefono,
          email: datos.email,
          direccion: datos.direccion
        },
        // **Solo el id y la cantidad.** El precio lo pone el backend.
        items.map((item) => ({ vinoId: item.product.id, cantidad: item.quantity }))
      )

      guardarResumen({ orderId: pedido.orderId, total: pedido.total, items: [] })

      // Se va a Mercado Pago con `location.assign` y **no** con `navigate`: es
      // una pagina de otro origen, y un router de SPA no puede(topicar)arla.
      window.location.assign(pedido.initPoint)
    } catch (error: unknown) {
      setErrorServidor(mensajeDeErrorDeCheckout(error))
      setEnviando(false)
    }
  }

  return (
    <main className='min-h-screen bg-charcoal-950 px-4 py-10 text-cream-100'>
      <div className='mx-auto max-w-md'>
        <h1 className='mb-1 text-center font-serif text-3xl font-bold'>Finalizar compra</h1>
        <p className='mb-8 text-center text-sm text-neutral-400'>
          No hace falta crear cuenta. Solo necesitamos estos datos para coordinar.
        </p>

        <FormularioCheckout
          alEnviar={(datos) => void enviar(datos)}
          enviando={enviando}
          errorServidor={errorServidor}
        />
      </div>
    </main>
  )
}

interface ResultadoProps {
  resultado: 'aprobado' | 'fallido' | 'pendiente'
  resumen: { orderId: string; total: number; items: { vinoId: string; cantidad: number }[] } | null
  alVolver: () => void
  alReintentar: () => void
}

/**
 * Lo que se ve al volver de Mercado Pago.
 *
 * ## Por que el total sale del `sessionStorage` y no de un endpoint
 *
 * Un `GET /api/orders/:id` publico devolveria nombre, telefono y direccion de un
 * comprador que **no tiene cuenta en el sistema**, con soloKnowing el id. Ese
 * endpoint publico existia en la primera version de la spec y se saco (D-F de
 * `plan.md`).
 *
 * La confirmacion necesita **el numero y el monto**, que son los unicos datos que
 * la persona ya conocio. Esos se guardaron antes de ir a Mercado Pago.
 *
 * ## Y si el resumen no esta
 *
 * Puede pasar: el comprador abrio la tienda en otra pestana, o borro el
 * almacenamiento. La pagina **no inventa un total** —un "$0" o un total al
 * azar seria una mentira que el comprador lleva al mostrador—: avisa que no lo
 * encontro y lo manda a la tienda.
 */
const ResultadoDelPago = ({ resultado, resumen, alVolver, alReintentar }: ResultadoProps) => {
  const aprobado = resultado === 'aprobado'

  if (resultado === 'pendiente') {
    return (
      <Aviso
        icono={<Loader2 className='h-12 w-12 animate-spin text-gold-400' aria-hidden='true' />}
        titulo='Tu pago se esta procesando'
        texto='Mercado Pago nos confirmara en un momento. No hace falta que hagas nada.'
        accion={{ texto: 'Volver a la tienda', alHacer: alVolver }}
      />
    )
  }

  if (!aprobado) {
    return (
      <Aviso
        icono={<XCircle className='h-12 w-12 text-wine-400' aria-hidden='true' />}
        titulo='El pago no se completo'
        texto='Tu carrito sigue intacto. Podes intentarlo de nuevo cuando quieras.'
        accion={{ texto: 'Intentar de nuevo', alHacer: alReintentar }}
      />
    )
  }

  return (
    <main className='flex min-h-screen items-center justify-center bg-charcoal-950 px-4 text-cream-100'>
      <div className='w-full max-w-md rounded-2xl border border-neutral-800 bg-charcoal-900 p-8 text-center'>
        <CheckCircle2 className='mx-auto h-12 w-12 text-gold-400' aria-hidden='true' />

        <h1 className='mt-4 font-serif text-2xl font-bold'>Pedido confirmado</h1>

        {resumen === null ? (
          <>
            <p className='mt-3 text-sm text-neutral-400'>
              Tu pago se registro. No encontramos el detalle del pedido en esta
              sesion, asi que te loanamos por email.
            </p>
            <p className='mt-3 text-sm text-neutral-300'>
              Si ya lo habias pagado desde este navegador, recargá la pagina y el
              detalle vuelve a aparecer.
            </p>
          </>
        ) : (
          <>
            <p className='mt-3 text-sm text-neutral-400'>
              Guardamos tu pedido y te escribimos con el seguimiento.
            </p>

            <dl className='mt-6 space-y-3 rounded-xl border border-neutral-800 bg-charcoal-950 p-4 text-left'>
              <div className='flex justify-between gap-4'>
                <dt className='text-xs uppercase tracking-widest text-neutral-500'>Pedido</dt>
                <dd className='font-mono text-sm text-cream-100'>{resumen.orderId}</dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-xs uppercase tracking-widest text-neutral-500'>Total</dt>
                <dd className='font-mono text-sm font-bold text-gold-400'>
                  {new Intl.NumberFormat('es-AR', {
                    style: 'currency',
                    currency: 'ARS',
                    maximumFractionDigits: 0
                  }).format(resumen.total)}
                </dd>
              </div>
            </dl>
          </>
        )}

        <button
          type='button'
          onClick={alVolver}
          className='mt-6 w-full rounded-xl bg-wine-700 py-3 text-sm font-semibold uppercase tracking-wider text-cream-100 transition-colors hover:bg-wine-500'
        >
          Volver a la tienda
        </button>
      </div>
    </main>
  )
}

interface AvisoProps {
  icono: React.ReactNode
  titulo: string
  texto: string
  accion: { texto: string; alHacer: () => void }
}

const Aviso = ({ icono, titulo, texto, accion }: AvisoProps) => (
  <main className='flex min-h-screen items-center justify-center bg-charcoal-950 px-4 text-cream-100'>
    <div className='w-full max-w-md rounded-2xl border border-neutral-800 bg-charcoal-900 p-8 text-center'>
      {icono}
      <h1 className='mt-4 font-serif text-2xl font-bold'>{titulo}</h1>
      <p className='mt-3 text-sm text-neutral-400'>{texto}</p>
      <button
        type='button'
        onClick={accion.alHacer}
        className='mt-6 w-full rounded-xl bg-wine-700 py-3 text-sm font-semibold uppercase tracking-wider text-cream-100 transition-colors hover:bg-wine-500'
      >
        {accion.texto}
      </button>
    </div>
  </main>
)
