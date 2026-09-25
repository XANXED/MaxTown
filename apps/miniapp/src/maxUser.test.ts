import { describe, expect, it } from 'vitest';
import { toProfileUser } from './maxUser.ts';

describe('toProfileUser', () => {
  it('has no user outside MAX', () => {
    expect(toProfileUser(undefined)).toBeNull();
  });

  it('builds the name and initials from first and last name', () => {
    expect(toProfileUser({ id: 1, first_name: 'Анна', last_name: 'Соколова', photo_url: 'https://x/a.jpg' })).toEqual({
      name: 'Анна Соколова',
      initials: 'АС',
      username: undefined,
      photoUrl: 'https://x/a.jpg',
    });
  });

  it('falls back to the username when the name is empty', () => {
    const user = toProfileUser({ id: 2, first_name: '  ', username: 'kirill' });
    expect(user?.name).toBe('kirill');
    expect(user?.initials).toBe('K');
  });
});
