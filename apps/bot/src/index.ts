import type {
  HouseAccess,
  HouseAddressSuggestion,
  HouseRole,
  MaxAuthResponse,
  MaxAuthUser,
  MaxHouseChatRole,
  PendingHouseSetup,
} from '@maxtown/shared';
import { withTimeout } from '@maxtown/shared/http';
import {
  AddressProviderError,
  findHouseAddressByGuid,
  resolveHouseAddressFromTitle,
  suggestHouseAddresses,
} from './address.ts';

const MAX_API_ORIGIN = 'https://platform-api2.max.ru';
const WEBHOOK_PATH = '/api/max/webhook';
const REGISTER_PATH = '/api/max/register';
const AUTH_PATH = '/api/auth/max';
const ADDRESS_SUGGESTIONS_PATH = '/api/house-setup/suggestions';
const ADDRESS_CONFIRM_PATH = '/api/house-setup/confirm';
const HEALTH_PATH = '/api/health';
const HOUSE_CHAT_PREFIX = 'house-chat:';
const HOUSE_ONBOARDING_PREFIX = 'house-onboarding:';
const HOUSE_CREATOR_PREFIX = 'house-creator:';
const DEFAULT_MAX_BOT_USERNAME = 't25_hakaton_max_bot';
const DEFAULT_INIT_DATA_TTL_SECONDS = 900;
const WELCOME_MESSAGE =
  'Привет! Это MaxTown, помощник жильцов дома. Войти смогут участники Домового чата, в котором я администратор.';
const ADMIN_REQUIRED_MESSAGE =
  'Чтобы подключить Дом к MaxTown, выдайте боту права администратора. Они нужны для проверки участников чата.';
const ADDRESS_REQUIRED_MESSAGE =
  'Не удалось однозначно определить адрес по названию чата. Администратор чата, выберите адрес Дома в мини-приложении.';

type KvKey = {
  name: string;
  metadata?: unknown;
};

type KvListResult = {
  keys: KvKey[];
  list_complete: boolean;
  cursor?: string;
};

export type HouseChatStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<KvListResult>;
};

export type BotEnv = {
  BOT_TOKEN: string;
  MAX_WEBHOOK_SECRET: string;
  DADATA_API_KEY?: string;
  MAX_INIT_DATA_TTL_SECONDS?: string;
  MAX_BOT_USERNAME?: string;
  HOUSE_CHATS?: HouseChatStore;
};

type ChatUpdate = {
  update_type: 'bot_added' | 'bot_admin_permissions_changed' | 'bot_removed';
  chat_id: number;
  user?: unknown;
};

type BotStartedUpdate = {
  update_type: 'bot_started';
  chat_id: number;
};

type MaxActionResponse = {
  success?: boolean;
  message?: string;
};

type MaxChatResponse = {
  type?: unknown;
  status?: unknown;
  title?: unknown;
};

type HouseChatBinding = {
  houseId: string;
  houseLabel: string;
  chatId: number;
  garHouseGuid?: string;
  locality?: string;
  createdByUserId?: number;
  managementCompanyUserId?: number;
  managementCompanyUsername?: string;
};

type HouseCreator = {
  chatId: number;
  userId: number;
};

type HouseOnboarding = PendingHouseSetup & {
  status: 'address-required';
};

type MaxInitDataValidation =
  | { ok: true; user: MaxAuthUser }
  | { ok: false };

class MaxApiError extends Error {}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function methodNotAllowed(allowed: string): Response {
  return new Response(null, {
    status: 405,
    headers: { allow: allowed },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChatId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value !== 0;
}

function isUserId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isBotStartedUpdate(value: Record<string, unknown>): value is Record<string, unknown> & BotStartedUpdate {
  return value.update_type === 'bot_started' && isChatId(value.chat_id);
}

function isChatUpdate(value: Record<string, unknown>): value is Record<string, unknown> & ChatUpdate {
  return (
    (value.update_type === 'bot_added' ||
      value.update_type === 'bot_admin_permissions_changed' ||
      value.update_type === 'bot_removed') &&
    isChatId(value.chat_id)
  );
}

function connectCommandUpdate(value: Record<string, unknown>): ChatUpdate | null {
  if (value.update_type !== 'message_created' || !isRecord(value.message)) return null;
  const { recipient, body } = value.message;
  if (!isRecord(recipient) || recipient.chat_type !== 'chat' || !isChatId(recipient.chat_id)) return null;
  if (!isRecord(body) || typeof body.text !== 'string') return null;
  if (!/^\/connect(?:@[a-z\d_]+)?$/iu.test(body.text.trim())) return null;
  return {
    update_type: 'bot_admin_permissions_changed',
    chat_id: recipient.chat_id,
  };
}

type SetManagementCompanyCommand = {
  chatId: number;
  actorUserId: number;
  targetUsername: string;
};

function setManagementCompanyCommand(value: Record<string, unknown>): SetManagementCompanyCommand | null {
  if (value.update_type !== 'message_created' || !isRecord(value.message)) return null;
  const { sender, recipient, body } = value.message;
  if (!isRecord(sender) || !isUserId(sender.user_id) || sender.is_bot === true) return null;
  if (!isRecord(recipient) || recipient.chat_type !== 'chat' || !isChatId(recipient.chat_id)) return null;
  if (!isRecord(body) || typeof body.text !== 'string') return null;
  const match = /^\/set_uk(?:@[a-z\d_]+)?\s+@?([a-z\d_.-]+)$/iu.exec(body.text.trim());
  if (!match) return null;
  const targetUsername = normalizedUsername(match[1]);
  return targetUsername
    ? { chatId: recipient.chat_id, actorUserId: sender.user_id, targetUsername }
    : null;
}

function normalizedUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^@/, '').toLocaleLowerCase('ru-RU');
  return normalized || null;
}

