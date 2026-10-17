import { motion } from 'framer-motion'
import { TIENDA } from '../utils/tienda'

export const Footer = () => {
  return (
    <footer id='contacto' className='bg-charcoal-950 border-t border-wine-900/30'>
      <div className='max-w-7xl mx-auto px-6 py-16'>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-12 mb-12'>
          <div>
            <p className='text-gold-500 font-serif text-2xl font-bold tracking-wider mb-4'>
              {TIENDA.nombre}
            </p>
            <p className='text-neutral-400 text-sm leading-relaxed mb-6'>
              Seleccion exclusiva de vinos de alta gama para los paladares mas exigentes.
              Curamos cada etiqueta con pasion y dedicacion.
            </p>
            <div className='flex items-center gap-4'>
              <a href='#' className='text-neutral-400 hover:text-gold-500 transition-colors' aria-label='Instagram'>
                <svg className='w-6 h-6' fill='currentColor' viewBox='0 0 24 24'>
                  <path d='M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z' />
                </svg>
              </a>
              <a href='#' className='text-neutral-400 hover:text-gold-500 transition-colors' aria-label='Facebook'>
                <svg className='w-6 h-6' fill='currentColor' viewBox='0 0 24 24'>
                  <path d='M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' />
                </svg>
              </a>
              <a href='#' className='text-neutral-400 hover:text-gold-500 transition-colors' aria-label='Twitter'>
                <svg className='w-6 h-6' fill='currentColor' viewBox='0 0 24 24'>
                  <path d='M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z' />
                </svg>
              </a>
            </div>
          </div>

          <div>
            <h3 className='text-cream-100 font-serif text-lg font-bold mb-4'>
              Horarios
            </h3>
            <dl className='space-y-3 text-sm'>
              <div className='flex justify-between'>
                <dt className='text-neutral-400'>Lunes - Viernes</dt>
                <dd className='text-cream-200'>10:00 - 21:00</dd>
              </div>
              <div className='flex justify-between'>
                <dt className='text-neutral-400'>Sábados</dt>
                <dd className='text-cream-200'>10:00 - 22:00</dd>
              </div>
              <div className='flex justify-between'>
                <dt className='text-neutral-400'>Domingos</dt>
                <dd className='text-cream-200'>11:00 - 20:00</dd>
              </div>
            </dl>
          </div>

          <div>
            <h3 className='text-cream-100 font-serif text-lg font-bold mb-4'>
              Ubicación
            </h3>
            <address className='text-neutral-400 text-sm not-italic leading-relaxed'>
              <p>Av. del Libertador 1234</p>
              <p>Buenos Aires, Argentina</p>
              <p className='mt-2'>
                <a href='tel:+541145678900' className='hover:text-gold-500 transition-colors'>
                  +54 11 4567 8900
                </a>
              </p>
              <p>
                <a href={`mailto:${TIENDA.email}`} className='hover:text-gold-500 transition-colors'>
                  {TIENDA.email}
                </a>
              </p>
            </address>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className='pt-8 border-t border-neutral-800/50 flex flex-col md:flex-row justify-between items-center gap-4'
        >
          <p className='text-neutral-500 text-sm'>
            © 2024 {TIENDA.nombre}. Todos los derechos reservados.
          </p>
          <p className='text-gold-400 text-sm font-semibold'>
            Prohibida la venta de alcohol a menores de 18 años. Beba con moderación.
          </p>
          <nav className='flex gap-6 text-sm'>
            <a href='#' className='text-neutral-500 hover:text-gold-500 transition-colors'>
              Aviso legal
            </a>
            <a href='#' className='text-neutral-500 hover:text-gold-500 transition-colors'>
              Privacidad
            </a>
            <a href='#' className='text-neutral-500 hover:text-gold-500 transition-colors'>
              Términos
            </a>
          </nav>
        </motion.div>
      </div>
    </footer>
  )
}