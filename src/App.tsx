import { useState, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Wine, CartItem } from './types/vino'
import { INITIAL_WINES } from './datos/vino'
import { Checkout } from './pages/checkout'
import { Navbar } from './components/barra_de_navegacion'
import { Hero } from './components/hero'

import { ProductCatalog } from './components/carta_de_catalogo'
import { CartDrawer } from './components/carrito_de_compras'
import { ProductForm } from './components/editor_formador_productos'
import { VistaRapidaProducto } from './components/vista_rapida_producto'
import { Footer } from './components/pie_de_pagina'
import { AnimatedSection } from './components/animated_section'

const STORAGE_KEY_WINES = 'vinoteca_wines'
const STORAGE_KEY_CART = 'vinoteca_cart'

// El acceso al panel ya no vive aca. T1 dejo un flag `isAdmin` en
// `localStorage` que cualquier visitante activaba con un boton en la navbar, y
// que ademas se podia poner en `true` desde la consola. Se reemplazo por una
// clave en `src/utils/admin_acceso.ts`, que ademas no es ningun boton: al panel
// se entra escribiendo `/admin`.

// RF-34 y CE-01: si lo guardado no es un array con contenido, se arranca con
// el catalogo inicial. Sin estas dos guardas, un `localStorage` con `"{}"` o con
// `"[]"` deja el catalogo vacio y la pagina muestra un estado de "no hay
// etiquetas" en lugar del catalogo de la tienda.
function loadWines(): Wine[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_WINES)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // ignore
  }
  return INITIAL_WINES
}

function saveWines(wines: Wine[]) {
  localStorage.setItem(STORAGE_KEY_WINES, JSON.stringify(wines))
}

// Misma guarda que `loadWines`, por el mismo motivo (RF-34, CE-02): lo guardado
// tiene que ser un array, o se arranca con el carrito vacio.
function loadCart(): CartItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_CART)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    // ignore
  }
  return []
}

function saveCart(cart: CartItem[]) {
  localStorage.setItem(STORAGE_KEY_CART, JSON.stringify(cart))
}