function maxBotUsername(env: BotEnv): string {
  return normalizedUsername(env.MAX_BOT_USERNAME) ?? DEFAULT_MAX_BOT_USERNAME;
}

/** Сравнение без раннего выхода, чтобы не раскрывать секрет по времени ответа. */
function secretsEqual(actual: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  const length = Math.max(actualBytes.length, expectedBytes.length);
  let different = actualBytes.length ^ expectedBytes.length;

  for (let index = 0; index < length; index += 1) {
    different |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return different === 0;
}

function hasBotSecrets(env: BotEnv): boolean {
  return Boolean(env.BOT_TOKEN && env.MAX_WEBHOOK_SECRET);
}

function isAuthorized(request: Request, env: BotEnv): boolean {
  const supplied = request.headers.get('x-max-bot-api-secret') ?? '';
  return secretsEqual(supplied, env.MAX_WEBHOOK_SECRET);
}

async function fetchMaxApi(
  env: BotEnv,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Response> {
  const url = new URL(path, MAX_API_ORIGIN);
  const requestInit: RequestInit = {
    ...init,
    headers: {
      authorization: env.BOT_TOKEN,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  };
  return fetcher(url.href, requestInit);
}

async function callMaxApi<T>(
  env: BotEnv,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<T> {
  try {
    return await withTimeout(async (signal) => {
      const response = await fetchMaxApi(env, path, { ...init, signal }, fetcher);

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new MaxApiError(`MAX API ответил с HTTP ${response.status}`);
      }

      return data as T;
    }, 4_000);
  } catch (error) {
    if (error instanceof MaxApiError) throw error;
    throw new MaxApiError('MAX не ответил вовремя или недоступен');
  }
}

function openAppAttachment(env: BotEnv, text = 'Открыть MaxTown', payload?: string): unknown[] {
  return [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: [
          [
            {
              type: 'open_app',
              text,
              web_app: maxBotUsername(env),
              ...(payload ? { payload } : {}),
            },
          ],
        ],
      },
    },
  ];
}

async function sendChatMessage(
  chatId: number,
  text: string,
  attachments: unknown[],
  env: BotEnv,
  fetcher: typeof fetch,
): Promise<void> {
  await callMaxApi(
    env,
    `/messages?chat_id=${encodeURIComponent(String(chatId))}`,
    {
      method: 'POST',
      body: JSON.stringify({ text, ...(attachments.length > 0 ? { attachments } : {}) }),
    },
    fetcher,
  );
}

async function sendWelcome(update: BotStartedUpdate, env: BotEnv, fetcher: typeof fetch): Promise<void> {
  await sendChatMessage(update.chat_id, WELCOME_MESSAGE, openAppAttachment(env), env, fetcher);
}

async function botIsAdmin(chatId: number, env: BotEnv, fetcher: typeof fetch): Promise<boolean> {
  try {
    return await withTimeout(async (signal) => {
      const response = await fetchMaxApi(
        env,
        `/chats/${encodeURIComponent(String(chatId))}/members/me`,
        { method: 'GET', signal },
        fetcher,
      );
      if (response.status === 403 || response.status === 404) return false;
      if (!response.ok) throw new MaxApiError(`MAX API ответил с HTTP ${response.status}`);

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new MaxApiError('MAX API вернул некорректный JSON');
      }
      return isRecord(data) && (data.is_admin === true || data.is_owner === true);
    }, 4_000);
  } catch (error) {
    if (error instanceof MaxApiError) throw error;
    throw new MaxApiError('Не удалось проверить права бота в MAX');
  }
}

function houseChatKey(chatId: number): string {
  return `${HOUSE_CHAT_PREFIX}${chatId}`;
}

function houseOnboardingKey(chatId: number): string {
  return `${HOUSE_ONBOARDING_PREFIX}${chatId}`;
}

function houseCreatorKey(chatId: number): string {
  return `${HOUSE_CREATOR_PREFIX}${chatId}`;
}

