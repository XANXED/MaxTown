import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import type { ApartmentAccessState, ApartmentLocationInput, InviteCheck } from '@maxtown/shared';
import { requireAuthentication } from '../auth/sessions.ts';
import { inTransaction } from '../db/transaction.ts';
import {
  ApartmentAccessProblem,
  cancelApartmentAccessRequest,
  claimOrRequestApartment,
  createApartmentInvitation,
  decideApartmentAccessRequest,
  readApartmentAccessState,
  readApartmentInvitation,
  redeemApartmentInvitation,
} from '../apartment-access/store.ts';

type HouseParams = { houseId: string };
type RequestParams = HouseParams & { requestId: string };
type InviteParams = { id: string };

const uuid = { type: 'string', format: 'uuid' } as const;
const houseParams = {
  type: 'object', required: ['houseId'], additionalProperties: false,
  properties: { houseId: uuid },
} as const;
const requestParams = {
  type: 'object', required: ['houseId', 'requestId'], additionalProperties: false,
  properties: { houseId: uuid, requestId: uuid },
} as const;
const inviteParams = {
  type: 'object', required: ['id'], additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{22}$' } },
} as const;
const locationBody = {
  type: 'object', required: ['apartmentNumber', 'floor'], additionalProperties: false,
  properties: {
    apartmentNumber: { type: 'string', pattern: '^[1-9][0-9]{0,3}[а-яА-Яa-zA-Z]?$', maxLength: 5 },
    floor: { type: 'integer', minimum: 1, maximum: 200 },
    entrance: { type: ['integer', 'null'], minimum: 1, maximum: 100 },
  },
} as const;

function answerProblem(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof ApartmentAccessProblem) return reply.code(error.status).send({ error: error.code });
  throw error;
}

export function registerApartmentAccessRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Params: HouseParams; Reply: ApartmentAccessState }>(
    '/api/houses/:houseId/apartment-access',
    { preHandler: authenticated, schema: { params: houseParams } },
    async (request, reply) => {
      try {
        return await readApartmentAccessState(pool, request.authSession!.resident.id, request.params.houseId);
      } catch (error) {
        return answerProblem(reply, error) as never;
      }
    },
  );

  app.post<{ Params: HouseParams; Body: ApartmentLocationInput }>(
    '/api/houses/:houseId/apartment-access',
    { preHandler: authenticated, schema: { params: houseParams, body: locationBody } },
    async (request, reply) => {
      try {
        const result = await inTransaction(pool, (client) => claimOrRequestApartment(
          client,
          request.authSession!.resident.id,
          request.params.houseId,
          request.body,
        ));
        return result.status === 'joined'
          ? reply.code(201).send({ status: 'joined', state: result.state })
          : reply.code(202).send({ status: 'pending', request: result.request });
      } catch (error) {
        return answerProblem(reply, error);
      }
    },
  );

  app.delete<{ Params: RequestParams }>(
    '/api/houses/:houseId/apartment-access/requests/:requestId',
    { preHandler: authenticated, schema: { params: requestParams } },
    async (request, reply) => {
      try {
        await inTransaction(pool, (client) => cancelApartmentAccessRequest(
          client,
          request.authSession!.resident.id,
          request.params.houseId,
          request.params.requestId,
        ));
        return reply.code(204).send();
      } catch (error) {
        return answerProblem(reply, error);
      }
    },
  );

  app.post<{ Params: RequestParams; Body: { decision: 'approve' | 'reject' } }>(
    '/api/houses/:houseId/apartment-access/requests/:requestId/decision',
    {
      preHandler: authenticated,
      schema: {
        params: requestParams,
        body: {
          type: 'object', required: ['decision'], additionalProperties: false,
          properties: { decision: { type: 'string', enum: ['approve', 'reject'] } },
        },
      },
    },
    async (request, reply) => {
      try {
        await inTransaction(pool, (client) => decideApartmentAccessRequest(
          client,
          request.authSession!.resident.id,
          request.params.houseId,
          request.params.requestId,
          request.body.decision,
        ));
        return { status: request.body.decision === 'approve' ? 'approved' : 'rejected' };
      } catch (error) {
        return answerProblem(reply, error);
      }
    },
  );

  app.post<{ Params: HouseParams }>(
    '/api/houses/:houseId/apartment-access/invitations',
    { preHandler: authenticated, schema: { params: houseParams } },
    async (request, reply) => {
      try {
        const code = await inTransaction(pool, (client) => createApartmentInvitation(
          client,
          request.authSession!.resident.id,
          request.params.houseId,
        ));
        return reply.code(201).send({ code });
      } catch (error) {
        return answerProblem(reply, error);
      }
    },
  );

  app.get<{ Params: InviteParams }>(
    '/api/invitations/:id',
    { preHandler: authenticated, schema: { params: inviteParams } },
    async (request): Promise<{ invitation: InviteCheck }> => ({ invitation: await readApartmentInvitation(pool, request.params.id) }),
  );

  app.post<{ Params: InviteParams }>(
    '/api/invitations/:id/redeem',
    { preHandler: authenticated, schema: { params: inviteParams } },
    async (request, reply) => {
      try {
        const membership = await inTransaction(pool, (client) => redeemApartmentInvitation(
          client,
          request.authSession!.resident.id,
          request.params.id,
        ));
        return { membership };
      } catch (error) {
        return answerProblem(reply, error);
      }
    },
  );
}
