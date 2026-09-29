import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { UtilityPaymentPeriodInput, UtilityPaymentTemplateInput } from '@maxtown/shared';
import { UTILITY_PAYMENT_CATEGORIES } from '@maxtown/shared';
import { findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import { inTransaction } from '../db/transaction.ts';
import {
  archiveUtilityPaymentTemplate,
  createUtilityPaymentTemplate,
  deleteUtilityPaymentReceipt,
  listUtilityPaymentPeriods,
  listUtilityPaymentsOverview,
  readUtilityPaymentPeriod,
  readUtilityPaymentReceipt,
  RECEIPT_MAX_BYTES,
  saveUtilityPaymentReceipt,
  transitionUtilityPaymentPeriod,
  updateUtilityPaymentPeriod,
  updateUtilityPaymentTemplate,
  UtilityPaymentProblem,
  type UtilityPaymentContext,
  type UtilityPaymentTransition,
} from '../utility-payments/store.ts';

type HouseParams = { houseId: string };
type TemplateParams = HouseParams & { templateId: string };
type PeriodParams = HouseParams & { periodId: string };
type VersionBody = { version: number };

const uuid = { type: 'string', format: 'uuid' } as const;
const houseParams = { type: 'object', required: ['houseId'], properties: { houseId: uuid } } as const;
const templateParams = { type: 'object', required: ['houseId', 'templateId'], properties: { houseId: uuid, templateId: uuid } } as const;
const periodParams = { type: 'object', required: ['houseId', 'periodId'], properties: { houseId: uuid, periodId: uuid } } as const;
const versionBody = {
  type: 'object', required: ['version'], additionalProperties: false,
  properties: { version: { type: 'integer', minimum: 1 } },
} as const;
const templateBody = {
  type: 'object', required: ['category', 'title', 'dueDay', 'startsOn'], additionalProperties: false,
  properties: {
    category: { type: 'string', enum: [...UTILITY_PAYMENT_CATEGORIES] },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    dueDay: { type: 'integer', minimum: 1, maximum: 31 },
    startsOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-01$' },
    version: { type: 'integer', minimum: 1 },
  },
} as const;
const periodBody = {
  type: 'object', required: ['version'], additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    dueOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    version: { type: 'integer', minimum: 1 },
  },
} as const;

async function contextFor(
  pool: Pool,
  request: FastifyRequest<{ Params: HouseParams }>,
  reply: FastifyReply,
): Promise<UtilityPaymentContext | null> {
  const resident = request.authSession!.resident;
  const access = await findHouseAccess(pool, resident.id, request.params.houseId);
  if (!access) {
    await reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  if (access.role === 'management-company') {
    await reply.code(403).send({ error: 'utility_payments_private' });
    return null;
  }
  if (!access.apartmentId || !access.apartmentNumber) {
    await reply.code(409).send({ error: 'utility_payments_apartment_required' });
    return null;
  }
  return {
    houseId: access.houseId,
    apartmentId: access.apartmentId,
    apartmentNumber: access.apartmentNumber,
    membershipId: access.id,
    residentName: resident.displayName,
  };
}

function answerProblem(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof UtilityPaymentProblem) return reply.code(error.status).send({ error: error.code });
  throw error;
}

