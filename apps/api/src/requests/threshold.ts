import type { PoolClient } from 'pg';
import { notifyResidents, processorIds } from '../notifications/in-app.ts';

// Порог (docs/adr/0012): три разных Жильца за 2 часа сообщили об одной
// Системе — открытой Заявкой или «У меня тоже» на ней. Тогда Авария
// открывается сама, а эти Заявки привязываются к ней и закроются вместе с ней.

export const THRESHOLD_RESIDENTS = 3;
export const THRESHOLD_WINDOW_HOURS = 2;

const WINDOW = `interval '${THRESHOLD_WINDOW_HOURS} hours'`;

/** Открытые Заявки о Системе без Аварии: поданные или отмеченные «У меня тоже» за окно Порога. */
const RECENT_OPEN_REQUESTS = `
  r.house_id = $1 AND r.category = $2 AND r.status IN ('new', 'in-progress') AND r.accident_id IS NULL
  AND (r.created_at > now() - ${WINDOW}
       OR EXISTS (SELECT 1 FROM request_supporters s WHERE s.request_id = r.id AND s.created_at > now() - ${WINDOW}))`;

export function residentsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'Жилец';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'Жильца';
  return 'Жильцов';
}

/** Сколько разных Жильцов сообщили о Системе за окно Порога. */
export async function countReporters(client: PoolClient, houseId: string, system: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(DISTINCT resident_id)::int AS count FROM (
       SELECT r.author_resident_id AS resident_id FROM requests r
        WHERE r.house_id = $1 AND r.category = $2 AND r.status IN ('new', 'in-progress') AND r.accident_id IS NULL
          AND r.created_at > now() - ${WINDOW}
       UNION ALL
       SELECT s.resident_id FROM request_supporters s JOIN requests r ON r.id = s.request_id
        WHERE r.house_id = $1 AND r.category = $2 AND r.status IN ('new', 'in-progress') AND r.accident_id IS NULL
          AND s.created_at > now() - ${WINDOW}
     ) reporters`,
    [houseId, system],
  );
  return result.rows[0]?.count ?? 0;
}

type LinkedRequest = { id: string; number: number; author_resident_id: string };

/**
 * Привязать к Аварии свежие открытые Заявки о её Системе и уведомить их
 * авторов и отметивших «У меня тоже».
 */
export async function linkRecentRequests(
  client: PoolClient,
  houseId: string,
  system: string,
  accidentId: string,
  actorResidentId: string | null,
): Promise<number> {
  const linked = await client.query<LinkedRequest>(
    `UPDATE requests r SET accident_id = $3, updated_at = now()
      WHERE ${RECENT_OPEN_REQUESTS}
      RETURNING r.id, r.number, r.author_resident_id`,
    [houseId, system, accidentId],
  );
  for (const request of linked.rows) {
    const supporters = await client.query<{ resident_id: string }>(
      'SELECT resident_id FROM request_supporters WHERE request_id = $1',
      [request.id],
    );
    await notifyResidents(client, [request.author_resident_id, ...supporters.rows.map((row) => row.resident_id)], {
      kind: 'request-status',
      houseId,
      requestId: request.id,
      title: `Заявка № ${request.number} привязана к Аварии`,
      body: 'Она закроется вместе с Аварией. Отдельно подавать ничего не нужно',
    }, actorResidentId);
  }
  return linked.rowCount ?? 0;
}

/** Открытая Авария Системы в Доме, если она есть. */
export async function openAccidentId(client: PoolClient, houseId: string, system: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    'SELECT id FROM accidents WHERE house_id = $1 AND system = $2 AND resolved_at IS NULL',
    [houseId, system],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Проверить Порог после новой Заявки или «У меня тоже». Вызывается внутри
 * транзакции, которая заблокировала строку Дома. Возвращает id открытой Аварии.
 */
export async function checkThreshold(client: PoolClient, houseId: string, system: string): Promise<string | null> {
  if (await openAccidentId(client, houseId, system)) return null;
  const reporters = await countReporters(client, houseId, system);
  if (reporters < THRESHOLD_RESIDENTS) return null;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO accidents (house_id, system, title, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (house_id, system) WHERE resolved_at IS NULL DO NOTHING
     RETURNING id`,
    [
      houseId,
      system,
      `Неполадка: ${system}`,
      `О неполадке сообщили ${reporters} ${residentsWord(reporters)} за ${THRESHOLD_WINDOW_HOURS} часа. `
        + 'Авария открыта автоматически, УК и Администратор Дома видят Заявки.',
    ],
  );
  const accidentId = inserted.rows[0]?.id;
  if (!accidentId) return null;

  await linkRecentRequests(client, houseId, system, accidentId, null);
  await notifyResidents(client, await processorIds(client, houseId), {
    kind: 'accident',
    houseId,
    accidentId,
    title: `Открыта Авария: ${system}`,
    body: `О неполадке сообщили ${reporters} ${residentsWord(reporters)}. Её открыл Порог`,
  });
  return accidentId;
}
