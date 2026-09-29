import type { HouseAddressSuggestion, PendingHouseSetup } from '@maxtown/shared';
import { RequestTimeoutError, withTimeout } from '@maxtown/shared/http';
import { apiFetch, getSession } from './auth/session.ts';
import { currentMaxInitData, launchParameter } from './maxLaunch.ts';

// Подключение Дома: бот не узнал адрес по названию Домового чата, и его
// администратор выбирает Дом из подсказок DaData. Кто выбирает — сервер знает
// из сессии, права в чате и выбранный GUID он проверяет сам.

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
  return setupChatId(launchParameter('WebAppStartParam'))
    ?? setupChatId(new URLSearchParams(currentMaxInitData()).get('start_param'));
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function setupRequest(path: string, body: Record<string, unknown>, fetcher: Fetcher) {
  try {
    return await withTimeout(async (signal) => {
      const response = await fetcher(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      return { response, data: await responseData(response) };
    }, 20_000);
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      throw new HouseSetupRequestError('Сервер долго не отвечает. Попробуйте ещё раз', 504);
    }
    throw error;
  }
}

/** Вне MAX, в dev-предпросмотре без сессии — примеры вместо запросов. */
function demo(): boolean {
  return import.meta.env.DEV && getSession() === null;
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

const errorMessages: Record<string, string> = {
  house_setup_forbidden: 'Выбрать адрес может только администратор этого чата',
  house_setup_not_found: 'Адрес этого чата уже выбран или настройка не найдена',
  bot_is_not_admin: 'Сначала верните боту MaxTown права администратора чата',
  house_address_not_found: 'Этого дома нет в ГАР. Выберите адрес из списка',
  address_provider_not_configured: 'На сервере не настроен поиск адресов',
  address_provider_unavailable: 'Сервис адресов не ответил. Попробуйте ещё раз',
  max_unavailable: 'MAX не ответил. Попробуйте ещё раз',
};

function responseError(data: unknown, response: Response, fallback: string): HouseSetupRequestError {
  const code = isRecord(data) && typeof data.error === 'string' ? data.error : '';
  return new HouseSetupRequestError(errorMessages[code] ?? fallback, response.status);
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
  fetcher: Fetcher = apiFetch,
): Promise<HouseAddressSuggestion[]> {
  if (demo()) return demoSuggestions;

  const { response, data } = await setupRequest('/api/house-setup/suggestions', { chatId: setup.chatId, query }, fetcher);
  if (!response.ok) throw responseError(data, response, 'Не удалось найти адрес');
  if (!isRecord(data) || !Array.isArray(data.suggestions) || !data.suggestions.every(isSuggestion)) {
    throw new HouseSetupRequestError('Сервер вернул адреса неизвестного формата', response.status);
  }
  return data.suggestions;
}

/** Создать Дом по выбранному адресу. Возвращает id Дома. */
export async function confirmSetupAddress(
  setup: PendingHouseSetup,
  address: HouseAddressSuggestion,
  fetcher: Fetcher = apiFetch,
): Promise<string> {
  if (demo()) return `demo-${setup.chatId}`;

  const { response, data } = await setupRequest('/api/house-setup/confirm', { chatId: setup.chatId, garHouseGuid: address.garHouseGuid }, fetcher);
  if (!response.ok) throw responseError(data, response, 'Не удалось сохранить адрес');
  if (!isRecord(data) || typeof data.houseId !== 'string') {
    throw new HouseSetupRequestError('Сервер не подтвердил создание Дома', response.status);
  }
  return data.houseId;
}
