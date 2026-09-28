import { createHmac } from 'node:crypto';

export const MIN_POLL_NULLIFIER_SECRET_BYTES = 32;

export function isValidPollNullifierSecret(secret: string | undefined): secret is string {
  return typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= MIN_POLL_NULLIFIER_SECRET_BYTES;
}

export function createPollVoterNullifier(secret: string, pollId: string, membershipId: string): Buffer {
  if (!isValidPollNullifierSecret(secret)) {
    throw new Error(`POLL_VOTER_NULLIFIER_SECRET must contain at least ${MIN_POLL_NULLIFIER_SECRET_BYTES} bytes`);
  }
  if (!pollId || !membershipId) throw new Error('Poll and membership identifiers are required');
  return createHmac('sha256', secret).update(`${pollId}${membershipId}`, 'utf8').digest();
}