function parseHouseChatBinding(value: unknown): HouseChatBinding | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.houseId !== 'string' ||
    !value.houseId ||
    typeof value.houseLabel !== 'string' ||
    !value.houseLabel ||
    !isChatId(value.chatId)
  ) {
    return null;
  }

  return {
    houseId: value.houseId,
    houseLabel: value.houseLabel,
    chatId: value.chatId,
    ...(typeof value.garHouseGuid === 'string' && value.garHouseGuid
      ? { garHouseGuid: value.garHouseGuid }
      : {}),
    ...(typeof value.locality === 'string' && value.locality ? { locality: value.locality } : {}),
    ...(isUserId(value.createdByUserId) ? { createdByUserId: value.createdByUserId } : {}),
    ...(isUserId(value.managementCompanyUserId)
      ? { managementCompanyUserId: value.managementCompanyUserId }
      : {}),
    ...(typeof value.managementCompanyUsername === 'string' && value.managementCompanyUsername
      ? { managementCompanyUsername: value.managementCompanyUsername }
      : {}),
  };
}

function parseHouseOnboarding(value: unknown): HouseOnboarding | null {
  if (!isRecord(value)) return null;
  if (
    !isChatId(value.chatId) ||
    typeof value.chatTitle !== 'string' ||
    !value.chatTitle.trim() ||
    value.status !== 'address-required'
  ) {
    return null;
  }
  return {
    chatId: value.chatId,
    chatTitle: value.chatTitle.trim(),
    status: 'address-required',
  };
}

async function saveHouseChat(store: HouseChatStore, binding: HouseChatBinding): Promise<void> {
  await store.put(houseChatKey(binding.chatId), JSON.stringify(binding), { metadata: binding });
}

async function readHouseChat(store: HouseChatStore, chatId: number): Promise<HouseChatBinding | null> {
  const stored = await store.get(houseChatKey(chatId));
  if (!stored) return null;
  try {
    return parseHouseChatBinding(JSON.parse(stored));
  } catch {
    return null;
  }
}

async function deleteHouseChat(store: HouseChatStore | undefined, chatId: number): Promise<void> {
  if (!store) return;
  await store.delete(houseChatKey(chatId));
}

async function saveHouseOnboarding(store: HouseChatStore, onboarding: HouseOnboarding): Promise<void> {
  await store.put(houseOnboardingKey(onboarding.chatId), JSON.stringify(onboarding), {
    metadata: onboarding,
  });
}

async function readHouseOnboarding(store: HouseChatStore, chatId: number): Promise<HouseOnboarding | null> {
  const stored = await store.get(houseOnboardingKey(chatId));
  if (!stored) return null;
  try {
    return parseHouseOnboarding(JSON.parse(stored));
  } catch {
    return null;
  }
}

async function deleteHouseOnboarding(store: HouseChatStore | undefined, chatId: number): Promise<void> {
  if (!store) return;
  await store.delete(houseOnboardingKey(chatId));
}

async function readHouseCreator(store: HouseChatStore, chatId: number): Promise<HouseCreator | null> {
  const stored = await store.get(houseCreatorKey(chatId));
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    return isRecord(value) && value.chatId === chatId && isUserId(value.userId)
      ? { chatId, userId: value.userId }
      : null;
  } catch {
    return null;
  }
}

async function rememberHouseCreator(
  store: HouseChatStore,
  chatId: number,
  user: unknown,
): Promise<void> {
  if (!isRecord(user) || !isUserId(user.user_id)) return;
  if (await readHouseCreator(store, chatId)) return;
  const creator: HouseCreator = { chatId, userId: user.user_id };
  await store.put(houseCreatorKey(chatId), JSON.stringify(creator), { metadata: creator });
}

async function deleteHouseCreator(store: HouseChatStore | undefined, chatId: number): Promise<void> {
  if (!store) return;
  await store.delete(houseCreatorKey(chatId));
}

async function deleteHouseConnection(store: HouseChatStore | undefined, chatId: number): Promise<void> {
  await Promise.all([deleteHouseChat(store, chatId), deleteHouseOnboarding(store, chatId)]);
}

async function deleteHouseState(store: HouseChatStore | undefined, chatId: number): Promise<void> {
  await Promise.all([deleteHouseConnection(store, chatId), deleteHouseCreator(store, chatId)]);
}

async function listHouseChats(store: HouseChatStore): Promise<HouseChatBinding[]> {
  const chats: HouseChatBinding[] = [];
  let cursor: string | undefined;

  do {
    const page = await store.list({
      prefix: HOUSE_CHAT_PREFIX,
      ...(cursor ? { cursor } : {}),
    });

    for (const key of page.keys) {
      let binding = parseHouseChatBinding(key.metadata);
      if (!binding) {
        const stored = await store.get(key.name);
        if (stored) {
          try {
            binding = parseHouseChatBinding(JSON.parse(stored));
          } catch {
            binding = null;
          }
        }
      }
      if (binding) chats.push(binding);
    }

    if (page.list_complete) return chats;
    if (!page.cursor) throw new Error('Cloudflare KV не вернул курсор следующей страницы');
    cursor = page.cursor;
  } while (cursor);

  return chats;
}

