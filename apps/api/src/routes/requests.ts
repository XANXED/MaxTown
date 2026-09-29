import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { RequestAction, RequestInput } from '@maxtown/shared';
import { REQUEST_CATEGORIES } from '@maxtown/shared/requests';
import { canManageServices, findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import { inTransaction } from '../db/transaction.ts';
import {
  addRequestComment,
  addRequestPhoto,
  applyRequestAction,
  createRequest,
  listRequests,
  PHOTO_MAX_BYTES,
  readRequest,
  readRequestPhoto,
  reloadRequest,
  RequestProblem,
  setRequestSupport,
  type RequestContext,
} from '../requests/store.ts';

// Заявки Дома (docs/adr/0012). Каждый запрос заново проверяет, что человек
// сейчас участник Дома: Роль выводится из Домового чата и может смениться.

type HouseParams = { houseId: string };
type RequestParams = HouseParams & { requestId: string };
type PhotoParams = RequestParams & { photoId: string };

const uuid = { type: 'string', format: 'uuid' } as const;
const houseParams = { type: 'object', required: ['houseId'], properties: { houseId: uuid } } as const;
const requestParams = { type: 'object', required: ['houseId', 'requestId'], properties: { houseId: uuid, requestId: uuid } } as const;
const photoParams = {
  type: 'object', required: ['houseId', 'requestId', 'photoId'], properties: { houseId: uuid, requestId: uuid, photoId: uuid },
} as const;
const actions: RequestAction[] = ['take', 'schedule-visit', 'complete', 'reject', 'cancel', 'confirm', 'not-fixed'];
const BINARY_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const BINARY_BODY_MAX_BYTES = 5_242_880;

async function contextFor(pool: Pool, request: FastifyRequest<{ Params: HouseParams }>, reply: FastifyReply): Promise<RequestContext | null> {
  const resident = request.authSession!.resident;
  const access = await findHouseAccess(pool, resident.id, request.params.houseId);
  if (!access) {
    await reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return {
    houseId: access.houseId,
    residentId: resident.id,
    residentName: resident.displayName,
    processor: canManageServices(access),
    apartmentNumber: access.apartmentNumber,
  };
}

/** Ожидаемый отказ — его код клиенту, остальное — общему обработчику ошибок. */
async function answerProblem(reply: FastifyReply, error: unknown): Promise<void> {
  if (error instanceof RequestProblem) {
    await reply.code(error.status).send({ error: error.code });
    return;
  }
  throw error;
}

export function registerRequestRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  // Фото приходят телом запроса, по одному: так не нужен multipart.
  // Один бинарный parser обслуживает фото и Чеки оплаты. Лимит конкретного
  // маршрута остаётся строже: у фото 1,5 МБ, у Чека оплаты 5 МБ.
  app.addContentTypeParser(BINARY_TYPES, { parseAs: 'buffer', bodyLimit: BINARY_BODY_MAX_BYTES }, (_request, body, done) => done(null, body));

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/requests', {
    preHandler: authenticated, schema: { params: houseParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    return { requests: await listRequests(pool, context) };
  });

  app.post<{ Params: HouseParams; Body: RequestInput }>('/api/houses/:houseId/requests', {
    preHandler: authenticated,
    schema: {
      params: houseParams,
      body: {
        type: 'object', required: ['category', 'place', 'description'], additionalProperties: false,
        properties: {
          category: { type: 'string', enum: [...REQUEST_CATEGORIES] },
          subcategory: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' },
          place: { type: 'string', enum: ['apartment', 'common-property'] },
          description: { type: 'string', minLength: 10, maxLength: 500 },
          apartmentNumber: { type: 'string', pattern: '^[0-9]{1,4}[а-яА-Яa-zA-Z]?$' },
          preferredVisitDate: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
        },
      },
    },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const created = await inTransaction(pool, async (client) => {
        const requestId = await createRequest(client, context, request.body);
        return reloadRequest(client, context, requestId);
      });
      return reply.code(201).send({ request: created });
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.get<{ Params: RequestParams }>('/api/houses/:houseId/requests/:requestId', {
    preHandler: authenticated, schema: { params: requestParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    const details = await readRequest(pool, context, request.params.requestId);
    if (!details) return reply.code(404).send({ error: 'request_not_found' });
    return { request: details };
  });

  app.post<{ Params: RequestParams; Body: { action: RequestAction; note?: string; scheduledAt?: string } }>('/api/houses/:houseId/requests/:requestId/actions', {
    preHandler: authenticated,
    schema: {
      params: requestParams,
      body: {
        type: 'object', required: ['action'], additionalProperties: false,
        properties: {
          action: { type: 'string', enum: actions },
          note: { type: 'string', maxLength: 1000 },
          scheduledAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      return {
        request: await inTransaction(pool, async (client) => {
          await applyRequestAction(client, context, request.params.requestId, request.body);
          return reloadRequest(client, context, request.params.requestId);
        }),
      };
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.post<{ Params: RequestParams; Body: { text: string } }>('/api/houses/:houseId/requests/:requestId/comments', {
    preHandler: authenticated,
    schema: {
      params: requestParams,
      body: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', minLength: 1, maxLength: 1000 } } },
    },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      return {
        request: await inTransaction(pool, async (client) => {
          await addRequestComment(client, context, request.params.requestId, request.body.text);
          return reloadRequest(client, context, request.params.requestId);
        }),
      };
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  for (const method of ['POST', 'DELETE'] as const) {
    app.route<{ Params: RequestParams }>({
      method,
      url: '/api/houses/:houseId/requests/:requestId/support',
      preHandler: authenticated,
      schema: { params: requestParams },
      handler: async (request, reply) => {
        const context = await contextFor(pool, request, reply);
        if (!context) return;
        try {
          return {
            request: await inTransaction(pool, async (client) => {
              await setRequestSupport(client, context, request.params.requestId, method === 'POST');
              return reloadRequest(client, context, request.params.requestId);
            }),
          };
        } catch (error) {
          return answerProblem(reply, error);
        }
      },
    });
  }

  app.post<{ Params: RequestParams; Body: Buffer }>('/api/houses/:houseId/requests/:requestId/photos', {
    preHandler: authenticated, bodyLimit: PHOTO_MAX_BYTES, schema: { params: requestParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'unsupported_photo' });
    try {
      const photoId = await inTransaction(pool, (client) => addRequestPhoto(client, context, request.params.requestId, request.body));
      return reply.code(201).send({ photo: { id: photoId } });
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.get<{ Params: PhotoParams }>('/api/houses/:houseId/requests/:requestId/photos/:photoId', {
    preHandler: authenticated, schema: { params: photoParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    const photo = await readRequestPhoto(pool, context, request.params.requestId, request.params.photoId);
    if (!photo) return reply.code(404).send({ error: 'photo_not_found' });
    return reply
      .header('content-type', photo.contentType)
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .send(photo.data);
  });
}
