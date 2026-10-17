import { motion } from 'framer-motion'
import { TIENDA } from '../utils/tienda'
import type { Wine } from '../types/vino'

/**
 * Hero clasico y premium para la marca 2920.
 *
 * **Sin botella 3D.** El canvas de Three.js se saco del hero: pesaba ~376 kB
 * de chunk y en movil no se veia por debajo de 640px. En su lugar, el hero
 * muestra las tres botellas destacadas del catalogo en una fila elegante.
 *
 * **Tipografia protagonista.** El nombre "2920" es el titular principal,
 * con un subtitulo que evoca la tradicion vinicola y un CTA claro.
 *
 * Recibe `wines` y `onSelectWine` para renderizar las destacadas directamente,
 * sin intermediarios.
 */
interface HeroProps {
  wines: Wine[]
  onSelectWine: (wine: Wine) => void
}

export const Hero = ({ wines, onSelectWine }: HeroProps) => {
  const destacados = [...wines].sort((a, b) => b.price - a.price).slice(0, 3)

  return (
    <section id='hero' className='relative overflow-hidden bg-charcoal-950'>
      {/* Fondo con gradiente sutil para profundidad */}
      <div className='absolute inset-0 bg-gradient-to-b from-charcoal-950 via-charcoal-900/50 to-charcoal-950' />

      <div className='relative mx-auto flex min-h-screen w-full max-w-screen-2xl flex-col items-center justify-center px-6 py-20 lg:px-12 lg:py-24'>
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className='mx-auto max-w-3xl text-center'
        >
          <p className='mb-3 font-serif text-2xl font-bold uppercase tracking-wider text-cream-100 md:text-3xl'>
            Tienda Digital
          </p>
          <p className='mb-6 text-xs font-semibold uppercase tracking-[0.4em] text-gold-500'>
            Un detalle especial, Un buen momento. A un click de distancia
          </p>

          <h1 className='mb-8'>
            <img
              src='/logo-2920.svg'
              alt={TIENDA.nombre}
              className='mx-auto h-48 w-auto md:h-64'
            />
          </h1>

          <div className='mx-auto mb-8 h-px w-24 bg-gold-500/60' />

          <p className='mx-auto mb-12 max-w-xl font-light leading-relaxed text-lg text-neutral-400 md:text-xl'>
            Elegí lo que buscas y recibilo en la puerta de tu casa, de manera simple, cómoda y segura.
          </p>
          <p className='-mt-8 mb-12 text-sm font-semibold uppercase tracking-widest text-gold-500'>
            Bebidas · Regalería · Gastronomía
          </p>

          <motion.a
            href='#catalogo'
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className='inline-flex items-center gap-3 rounded-lg border border-gold-500/40 bg-wine-700 px-10 py-4 text-sm font-semibold uppercase tracking-widest text-cream-100 shadow-lg shadow-wine-900/40 transition-all duration-300 hover:bg-wine-600 hover:shadow-wine-800/50'
          >
            Explorar Productos
            <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M17 8l4 4m0 0l-4 4m4-4H3' />
            </svg>
          </motion.a>
        </motion.div>

        {/* Título de promociones */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
          className='mt-16 text-center'
        >
          <h2 className='font-serif text-3xl font-bold uppercase tracking-widest text-cream-100 md:text-4xl'>
            Promociones <span className='text-gold-500'>&</span> Combos
          </h2>
          <div className='mx-auto mt-4 h-0.5 w-16 bg-gold-500/60' />
        </motion.div>

        {/* Botellas destacadas */}
        {destacados.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
            className='mx-auto mt-20 max-w-4xl'
          >
            <div className='grid grid-cols-1 gap-6 sm:grid-cols-3'>
              {destacados.map((wine, i) => (
                <motion.button
                  key={wine.id}
                  type='button'
                  onClick={() => onSelectWine(wine)}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.5 + i * 0.15, ease: 'easeOut' }}
                  className='group relative overflow-hidden rounded-2xl border border-neutral-800 bg-charcoal-900/80 text-left transition-all duration-300 hover:border-gold-500/40 hover:shadow-xl hover:shadow-wine-900/20'
                >
                  <div className='relative aspect-[3/4] w-full overflow-hidden'>
                    <img
                      src={wine.imageUrl}
                      alt={wine.name}
                      className='h-full w-full object-cover transition-transform duration-700 group-hover:scale-105'
                    />
                    <div className='absolute inset-0 bg-gradient-to-t from-charcoal-950/90 via-transparent to-transparent' />
                    <span className='absolute bottom-4 left-4 right-4'>
                      <span className='block font-serif text-base font-bold text-cream-100 transition-colors group-hover:text-gold-400'>
                        {wine.name}
                      </span>
                      <span className='mt-1 block text-xs uppercase tracking-wider text-neutral-400'>
                        {wine.winery} &middot; {wine.vintage}
                      </span>
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </section>
  )
}
