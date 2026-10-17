import { defineConfig } from 'vitest/config'

// Configuracion exclusiva de Vitest.
// Se ubica en `vitest.config.ts` (y no dentro de `vite.config.ts`) a proposito:
// Vite solo auto-carga `vite.config.*`, por lo que este archivo no altera
// en absoluto el pipeline de `vite build` ni el de `vite dev`.
export default defineConfig({
  test: {
    // jsdom habilita los tests de componentes presentes y futuros.
    environment: 'jsdom',

    /**
     * La URL importa mas de lo que parece: **sin origen, `localStorage` no
     * existe**. jsdom lo expone `undefined`, no un objeto vacio, asi que
     * `localStorage.getItem(...)` es un `TypeError` y no un `null`.
     *
     * La app usa `localStorage` para el catalogo y el carrito, asi que un
     * entorno sin URL no puede probar los tests que tocan el almacenamiento —
     * que son justamente los que verifican que el carrito sobreviva a una
     * recarga. Con `about:blank` el origen es opaco y no hay almacenamiento.
     */
    environmentOptions: {
      jsdom: { url: 'http://localhost:5173' }
    },

    // Solo se recolectan tests dentro de la carpeta `test/` del proyecto.
    include: ['test/**/*.test.ts'],

    // Exclusion explicita: node_modules ya queda fuera por defecto, pero se
    // declara junto a .opencode y .agents para garantizar que ningun archivo
    // de tooling del agente se interprete como suite de tests.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.opencode/**',
      '**/.agents/**',
      '**/.git/**',
      '**/cypress/**'
    ],

    // Modo no interactivo por defecto: aunque alguien invoque `vitest` sin
    // argumentos, nunca se queda en watch. `npm test` usa `vitest run`.
    watch: false
  }
})