import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { CommunityMessage, CommunityPoll, CommunityPollResults } from '@maxtown/shared';
import { findHouseAccess } from '../auth/house-access.ts';
import { createPollVoterNullifier } from '../auth/poll-nullifier.ts';
import { requireAuthentication } from '../auth/sessions.ts';

type HouseParams = { houseId: string };
type PollParams = { houseId: string; pollId: string };
type VoteParams = { houseId: string; pollId: string };
type MessageBody = { body: string };
type PollBody = { question: string; options: Array<{ label: string }>; closesAt?: string };
type VoteBody = { optionId: string };

type MessageRow = { id: string; author_name: string; role: CommunityMessage['authorRole']; body: string; created_at: Date };
type PollRow = {
  id: string; question: string; created_at: Date; closes_at: Date | null;
  option_id: string; option_label: string; votes: string;
};

function makeCursor(row: MessageRow): string {
  return Buffer.from(`${row.created_at.toISOString()}|${row.id}`).toString('base64url');
}

function readCursor(value: string): { createdAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf('|');
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (separator <= 0 || !Number.isFinite(Date.parse(createdAt)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { createdAt, id };
  } catch { return null; }
}

async function transaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function readPolls(pool: Pool, houseId: string, membershipId: string, nullifierSecret: string): Promise<CommunityPoll[]> {
  const result = await pool.query<PollRow>(
    `WITH ballot_counts AS (
       SELECT poll_id, option_id, count(*)::bigint AS votes
         FROM poll_ballots GROUP BY poll_id, option_id
     )
     SELECT p.id, p.question, p.created_at, p.closes_at,
            o.id AS option_id, o.label AS option_label,
            (coalesce(b.votes, 0) + coalesce(legacy.votes, 0))::text AS votes
       FROM polls p
       JOIN poll_options o ON o.poll_id = p.id
       LEFT JOIN ballot_counts b ON b.poll_id = p.id AND b.option_id = o.id
       LEFT JOIN poll_legacy_totals legacy ON legacy.poll_id = p.id AND legacy.option_id = o.id
      WHERE p.house_id = $1
      ORDER BY p.created_at DESC, p.id DESC, o.position ASC`,
    [houseId],
  );
  const polls = new Map<string, CommunityPoll>();
  for (const row of result.rows) {
    let poll = polls.get(row.id);
    if (!poll) {
      poll = {
        id: row.id, question: row.question, createdAt: row.created_at.toISOString(),
        closesAt: row.closes_at?.toISOString() ?? null, options: [], myVoteOptionId: null,
      };
      polls.set(row.id, poll);
    }
    poll.options.push({ id: row.option_id, label: row.option_label, votes: Number(row.votes) });
  }
  const mineRecords = JSON.stringify([...polls.values()].map((poll) => ({
    poll_id: poll.id,
    voter_nullifier: createPollVoterNullifier(nullifierSecret, poll.id, membershipId).toString('hex'),
  })));
  if (polls.size) {
    const mine = await pool.query<{ poll_id: string; option_id: string }>(
      `SELECT ballot.poll_id, ballot.option_id
         FROM poll_ballots ballot
         JOIN jsonb_to_recordset($1::jsonb) AS current_vote(poll_id uuid, voter_nullifier text)
           ON ballot.poll_id = current_vote.poll_id
          AND ballot.voter_nullifier = decode(current_vote.voter_nullifier, 'hex')`,
      [mineRecords],
    );
    for (const row of mine.rows) {
      const poll = polls.get(row.poll_id);
      if (poll) poll.myVoteOptionId = row.option_id;
    }
  }
  return [...polls.values()];
}

export function registerCommunityRoutes(app: FastifyInstance, pool: Pool, nullifierSecret: string): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Params: HouseParams; Querystring: { before?: string; limit?: number } }>(
    '/api/houses/:houseId/community/messages',
    {
      preHandler: authenticated,
      schema: {
        params: { type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } } },
        querystring: { type: 'object', additionalProperties: false, properties: { before: { type: 'string', minLength: 1, maxLength: 128 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      },
    },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      const limit = request.query.limit ?? 30;
      const cursor = request.query.before ? readCursor(request.query.before) : null;
      if (request.query.before && !cursor) return reply.code(400).send({ error: 'invalid_cursor' });
      const rows = await pool.query<MessageRow>(
        `SELECT m.id, r.display_name AS author_name, author.role AS role, m.body, m.created_at
           FROM community_messages m
           JOIN memberships author ON author.id = m.author_membership_id
           JOIN residents r ON r.id = author.resident_id
          WHERE m.house_id = $1 AND ($2::timestamptz IS NULL OR (m.created_at, m.id) < ($2, $3::uuid))
          ORDER BY m.created_at DESC, m.id DESC LIMIT $4`,
        [request.params.houseId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
      );
      const hasMore = rows.rows.length > limit;
      const page = rows.rows.slice(0, limit);
      return {
        messages: page.map((row) => ({ id: row.id, authorName: row.author_name, authorRole: row.role, body: row.body, createdAt: row.created_at.toISOString() })),
        nextCursor: hasMore && page.length ? makeCursor(page.at(-1)!) : null,
      };
    },
  );

  app.post<{ Params: HouseParams; Body: MessageBody }>(
    '/api/houses/:houseId/community/messages',
    {
      preHandler: authenticated,
      schema: {
        params: { type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', minLength: 1, maxLength: 4000 } } },
      },
    },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      const body = request.body.body.trim();
      if (!body) return reply.code(400).send({ error: 'message_required' });
      const result = await pool.query<MessageRow>(
        `INSERT INTO community_messages (house_id, author_membership_id, body)
         VALUES ($1, $2, $3) RETURNING id, body, created_at`,
        [request.params.houseId, access.id, body],
      );
      return reply.code(201).send({ message: { id: result.rows[0]!.id, authorName: request.authSession!.resident.displayName, authorRole: access.role, body: result.rows[0]!.body, createdAt: result.rows[0]!.created_at.toISOString() } });
    },
  );

  app.get<{ Params: HouseParams }>(
    '/api/houses/:houseId/polls',
    { preHandler: authenticated, schema: { params: { type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } } } } },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      return { polls: await readPolls(pool, request.params.houseId, access.id, nullifierSecret) };
    },
  );

  app.post<{ Params: HouseParams; Body: PollBody }>(
    '/api/houses/:houseId/polls',
    {
      preHandler: authenticated,
      schema: {
        params: { type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['question', 'options'], additionalProperties: false,
          properties: { question: { type: 'string', minLength: 1, maxLength: 500 }, options: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', required: ['label'], additionalProperties: false, properties: { label: { type: 'string', minLength: 1, maxLength: 200 } } } }, closesAt: { type: 'string', format: 'date-time' } } },
      },
    },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      const question = request.body.question.trim();
      const labels = request.body.options.map(({ label }) => label.trim());
      if (question.length < 3) return reply.code(400).send({ error: 'invalid_poll_question' });
      if (labels.some((label) => !label)) return reply.code(400).send({ error: 'invalid_poll_option' });
      if (new Set(labels.map((label) => label.toLocaleLowerCase('ru-RU'))).size !== labels.length) return reply.code(400).send({ error: 'duplicate_poll_option' });
      if (request.body.closesAt && Date.parse(request.body.closesAt) <= Date.now()) return reply.code(400).send({ error: 'poll_close_must_be_future' });
      const poll = await transaction(pool, async (client) => {
        const created = await client.query<{ id: string; created_at: Date; closes_at: Date | null }>(
          'INSERT INTO polls (house_id, author_membership_id, question, closes_at) VALUES ($1, $2, $3, $4) RETURNING id, created_at, closes_at',
          [request.params.houseId, access.id, question, request.body.closesAt ?? null],
        );
        const row = created.rows[0]!;
        const options = [];
        for (const [index, option] of request.body.options.entries()) {
          const inserted = await client.query<{ id: string; label: string }>(
            'INSERT INTO poll_options (poll_id, label, position) VALUES ($1, $2, $3) RETURNING id, label',
            [row.id, labels[index], index + 1],
          );
          options.push({ id: inserted.rows[0]!.id, label: inserted.rows[0]!.label, votes: 0 });
        }
        return { id: row.id, question, createdAt: row.created_at.toISOString(), closesAt: row.closes_at?.toISOString() ?? null, options, myVoteOptionId: null } satisfies CommunityPoll;
      });
      return reply.code(201).send({ poll });
    },
  );

  app.post<{ Params: VoteParams; Body: VoteBody }>(
    '/api/houses/:houseId/polls/:pollId/votes',
    {
      preHandler: authenticated,
      schema: {
        params: { type: 'object', required: ['houseId', 'pollId'], properties: { houseId: { type: 'string', format: 'uuid' }, pollId: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['optionId'], additionalProperties: false, properties: { optionId: { type: 'string', format: 'uuid' } } },
      },
    },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      const result = await transaction(pool, async (client) => {
        const poll = await client.query<{ closes_at: Date | null }>('SELECT closes_at FROM polls WHERE id = $1 AND house_id = $2 FOR UPDATE', [request.params.pollId, request.params.houseId]);
        const row = poll.rows[0];
        if (!row) return { status: 404 as const };
        if (row.closes_at && row.closes_at <= new Date()) return { status: 409 as const, error: 'poll_closed' };
        const option = await client.query('SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2', [request.body.optionId, request.params.pollId]);
        if (!option.rowCount) return { status: 400 as const, error: 'invalid_poll_option' };
        const vote = await client.query(
          `INSERT INTO poll_ballots (poll_id, option_id, voter_nullifier)
           VALUES ($1, $2, $3) ON CONFLICT (poll_id, voter_nullifier) DO NOTHING RETURNING poll_id`,
          [request.params.pollId, request.body.optionId, createPollVoterNullifier(nullifierSecret, request.params.pollId, access.id)],
        );
        return vote.rowCount ? { status: 201 as const } : { status: 409 as const, error: 'vote_already_cast' };
      });
      if (result.status !== 201) return reply.code(result.status).send({ error: result.status === 404 ? 'poll_not_found' : result.error });
      return reply.code(201).send({ status: 'recorded' });
    },
  );

  app.get<{ Params: PollParams }>(
    '/api/houses/:houseId/polls/:pollId/results',
    { preHandler: authenticated, schema: { params: { type: 'object', required: ['houseId', 'pollId'], properties: { houseId: { type: 'string', format: 'uuid' }, pollId: { type: 'string', format: 'uuid' } } } } },
    async (request, reply): Promise<CommunityPollResults | { error: string }> => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      const polls = await readPolls(pool, request.params.houseId, access.id, nullifierSecret);
      const poll = polls.find(({ id }) => id === request.params.pollId);
      if (!poll) return reply.code(404).send({ error: 'poll_not_found' });
      return { pollId: poll.id, question: poll.question, totalVotes: poll.options.reduce((sum, option) => sum + option.votes, 0), options: poll.options, myVoteOptionId: poll.myVoteOptionId };
    },
  );
}
