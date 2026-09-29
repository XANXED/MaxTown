import type { InviteCheck } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { launchStartParam } from '../maxLaunch.ts';
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

/** Приглашение из параметра запуска MAX (`start_param`). */
export function inviteFromStartParam(startParam: string | undefined): string | null {
  if (!startParam?.startsWith(INVITE_PREFIX)) return null;
  const code = startParam.slice(INVITE_PREFIX.length);
  return codePattern.test(code) ? code : null;
}

/** Приглашение, с которым открыли мини-апп, если оно было в ссылке. */
export function launchInviteCode(): string | null {
  return inviteFromStartParam(launchStartParam());
}

/** Результат проверки на экране: к ответам сервера добавляется ошибка доступности API. */
export type InviteResult = InviteCheck | { status: 'unavailable' };

/** Проверить Приглашение; в dev-демо ответ даёт fixtures.ts. */
export async function checkInvite(code: string): Promise<InviteResult> {
  const fixtures = demoMode() ? loadFixtures() : null;
  if (fixtures) return (await fixtures).sampleInviteCheck(code);
  try {
    const response = await apiFetch(`/api/invitations/${encodeURIComponent(code)}`);
    if (!response.ok) return { status: 'unavailable' };
    return (await response.json() as { invitation: InviteResult }).invitation;
  } catch {
    return { status: 'unavailable' };
  }
}

export async function redeemInvite(code: string): Promise<void> {
  if (demoMode()) return;
  const response = await apiFetch(`/api/invitations/${encodeURIComponent(code)}/redeem`, { method: 'POST' });
  if (!response.ok) throw new Error('Не удалось вступить по Приглашению');
}
