import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { ManagementQuestionInput, ManagementQuestionMessageInput } from '@maxtown/shared';
import { findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import { inTransaction } from '../db/transaction.ts';
import {
  addManagementQuestionMessage,
  addManagementQuestionPhoto,
  closeManagementQuestion,
  createManagementQuestion,
  listManagementQuestions,
  managementAssigned,
  ManagementQuestionProblem,
  readManagementQuestion,
  readManagementQuestionPhoto,
  reopenManagementQuestion,
  type ManagementQuestionContext,
} from '../management-questions/store.ts';
import { PHOTO_MAX_BYTES } from '../requests/store.ts';

type HouseParams = { houseId: string };
type QuestionParams = HouseParams & { questionId: string };
type MessageParams = QuestionParams & { messageId: string };
type PhotoParams = MessageParams & { photoId: string };

const uuid = { type: 'string', format: 'uuid' } as const;
const houseParams = { type: 'object', required: ['houseId'], properties: { houseId: uuid } } as const;
const questionParams = { type: 'object', required: ['houseId', 'questionId'], properties: { houseId: uuid, questionId: uuid } } as const;
const messageParams = { type: 'object', required: ['houseId', 'questionId', 'messageId'], properties: { houseId: uuid, questionId: uuid, messageId: uuid } } as const;
const photoParams = { type: 'object', required: ['houseId', 'questionId', 'messageId', 'photoId'], properties: { houseId: uuid, questionId: uuid, messageId: uuid, photoId: uuid } } as const;
const messageBody = {
  type: 'object', required: ['text'], additionalProperties: false,
  properties: { text: { type: 'string', minLength: 1, maxLength: 4000 } },
} as const;

async function contextFor(pool: Pool, request: FastifyRequest<{ Params: HouseParams }>, reply: FastifyReply): Promise<ManagementQuestionContext | null> {
  const resident = request.authSession!.resident;
  const access = await findHouseAccess(pool, resident.id, request.params.houseId);
  if (!access) {
    await reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return {
    houseId: access.houseId,
    membershipId: access.id,
    residentId: resident.id,
    residentName: resident.displayName,
    role: access.role,
  };
}

function answerProblem(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof ManagementQuestionProblem) return reply.code(error.status).send({ error: error.code });
  throw error;
}

export function registerManagementQuestionRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/management-questions', {
    preHandler: authenticated, schema: { params: houseParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    return {
      questions: await listManagementQuestions(pool, context),
      managementAssigned: await managementAssigned(pool, context.houseId),
    };
  });

  app.post<{ Params: HouseParams; Body: ManagementQuestionInput }>('/api/houses/:houseId/management-questions', {
    preHandler: authenticated,
    schema: {
      params: houseParams,
      body: {
        type: 'object', required: ['title', 'text'], additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          text: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      },
    },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const question = await inTransaction(pool, async (client) => {
        const id = await createManagementQuestion(client, context, request.body);
        return readManagementQuestion(client, context, id);
      });
      return reply.code(201).send({ question });
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.get<{ Params: QuestionParams }>('/api/houses/:houseId/management-questions/:questionId', {
    preHandler: authenticated, schema: { params: questionParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    const question = await readManagementQuestion(pool, context, request.params.questionId);
    if (!question) return reply.code(404).send({ error: 'management_question_not_found' });
    return { question, managementAssigned: await managementAssigned(pool, context.houseId) };
  });

  app.post<{ Params: QuestionParams; Body: ManagementQuestionMessageInput }>('/api/houses/:houseId/management-questions/:questionId/messages', {
    preHandler: authenticated, schema: { params: questionParams, body: messageBody },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const result = await inTransaction(pool, async (client) => {
        const messageId = await addManagementQuestionMessage(client, context, request.params.questionId, request.body);
        return { messageId, question: await readManagementQuestion(client, context, request.params.questionId) };
      });
      return reply.code(201).send(result);
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.post<{ Params: QuestionParams }>('/api/houses/:houseId/management-questions/:questionId/close', {
    preHandler: authenticated, schema: { params: questionParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      return {
        question: await inTransaction(pool, async (client) => {
          await closeManagementQuestion(client, context, request.params.questionId);
          return readManagementQuestion(client, context, request.params.questionId);
        }),
      };
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.post<{ Params: QuestionParams; Body: ManagementQuestionMessageInput }>('/api/houses/:houseId/management-questions/:questionId/reopen', {
    preHandler: authenticated, schema: { params: questionParams, body: messageBody },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    try {
      const result = await inTransaction(pool, async (client) => {
        const messageId = await reopenManagementQuestion(client, context, request.params.questionId, request.body);
        return { messageId, question: await readManagementQuestion(client, context, request.params.questionId) };
      });
      return reply.code(201).send(result);
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.post<{ Params: MessageParams; Body: Buffer }>('/api/houses/:houseId/management-questions/:questionId/messages/:messageId/photos', {
    preHandler: authenticated, bodyLimit: PHOTO_MAX_BYTES, schema: { params: messageParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'unsupported_photo' });
    try {
      const photoId = await inTransaction(pool, (client) => addManagementQuestionPhoto(
        client, context, request.params.questionId, request.params.messageId, request.body,
      ));
      return reply.code(201).send({ photo: { id: photoId } });
    } catch (error) {
      return answerProblem(reply, error);
    }
  });

  app.get<{ Params: PhotoParams }>('/api/houses/:houseId/management-questions/:questionId/messages/:messageId/photos/:photoId', {
    preHandler: authenticated, schema: { params: photoParams },
  }, async (request, reply) => {
    const context = await contextFor(pool, request, reply);
    if (!context) return;
    const photo = await readManagementQuestionPhoto(
      pool, context, request.params.questionId, request.params.messageId, request.params.photoId,
    );
    if (!photo) return reply.code(404).send({ error: 'photo_not_found' });
    return reply.header('content-type', photo.contentType)
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .send(photo.data);
  });
}