export function registerUtilityPaymentRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/utility-payments', {
    preHandler: authenticated, schema: { params: houseParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    return listUtilityPaymentsOverview(pool, context);
  });

  app.post<{ Params: HouseParams; Body: UtilityPaymentTemplateInput }>('/api/houses/:houseId/utility-payments/templates', {
    preHandler: authenticated, schema: { params: houseParams, body: templateBody },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const template = await inTransaction(pool, (client) => createUtilityPaymentTemplate(client, context, request.body));
      return reply.code(201).send({ template });
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.put<{ Params: TemplateParams; Body: UtilityPaymentTemplateInput }>('/api/houses/:houseId/utility-payments/templates/:templateId', {
    preHandler: authenticated, schema: { params: templateParams, body: { ...templateBody, required: [...templateBody.required, 'version'] } },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const template = await inTransaction(pool, (client) => updateUtilityPaymentTemplate(client, context, request.params.templateId, request.body));
      return { template };
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.post<{ Params: TemplateParams; Body: VersionBody }>('/api/houses/:houseId/utility-payments/templates/:templateId/archive', {
    preHandler: authenticated, schema: { params: templateParams, body: versionBody },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const template = await inTransaction(pool, (client) => archiveUtilityPaymentTemplate(client, context, request.params.templateId, request.body.version));
      return { template };
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.get<{ Params: HouseParams; Querystring: { year?: string; cursor?: string } }>('/api/houses/:houseId/utility-payments/periods', {
    preHandler: authenticated,
    schema: {
      params: houseParams,
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { year: { type: 'string', pattern: '^\\d{4}$' }, cursor: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const year = request.query.year ? Number(request.query.year) : Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Moscow' }).format(new Date()));
      return listUtilityPaymentPeriods(pool, context, year, request.query.cursor);
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.get<{ Params: PeriodParams }>('/api/houses/:houseId/utility-payments/periods/:periodId', {
    preHandler: authenticated, schema: { params: periodParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    const period = await readUtilityPaymentPeriod(pool, context, request.params.periodId);
    if (!period) return reply.code(404).send({ error: 'utility_payment_not_found' });
    return { period };
  });

  app.put<{ Params: PeriodParams; Body: UtilityPaymentPeriodInput }>('/api/houses/:houseId/utility-payments/periods/:periodId', {
    preHandler: authenticated, schema: { params: periodParams, body: periodBody },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const period = await inTransaction(pool, (client) => updateUtilityPaymentPeriod(client, context, request.params.periodId, request.body));
      return { period };
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  for (const transition of ['paid', 'unpaid', 'skipped', 'unskipped'] as const satisfies readonly UtilityPaymentTransition[]) {
    const path = transition === 'paid' ? 'pay' : transition === 'unpaid' ? 'unpay' : transition === 'skipped' ? 'skip' : 'unskip';
    app.post<{ Params: PeriodParams; Body: VersionBody }>(`/api/houses/:houseId/utility-payments/periods/:periodId/${path}`, {
      preHandler: authenticated, schema: { params: periodParams, body: versionBody },
    }, async (request, reply) => {
      const context = await contextFor(pool, request, reply);
      if (!context) return;
      try {
        const period = await inTransaction(pool, (client) => transitionUtilityPaymentPeriod(
          client, context, request.params.periodId, transition, request.body.version,
        ));
        return { period };
      } catch (error) {
        return answerProblem(reply, error);
      }
    });
  }

  app.put<{ Params: PeriodParams; Body: Buffer }>('/api/houses/:houseId/utility-payments/periods/:periodId/receipt', {
    preHandler: authenticated, bodyLimit: RECEIPT_MAX_BYTES, schema: { params: periodParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'utility_payment_receipt_unsupported' });
    const header = request.headers['x-file-name'];
    let fileName = 'чек';
    if (typeof header === 'string') {
      try {
        fileName = decodeURIComponent(header);
      } catch {
        return reply.code(400).send({ error: 'utility_payment_file_name_invalid' });
      }
    }
    try {
      const period = await inTransaction(pool, (client) => saveUtilityPaymentReceipt(client, context, request.params.periodId, fileName, request.body));
      return { period };
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.get<{ Params: PeriodParams }>('/api/houses/:houseId/utility-payments/periods/:periodId/receipt', {
    preHandler: authenticated, schema: { params: periodParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const receipt = await readUtilityPaymentReceipt(pool, context, request.params.periodId);
      if (!receipt) return reply.code(404).send({ error: 'utility_payment_receipt_not_found' });
      const encoded = encodeURIComponent(receipt.fileName);
      return reply.header('content-type', receipt.contentType)
        .header('content-disposition', `inline; filename="receipt"; filename*=UTF-8''${encoded}`)
        .header('cache-control', 'private, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        .send(receipt.data);
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.delete<{ Params: PeriodParams }>('/api/houses/:houseId/utility-payments/periods/:periodId/receipt', {
    preHandler: authenticated, schema: { params: periodParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const period = await inTransaction(pool, (client) => deleteUtilityPaymentReceipt(client, context, request.params.periodId));
      return { period };
    } catch (error) {
      return answerProblem(reply, error);
    }
  });
}