async function listHouseOnboardings(store: HouseChatStore): Promise<HouseOnboarding[]> {
  const onboardings: HouseOnboarding[] = [];
  let cursor: string | undefined;

  do {
    const page = await store.list({
      prefix: HOUSE_ONBOARDING_PREFIX,
      ...(cursor ? { cursor } : {}),
    });

    for (const key of page.keys) {
      let onboarding = parseHouseOnboarding(key.metadata);
      if (!onboarding) {
        const stored = await store.get(key.name);
        if (stored) {
          try {
            onboarding = parseHouseOnboarding(JSON.parse(stored));
          } catch {
            onboarding = null;
          }
        }
      }
      if (onboarding) onboardings.push(onboarding);
    }

    if (page.list_complete) return onboardings;
    if (!page.cursor) throw new Error('Cloudflare KV не вернул курсор следующей страницы');
    cursor = page.cursor;
  } while (cursor);

  return onboardings;
}

async function getChatTitle(chatId: number, env: BotEnv, fetcher: typeof fetch): Promise<string> {
  const encodedChatId = encodeURIComponent(String(chatId));
  const chat = await callMaxApi<MaxChatResponse>(env, `/chats/${encodedChatId}`, { method: 'GET' }, fetcher);
  if (chat.type !== 'chat' || chat.status !== 'active') {
    throw new Error('Добавленный объект MAX не является активным групповым чатом');
  }
  return typeof chat.title === 'string' && chat.title.trim() ? chat.title.trim() : `Домовой чат ${chatId}`;
}

function houseConnectedMessage(address: string): string {
  return `Дом подключён к MaxTown: ${address}. Администраторы чата получают роль Администратора Дома, остальные участники — роль Жильца. Назначить аккаунт УК: /set_uk @username`;
}

async function activateHouseChat(
  chatId: number,
  address: HouseAddressSuggestion,
  env: BotEnv,
  fetcher: typeof fetch,
): Promise<HouseChatBinding> {
  if (!env.HOUSE_CHATS) throw new Error('Хранилище Домовых чатов не настроено');

  const creator = await readHouseCreator(env.HOUSE_CHATS, chatId);

  const binding: HouseChatBinding = {
    houseId: `max-chat:${chatId}`,
    houseLabel: address.value,
    chatId,
    garHouseGuid: address.garHouseGuid,
    locality: address.locality,
    ...(creator ? { createdByUserId: creator.userId } : {}),
  };
  await saveHouseChat(env.HOUSE_CHATS, binding);
  await Promise.all([
    deleteHouseOnboarding(env.HOUSE_CHATS, chatId),
    deleteHouseCreator(env.HOUSE_CHATS, chatId),
  ]);
  try {
    await sendChatMessage(chatId, houseConnectedMessage(address.value), openAppAttachment(env), env, fetcher);
  } catch {
    // Сохранённый Дом уже доступен. Сбой доставки объявления не отменяет создание.
    console.warn('Дом создан, но MAX не принял объявление в чат');
  }
  return binding;
}

async function syncHouseChat(update: ChatUpdate, env: BotEnv, fetcher: typeof fetch): Promise<void> {
  if (!env.HOUSE_CHATS) throw new Error('Хранилище Домовых чатов не настроено');

  const existingBinding = await readHouseChat(env.HOUSE_CHATS, update.chat_id);
  if (!existingBinding) {
    await rememberHouseCreator(env.HOUSE_CHATS, update.chat_id, update.user);
  }

  if (!(await botIsAdmin(update.chat_id, env, fetcher))) {
    if (existingBinding?.createdByUserId) {
      const creator: HouseCreator = {
        chatId: update.chat_id,
        userId: existingBinding.createdByUserId,
      };
      await env.HOUSE_CHATS.put(houseCreatorKey(update.chat_id), JSON.stringify(creator), {
        metadata: creator,
      });
    }
    await deleteHouseConnection(env.HOUSE_CHATS, update.chat_id);
    await sendChatMessage(update.chat_id, ADMIN_REQUIRED_MESSAGE, [], env, fetcher);
    return;
  }

  if (existingBinding) {
    return;
  }

  const chatTitle = await getChatTitle(update.chat_id, env, fetcher);
  if (env.DADATA_API_KEY) {
    try {
      const address = await resolveHouseAddressFromTitle(env.DADATA_API_KEY, chatTitle, fetcher);
      if (address) {
        await activateHouseChat(update.chat_id, address, env, fetcher);
        return;
      }
    } catch (error) {
      if (!(error instanceof AddressProviderError)) throw error;
      console.error('Не удалось определить адрес Домового чата через DaData', error);
    }
  }

  const existingOnboarding = await readHouseOnboarding(env.HOUSE_CHATS, update.chat_id);
  if (existingOnboarding?.chatTitle === chatTitle) return;

  await saveHouseOnboarding(env.HOUSE_CHATS, {
    chatId: update.chat_id,
    chatTitle,
    status: 'address-required',
  });
  await sendChatMessage(
    update.chat_id,
    ADDRESS_REQUIRED_MESSAGE,
    openAppAttachment(env, 'Указать адрес', `setup_${update.chat_id}`),
    env,
    fetcher,
  );
}

