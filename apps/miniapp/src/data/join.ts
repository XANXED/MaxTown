import type { InviteCheck } from '@maxtown/shared';
import { demoMode, loadFixtures } from './loadable.ts';

// Стать Жильцом можно только по Приглашению — QR-коду или ссылке на
// конкретную Квартиру.
//
// Приглашение — ссылка MAX на мини-апп: https://max.ru/<бот>?startapp=inv_<код>,
// код — 22 символа base64url (docs/research/2026-09-house-data-and-max-platform.md, 2.5).
// В payload MAX пропускает только латиницу, цифры, «_» и «-», до 512 символов.

const INVITE_PREFIX = 'inv_';
const codePattern = /^[A-Za-z0-9_-]{4,64}$/;

/** Код Приглашения из ссылки, из payload `inv_…` или сам код. Иначе null. */
export function parseInviteCode(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/[/?]/.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      return null;
    }
    if (url.hostname !== 'max.ru') return null;
    return inviteFromStartParam(url.searchParams.get('startapp') ?? undefined);
  }

  const code = trimmed.startsWith(INVITE_PREFIX) ? trimmed.slice(INVITE_PREFIX.length) : trimmed;
  return codePattern.test(code) ? code : null;
}

/** Приглашение из параметра запуска MAX (`initDataUnsafe.start_param`). */
export function inviteFromStartParam(startParam: string | undefined): string | null {
  if (!startParam?.startsWith(INVITE_PREFIX)) return null;
  const code = startParam.slice(INVITE_PREFIX.length);
  return codePattern.test(code) ? code : null;
}

/** Приглашение, с которым открыли мини-апп, если оно было в ссылке. */
export function launchInviteCode(): string | null {
  const startParam = window.WebApp?.initDataUnsafe?.start_param;
  return inviteFromStartParam(typeof startParam === 'string' ? startParam : undefined);
}

/** Результат проверки на экране: к ответам сервера добавляется «вступить пока нельзя». */
export type InviteResult = InviteCheck | { status: 'unavailable' };

/**
 * Проверить Приглашение. API ещё нет: в сборке честно отвечаем, что вступить
 * пока нельзя. В dev-демо ответ даёт fixtures.ts.
 */
export async function checkInvite(code: string): Promise<InviteResult> {
  const fixtures = demoMode() ? loadFixtures() : null;
  if (!fixtures) return { status: 'unavailable' };
  return (await fixtures).sampleInviteCheck(code);
}
