import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  assignManagementCompany,
  connectHouseChat,
  MaxApiError,
  removeHouseChat,
  WELCOME_MESSAGE,
  type HouseChatDeps,
  type SetManagementCompanyResult,
} from '../max/house-chats.ts';

// События бота MAX (https://dev.max.ru/docs-api/methods/POST/subscriptions):
// подключение Домового чата, отключение, /connect и /set_uk. MAX считает
// событие доставленным только при HTTP 200.

type Update = Record<string, unknown>;

function isRecord(value: unknown): value is Update {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChatId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value !== 0;
}

function isUserId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Сравнение без раннего выхода, чтобы не раскрывать секрет по времени ответа. */
function secretsEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Текст команды в групповом чате: «/connect», «/set_uk@бот @uk». */
function chatCommand(update: Update): { chatId: number; senderId: number | null; text: string } | null {
  if (update.update_type !== 'message_created' || !isRecord(update.message)) return null;
  const { sender, recipient, body } = update.message;
  if (!isRecord(recipient) || recipient.chat_type !== 'chat' || !isChatId(recipient.chat_id)) return null;
  if (!isRecord(body) || typeof body.text !== 'string') return null;
  const senderId = isRecord(sender) && sender.is_bot !== true && isUserId(sender.user_id) ? sender.user_id : null;
  return { chatId: recipient.chat_id, senderId, text: body.text.trim() };
}

const setUkReplies: Record<SetManagementCompanyResult, (username: string) => string> = {
  assigned: (username) => `@${username} назначен аккаунтом УК для этого Дома.`,
  'no-house': () => 'Сначала подключите Дом и укажите его адрес.',
  forbidden: () => 'Назначить аккаунт УК может только Администратор Дома.',
  'not-found': (username) => `Аккаунт @${username} не найден среди участников Домового чата.`,
};

async function handleUpdate(deps: HouseChatDeps, update: Update): Promise<void> {
  const type = update.update_type;
  if (type === 'bot_started' && isChatId(update.chat_id)) {
    await deps.max.sendChatMessage(update.chat_id, WELCOME_MESSAGE, { text: 'Открыть MaxTown' });
    return;
  }
  if ((type === 'bot_added' || type === 'bot_admin_permissions_changed') && isChatId(update.chat_id)) {
    const actor = isRecord(update.user) && isUserId(update.user.user_id) ? update.user.user_id : null;
    await connectHouseChat(deps, update.chat_id, actor);
    return;
  }
  if (type === 'bot_removed' && isChatId(update.chat_id)) {
    await removeHouseChat(deps, update.chat_id);
    return;
  }
  const command = chatCommand(update);
  if (!command) return;
  if (/^\/connect(?:@[a-z\d_]+)?$/iu.test(command.text)) {
    await connectHouseChat(deps, command.chatId, command.senderId);
    return;
  }
  const setUk = /^\/set_uk(?:@[a-z\d_]+)?\s+@?([a-z\d_.-]+)$/iu.exec(command.text);
  if (setUk && command.senderId !== null) {
    const username = setUk[1]!.toLocaleLowerCase('ru-RU');
    const result = await assignManagementCompany(deps, { chatId: command.chatId, actorUserId: command.senderId, targetUsername: username });
    await deps.max.sendChatMessage(command.chatId, setUkReplies[result](username));
  }
}

export function registerMaxWebhookRoutes(
  app: FastifyInstance,
  deps: HouseChatDeps,
  config: { webhookSecret: string; internalSecret: string | null; publicOrigin: string | null },
): void {
  app.post('/api/max/webhook', async (request, reply) => {
    const supplied = request.headers['x-max-bot-api-secret'];
    if (typeof supplied !== 'string' || !secretsEqual(supplied, config.webhookSecret)) return reply.code(401).send({ error: 'unauthorized' });
    if (!isRecord(request.body) || typeof request.body.update_type !== 'string') return reply.code(400).send({ error: 'invalid_update' });
    try {
      await handleUpdate(deps, request.body);
      return { success: true };
    } catch (error) {
      if (!(error instanceof MaxApiError)) throw error;
      request.log.error({ err: error }, 'MAX update failed');
      // Не 200 — MAX повторит событие позже.
      return reply.code(502).send({ error: 'max_unavailable' });
    }
  });

  /** Подписать бота на события: вызывается вручную после деплоя. */
  app.post('/api/max/register', async (request: FastifyRequest, reply) => {
    const supplied = request.headers['x-maxtown-internal-secret'];
    if (!config.internalSecret) return reply.code(503).send({ error: 'register_unavailable' });
    if (typeof supplied !== 'string' || !secretsEqual(supplied, config.internalSecret)) return reply.code(401).send({ error: 'unauthorized' });
    const origin = config.publicOrigin ?? `${request.protocol}://${request.host}`;
    const webhookUrl = new URL('/api/max/webhook', origin).href;
    try {
      await deps.max.subscribe(webhookUrl, config.webhookSecret);
    } catch (error) {
      request.log.error({ err: error }, 'MAX webhook registration failed');
      return reply.code(502).send({ error: 'max_unavailable' });
    }
    return { success: true, webhookUrl };
  });
}