async function registerWebhook(requestUrl: URL, env: BotEnv, fetcher: typeof fetch): Promise<string> {
  const webhookUrl = new URL(WEBHOOK_PATH, requestUrl.origin).href;
  const result = await callMaxApi<MaxActionResponse>(
    env,
    '/subscriptions',
    {
      method: 'POST',
      body: JSON.stringify({
        url: webhookUrl,
        update_types: [
          'bot_started',
          'bot_added',
          'bot_removed',
          'bot_admin_permissions_changed',
          'message_created',
        ],
        secret: env.MAX_WEBHOOK_SECRET,
      }),
    },
    fetcher,
  );

  if (!result.success) {
    throw new Error(`MAX не зарегистрировал webhook${result.message ? `: ${result.message}` : ''}`);
  }

  return webhookUrl;
}

function parsePairs(initData: string): Map<string, string> | null {
  if (!initData || initData.length > 16_384) return null;

  const pairs = new Map<string, string>();
  for (const part of initData.split('&')) {
    const separator = part.indexOf('=');
    if (separator <= 0) return null;

    const key = part.slice(0, separator);
    if (!/^[a-z_]+$/.test(key) || pairs.has(key)) return null;

    try {
      pairs.set(key, decodeURIComponent(part.slice(separator + 1).replace(/\+/g, ' ')));
    } catch {
      return null;
    }
  }

  return pairs;
}

async function hmacSha256(key: string | Uint8Array<ArrayBuffer>, value: string): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const rawKey = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
  return new Uint8Array(signature);
}

function bytesFromHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[a-f\d]{64}$/i.test(value)) return null;
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    result[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return result;
}

function bytesEqual(actual: Uint8Array, expected: Uint8Array): boolean {
  const length = Math.max(actual.length, expected.length);
  let different = actual.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    different |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return different === 0;
}

function maxAuthUser(value: string | undefined): MaxAuthUser | null {
  if (!value) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Number.isSafeInteger(parsed.id) || (parsed.id as number) <= 0) return null;
  if (typeof parsed.first_name !== 'string' || !parsed.first_name.trim()) return null;

  return {
    id: parsed.id as number,
    firstName: parsed.first_name.trim(),
    ...(typeof parsed.last_name === 'string' && parsed.last_name.trim()
      ? { lastName: parsed.last_name.trim() }
      : {}),
    ...(typeof parsed.username === 'string' && parsed.username.trim()
      ? { username: parsed.username.trim() }
      : {}),
    ...(typeof parsed.photo_url === 'string' && parsed.photo_url.trim()
      ? { photoUrl: parsed.photo_url.trim() }
      : {}),
  };
}

function initDataTtl(env: BotEnv): number {
  const value = Number(env.MAX_INIT_DATA_TTL_SECONDS ?? DEFAULT_INIT_DATA_TTL_SECONDS);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_INIT_DATA_TTL_SECONDS;
}

async function validateMaxInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
): Promise<MaxInitDataValidation> {
  const pairs = parsePairs(initData);
  const receivedHash = pairs ? bytesFromHex(pairs.get('hash') ?? '') : null;
  if (!pairs || !receivedHash || !botToken) return { ok: false };

  const launchParams = [...pairs.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = await hmacSha256('WebAppData', botToken);
  const expectedHash = await hmacSha256(secretKey, launchParams);
  if (!bytesEqual(receivedHash, expectedHash)) return { ok: false };

  const authDateText = pairs.get('auth_date');
  if (!authDateText || !/^\d+$/.test(authDateText)) return { ok: false };
  const authDate = Number(authDateText);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(authDate) ||
    authDate > nowSeconds + 60 ||
    nowSeconds - authDate > maxAgeSeconds
  ) {
    return { ok: false };
  }

  const user = maxAuthUser(pairs.get('user'));
  return user ? { ok: true, user } : { ok: false };
}

function chatRole(member: Record<string, unknown>): MaxHouseChatRole {
  if (member.is_owner === true) return 'owner';
  if (member.is_admin === true) return 'administrator';
  return 'member';
}

async function memberForChat(
  chatId: number,
  userId: number,
  env: BotEnv,
  fetcher: typeof fetch,
): Promise<Record<string, unknown> | null> {
  const path = `/chats/${encodeURIComponent(String(chatId))}/members?user_ids=${encodeURIComponent(String(userId))}`;
  const data = await callMaxApi<unknown>(env, path, { method: 'GET' }, fetcher);
  if (!isRecord(data) || !Array.isArray(data.members)) {
    throw new MaxApiError('MAX API вернул ответ без списка участников');
  }

  return (
    data.members.find(
      (candidate): candidate is Record<string, unknown> =>
        isRecord(candidate) && candidate.user_id === userId && candidate.is_bot !== true,
    ) ?? null
  );
}

