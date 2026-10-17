import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../hooks/useAuth'
import { TIENDA } from '../utils/tienda'

const NAV_LINKS = [
  { href: '#hero', label: 'Inicio' },
  { href: '#catalogo', label: 'Catálogo' },
  { href: '#contacto', label: 'Contacto' }
]

interface NavbarProps {
  cartCount: number
  onOpenCart: () => void
  searchQuery: string
  onSearchChange: (query: string) => void
}

export const Navbar = ({
  cartCount,
  onOpenCart,
  searchQuery,
  onSearchChange
}: NavbarProps) => {
  const { user, isLoading, isAuthenticated, logout, hasRole } = useAuth()
  const [isScrolled, setIsScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const handleNavClick = (href: string) => {
    setMobileMenuOpen(false)
    const target = document.querySelector(href)
    if (target) {
      const headerOffset = 80
      const elementPosition = target.getBoundingClientRect().top
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      })
    }
  }

  const handleLogout = async () => {
    await logout()
  }

  return (
    <>
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6 }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled
            ? 'bg-charcoal-900/90 backdrop-blur-md shadow-lg border-b border-wine-900/50 py-3'
            : 'bg-transparent py-5'
        }`}
      >
        <div className='max-w-7xl mx-auto px-6 flex items-center justify-between'>
          <a href='#' className='flex items-center gap-2'>
            <img
              src='/logo-2920.svg'
              alt={TIENDA.nombre}
              className='h-10 w-auto'
            />
          </a>

          <nav className='flex-1 max-w-md mx-8 hidden md:block'>
            <ul className='flex items-center justify-center gap-8'>
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <button
                    onClick={() => handleNavClick(link.href)}
                    className='text-cream-200 hover:text-gold-500 text-xs uppercase tracking-widest font-semibold transition-colors relative py-2'
                  >
                    {link.label}
                    <span className='absolute bottom-0 left-0 w-0 h-0.5 bg-gold-500 transition-all duration-300' />
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className='flex-1 max-w-md mx-8 hidden md:block'>
            <input
              type='text'
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder='Buscar por etiqueta, cepa o bodega...'
              className='w-full bg-charcoal-800/80 text-cream-100 placeholder-neutral-500 px-4 py-2 rounded-full border border-neutral-700/50 focus:outline-none focus:border-gold-500 text-sm transition-colors'
            />
          </div>

          <div className='flex items-center gap-4'>
            {/* Botón "Panel Admin" solo para admin/gestor */}
            {isAuthenticated && (hasRole('admin') || hasRole('gestor')) && (
              <button
                onClick={() => window.location.href = '/admin'}
                className='text-xs uppercase tracking-widest text-cream-200 hover:text-gold-500 px-3 py-2 rounded-lg border border-neutral-700 hover:border-gold-500 transition-colors hidden sm:block'
              >
                Panel Admin
              </button>
            )}

            {/* Botón Cargar Vino solo para admin/gestor (legacy) */}
            {isAuthenticated && (hasRole('admin') || hasRole('gestor')) && (
              <button
                onClick={() => window.location.href = '/admin/catalogo'}
                className='text-xs uppercase tracking-widest text-cream-200 hover:text-gold-500 px-3 py-2 rounded-lg border border-neutral-700 hover:border-gold-500 transition-colors hidden sm:block'
              >
                + Cargar Vino
              </button>
            )}

            <button
              onClick={onOpenCart}
              className='relative p-2 text-cream-100 hover:text-gold-500 transition-colors'
              aria-label='Carrito de compras'
            >
              <svg
                className='w-6 h-6'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z'
                />
              </svg>
              {cartCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className='absolute -top-1 -right-1 bg-wine-500 text-cream-100 text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center'
                >
                  {cartCount}
                </motion.span>
              )}
            </button>

            {/* Auth: User menu only for authenticated users */}
            {isLoading ? (
              <div className='w-8 h-8 border-2 border-gold-500/30 border-t-gold-500 rounded-full animate-spin' />
            ) : isAuthenticated ? (
              <div className='relative'>
                <button
                  className='flex items-center gap-2 p-2 text-cream-100 hover:text-gold-500 transition-colors'
                  aria-label='Menú de usuario'
                >
                  <div className='w-8 h-8 bg-wine-700 rounded-full flex items-center justify-center text-sm font-semibold text-cream-100'>
                    {user?.name?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <span className='hidden sm:block text-sm font-medium'>{user?.name}</span>
                </button>
              </div>
            ) : (
              <span className='hidden sm:block' />
            )}

            <button
              onClick={() => setMobileMenuOpen(true)}
              className='md:hidden p-2 text-cream-100 hover:text-gold-500 transition-colors'
              aria-label='Abrir menú de navegación'
              aria-expanded={mobileMenuOpen}
            >
              <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M4 6h16M4 12h16M4 18h16' />
              </svg>
            </button>
          </div>
        </div>
      </motion.header>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className='fixed inset-0 bg-black/70 backdrop-blur-sm z-50 md:hidden'
              aria-hidden='true'
            />

            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className='fixed top-0 right-0 bottom-0 w-full max-w-sm bg-charcoal-900 border-l border-wine-900/50 text-cream-100 z-50 flex flex-col shadow-2xl md:hidden'
              role='dialog'
              aria-label='Menú de navegación'
            >
              <div className='p-6 border-b border-neutral-800 flex items-center justify-between'>
                {/* El drawer mobile abria con el titulo "Navegacion" y **sin
                    nombre de tienda**, mientras la barra de escritorio muestra el
                    logo. O sea que en el movil no se decia de que tienda era el
                    menu que se estaba abriendo.

                    El nombre sale de `TIENDA.nombre` y no de un texto aca: es el
                    mismo que muestra Configuracion, y asi un rebranding no
                    puede olvidarse este archivo —que es exactamente lo que paso
                    con el nombre viejo. El logo va con `alt` y no como texto
                    porque si la imagen no carga, el `alt` es lo que queda. */}
                <div className='flex items-center gap-2.5'>
                  <img
                    src='/logo-2920.svg'
                    alt={TIENDA.nombre}
                    className='h-8 w-auto'
                  />
                  <span className='font-serif text-lg font-bold tracking-tight text-cream-100'>
                    {TIENDA.nombre}
                  </span>
                </div>

                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className='text-neutral-400 hover:text-cream-100 p-2 rounded-lg hover:bg-neutral-800 transition-colors'
                  aria-label='Cerrar menú'
                >
                  ✕
                </button>
              </div>

              <nav className='flex-1 p-6' aria-label='Navegación'>
                <h2 className='mb-4 text-[10px] uppercase tracking-widest text-neutral-500'>
                  Navegación
                </h2>
                <ul className='flex flex-col gap-4'>
                  {NAV_LINKS.map((link) => (
                    <li key={link.href}>
                      <button
                        onClick={() => handleNavClick(link.href)}
                        className='text-cream-200 hover:text-gold-500 text-lg font-semibold py-3 text-left border-b border-neutral-800 transition-colors'
                      >
                        {link.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>

              <div className='p-6 border-t border-neutral-800 bg-charcoal-950/80 space-y-3'>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false)
                    window.location.href = '/admin/catalogo'
                  }}
                  className='w-full bg-wine-700 hover:bg-wine-500 text-cream-100 py-3 rounded-xl font-semibold tracking-wider uppercase transition-all duration-300 border border-wine-500/30'
                >
                  + Cargar Vino
                </button>

                {isAuthenticated ? (
                  <>
                    <button
                      onClick={handleLogout}
                      className='w-full bg-neutral-800 hover:bg-neutral-700 text-cream-100 py-3 rounded-xl font-semibold tracking-wider uppercase transition-all duration-300 border border-neutral-700'
                    >
                      Cerrar sesión
                    </button>
                  </>
                ) : (
                    <span className='hidden' />
                  )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}