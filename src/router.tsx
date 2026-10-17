import { createBrowserRouter } from 'react-router-dom'
import App from './App'
import { AdminLayout } from './components/admin/admin_layout'
import { CatalogoAdmin } from './pages/admin/catalogo'
import { ClientesAdmin } from './pages/admin/clientes'
import { ConfiguracionAdmin } from './pages/admin/configuracion'
import { Dashboard } from './pages/admin/dashboard'
import { PedidosAdmin } from './pages/admin/pedidos'

// La proteccion de las rutas admin NO vive aqui: la hace AdminLayout en T2,
// que es el unico componente que se monta en todas las hijas y por lo tanto el
// unico lugar donde un redirect no esquivaria las rutas hijas.
//
// `catchAll` esta para que una URL desconocida en el admin no quede en blanco.
// Va al inicio publico, no a un 404 propio: la 004-a no define un 404.
//
// El checkout (`/checkout`, spec 009) es **publico y va antes del admin**: el
// comprador no tiene sesion.
//
// Las dos rutas publicas renderizan el **mismo** `App`. El carrito vive en
// `localStorage` y en el estado de `App`, no en un contexto, asi que el checkout
// necesita a `App` para poder mandar. Que `App` decida con `useLocation()` en
// vez de recibir una prop `rutaInterna` es a proposito: **la URL es la unica
// fuente**, y una prop que puede no coincidir con ella es una prop que un dia
// va a coincidir menos.
export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />
  },
  {
    path: '/checkout',
    element: <App />
  },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'catalogo', element: <CatalogoAdmin /> },
      { path: 'pedidos', element: <PedidosAdmin /> },
      { path: 'clientes', element: <ClientesAdmin /> },
      { path: 'configuracion', element: <ConfiguracionAdmin /> },
      { path: '*', element: <Dashboard /> }
    ]
  }
])
