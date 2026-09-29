import type { MaxHouseChatRole } from '@maxtown/shared';
import { withTimeout } from '@maxtown/shared/http';

// Вызовы MAX Bot API (https://dev.max.ru/docs-api) от имени бота MaxTown.
// Токен уходит только на два фиксированных домена MAX.

const MAX_API_ORIGIN = 'https://platform-api2.max.ru';
/**
 * platform-api2 подписан Russian Trusted Root CA (Минцифры), которого нет в
 * стандартном наборе Node и Cloudflare. Старый домен отдаёт тот же API с
 * публично доверенной цепочкой — идём туда только при ошибке TLS (ADR 0004).
 * Поставите корень Минцифры в NODE_EXTRA_CA_CERTS — запасной не понадобится.
 */
const MAX_API_FALLBACK_ORIGIN = 'https://platform-api.max.ru';
const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
]);
const TIMEOUT_MS = 4_000;

export class MaxApiError extends Error {}

/** Участник чата — только то, что нужно для Ролей. */
export type MaxChatMember = {
  userId: number;
  username: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  isBot: boolean;
};

export type MaxOpenAppButton = { text: string; payload?: string };

export type MaxApi = {
  /** Название активного группового чата. */
  chatTitle(chatId: number): Promise<string>;
  /** Участник чата или null, если человека в чате нет. */
  member(chatId: number, userId: number): Promise<MaxChatMember | null>;
  members(chatId: number): Promise<MaxChatMember[]>;
  botIsAdmin(chatId: number): Promise<boolean>;
  sendChatMessage(chatId: number, text: string, button?: MaxOpenAppButton): Promise<void>;
  subscribe(url: string, secret: string): Promise<void>;
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUserId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isTlsError(error: unknown): boolean {
  const cause = isRecord(error) ? error.cause : undefined;
  return isRecord(cause) && typeof cause.code === 'string' && TLS_ERROR_CODES.has(cause.code);
}

function toMember(value: unknown): MaxChatMember | null {
  if (!isRecord(value) || !isUserId(value.user_id)) return null;
  return {
    userId: value.user_id,
    username: typeof value.username === 'string' && value.username.trim() ? value.username.trim() : null,
    isAdmin: value.is_admin === true,
    isOwner: value.is_owner === true,
    isBot: value.is_bot === true,
  };
}

export function chatRole(member: MaxChatMember): MaxHouseChatRole {
  if (member.isOwner) return 'owner';
  if (member.isAdmin) return 'administrator';
  return 'member';
}

export function createMaxApi(config: { token: string; botUsername: string; fetcher?: Fetcher }): MaxApi {
  const fetcher: Fetcher = config.fetcher ?? ((input, init) => fetch(input, init));

  async function send(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    const request: RequestInit = {
      ...init,
      signal,
      headers: {
        authorization: config.token,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    };
    try {
      const response = await fetcher(new URL(path, MAX_API_ORIGIN).href, request);
      // 526 — тот же отказ TLS, если запрос идёт через Cloudflare.
      if (response.status !== 526) return response;
    } catch (error) {
      if (!isTlsError(error)) throw error;
    }
    return fetcher(new URL(path, MAX_API_FALLBACK_ORIGIN).href, request);
  }

  /** Запрос с таймаутом; 403 и 404 отдаются вызывающему, остальные ошибки — MaxApiError. */
  async function call(path: string, init: RequestInit = { method: 'GET' }): Promise<{ status: number; data: unknown }> {
    try {
      return await withTimeout(async (signal) => {
        const response = await send(path, init, signal);
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok && response.status !== 403 && response.status !== 404) {
          throw new MaxApiError(`MAX API ответил с HTTP ${response.status}`);
        }
        return { status: response.status, data };
      }, TIMEOUT_MS);
    } catch (error) {
      if (error instanceof MaxApiError) throw error;
      throw new MaxApiError('MAX не ответил вовремя или недоступен');
    }
  }

  async function ok(path: string, init?: RequestInit): Promise<unknown> {
    const { status, data } = await call(path, init);
    if (status === 403 || status === 404) throw new MaxApiError(`MAX API ответил с HTTP ${status}`);
    return data;
  }

  const chatPath = (chatId: number) => `/chats/${encodeURIComponent(String(chatId))}`;

  return {
    async chatTitle(chatId) {
      const chat = await ok(chatPath(chatId));
      if (!isRecord(chat) || chat.type !== 'chat' || chat.status !== 'active') {
        throw new MaxApiError('Это не активный групповой чат MAX');
      }
      return typeof chat.title === 'string' && chat.title.trim() ? chat.title.trim() : `Домовой чат ${chatId}`;
    },

    async member(chatId, userId) {
      const data = await ok(`${chatPath(chatId)}/members?user_ids=${encodeURIComponent(String(userId))}`);
      if (!isRecord(data) || !Array.isArray(data.members)) throw new MaxApiError('MAX API вернул ответ без списка участников');
      const member = data.members.map(toMember).find((candidate) => candidate?.userId === userId && !candidate.isBot);
      return member ?? null;
    },

    async members(chatId) {
      const members: MaxChatMember[] = [];
      let marker: number | undefined;
      do {
        const query = new URLSearchParams({ count: '100' });
        if (marker !== undefined) query.set('marker', String(marker));
        const data = await ok(`${chatPath(chatId)}/members?${query}`);
        if (!isRecord(data) || !Array.isArray(data.members)) throw new MaxApiError('MAX API вернул ответ без списка участников');
        members.push(...data.members.map(toMember).filter((member): member is MaxChatMember => member !== null));
        marker = isUserId(data.marker) ? data.marker : undefined;
      } while (marker !== undefined);
      return members;
    },

    async botIsAdmin(chatId) {
      const { status, data } = await call(`${chatPath(chatId)}/members/me`);
      if (status === 403 || status === 404) return false;
      return isRecord(data) && (data.is_admin === true || data.is_owner === true);
    },

    async sendChatMessage(chatId, text, button) {
      const attachments = button ? [{
        type: 'inline_keyboard',
        payload: {
          buttons: [[{
            type: 'open_app',
            text: button.text,
            web_app: config.botUsername,
            ...(button.payload ? { payload: button.payload } : {}),
          }]],
        },
      }] : [];
      await ok(`/messages?chat_id=${encodeURIComponent(String(chatId))}`, {
        method: 'POST',
        body: JSON.stringify({ text, ...(attachments.length > 0 ? { attachments } : {}) }),
      });
    },

    async subscribe(url, secret) {
      const result = await ok('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          url,
          update_types: ['bot_started', 'bot_added', 'bot_removed', 'bot_admin_permissions_changed', 'message_created'],
          secret,
        }),
      });
      if (!isRecord(result) || result.success !== true) {
        const message = isRecord(result) && typeof result.message === 'string' ? `: ${result.message}` : '';
        throw new MaxApiError(`MAX не зарегистрировал webhook${message}`);
      }
    },
  };
}
