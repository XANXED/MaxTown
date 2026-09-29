import { describe, expect, it } from 'vitest';
import { inviteFromStartParam, parseInviteCode } from './join.ts';

describe('parseInviteCode', () => {
  it('reads the code from MAX mini app links', () => {
    expect(parseInviteCode('https://max.ru/maxtown_bot?startapp=inv_K7f2-x9')).toBe('K7f2-x9');
    expect(parseInviteCode('  max.ru/maxtown_bot?startapp=inv_abc123  ')).toBe('abc123');
  });

  it('accepts the bare payload or code', () => {
    expect(parseInviteCode('inv_abc123')).toBe('abc123');
    expect(parseInviteCode('abc123')).toBe('abc123');
  });

  it('rejects text that is not an Invitation', () => {
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('https://example.com/?ref=inv_abc123')).toBeNull();
    expect(parseInviteCode('https://max.ru/maxtown_bot?startapp=promo_abc')).toBeNull();
    expect(parseInviteCode('https://vk.com/app123?ref=inv_abc123')).toBeNull();
    expect(parseInviteCode('привет')).toBeNull();
    expect(parseInviteCode('ab')).toBeNull();
  });
});

describe('inviteFromStartParam', () => {
  it('finds an Invitation in the launch parameter', () => {
    expect(inviteFromStartParam('inv_abc123')).toBe('abc123');
    expect(inviteFromStartParam('promo_summer')).toBeNull();
    expect(inviteFromStartParam(undefined)).toBeNull();
  });
});
