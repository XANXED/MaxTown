import type { MaxPhoneContact } from '@maxtown/shared';

export type MaxContactErrorReason = 'unsupported' | 'refused' | 'failed' | 'malformed';

export class MaxContactRequestError extends Error {
  readonly reason: MaxContactErrorReason;

  constructor(reason: MaxContactErrorReason) {
    super(reason);
    this.reason = reason;
  }
}

type ContactBridge = Pick<MaxWebApp, 'requestContact'> | undefined;

function errorReason(value: unknown): MaxContactErrorReason {
  if (typeof value !== 'object' || value === null || !('error' in value)) return 'failed';
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return 'failed';
  return error.code.includes('user_refused_provide_phone_number') ? 'refused' : 'failed';
}

/** Открывает нативное окно MAX. Сервер затем отдельно проверяет подпись номера. */
export async function requestMaxPhoneContact(bridge?: ContactBridge): Promise<MaxPhoneContact> {
  const resolvedBridge = bridge ?? (typeof window === 'undefined' ? undefined : window.WebApp);
  if (!resolvedBridge?.requestContact) throw new MaxContactRequestError('unsupported');

  let result: Awaited<ReturnType<NonNullable<MaxWebApp['requestContact']>>>;
  try {
    result = await resolvedBridge.requestContact();
  } catch (error) {
    throw new MaxContactRequestError(errorReason(error));
  }

  if ('error' in result) {
    throw new MaxContactRequestError(errorReason(result));
  }
  if (
    typeof result.phone !== 'string'
    || typeof result.authDate !== 'string'
    || typeof result.hash !== 'string'
    || !result.phone
    || !result.authDate
    || !/^[a-f\d]{64}$/i.test(result.hash)
  ) {
    throw new MaxContactRequestError('malformed');
  }
  return result;
}