async function listChatMembers(
  chatId: number,
  env: BotEnv,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>[]> {
  const members: Record<string, unknown>[] = [];
  let marker: number | undefined;

  do {
    const query = new URLSearchParams({ count: '100' });
    if (marker !== undefined) query.set('marker', String(marker));
    const data = await callMaxApi<unknown>(
      env,
      `/chats/${encodeURIComponent(String(chatId))}/members?${query}`,
      { method: 'GET' },
      fetcher,
    );
    if (!isRecord(data) || !Array.isArray(data.members)) {
      throw new MaxApiError('MAX API вернул ответ без списка участников');
    }
    members.push(...data.members.filter(isRecord));
    marker = isUserId(data.marker) ? data.marker : undefined;
  } while (marker !== undefined);

  return members;
}

function isHouseAdmin(binding: HouseChatBinding, member: Record<string, unknown>): boolean {
  const role = chatRole(member);
  return (
    role === 'administrator' ||
    role === 'owner' ||
    (isUserId(member.user_id) && member.user_id === binding.createdByUserId)
  );
}

function rolesForHouse(binding: HouseChatBinding, member: Record<string, unknown>): HouseRole[] {
  const roles: HouseRole[] = [];
  if (isHouseAdmin(binding, member)) roles.push('admin');
  if (isUserId(member.user_id) && member.user_id === binding.managementCompanyUserId) {
    roles.push('management-company');
  }
  if (roles.length === 0) roles.push('resident');
  return roles;
}

async function assignManagementCompany(
  command: SetManagementCompanyCommand,
  env: BotEnv,
  fetcher: typeof fetch,
): Promise<void> {
  if (!env.HOUSE_CHATS) throw new Error('Хранилище Домовых чатов не настроено');
  const binding = await readHouseChat(env.HOUSE_CHATS, command.chatId);
  if (!binding) {
    await sendChatMessage(
      command.chatId,
      'Сначала подключите Дом и укажите его адрес.',
      [],
      env,
      fetcher,
    );
    return;
  }

  const actor = await memberForChat(command.chatId, command.actorUserId, env, fetcher);
  if (!actor || !isHouseAdmin(binding, actor)) {
    await sendChatMessage(
      command.chatId,
      'Назначить аккаунт УК может только Администратор Дома.',
      [],
      env,
      fetcher,
    );
    return;
  }

  const members = await listChatMembers(command.chatId, env, fetcher);
  const target = members.find(
    (member) =>
      member.is_bot !== true &&
      normalizedUsername(member.username) === command.targetUsername &&
      isUserId(member.user_id),
  );
  if (!target || !isUserId(target.user_id)) {
    await sendChatMessage(
      command.chatId,
      `Аккаунт @${command.targetUsername} не найден среди участников Домового чата.`,
      [],
      env,
      fetcher,
    );
    return;
  }

  const updated: HouseChatBinding = {
    ...binding,
    managementCompanyUserId: target.user_id,
    managementCompanyUsername: command.targetUsername,
  };
  await saveHouseChat(env.HOUSE_CHATS, updated);
  await sendChatMessage(
    command.chatId,
    `@${command.targetUsername} назначен аккаунтом УК для этого Дома.`,
    [],
    env,
    fetcher,
  );
}

async function pendingSetupForUser(
  onboarding: HouseOnboarding,
  userId: number,
  env: BotEnv,
  fetcher: typeof fetch,
): Promise<PendingHouseSetup | null> {
  const member = await memberForChat(onboarding.chatId, userId, env, fetcher);
  if (!member) return null;
  const role = chatRole(member);
  const creator = env.HOUSE_CHATS ? await readHouseCreator(env.HOUSE_CHATS, onboarding.chatId) : null;
  return role === 'administrator' || role === 'owner' || creator?.userId === userId
    ? { chatId: onboarding.chatId, chatTitle: onboarding.chatTitle }
    : null;
}

async function accessForChat(
  binding: HouseChatBinding,
  userId: number,
  env: BotEnv,
  fetcher: typeof fetch,
): Promise<HouseAccess | null> {
  const member = await memberForChat(binding.chatId, userId, env, fetcher);
  if (!member) return null;

  return houseAccess(binding, member);
}

function houseAccess(binding: HouseChatBinding, member: Record<string, unknown>): HouseAccess {
  const maxChatRole = chatRole(member);
  const roles = rolesForHouse(binding, member);
  return {
    houseId: binding.houseId,
    houseLabel: binding.houseLabel,
    maxChatRole,
    canManageHouse: roles.includes('admin'),
    apartment: null,
    roles,
  };
}

async function authenticateMaxUser(request: Request, env: BotEnv, fetcher: typeof fetch): Promise<Response> {
  if (!env.BOT_TOKEN || !env.HOUSE_CHATS) {
    return json({ error: 'Авторизация MAX не настроена' }, 503);
  }

  const body = await parseJson(request);
  if (!isRecord(body) || typeof body.initData !== 'string' || !body.initData) {
    return json({ error: 'Передайте initData' }, 400);
  }

  const validation = await validateMaxInitData(body.initData, env.BOT_TOKEN, initDataTtl(env));
  if (!validation.ok) {
    return json({ error: 'Данные запуска MAX недействительны или устарели' }, 401);
  }

  try {
    // Контекст запуска лишь выбирает чат; права всё равно проверяются через MAX.
    // Читаем запись напрямую: список ключей KV может отставать после создания.
    const targetChatId = isChatId(body.chatId) ? body.chatId : null;
    const [chats, onboardings] = targetChatId !== null ? await Promise.all([
      readHouseChat(env.HOUSE_CHATS, targetChatId).then((house) => house ? [house] : []),
      readHouseOnboarding(env.HOUSE_CHATS, targetChatId).then((setup) => setup ? [setup] : []),
    ]) : await Promise.all([listHouseChats(env.HOUSE_CHATS), listHouseOnboardings(env.HOUSE_CHATS)]);
    const [accesses, pendingSetups] = await Promise.all([
      Promise.all(chats.map((chat) => accessForChat(chat, validation.user.id, env, fetcher))),
      Promise.all(
        onboardings.filter((onboarding) => !chats.some((house) => house.chatId === onboarding.chatId))
          .map((onboarding) => pendingSetupForUser(onboarding, validation.user.id, env, fetcher)),
      ),
    ]);
    const houses = accesses.filter((access): access is HouseAccess => access !== null);
    const pendingHouseSetups = pendingSetups.filter(
      (setup): setup is PendingHouseSetup => setup !== null,
    );
    if (houses.length === 0 && pendingHouseSetups.length === 0) {
      return json(
        { error: 'Доступ закрыт: добавьте бота MaxTown в домовой чат или попросите администратора сделать это' },
        403,
      );
    }

    const response: MaxAuthResponse = { user: validation.user, houses, pendingHouseSetups };
    return json(response);
  } catch (error) {
    console.error('Не удалось проверить участие в Домовом чате', error);
    return json({ error: 'Не удалось проверить участие в Домовом чате' }, 502);
  }
}

async function validateSetupAdmin(
  request: Request,
  env: BotEnv,
  fetcher: typeof fetch,
): Promise<
  | { ok: true; chatId: number; body: Record<string, unknown>; member: Record<string, unknown>; existingHouse: HouseChatBinding | null }
  | { ok: false; response: Response }
> {
  if (!env.BOT_TOKEN || !env.HOUSE_CHATS) {
    return { ok: false, response: json({ error: 'Подключение Дома не настроено' }, 503) };
  }

  const body = await parseJson(request);
  if (!isRecord(body) || typeof body.initData !== 'string' || !body.initData || !isChatId(body.chatId)) {
    return { ok: false, response: json({ error: 'Передайте initData и chatId' }, 400) };
  }

  const validation = await validateMaxInitData(body.initData, env.BOT_TOKEN, initDataTtl(env));
  if (!validation.ok) {
    return { ok: false, response: json({ error: 'Данные запуска MAX недействительны или устарели' }, 401) };
  }

  const [onboarding, existingHouse, creator] = await Promise.all([
    readHouseOnboarding(env.HOUSE_CHATS, body.chatId),
    readHouseChat(env.HOUSE_CHATS, body.chatId),
    readHouseCreator(env.HOUSE_CHATS, body.chatId),
  ]);
  if (!onboarding && !existingHouse) {
    return { ok: false, response: json({ error: 'Адрес этого Домового чата уже выбран или настройка не найдена' }, 404) };
  }

  const member = await memberForChat(body.chatId, validation.user.id, env, fetcher);
  if (!member || !(existingHouse ? isHouseAdmin(existingHouse, member) : chatRole(member) !== 'member' || creator?.userId === validation.user.id)) {
    return { ok: false, response: json({ error: 'Выбрать адрес может только администратор чата' }, 403) };
  }
  if (!(await botIsAdmin(body.chatId, env, fetcher))) {
    return { ok: false, response: json({ error: 'Сначала верните боту права администратора чата' }, 409) };
  }

  return { ok: true, chatId: body.chatId, body, member, existingHouse };
}

async function getAddressSuggestions(request: Request, env: BotEnv, fetcher: typeof fetch): Promise<Response> {
  if (!env.DADATA_API_KEY) return json({ error: 'API-ключ DaData не настроен' }, 503);

  try {
    const setup = await validateSetupAdmin(request, env, fetcher);
    if (!setup.ok) return setup.response;
    const query = typeof setup.body.query === 'string' ? setup.body.query.trim() : '';
    if (query.length < 3 || query.length > 200) {
      return json({ error: 'Введите не менее трёх символов адреса' }, 400);
    }

    const suggestions = await suggestHouseAddresses(env.DADATA_API_KEY, query, fetcher);
    return json({ suggestions });
  } catch (error) {
    if (error instanceof AddressProviderError) {
      console.error('Не удалось получить подсказки DaData', error);
      return json({ error: 'Не удалось получить подсказки адреса' }, 502);
    }
    if (error instanceof MaxApiError) {
      console.error('Не удалось проверить администратора Домового чата', error);
      return json({ error: 'Не удалось проверить права в Домовом чате' }, 502);
    }
    throw error;
  }
}

async function confirmHouseAddress(request: Request, env: BotEnv, fetcher: typeof fetch): Promise<Response> {
  if (!env.DADATA_API_KEY) return json({ error: 'API-ключ DaData не настроен' }, 503);

  try {
    const setup = await validateSetupAdmin(request, env, fetcher);
    if (!setup.ok) return setup.response;
    // Повтор после потери ответа не создаёт Дом заново и не меняет его адрес/УК.
    if (setup.existingHouse) {
      return json({ house: setup.existingHouse, access: houseAccess(setup.existingHouse, setup.member) });
    }
    const garHouseGuid =
      typeof setup.body.garHouseGuid === 'string' ? setup.body.garHouseGuid.trim() : '';
    if (!garHouseGuid || garHouseGuid.length > 128) {
      return json({ error: 'Выберите адрес из списка' }, 400);
    }

    const address = await findHouseAddressByGuid(env.DADATA_API_KEY, garHouseGuid, fetcher);
    if (!address) return json({ error: 'Выбранный дом не найден в ГАР' }, 400);

    const house = await activateHouseChat(setup.chatId, address, env, fetcher);
    return json({ house, access: houseAccess(house, setup.member) });
  } catch (error) {
    if (error instanceof AddressProviderError) {
      console.error('Не удалось подтвердить адрес через DaData', error);
      return json({ error: 'Не удалось подтвердить адрес' }, 502);
    }
    if (error instanceof MaxApiError) {
      console.error('Не удалось проверить администратора Домового чата', error);
      return json({ error: 'Не удалось проверить права в Домовом чате' }, 502);
    }
    throw error;
  }
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function handleRequest(
  request: Request,
  env: BotEnv,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === HEALTH_PATH) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    return json({ status: 'ok' });
  }

  if (url.pathname === AUTH_PATH) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    return authenticateMaxUser(request, env, fetcher);
  }

  if (url.pathname === ADDRESS_SUGGESTIONS_PATH) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    return getAddressSuggestions(request, env, fetcher);
  }

  if (url.pathname === ADDRESS_CONFIRM_PATH) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    return confirmHouseAddress(request, env, fetcher);
  }

  if (url.pathname === REGISTER_PATH) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    if (!hasBotSecrets(env)) return json({ error: 'Секреты бота не настроены' }, 503);
    if (!isAuthorized(request, env)) return json({ error: 'Неверный секрет' }, 401);

    try {
      const webhookUrl = await registerWebhook(url, env, fetcher);
      return json({ success: true, webhookUrl });
    } catch (error) {
      console.error('Не удалось зарегистрировать webhook MAX', error);
      return json({ error: 'MAX не принял регистрацию webhook' }, 502);
    }
  }

  if (url.pathname === WEBHOOK_PATH) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    if (!hasBotSecrets(env)) return json({ error: 'Секреты бота не настроены' }, 503);
    if (!isAuthorized(request, env)) return json({ error: 'Неверный секрет' }, 401);

    const update = await parseJson(request);
    if (!isRecord(update) || typeof update.update_type !== 'string') {
      return json({ error: 'Некорректное событие MAX' }, 400);
    }

    try {
      if (update.update_type === 'bot_started') {
        if (!isBotStartedUpdate(update)) return json({ error: 'Некорректное событие bot_started' }, 400);
        await sendWelcome(update, env, fetcher);
      } else if (
        update.update_type === 'bot_added' ||
        update.update_type === 'bot_admin_permissions_changed'
      ) {
        if (!isChatUpdate(update)) return json({ error: `Некорректное событие ${update.update_type}` }, 400);
        await syncHouseChat(update, env, fetcher);
      } else if (update.update_type === 'bot_removed') {
        if (!isChatUpdate(update)) return json({ error: 'Некорректное событие bot_removed' }, 400);
        await deleteHouseState(env.HOUSE_CHATS, update.chat_id);
      } else if (update.update_type === 'message_created') {
        const setManagementCompany = setManagementCompanyCommand(update);
        if (setManagementCompany) {
          await assignManagementCompany(setManagementCompany, env, fetcher);
        } else {
          const connectUpdate = connectCommandUpdate(update);
          if (connectUpdate) await syncHouseChat(connectUpdate, env, fetcher);
        }
      }
      // MAX считает доставленным только webhook с HTTP 200.
      return json({ success: true });
    } catch (error) {
      console.error('Не удалось обработать событие MAX', error);
      return json({ error: 'Не удалось обработать событие MAX' }, 502);
    }
  }

  return new Response('Not found', { status: 404 });
}

export default {
  fetch(request: Request, env: BotEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
