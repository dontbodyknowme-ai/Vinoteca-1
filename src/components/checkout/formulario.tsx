import { useState } from 'react'

/**
 * El formulario de datos del comprador (spec 009, T6, RF-02).
 *
 * ## Que NO esta
 *
 * **No hay campo de contraseña, ni de DNI, ni de "crear cuenta".** El comprador
 * no tiene cuenta (RF-01) y no se registra en ningun lado: esto es lo que se le
 * preguntaria en un mostrador.
 *
 * El email **es obligatorio** (D-9): es la identidad del comprador. Si vuelve,
 * se lo busca por ese campo y se reutiliza la ficha en vez de abrir un cliente
 * nuevo. Con email opcional, dos compradores sin email no se podrian
 * distinguir nunca.
 *
 * ## El boton arranca deshabilitado
 *
 * Con los campos vacios no hay nada que mandar. La validacion del backend es la
 * que manda —esta es la que evita el viaje redondo para una direccion vacia— pero
 * un boton que no se puede apretar es la primera linea.
 *
 * ## El error va **debajo** del campo
 *
 * Igual que en el login (004-a): si el mensaje apareciera arriba, el usuario
 * tendria que volver a buscar el input.
 */

export interface DatosDelFormulario {
  nombre: string
  apellido: string
  telefono: string
  email: string
  direccion: string
}

export const CAMPOS_VACIOS: DatosDelFormulario = {
  nombre: '',
  apellido: '',
  telefono: '',
  email: '',
  direccion: ''
}

/** Lo que hay que tener lleno para poder mandar. El email cuenta. */
export const estaCompleto = (datos: DatosDelFormulario): boolean =>
  datos.nombre.trim() !== '' &&
  datos.apellido.trim() !== '' &&
  datos.telefono.trim() !== '' &&
  datos.email.trim() !== '' &&
  datos.direccion.trim() !== ''

/**
 * Validacion de la **forma**, no del formato.
 *
 * Lo que decide si se puede mandar es "esta completo". El formato del telefono y
 * del email lo valida el backend, que es quien tiene el schema; una regex
 * duplicada aca corre el riesgo de aceptar algo que el backend rechaza, y el
 * sintoma es un error que aparece solo despues de recargar el sitio.
 */
export const erroresDe = (
  datos: DatosDelFormulario,
  tocados: Readonly<Record<keyof DatosDelFormulario, boolean>>
): Partial<Record<keyof DatosDelFormulario, string>> => {
  const errores: Partial<Record<keyof DatosDelFormulario, string>> = {}

  for (const campo of Object.keys(datos) as (keyof DatosDelFormulario)[]) {
    // Solo se marca un campo que la persona **ya toco**: un formulario recien
    // abierto con cinco errores en rojo parece un formulario roto.
    if (tocados[campo] && datos[campo].trim() === '') {
      errores[campo] = 'Este campo es obligatorio'
    }
  }

  return errores
}

interface FormularioCheckoutProps {
  alEnviar: (datos: DatosDelFormulario) => void
  /** Deshabilita el boton mientras se crea el pedido. */
  enviando?: boolean
  /** Error del servidor, que se muestra arriba del boton. */
  errorServidor?: string
}

const ETIQUETAS: { campo: keyof DatosDelFormulario; texto: string; tipo: string; ayuda?: string }[] = [
  { campo: 'nombre', texto: 'Nombre', tipo: 'text' },
  { campo: 'apellido', texto: 'Apellido', tipo: 'text' },
  {
    campo: 'telefono',
    texto: 'Telefono',
    tipo: 'tel',
    ayuda: 'Para coordinar la entrega'
  },
  { campo: 'email', texto: 'Email', tipo: 'email', ayuda: 'Te escribimos el estado del pedido' },
  {
    campo: 'direccion',
    texto: 'Direccion de envio',
    tipo: 'text',
    ayuda: 'Calle y numero. El envio lo coordinamos por separado'
  }
]

export const FormularioCheckout = ({
  alEnviar,
  enviando = false,
  errorServidor
}: FormularioCheckoutProps) => {
  const [datos, setDatos] = useState<DatosDelFormulario>(CAMPOS_VACIOS)
  const [tocados, setTocados] = useState<Record<keyof DatosDelFormulario, boolean>>({
    nombre: false,
    apellido: false,
    telefono: false,
    email: false,
    direccion: false
  })

  const errores = erroresDe(datos, tocados)
  const habilitado = estaCompleto(datos) && !enviando

  const cambiar = (campo: keyof DatosDelFormulario, valor: string) => {
    setDatos((previos) => ({ ...previos, [campo]: valor }))
  }

  const tocar = (campo: keyof DatosDelFormulario) => {
    setTocados((previos) => ({ ...previos, [campo]: true }))
  }

  const enviar = (evento: React.FormEvent) => {
    evento.preventDefault()

    if (!habilitado) return

    // Todo tocado, para que si algo falta aparezca el error en su campo y no
    // solo que "no pasa nada".
    setTocados({ nombre: true, apellido: true, telefono: true, email: true, direccion: true })
    alEnviar(datos)
  }

  return (
    <form onSubmit={enviar} noValidate className='space-y-4'>
      {ETIQUETAS.map(({ campo, texto, tipo, ayuda }) => (
        <div key={campo}>
          <label
            htmlFor={`checkout-${campo}`}
            className='mb-1.5 block text-[10px] uppercase tracking-widest text-neutral-400'
          >
            {texto}
            {campo === 'email' && <span className='ml-1 text-wine-400'>·</span>}
          </label>

          <input
            id={`checkout-${campo}`}
            type={tipo}
            autoComplete={campo === 'email' ? 'email' : campo === 'telefono' ? 'tel' : 'off'}
            value={datos[campo]}
            onChange={(e) => cambiar(campo, e.target.value)}
            onBlur={() => tocar(campo)}
            aria-invalid={errores[campo] !== undefined}
            aria-describedby={errores[campo] !== undefined ? `error-${campo}` : undefined}
            className={[
              'w-full rounded-xl border bg-charcoal-800 px-3 py-2.5 text-sm text-cream-100 placeholder-neutral-600 focus:outline-none',
              errores[campo] !== undefined
                ? 'border-wine-500 focus:border-wine-400'
                : 'border-neutral-700 focus:border-gold-500'
            ].join(' ')}
          />

          {errores[campo] !== undefined ? (
            <p id={`error-${campo}`} className='mt-1 text-xs text-wine-400'>
              {errores[campo]}
            </p>
          ) : (
            ayuda !== undefined && <p className='mt-1 text-xs text-neutral-500'>{ayuda}</p>
          )}
        </div>
      ))}

      {errorServidor !== undefined && errorServidor !== '' && (
        <p role='alert' className='rounded-lg border border-wine-500/50 bg-wine-900/40 px-3 py-2 text-sm text-cream-100'>
          {errorServidor}
        </p>
      )}

      <button
        type='submit'
        disabled={!habilitado}
        className='w-full rounded-xl bg-wine-700 py-3.5 text-sm font-semibold uppercase tracking-wider text-cream-100 transition-colors hover:bg-wine-500 disabled:cursor-not-allowed disabled:opacity-40'
      >
        {enviando ? 'Creando el pedido...' : 'Continuar al pago'}
      </button>

      <p className='text-center text-xs text-neutral-500'>
        Pagas en Mercado Pago. No hace falta crear cuenta ni guardar contrasena.
      </p>
    </form>
  )
}
