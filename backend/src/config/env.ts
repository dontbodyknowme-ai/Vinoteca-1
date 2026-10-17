import 'dotenv/config'
import { z } from 'zod'

/**
 * Origenes CORS: una lista de URLs http(s), separadas por coma.
 *
 * Antes era `z.string()` pelado, que es donde nacio un 500 en produccion.
 *
 * `@fastify/cors` **rechaza en el hook** cualquier `origin` que no sea `*`, una
 * string no vacia, una funcion o un array. Con la variable definida pero
 * vacia (lo que pasa si se carga en un panel y se deja el campo en blanco),
 * `z.string()` la daba por buena y el backend arrancaba perfecto:
 *
 *   Error: Invalid CORS origin option
 *     at resolveOriginOption (@fastify/cors/index.js:159)
 *
 * Es decir: la app levanta, el healthcheck da 200, y **cada request** devuelve
 * 500. El sintoma dice "error interno del servidor" y la causa es una variable
 * de entorno mal cargada.
 *
 * Ademas `origin` acepta un array, asi que varios dominios (preview deploys,
 * el `.vercel.app` de produccion y el de staging) se separan por coma en la
 * misma variable, sin agregar otra.
 */
const origenesCors = z
  .string({ required_error: 'falta. En produccion el frontend no puede llamar a la API' })
  .transform((valor) =>
    valor
      .split(',')
      .map((origen) => origen.trim())
      .filter(Boolean)
  )
  .refine((origenes) => origenes.length > 0, {
    message:
      'esta vacia. En produccion el frontend queda bloqueado por CORS. Mientras no exista el deploy de Vercel, ponela en http://localhost:5173'
  })
  .refine(
    (origenes) =>
      origenes.every((origen) => {
        try {
          const url = new URL(origen)
          return url.protocol === 'http:' || url.protocol === 'https:'
        } catch {
          return false
        }
      }),
    { message: 'cada origen tiene que ser una URL http(s) completa, separados por coma' }
  )

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  // Conexion **sin pooler**, usada solo por `prisma migrate deploy`. Ver el
  // comentario en `prisma/schema.prisma`: con la pooled, PgBouncer deja el
  // advisory lock tomado en una sesion idle y el segundo deploy muere.
  DIRECT_URL: z.string().min(1, 'DIRECT_URL es la conexion SIN pooler que usan las migraciones'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),
  CORS_ORIGIN: origenesCors.default('http://localhost:5173'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  LOGIN_RATE_MAX: z.coerce.number().int().positive().default(5),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('wine-images'),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  // URL **pública** del bucket, distinta de `STORAGE_ENDPOINT` (que es el
  // endpoint de la API S3 y no se puede abrir en un navegador).
  // Cloudflare R2: https://pub-<cuenta>.r2.dev  (o un dominio propio)
  // La devuelve `POST /api/upload` y es la que queda guardada en el vino.
  // No se firma: una URL firmada caduca en una hora y el vino la tiene guardada
  // para siempre, o sea que la imagen se rompia al dia siguiente.
  STORAGE_PUBLIC_URL: z.string().url(),
  PUBLIC_API_URL: z.string().url(),

  /**
   * Secreto de la webhook de Mercado Pago (spec 009, T4).
   *
   * **Opcional a proposito**, y esta es una excepcion al "todo sensible se
   * valida": sin el, el checkout igual no funciona —no hay Preference— asi que
   * la app levanta y avisa por `stderr` en vez de negarse a arrancar. Un deploy
   * sin la variable deberia dejar ver **todo lo demas** funcionando y despues
   * fallar solo en el pago, no tirar abajo el catalogo entero.
   *
   * El webhook **valida la firma contra esto**. Si se aceptara la notificacion
   * sin validar, cualquiera que descubra la URL podria poner `aprobado` en un
   * pedido que no se pago — que es un alta de pedido gratis, no un bug de
   * permisos.
   */
  MERCADO_PAGO_WEBHOOK_SECRET: z.string().min(1).optional(),

  /**
   * Token de la cuenta de Mercado Pago (spec 009, T3).
   *
   * Opcional por lo mismo que el secreto de la webhook: sin el, `POST /api/orders`
   * responde 500 con un mensaje que lo dice, y el catalogo y el panel igual
   * funcionan.
   *
   * **Opcional y ademas validado**, lo cual suena contradictorio pero no lo es:
   * que no sea obligatoria evita que un deploy sin Mercado Pago no levante;
   * declararla evita que sea una variable suelta que nadie encuentra cuando hay
   * que ponerla. Una variable que el codigo lee y el esquema no conoce es una
   * variable que no aparece en `.env.example` y a la que nadie llega.
   */
  MERCADO_PAGO_ACCESS_TOKEN: z.string().min(1).optional()
})

