import type { HouseAddressSuggestion, PendingHouseSetup } from '@maxtown/shared';
import { currentMaxInitData } from './maxLaunch.ts';

export class HouseSetupRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setupChatId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^setup_(-?\d+)$/.exec(value);
  if (!match) return null;
  const chatId = Number(match[1]);
  return Number.isSafeInteger(chatId) && chatId !== 0 ? chatId : null;
}

export function launchSetupChatId(): number | null {
  const bridgeStartParam = window.WebApp?.initDataUnsafe?.start_param;
  const bridgeChatId = setupChatId(bridgeStartParam);
  if (bridgeChatId !== null) return bridgeChatId;

  // MAX также передаёт payload запуска в GET-параметре WebAppStartParam.
  // В некоторых клиентах он появляется раньше, чем initDataUnsafe заполняется мостом.
  return setupChatId(new URLSearchParams(window.location.search).get('WebAppStartParam'));
}

export function demoPendingHouseSetup(): PendingHouseSetup {
  return { chatId: -42, chatTitle: 'ул. Победы, д. 31, г. Тольятти' };
}

function isSuggestion(value: unknown): value is HouseAddressSuggestion {
  return (
    isRecord(value) &&
    typeof value.value === 'string' &&
    typeof value.locality === 'string' &&
    typeof value.garHouseGuid === 'string'
  );
}

async function responseData(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new HouseSetupRequestError('Сервер вернул некорректный ответ', response.status);
  }
}

function responseError(data: unknown, response: Response, fallback: string): HouseSetupRequestError {
  const message = isRecord(data) && typeof data.error === 'string' ? data.error : fallback;
  return new HouseSetupRequestError(message, response.status);
}

const demoSuggestions: HouseAddressSuggestion[] = [
  {
    value: 'Самарская обл, г Тольятти, ул Победы, д 31',
    locality: 'Самарская обл, г Тольятти',
    garHouseGuid: '1da21a60-f4a8-4fa7-a7d7-bb77398ba437',
  },
  {
    value: 'Самарская обл, г Тольятти, ул Победы, д 31А',
    locality: 'Самарская обл, г Тольятти',
    garHouseGuid: '7d4d9479-6cd2-4c9a-aa83-b9c0c8f5a312',
  },
];

export async function suggestSetupAddresses(
  setup: PendingHouseSetup,
  query: string,
  fetcher: typeof fetch = globalThis.fetch,
  initData: string | undefined = currentMaxInitData(),
): Promise<HouseAddressSuggestion[]> {
  if (!initData && import.meta.env.DEV) return demoSuggestions;
  if (!initData) throw new HouseSetupRequestError('Откройте настройку из чата MAX', 401);

  const response = await fetcher('/api/house-setup/suggestions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData, chatId: setup.chatId, query }),
  });
  const data = await responseData(response);
  if (!response.ok) throw responseError(data, response, 'Не удалось найти адрес');
  if (!isRecord(data) || !Array.isArray(data.suggestions) || !data.suggestions.every(isSuggestion)) {
    throw new HouseSetupRequestError('Сервер вернул адреса неизвестного формата', response.status);
  }
  return data.suggestions;
}

export async function confirmSetupAddress(
  setup: PendingHouseSetup,
  address: HouseAddressSuggestion,
  fetcher: typeof fetch = globalThis.fetch,
  initData: string | undefined = currentMaxInitData(),
): Promise<void> {
  if (!initData && import.meta.env.DEV) return;
  if (!initData) throw new HouseSetupRequestError('Откройте настройку из чата MAX', 401);

  const response = await fetcher('/api/house-setup/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      initData,
      chatId: setup.chatId,
      garHouseGuid: address.garHouseGuid,
    }),
  });
  const data = await responseData(response);
  if (!response.ok) throw responseError(data, response, 'Не удалось сохранить адрес');
  if (!isRecord(data) || !isRecord(data.house) || typeof data.house.houseLabel !== 'string') {
    throw new HouseSetupRequestError('Сервер не подтвердил создание Дома', response.status);
  }
}
