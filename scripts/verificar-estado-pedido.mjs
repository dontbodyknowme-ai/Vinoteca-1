import { readFileSync } from 'node:fs'

/**
 * Verificacion puntual: ¿un `vendedor` puede cambiar el estado de envio de un
 * pedido a "Entregado"?
 *
 * Es un requisito que el usuario describio como si faltara. Antes de
 * implementarlo, se comprueba si ya funciona: si ya funciona, la spec 009 no lo
 * agrega, lo tiene que **no romper**.
 *
 * Hace el PATCH de verdad y despues lo revierte, asi que el estado final en
 * produccion es el mismo que estaba.
 */

const API = process.env.PUBLIC_API_URL ?? 'https://vinoteca-cava.onrender.com'

const leerClave = (variable) => {
  const crudo = readFileSync('backend/.env', 'utf8')
  const linea = crudo.split(/\r?\n/).find((l) => l.startsWith(`${variable}=`))
  if (linea === undefined) throw new Error(`falta ${variable} en backend/.env`)
  return linea.slice(variable.length + 1).trim().replace(/^["']|["']$/g, '')
}

console.log(`\n  API: ${API}\n`)

const despertar = async () => {
  process.stdout.write('  despertando la API')
  const limite = Date.now() + 150_000
  while (Date.now() < limite) {
    try {
      const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(20_000) })
      if (res.ok) {
        console.log(' — lista')
        return res.json()
      }
    } catch {
      process.stdout.write('.')
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
  throw new Error('la API no desperto')
}

await despertar()

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'vendedor@vinoteca.local',
    password: leerClave('SEED_VENDEDOR_PASSWORD')
  })
})

if (!login.ok) {
  console.log(`  el login del vendedor dio ${login.status}`)
  process.exit(1)
}

const { accessToken } = await login.json()
const pedir = (url, metodo = 'GET', cuerpo = null) =>
  fetch(`${API}${url}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(cuerpo === null ? {} : { 'Content-Type': 'application/json' })
    },
    body: cuerpo === null ? undefined : JSON.stringify(cuerpo)
  })

const lista = await (await pedir('/api/orders?limit=5')).json()
const pedidos = lista.data ?? []

console.log(`  el vendedor lista ${pedidos.length} pedido(s)`)

if (pedidos.length === 0) {
  console.log('  no hay pedidos en la base: no se puede probar el PATCH')
  console.log('  (el seed carga vinos y clientes, no pedidos)\n')
  process.exit(0)
}

const objetivo = pedidos[0]
console.log(`\n  pedido ${objetivo.id}`)
console.log(`    estado actual: ${objetivo.status}`)

console.log('\n  --- el vendedor pone "Entregado" ---')
const puesto = await pedir(`/api/orders/${objetivo.id}`, 'PATCH', { status: 'entregado' })
const cuerpoPuesto = await puesto.json()

if (!puesto.ok) {
  console.log(`    FALLA: dio ${puesto.status} ${cuerpoPuesto.code ?? ''} ${cuerpoPuesto.message ?? ''}`)
} else {
  console.log(`    OK  ${puesto.status}, el pedido quedo en "${cuerpoPuesto.status}"`)
  console.log(`    historial: ${cuerpoPuesto.timeline?.length ?? 0} entrada(s)`)
}

console.log('\n  --- y lo revierte ---')
const revertido = await pedir(`/api/orders/${objetivo.id}`, 'PATCH', { status: objetivo.status })
const cuerpoRevertido = await revertido.json()
console.log(`    ${revertido.ok ? 'OK' : 'FALLA'} ${revertido.status}, quedo en "${cuerpoRevertido.status}"`)

console.log(
  `\n  estado final == estado inicial: ${
    cuerpoRevertido.status === objetivo.status ? 'SI, no queda rastro' : 'NO'
  }\n`
)
