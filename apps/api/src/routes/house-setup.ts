import type { FastifyInstance } from 'fastify';
import type { HouseAddressSuggestionsResponse } from '@maxtown/shared';
import { requireAuthentication } from '../auth/sessions.ts';
import { AddressProviderError, findHouseAddressByGuid, publicSuggestion, suggestHouseAddresses } from '../address/dadata.ts';
import { activateHouseChat, checkSetupAdmin, MaxApiError, syncResidentHouses, type HouseChatDeps } from '../max/house-chats.ts';

// Подключение Дома (CONTEXT.md): бот не узнал адрес по названию чата, и
// администратор чата выбирает его из подсказок DaData. Кто выбирает — из
// серверной сессии; права в чате и выбранный GUID сервер проверяет сам.

type SetupBody = { chatId: number; query?: string; garHouseGuid?: string };

const chatIdSchema = { type: 'integer', not: { const: 0 } } as const;

export function registerHouseSetupRoutes(app: FastifyInstance, deps: HouseChatDeps): void {
  const authenticated = requireAuthentication(deps.pool);

  /** MAX ID человека из сессии; без него (старый вход) выбирать адрес нельзя. */
  const maxUserIdOf = (value: string | null): number | null => (value && /^\d+$/.test(value) ? Number(value) : null);

  app.post<{ Body: SetupBody }>('/api/house-setup/suggestions', {
    preHandler: authenticated,
    schema: {
      body: {
        type: 'object', required: ['chatId', 'query'], additionalProperties: false,
        properties: { chatId: chatIdSchema, query: { type: 'string', minLength: 3, maxLength: 200 } },
      },
    },
  }, async (request, reply): Promise<HouseAddressSuggestionsResponse | undefined> => {
    if (!deps.dadataKey) return reply.code(503).send({ error: 'address_provider_not_configured' });
    const maxUserId = maxUserIdOf(request.authSession!.resident.maxUserId);
    if (maxUserId === null) return reply.code(403).send({ error: 'house_setup_forbidden' });
    try {
      const setup = await checkSetupAdmin(deps, request.body.chatId, maxUserId);
      if (!setup.ok) return reply.code(setup.status).send({ error: setup.error });
      const suggestions = await suggestHouseAddresses(deps.dadataKey, request.body.query!.trim(), deps.dadataFetch);
      return { suggestions: suggestions.map(publicSuggestion) };
    } catch (error) {
      if (error instanceof AddressProviderError) return reply.code(502).send({ error: 'address_provider_unavailable' });
      if (error instanceof MaxApiError) return reply.code(502).send({ error: 'max_unavailable' });
      throw error;
    }
  });

  app.post<{ Body: SetupBody }>('/api/house-setup/confirm', {
    preHandler: authenticated,
    schema: {
      body: {
        type: 'object', required: ['chatId', 'garHouseGuid'], additionalProperties: false,
        properties: { chatId: chatIdSchema, garHouseGuid: { type: 'string', minLength: 1, maxLength: 128 } },
      },
    },
  }, async (request, reply) => {
    if (!deps.dadataKey) return reply.code(503).send({ error: 'address_provider_not_configured' });
    const resident = request.authSession!.resident;
    const maxUserId = maxUserIdOf(resident.maxUserId);
    if (maxUserId === null) return reply.code(403).send({ error: 'house_setup_forbidden' });
    try {
      const setup = await checkSetupAdmin(deps, request.body.chatId, maxUserId);
      if (!setup.ok) return reply.code(setup.status).send({ error: setup.error });
      // Повтор после потерянного ответа не меняет уже выбранный адрес.
      let houseId = setup.houseId;
      if (!houseId) {
        const address = await findHouseAddressByGuid(deps.dadataKey, request.body.garHouseGuid!.trim(), deps.dadataFetch);
        if (!address) return reply.code(400).send({ error: 'house_address_not_found' });
        houseId = (await activateHouseChat(deps, request.body.chatId, address)).houseId;
      }
      await syncResidentHouses(deps, { id: resident.id, maxUserId }, request.body.chatId);
      return { houseId };
    } catch (error) {
      if (error instanceof AddressProviderError) return reply.code(502).send({ error: 'address_provider_unavailable' });
      if (error instanceof MaxApiError) return reply.code(502).send({ error: 'max_unavailable' });
      throw error;
    }
  });
}