/**
 * En produccion `CORS_ORIGIN` es obligatoria.
 *
 * Sin esto, un deploy que se olvide de la variable no falla: cae al default
 * `http://localhost:5173` y la API responde contenta, mientras el frontend en
 * `*.vercel.app` la rechaza por CORS. El unico sintoma es un error en el
 * navegador, sin nada raro en el log del servidor.
 */
const validado = esquema.superRefine((valores, ctx) => {
  if (valores.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ORIGIN'],
      message:
        'falta. En produccion no hay default: el frontend real la necesita y sin esto cada request falla por CORS'
    })
  }
})

const resultado = validado.safeParse(process.env)

if (!resultado.success) {
  // Un `ZodError` crudo es inservible: son 40 lineas de JSON con dos mitades
  // que se pisan, `"message"` repetido y corchetes sin cerrar, y con
  // `pino-pretty` el logger lo embarra todavia mas. Ademas no dice que hacer.
  const problemas = resultado.error.issues.map((issue) => {
    const donde = issue.path.length ? issue.path.join('.') : '(raiz)'
    return `  - ${donde}: ${issue.message}`
  })

  process.stderr.write(
    [
      '',
      'Faltan variables de entorno o tienen un valor invalido:',
      '',
      ...problemas,
      '',
      'Ver backend/.env.example para la lista completa con su documentacion.',
      '',
      `  ${problemas.length} problema(s). Nada arranco.`,
      ''
    ].join('\n')
  )

  process.exit(1)
}

export const env = resultado.data

/**
 * Aviso por `NODE_ENV` mal puesto.
 *
 * `NODE_ENV` decide el comportamiento de varias cosas **sin fallar** cuando no
 * es el esperado:
 *
 *   - la cookie de refresh sale `SameSite=Lax` sin `Secure`, y la sesion muere
 *     en cada recarga de pagina
 *   - `CORS_ORIGIN` deja de ser obligatoria y cae al default de localhost
 *   - `CORS_ORIGIN` vacia no rompe el arranque (la schema la rechaza, pero solo
 *     si la variable existe)
 *
 * Los tres son fallos silenciosos: la app levanta, el healthcheck da 200 y el
 * unico sintoma esta del lado del navegador. Paso de verdad: `NODE_ENV` sin
 * poner en Render dejo la sesion del panel rota y no habia forma de saberlo
 * desde los logs del servidor.
 *
 * `PUBLIC_API_URL` con `https://` es la senal de que esto **no** es desarrollo
 * local: siTL;DR: pasame lo que sigue del proyecto y seguimos<tool_call>
<invoke name="edit"><path>C:\Vinoteca\Vinoteca-1\backend\src\config\env.ts</path><newString>export const env = resultado.data

/**
 * Aviso por `NODE_ENV` mal puesto.
 *
 * `NODE_ENV` decide el comportamiento de varias cosas **sin fallar** cuando no
 * es el esperado:
 *
 *   - la cookie de refresh sale `SameSite=Lax` y sin `Secure`, asi que la
 *     sesion muere en cada recarga de pagina
 *   - `CORS_ORIGIN` deja de ser obligatoria y cae al default de localhost
 *
 * Los dos son fallos silenciosos: la app levanta, `/health` da 200 y el unico
 * sintoma esta del lado del navegador. Paso de verdad: `NODE_ENV` sin poner en
 * Render dejo la sesion del panel rota y no habia forma de saberlo desde los
 * logs del servidor.
 *
 * `PUBLIC_API_URL` con `https://` es la senal de que esto **no** es desarrollo
 * local. Si lo es, el aviso se equivoca; preferible eso a no avisar nunca.
 */
if (env.NODE_ENV !== 'production' && env.PUBLIC_API_URL.startsWith('https://')) {
  process.stderr.write(
    [
      '',
      'AVISO: NODE_ENV=' + env.NODE_ENV + ' pero PUBLIC_API_URL es https://.',
      'Esto parece produccion con el entorno mal puesto. Consecuencias:',
      '  - la cookie de refresh va con SameSite=Lax y sin Secure, y la sesion',
      '    se pierde en cada recarga de pagina',
      '  - CORS_ORIGIN deja de ser obligatoria',
      '',
      ''
    ].join('\n')
  )
}