export default function App() {
  const ubicacion = useLocation()
  const [wines, setWines] = useState<Wine[]>(() => loadWines())
  const [cart, setCart] = useState<CartItem[]>(() => loadCart())
  const [searchQuery, setSearchQuery] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [vinoAEditar, setVinoAEditar] = useState<Wine | null>(null)
  const [selectedWine, setSelectedWine] = useState<Wine | null>(null)
  const [minPrice, setMinPrice] = useState<number | ''>('')
  const [maxPrice, setMaxPrice] = useState<number | ''>('')
  const [selectedVarietals, setSelectedVarietals] = useState<string[]>([])
  // `pedidoConfirmado` se fue con la 009: era un cartel que salia sin que
  // hubiera pasado nada — el carrito se vaciaba y se decia "gracias" sin
  // pedido, sin pago y sin pasarela. Ahora la confirmacion la dice el backend,
  // despues de que Mercado Pago confirme.
  // El estado `isAdmin` y su toggle se agregan en T9, junto con el boton del
  // navbar que los consume. Declararlos en T1 dejaba el setter sin uso y el
  // `noUnusedLocals` del proyecto lo rechaza: el flag queda persistido por las
  // funciones de arriba y el estado nace cuando hay algo que lo lea.

  useEffect(() => {
    saveWines(wines)
  }, [wines])

  useEffect(() => {
    saveCart(cart)
  }, [cart])

  const agregarAlCarrito = useCallback((wine: Wine) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === wine.id)
      if (existing) {
        return prev.map((item) =>
          item.product.id === wine.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      }
      return [...prev, { product: wine, quantity: 1 }]
    })
  }, [])

  const actualizarCantidad = useCallback((wineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.product.id === wineId ? { ...item, quantity: item.quantity + delta } : item
        )
        .filter((item) => item.quantity > 0)
    )
  }, [])

  const eliminarDelCarrito = useCallback((wineId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== wineId))
  }, [])

  // RF-27: mensaje de pedido confirmado y carrito vacio, sin recargar la
  // pagina. Se renderiza en el JSX de mas abajo como <p role='status'>, no con
  // `alert`: `alert` bloquea la ejecucion, y el test de RF-45 lee el DOM para
  // encontrar el mensaje.
  const finalizarCompra = useCallback(() => {
    if (cart.length === 0) return
    // Antes vaciaba el carrito y mostraba un cartel de "Pedido confirmado" sin
    // que hubiera pasado nada. **No se vacia aca**: si el comprador cancela en
    // Mercado Pago, su carrito tiene que seguir ahi (D-D de la 009).
    window.location.assign('/checkout')
  }, [cart.length])

  const agregarWine = useCallback((wine: Wine) => {
    setWines((prev) => [...prev, wine])
  }, [])

  const actualizarWine = useCallback((wine: Wine) => {
    setWines((previo) =>
      previo.map((w) => (w.id === wine.id ? wine : w))
    )
  }, [])

  const editarWine = useCallback((wine: Wine) => {
    setVinoAEditar(wine)
    setAdminOpen(true)
  }, [])

  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0)

  // El checkout vive en `App` y no en una pagina aparte porque **el carrito esta
  // aca**: en `localStorage` y en este estado, sin contexto. Si `Checkout` fuera
  // su propia ruta con su propio componente, el formulario no tendria que
  // mandar.
  //
  // Y decide por la URL, no por una prop: la URL es la unica fuente, y una prop
  // que puede no coincidir con el `pathname` es una prop que un dia coincide
  // menos.
  if (ubicacion.pathname === '/checkout') {
    return (
      <Checkout
        items={cart}
        alConfirmar={() => {
          // El carrito se vacia **solo** con el pago aprobado. Si el comprador
          // cancela en Mercado Pago, su carrito sigue ahi (D-D de la 009).
          setCart([])
          setCartOpen(false)
        }}
      />
    )
  }

  return (
    <>
      <Navbar
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
      {/* El hero no lleva `AnimatedSection`: es la primera pantalla y tiene su
          propia animacion de entrada. Envolverlo haria que el reveal por scroll
          lo mantuviera fuera de vista al cargar. */}
      <Hero wines={wines} onSelectWine={setSelectedWine} />

      <AnimatedSection>
        <ProductCatalog
          searchQuery={searchQuery}
          onAddToCart={agregarAlCarrito}
          onSelectWine={setSelectedWine}
          onEditWine={editarWine}
          minPrice={minPrice}
          maxPrice={maxPrice}
          selectedVarietals={selectedVarietals}
          onMinPriceChange={setMinPrice}
          onMaxPriceChange={setMaxPrice}
          onVarietalsChange={setSelectedVarietals}
        />
      </AnimatedSection>
      <CartDrawer
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cart}
        onUpdateQuantity={actualizarCantidad}
        onRemoveItem={eliminarDelCarrito}
        onCheckout={finalizarCompra}
      />
      <ProductForm
        isOpen={adminOpen}
        onClose={() => {
          setAdminOpen(false)
          setVinoAEditar(null)
        }}
        onAddWine={agregarWine}
        onUpdateWine={actualizarWine}
        wineToEdit={vinoAEditar}
      />
      <AnimatedSection>
        <Footer />
      </AnimatedSection>
      {/* RF-35 a RF-37: la vista rapida se monta SIEMPRE y es su `AnimatePresence`
          interno el que decide si hay algo que mostrar. Montarla con
          `selectedWine !== null` la desmontaria de golpe al cerrar y la animacion
          de salida no correria. */}
      <VistaRapidaProducto
        wine={selectedWine}
        onClose={() => setSelectedWine(null)}
      />
    </>
  )
}