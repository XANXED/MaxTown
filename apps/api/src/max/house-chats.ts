import type { Pool, PoolClient } from 'pg';
import type { HouseRole, PendingHouseSetup } from '@maxtown/shared';
import { AddressProviderError, resolveHouseAddressFromTitle, type DaDataHouse } from '../address/dadata.ts';
import { chatRole, MaxApiError, type MaxApi, type MaxChatMember } from './api.ts';

// Домовые чаты MAX (docs/adr/0006, 0007): каждый чат, где бот MaxTown стал
// администратором и Адрес Дома определён, — отдельный Дом. Роль человека в
// Доме выводится из участия в чате и пересчитывается при каждом входе.

export type HouseChatDeps = {
  pool: Pool;
  max: MaxApi;
  /** Серверный ключ DaData; без него Дом ждёт, пока адрес выберут вручную. */
  dadataKey: string | null;
  dadataFetch?: typeof fetch;
  log?: (message: string, error?: unknown) => void;
};

export const WELCOME_MESSAGE =
  'Привет! Это MaxTown, помощник жильцов дома. Войти смогут участники Домового чата, в котором я администратор.';
const ADMIN_REQUIRED_MESSAGE =
  'Чтобы подключить Дом к MaxTown, выдайте боту права администратора. Они нужны для проверки участников чата.';
const ADDRESS_REQUIRED_MESSAGE =
  'Не удалось однозначно определить адрес по названию чата. Администратор чата, выберите адрес Дома в мини-приложении.';

function houseConnectedMessage(address: string): string {
  return `Дом подключён к MaxTown: ${address}. Администраторы чата получают роль Администратора Дома, остальные участники — роль Жильца. Назначить аккаунт УК: /set_uk @username`;
}

type HouseChatRow = {
  chat_id: string;
  house_id: string;
  created_by_max_user_id: string | null;
  management_company_max_user_id: string | null;
  disconnected_at: Date | null;
};

type OnboardingRow = {
  chat_id: string;
  chat_title: string | null;
  created_by_max_user_id: string | null;
  address_required_at: Date | null;
};

const idOf = (value: string | null): number | null => (value === null ? null : Number(value));

function isHouseAdmin(chat: Pick<HouseChatRow, 'created_by_max_user_id'>, member: MaxChatMember): boolean {
  return chatRole(member) !== 'member' || member.userId === idOf(chat.created_by_max_user_id);
}

/**
 * Одна Роль на Дом: Администратор Дома важнее УК, УК важнее Жильца. Права УК
 * входят в права Администратора, поэтому совмещение хранится как admin.
 */
export function houseRoleFor(chat: Pick<HouseChatRow, 'created_by_max_user_id' | 'management_company_max_user_id'>, member: MaxChatMember): HouseRole {
  if (isHouseAdmin(chat, member)) return 'admin';
  if (member.userId === idOf(chat.management_company_max_user_id)) return 'management-company';
  return 'resident';
}

async function setMembership(db: Pool | PoolClient, residentId: string, houseId: string, role: HouseRole | null): Promise<void> {
  if (role === null) {
    await db.query('UPDATE memberships SET ended_at = now() WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL', [residentId, houseId]);
    return;
  }
  // Роль меняем на месте: Опросы, Сообщения и аудит ссылаются на членство.
  await db.query(
    `INSERT INTO memberships (house_id, resident_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (resident_id, house_id) WHERE ended_at IS NULL DO UPDATE SET role = EXCLUDED.role`,
    [houseId, residentId, role],
  );
}

/**
 * Пересчитать Дома человека по его участию в Домовых чатах. Если MAX не
 * ответил про какой-то чат, прежнее членство в этом Доме остаётся как было:
 * вход не должен ломаться от сбоя MAX. Возвращает чаты, где человек может
 * выбрать Адрес Дома.
 */
export async function syncResidentHouses(
  deps: HouseChatDeps,
  resident: { id: string; maxUserId: number },
  onlyChatId: number | null = null,
): Promise<PendingHouseSetup[]> {
  const chats = await deps.pool.query<HouseChatRow>(
    `SELECT chat_id, house_id, created_by_max_user_id, management_company_max_user_id, disconnected_at
       FROM house_chats WHERE disconnected_at IS NULL AND ($1::bigint IS NULL OR chat_id = $1)`,
    [onlyChatId],
  );
  await Promise.all(chats.rows.map(async (chat) => {
    let member: MaxChatMember | null;
    try {
      member = await deps.max.member(Number(chat.chat_id), resident.maxUserId);
    } catch (error) {
      deps.log?.('Не удалось проверить участие в Домовом чате', error);
      return;
    }
    await setMembership(deps.pool, resident.id, chat.house_id, member ? houseRoleFor(chat, member) : null);
  }));

  const onboardings = await deps.pool.query<OnboardingRow>(
    `SELECT onboarding.chat_id, onboarding.chat_title, onboarding.created_by_max_user_id, onboarding.address_required_at
       FROM house_chat_onboardings onboarding
      WHERE onboarding.address_required_at IS NOT NULL AND ($1::bigint IS NULL OR onboarding.chat_id = $1)
        AND NOT EXISTS (SELECT 1 FROM house_chats chat WHERE chat.chat_id = onboarding.chat_id)`,
    [onlyChatId],
  );
  const setups = await Promise.all(onboardings.rows.map(async (onboarding): Promise<PendingHouseSetup | null> => {
    try {
      const member = await deps.max.member(Number(onboarding.chat_id), resident.maxUserId);
      return member && isHouseAdmin(onboarding, member)
        ? { chatId: Number(onboarding.chat_id), chatTitle: onboarding.chat_title! }
        : null;
    } catch (error) {
      deps.log?.('Не удалось проверить администратора Домового чата', error);
      return null;
    }
  }));
  return setups.filter((setup): setup is PendingHouseSetup => setup !== null);
}

