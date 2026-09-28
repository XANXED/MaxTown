import type { HouseAccess, HouseRole, MaxHouseChatRole } from '@maxtown/shared';

const MAX_API_ORIGIN = 'https://platform-api2.max.ru';

export type HouseChatBinding = {
  houseId: string;
  houseLabel: string;
  chatId: number;
  createdByUserId?: number;
  managementCompanyUserId?: number;
  managementCompanyUsername?: string;
};

export class MaxApiError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseHouseChatBindings(raw: string | undefined): HouseChatBinding[] {
  if (!raw?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MAX_HOUSE_CHATS должен содержать корректный JSON');
  }

  if (!Array.isArray(parsed)) throw new Error('MAX_HOUSE_CHATS должен быть массивом');

  const bindings = parsed.map((item, index): HouseChatBinding => {
    if (!isRecord(item)) throw new Error(`MAX_HOUSE_CHATS[${index}] должен быть объектом`);
    const { houseId, houseLabel, chatId, createdByUserId, managementCompanyUserId, managementCompanyUsername } = item;
    if (typeof houseId !== 'string' || !houseId.trim()) {
      throw new Error(`MAX_HOUSE_CHATS[${index}].houseId обязателен`);
    }
    if (typeof houseLabel !== 'string' || !houseLabel.trim()) {
      throw new Error(`MAX_HOUSE_CHATS[${index}].houseLabel обязателен`);
    }
    if (!Number.isSafeInteger(chatId) || chatId === 0) {
      throw new Error(`MAX_HOUSE_CHATS[${index}].chatId должен быть ненулевым безопасным целым числом`);
    }

    return {
      houseId: houseId.trim(),
      houseLabel: houseLabel.trim(),
      chatId: chatId as number,
      ...(Number.isSafeInteger(createdByUserId) && Number(createdByUserId) > 0
        ? { createdByUserId: createdByUserId as number }
        : {}),
      ...(Number.isSafeInteger(managementCompanyUserId) && Number(managementCompanyUserId) > 0
        ? { managementCompanyUserId: managementCompanyUserId as number }
        : {}),
      ...(typeof managementCompanyUsername === 'string' && managementCompanyUsername.trim()
        ? { managementCompanyUsername: managementCompanyUsername.trim() }
        : {}),
    };
  });

  if (new Set(bindings.map(({ houseId }) => houseId)).size !== bindings.length) {
    throw new Error('MAX_HOUSE_CHATS содержит повторяющийся houseId');
  }
  if (new Set(bindings.map(({ chatId }) => chatId)).size !== bindings.length) {
    throw new Error('MAX_HOUSE_CHATS содержит повторяющийся chatId');
  }

  return bindings;
}

function chatRole(member: Record<string, unknown>): MaxHouseChatRole {
  if (member.is_owner === true) return 'owner';
  if (member.is_admin === true) return 'administrator';
  return 'member';
}

function rolesForBinding(binding: HouseChatBinding, member: Record<string, unknown>): HouseRole[] {
  const userId = typeof member.user_id === 'number' ? member.user_id : null;
  const maxChatRole = chatRole(member);
  const roles: HouseRole[] = [];
  if (
    maxChatRole === 'administrator' ||
    maxChatRole === 'owner' ||
    (userId !== null && userId === binding.createdByUserId)
  ) {
    roles.push('admin');
  }
  if (userId !== null && userId === binding.managementCompanyUserId) roles.push('management-company');
  if (roles.length === 0) roles.push('resident');
  return roles;
}

async function accessForBinding(
  binding: HouseChatBinding,
  userId: number,
  botToken: string,
  fetcher: typeof fetch,
): Promise<HouseAccess | null> {
  const url = new URL(`/chats/${encodeURIComponent(String(binding.chatId))}/members`, MAX_API_ORIGIN);
  url.searchParams.set('user_ids', String(userId));
  const response = await fetcher(url, { headers: { authorization: botToken } });
  if (!response.ok) throw new MaxApiError(`MAX API ответил с HTTP ${response.status}`);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new MaxApiError('MAX API вернул некорректный JSON');
  }

  if (!isRecord(data) || !Array.isArray(data.members)) {
    throw new MaxApiError('MAX API вернул ответ без списка участников');
  }

  const member = data.members.find(
    (candidate): candidate is Record<string, unknown> =>
      isRecord(candidate) && candidate.user_id === userId && candidate.is_bot !== true,
  );
  if (!member) return null;

  const maxChatRole = chatRole(member);
  const roles = rolesForBinding(binding, member);
  return {
    houseId: binding.houseId,
    houseLabel: binding.houseLabel,
    maxChatRole,
    canManageHouse: roles.includes('admin'),
    apartment: null,
    roles,
  };
}

export async function getHouseAccesses(
  bindings: HouseChatBinding[],
  userId: number,
  botToken: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<HouseAccess[]> {
  const accesses = await Promise.all(
    bindings.map((binding) => accessForBinding(binding, userId, botToken, fetcher)),
  );
  return accesses.filter((access): access is HouseAccess => access !== null);
}
