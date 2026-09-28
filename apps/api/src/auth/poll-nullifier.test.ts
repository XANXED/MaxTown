import { describe, expect, it } from 'vitest';
import { createPollVoterNullifier } from './poll-nullifier.ts';

const secret = 'a sufficiently long dedicated secret for anonymous voting';

describe('poll voter nullifier', () => {
  it('is deterministic for the same secret, poll, and stable membership', () => {
    expect(createPollVoterNullifier(secret, 'poll-a', 'membership-a'))
      .toEqual(createPollVoterNullifier(secret, 'poll-a', 'membership-a'));
  });

  it('separates voters, polls, and secrets', () => {
    const first = createPollVoterNullifier(secret, 'poll-a', 'membership-a');
    expect(createPollVoterNullifier(secret, 'poll-a', 'membership-b')).not.toBe(first);
    expect(createPollVoterNullifier(secret, 'poll-b', 'membership-a')).not.toBe(first);
    expect(createPollVoterNullifier(`${secret}!`, 'poll-a', 'membership-a')).not.toBe(first);
  });

  it('rejects secrets shorter than 32 bytes', () => {
    expect(() => createPollVoterNullifier('too short', 'poll-a', 'membership-a')).toThrow(/32 bytes/);
  });
});
