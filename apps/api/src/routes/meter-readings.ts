import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { MeterInput, ReadingsInput } from '@maxtown/shared';
import { METER_KINDS } from '@maxtown/shared';
import { findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import { inTransaction } from '../db/transaction.ts';
import {
  archiveMeter,
  createMeter,
  listMeterReadings,
  MeterReadingsProblem,
  saveMeterReadings,
  updateMeter,
  type MeterReadingsContext,
} from '../meter-readings/store.ts';

type HouseParams = { houseId: string };
type MeterParams = HouseParams & { meterId: string };
type VersionBody = { version: number };

const uuid = { type: 'string', format: 'uuid' } as const;
const houseParams = { type: 'object', required: ['houseId'], properties: { houseId: uuid } } as const;
const meterParams = {
  type: 'object', required: ['houseId', 'meterId'], properties: { houseId: uuid, meterId: uuid },
} as const;
const meterBody = {
  type: 'object', required: ['kind', 'title', 'decimals'], additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: [...METER_KINDS] },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    serial: { type: 'string', minLength: 1, maxLength: 80 },
    decimals: { type: 'integer', minimum: 0, maximum: 3 },
    version: { type: 'integer', minimum: 1 },
  },
} as const;
const readingsBody = {
  type: 'object', required: ['readings'], additionalProperties: false,
  properties: {
    readings: {
      type: 'array', minItems: 1, maxItems: 20,
      items: {
        type: 'object', required: ['meterId', 'value'], additionalProperties: false,
        properties: { meterId: uuid, value: { type: 'number', minimum: 0, exclusiveMaximum: 1_000_000_000_000_000 } },
      },
    },
  },
} as const;

async function contextFor(
  pool: Pool,
  request: FastifyRequest<{ Params: HouseParams }>,
  reply: FastifyReply,
): Promise<MeterReadingsContext | null> {
  const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
  if (!access) {
    await reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  if (access.role === 'management-company') {
    await reply.code(403).send({ error: 'meter_readings_private' });
    return null;
  }
  if (!access.apartmentId || !access.apartmentNumber) {
    await reply.code(409).send({ error: 'meter_readings_apartment_required' });
    return null;
  }
  return {
    houseId: access.houseId,
    apartmentId: access.apartmentId,
    apartmentNumber: access.apartmentNumber,
    membershipId: access.id,
  };
}

function answerProblem(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof MeterReadingsProblem) return reply.code(error.status).send({ error: error.code });
  throw error;
}

export function registerMeterReadingRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/readings', {
    preHandler: authenticated, schema: { params: houseParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    return listMeterReadings(pool, context);
  });

  app.post<{ Params: HouseParams; Body: MeterInput }>('/api/houses/:houseId/meters', {
    preHandler: authenticated, schema: { params: houseParams, body: meterBody },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const meter = await inTransaction(pool, (client) => createMeter(client, context, request.body));
      return reply.code(201).send({ meter });
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.put<{ Params: MeterParams; Body: MeterInput }>('/api/houses/:houseId/meters/:meterId', {
    preHandler: authenticated,
    schema: { params: meterParams, body: { ...meterBody, required: [...meterBody.required, 'version'] } },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      return { meter: await inTransaction(pool, (client) => updateMeter(client, context, request.params.meterId, request.body)) };
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.post<{ Params: MeterParams; Body: VersionBody }>('/api/houses/:houseId/meters/:meterId/archive', {
    preHandler: authenticated,
    schema: {
      params: meterParams,
      body: { type: 'object', required: ['version'], additionalProperties: false, properties: { version: { type: 'integer', minimum: 1 } } },
    },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      await inTransaction(pool, (client) => archiveMeter(client, context, request.params.meterId, request.body.version));
      return reply.code(204).send();
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.post<{ Params: HouseParams; Body: ReadingsInput }>('/api/houses/:houseId/readings', {
    preHandler: authenticated, schema: { params: houseParams, body: readingsBody },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      return await inTransaction(pool, (client) => saveMeterReadings(client, context, request.body));
    } catch (error) {
      return answerProblem(reply, error);
    }
  });
}
