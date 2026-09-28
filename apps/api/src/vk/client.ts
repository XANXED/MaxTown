import type { VkMessage, VkMessageSender } from '../notifications/outbox.ts';

export class VkApiError extends Error {
  readonly code: number | null;
  readonly retryable: boolean;

  constructor(code: number | null, retryable: boolean) {
    super(code === null ? 'VK API request failed' : `VK API request failed (${code})`);
    this.name = 'VkApiError';
    this.code = code;
    this.retryable = retryable;
  }
}

type VkApiResponse = { response?: unknown; error?: { error_code?: unknown } };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createVkMessageClient(config: {
  token: string;
  groupId: number;
  apiVersion?: string;
  timeoutMs?: number;
  fetch?: Fetcher;
}): VkMessageSender {
  const fetcher = config.fetch ?? fetch;
  const apiVersion = config.apiVersion ?? '5.199';
  const timeoutMs = config.timeoutMs ?? 8_000;
  return {
    async send(message: VkMessage): Promise<void> {
      const body = new URLSearchParams({
        access_token: config.token,
        group_id: String(config.groupId),
        user_id: message.userId,
        random_id: String(message.randomId),
        message: message.message,
        intent: 'non_promo_newsletter',
        v: apiVersion,
      });
      let response: Response;
      try {
        response = await fetcher('https://api.vk.com/method/messages.send', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new VkApiError(null, true);
      }
      if (!response.ok) throw new VkApiError(null, response.status >= 500 || response.status === 429);
      let payload: VkApiResponse;
      try { payload = await response.json() as VkApiResponse; }
      catch { throw new VkApiError(null, true); }
      if (payload.error) {
        const code = typeof payload.error.error_code === 'number' ? payload.error.error_code : null;
        throw new VkApiError(code, code === null || [1, 6, 10].includes(code));
      }
      if (!Object.hasOwn(payload, 'response')) throw new VkApiError(null, true);
    },
  };
}