async function readHouseChat(db: Pool | PoolClient, chatId: number): Promise<HouseChatRow | null> {
  const result = await db.query<HouseChatRow>(
    'SELECT chat_id, house_id, created_by_max_user_id, management_company_max_user_id, disconnected_at FROM house_chats WHERE chat_id = $1',
    [chatId],
  );
  return result.rows[0] ?? null;
}

async function readOnboarding(db: Pool | PoolClient, chatId: number): Promise<OnboardingRow | null> {
  const result = await db.query<OnboardingRow>(
    'SELECT chat_id, chat_title, created_by_max_user_id, address_required_at FROM house_chat_onboardings WHERE chat_id = $1',
    [chatId],
  );
  return result.rows[0] ?? null;
}

/** «Санкт-Петербург, Комендантский пр-кт, д 14 к 1» → улица и дом без города. */
function streetAddress(address: DaDataHouse): string {
  const prefix = `${address.locality}, `;
  return address.value.startsWith(prefix) && address.value.length > prefix.length ? address.value.slice(prefix.length) : address.value;
}

/**
 * Создать Дом для чата с выбранным адресом. Повтор (потерянный ответ, второй
 * webhook) не создаёт второй Дом: вернётся уже созданный.
 */
export async function activateHouseChat(deps: HouseChatDeps, chatId: number, address: DaDataHouse): Promise<{ houseId: string; created: boolean }> {
  const client = await deps.pool.connect();
  let houseId: string;
  try {
    await client.query('BEGIN');
    const existing = await readHouseChat(client, chatId);
    if (existing) {
      await client.query('ROLLBACK');
      return { houseId: existing.house_id, created: false };
    }
    const onboarding = await readOnboarding(client, chatId);
    const house = await client.query<{ id: string }>(
      'INSERT INTO houses (address, locality, gar_house_guid, lat, lon) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [streetAddress(address), address.locality, address.garHouseGuid, address.point?.lat ?? null, address.point?.lon ?? null],
    );
    houseId = house.rows[0]!.id;
    await client.query(
      'INSERT INTO house_chats (chat_id, house_id, created_by_max_user_id) VALUES ($1, $2, $3)',
      [chatId, houseId, onboarding?.created_by_max_user_id ?? null],
    );
    await client.query('DELETE FROM house_chat_onboardings WHERE chat_id = $1', [chatId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    // Параллельный запрос успел создать Дом первым.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      const existing = await readHouseChat(deps.pool, chatId);
      if (existing) return { houseId: existing.house_id, created: false };
    }
    throw error;
  } finally {
    client.release();
  }

  try {
    await deps.max.sendChatMessage(chatId, houseConnectedMessage(address.value), { text: 'Открыть MaxTown' });
  } catch (error) {
    // Дом уже создан; сбой объявления в чате его не отменяет.
    deps.log?.('Дом создан, но MAX не принял объявление в чат', error);
  }
  return { houseId, created: true };
}

/** Бот лишился прав или удалён: Доступа к Дому нет, пока права не вернут. */
async function disconnectHouseChat(db: Pool, chat: HouseChatRow): Promise<void> {
  await db.query('UPDATE house_chats SET disconnected_at = now() WHERE chat_id = $1 AND disconnected_at IS NULL', [chat.chat_id]);
  await db.query('UPDATE memberships SET ended_at = now() WHERE house_id = $1 AND ended_at IS NULL', [chat.house_id]);
}

async function rememberCreator(db: Pool, chatId: number, userId: number | null): Promise<void> {
  await db.query(
    `INSERT INTO house_chat_onboardings (chat_id, created_by_max_user_id) VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE
       SET created_by_max_user_id = COALESCE(house_chat_onboardings.created_by_max_user_id, EXCLUDED.created_by_max_user_id)`,
    [chatId, userId],
  );
}

/**
 * Бота добавили в чат, поменяли ему права или прислали /connect. Бот
 * администратор — определяем Адрес Дома по названию чата; одно точное
 * совпадение в DaData создаёт Дом, иначе администратор выбирает адрес сам.
 */
export async function connectHouseChat(deps: HouseChatDeps, chatId: number, actorUserId: number | null): Promise<void> {
  const existing = await readHouseChat(deps.pool, chatId);
  if (!existing) await rememberCreator(deps.pool, chatId, actorUserId);

  if (!(await deps.max.botIsAdmin(chatId))) {
    if (existing) await disconnectHouseChat(deps.pool, existing);
    await deps.pool.query('UPDATE house_chat_onboardings SET address_required_at = NULL WHERE chat_id = $1', [chatId]);
    await deps.max.sendChatMessage(chatId, ADMIN_REQUIRED_MESSAGE);
    return;
  }

  if (existing) {
    // Права вернули — Дом снова доступен; членства восстановятся при входе.
    if (existing.disconnected_at) await deps.pool.query('UPDATE house_chats SET disconnected_at = NULL WHERE chat_id = $1', [chatId]);
    return;
  }

  const chatTitle = await deps.max.chatTitle(chatId);
  if (deps.dadataKey) {
    try {
      const address = await resolveHouseAddressFromTitle(deps.dadataKey, chatTitle, deps.dadataFetch);
      if (address) {
        await activateHouseChat(deps, chatId, address);
        return;
      }
    } catch (error) {
      if (!(error instanceof AddressProviderError)) throw error;
      deps.log?.('Не удалось определить адрес Домового чата через DaData', error);
    }
  }

  const onboarding = await readOnboarding(deps.pool, chatId);
  // Уже просили выбрать адрес для этого же названия — не повторяемся в чате.
  if (onboarding?.address_required_at && onboarding.chat_title === chatTitle) return;
  await deps.pool.query(
    'UPDATE house_chat_onboardings SET chat_title = $2, address_required_at = now() WHERE chat_id = $1',
    [chatId, chatTitle],
  );
  await deps.max.sendChatMessage(chatId, ADDRESS_REQUIRED_MESSAGE, { text: 'Указать адрес', payload: `setup_${chatId}` });
}

/** Бота удалили из чата: Доступ к Дому закрыт, данные Дома остаются. */
export async function removeHouseChat(deps: HouseChatDeps, chatId: number): Promise<void> {
  const existing = await readHouseChat(deps.pool, chatId);
  if (existing) await disconnectHouseChat(deps.pool, existing);
  await deps.pool.query('DELETE FROM house_chat_onboardings WHERE chat_id = $1', [chatId]);
}

/**
 * Может ли человек выбрать Адрес Дома для чата: он администратор, владелец
 * или добавил бота, а бот всё ещё администратор. Дом уже создан — вернётся он.
 */
export async function checkSetupAdmin(
  deps: HouseChatDeps,
  chatId: number,
  maxUserId: number,
): Promise<{ ok: true; houseId: string | null } | { ok: false; status: 403 | 404 | 409; error: string }> {
  const [existing, onboarding] = await Promise.all([readHouseChat(deps.pool, chatId), readOnboarding(deps.pool, chatId)]);
  if (!existing && !onboarding?.address_required_at) return { ok: false, status: 404, error: 'house_setup_not_found' };
  const member = await deps.max.member(chatId, maxUserId);
  if (!member || !isHouseAdmin(existing ?? onboarding!, member)) return { ok: false, status: 403, error: 'house_setup_forbidden' };
  if (!(await deps.max.botIsAdmin(chatId))) return { ok: false, status: 409, error: 'bot_is_not_admin' };
  return { ok: true, houseId: existing?.house_id ?? null };
}

export type SetManagementCompanyResult = 'assigned' | 'no-house' | 'forbidden' | 'not-found';

/** /set_uk @username: Администратор Дома назначает аккаунт УК из участников чата. */
export async function assignManagementCompany(
  deps: HouseChatDeps,
  command: { chatId: number; actorUserId: number; targetUsername: string },
): Promise<SetManagementCompanyResult> {
  const chat = await readHouseChat(deps.pool, command.chatId);
  if (!chat || chat.disconnected_at) return 'no-house';
  const actor = await deps.max.member(command.chatId, command.actorUserId);
  if (!actor || !isHouseAdmin(chat, actor)) return 'forbidden';
  const members = await deps.max.members(command.chatId);
  const target = members.find((member) => !member.isBot && member.username?.toLocaleLowerCase('ru-RU') === command.targetUsername);
  if (!target) return 'not-found';

  await deps.pool.query(
    'UPDATE house_chats SET management_company_max_user_id = $2, management_company_username = $3 WHERE chat_id = $1',
    [command.chatId, target.userId, command.targetUsername],
  );
  // Роли вошедших людей меняем сразу, остальные пересчитаются при входе.
  await deps.pool.query(
    `UPDATE memberships membership SET role = CASE WHEN resident.max_user_id = $2 THEN 'management-company' ELSE 'resident' END
       FROM residents resident
      WHERE membership.resident_id = resident.id AND membership.house_id = $1 AND membership.ended_at IS NULL
        AND membership.role <> 'admin'
        AND (resident.max_user_id = $2 OR membership.role = 'management-company')`,
    [chat.house_id, String(target.userId)],
  );
  return 'assigned';
}

export { MaxApiError };
