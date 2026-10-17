import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  loginSchema,
  wineCreateSchema,
  wineUpdateSchema,
  wineIdParamSchema,
  wineQuerySchema,
  importResultSchema,
  orderQuerySchema,
  orderIdParamSchema,
  orderUpdateSchema,
  customerQuerySchema,
  customerIdParamSchema,
  customerUpdateSchema,
  uploadIdParamSchema
} from './schemas.js'

const toJsonSchema = (schema: any) => zodToJsonSchema(schema, { $refStrategy: 'none' })

/**
 * Objeto "documentado pero no recortado".
 *
 * Fastify **no** serializa con `JSON.stringify`: compila el `response.schema`
 * con `fast-json-stringify`, y ese serializador **descarta toda propiedad que
 * no este declarada**. Un `{ type: 'object' }` a secas no declara ninguna, asi
 * que devuelve `{}`:
 *
 *   s({ type: 'object', properties: { user: { type: 'object' } } })
 *     ({ accessToken: 'abc', user: { id: '1', role: 'admin' } })
 *   // -> {"accessToken":"abc","user":{}}      <-- el usuario desaparece
 *
 * Eso rompia la integracion entera sin que nada diera error: el login
 * respondia 200 con `user: {}`, `hasRole('admin')` daba `false` y el boton de
 * "Panel Admin" no aparecia hasta recargar la pagina (recien ahi entra por
 * `/auth/me`, que si tiene schema completo). Las metricas del dashboard
 * volvian `{}` y el alta de vinos contestaba 201 con cuerpo vacio.
 *
 * `additionalProperties: true` le dice al serializador que conserve lo que no
 * este declarado. Las `properties` que si aparecen siguen documentando en
 * Swagger: estos schemas son documentacion, no contratos cerrados. Convertir
 * cada respuesta en un contrato validado es trabajo aparte, endpoint por
 * endpoint.
 */
const objetoLibre = (): { type: 'object'; additionalProperties: true } => ({
  type: 'object',
  additionalProperties: true
})

const errorLibre = {
  type: 'object' as const,
  properties: { code: { type: 'string' }, message: { type: 'string' } },
  additionalProperties: true
}

export const jsonSchemas = {
  login: {
    body: toJsonSchema(loginSchema),
    response: {
      200: {
        type: 'object',
        properties: { accessToken: { type: 'string' }, user: objetoLibre() },
        additionalProperties: true
      },
      401: errorLibre,
      429: errorLibre
    }
  },
  refresh: {
    // Sin `body`: este endpoint lee la cookie `refreshToken`, no el cuerpo.
    // Declarar `z.object({})` obligaba al cliente a mandar `{}` y, sin body,
    // AJV rechazaba con "body must be object" -> 500.
    response: {
      200: {
        type: 'object',
        properties: { accessToken: { type: 'string' }, user: objetoLibre() },
        additionalProperties: true
      },
      401: errorLibre
    }
  },
  logout: {
    // Idem `refresh`: la sesion sale de la cookie.
    response: {
      204: { type: 'null' },
      401: errorLibre
    }
  },
  me: {
    response: {
      200: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string' }
        },
        additionalProperties: true
      },
      401: errorLibre
    }
  },
  wines: {
    list: {
      querystring: toJsonSchema(wineQuerySchema),
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array' },
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            totalPages: { type: 'number' }
          },
          additionalProperties: true
        }
      }
    },
    create: {
      body: toJsonSchema(wineCreateSchema),
      response: { 201: objetoLibre(), 400: errorLibre }
    },
    update: {
      params: toJsonSchema(wineIdParamSchema),
      body: toJsonSchema(wineUpdateSchema),
      response: { 200: objetoLibre(), 404: errorLibre }
    },
    delete: {
      params: toJsonSchema(wineIdParamSchema),
      response: { 204: { type: 'null' }, 404: errorLibre, 409: errorLibre }
    },
    import: {
      response: {
        201: toJsonSchema(importResultSchema),
        207: toJsonSchema(importResultSchema)
      }
    },
    public: {
      response: { 200: { type: 'array' } }
    }
  },
  orders: {
    list: {
      querystring: toJsonSchema(orderQuerySchema),
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array' },
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            totalPages: { type: 'number' }
          },
          additionalProperties: true
        }
      }
    },
    get: {
      params: toJsonSchema(orderIdParamSchema),
      response: { 200: objetoLibre(), 404: errorLibre }
    },
    update: {
      params: toJsonSchema(orderIdParamSchema),
      body: toJsonSchema(orderUpdateSchema),
      response: { 200: objetoLibre(), 403: errorLibre, 404: errorLibre }
    },
    /**
     * La webhook de Mercado Pago (spec 009, T4).
     *
     * `body: objetoLibre()` a proposito: la firma se valida contra el `data.id`,
     * y validar el **shape** con JSON Schema antes daria un `400` a Mercado Pago
     * por un evento que no nos interesa (alta de Preference, por ejemplo) y lo
     * haria reintentar para siempre. El handler filtra por lo que le sirve.
     */
    webhook: {
      body: objetoLibre(),
      response: {
        200: {
          type: 'object',
          properties: {
            received: { type: 'boolean' },
            applied: { type: 'boolean' },
            estado: { type: 'string' }
          },
          additionalProperties: true
        },
        202: objetoLibre(),
        401: errorLibre,
        503: errorLibre
      }
    },
    /**
     * El checkout (spec 009, T3).
     *
     * El `body` va como `objetoLibre()` y no como `toJsonSchema(orderCreateSchema)`
     * **a proposito**: la validacion fina la hace `orderCreateSchema` dentro del
     * handler, y duplicarla aca significaria dos lugares que mantener. Si
     * Fastify rechazara antes, el `details` del 400 seria el del JSON Schema, que
     * no es el mensaje que el frontend muestra debajo del campo.
     *
     * El 201 **declarado propiedad por propiedad**: `fast-json-stringify`
     * **descarta** lo que no este declarado (gotcha 11 de `AGENTS.md`), y esta
     * respuesta sin `initPoint` seria un 201 de mentira —el frontend no tendria
     * a donde mandar al comprador y el fallo aparece en el navegador, no en el
     * servidor.
     */
    create: {
      body: objetoLibre(),
      response: {
        201: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            preferenceId: { type: 'string' },
            initPoint: { type: 'string' },
            total: { type: 'number' }
          },
          additionalProperties: true
        },
        400: errorLibre
      }
    }
  },
  customers: {
    list: {
      querystring: toJsonSchema(customerQuerySchema),
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array' },
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            totalPages: { type: 'number' }
          },
          additionalProperties: true
        }
      }
    },
    get: {
      params: toJsonSchema(customerIdParamSchema),
      response: { 200: objetoLibre(), 404: errorLibre }
    },
    update: {
      params: toJsonSchema(customerIdParamSchema),
      body: toJsonSchema(customerUpdateSchema),
      response: { 200: objetoLibre(), 404: errorLibre }
    }
  },
  metrics: {
    get: {
      response: { 200: objetoLibre() }
    }
  },
  upload: {
    post: {
      response: {
        201: {
          type: 'object',
          properties: { id: { type: 'string' }, url: { type: 'string' } },
          additionalProperties: true
        },
        413: errorLibre,
        415: errorLibre
      }
    },
    delete: {
      params: toJsonSchema(uploadIdParamSchema),
      response: { 204: { type: 'null' }, 404: errorLibre }
    }
  },
  health: {
    get: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
            db: { type: 'string' }
          },
          additionalProperties: true
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
            db: { type: 'string' }
          },
          additionalProperties: true
        }
      }
    }
  }
}
