import { useEffect, useState } from 'react';
import type {
  UtilityPaymentPeriod,
  UtilityPaymentPeriodInput,
  UtilityPaymentPeriodsPage,
  UtilityPaymentsOverview,
  UtilityPaymentTemplate,
  UtilityPaymentTemplateInput,
} from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { jsonRequest, readApiJson } from './api.ts';
import type { Loadable } from './loadable.ts';

const messages = {
  utility_payments_private: 'Платежи доступны только участникам Квартиры',
  utility_payments_apartment_required: 'Сначала привяжитесь к Квартире',
  utility_payment_version_conflict: 'Данные уже изменил другой участник Квартиры. Обновите экран',
  utility_payment_period_locked: 'Выполненный или пропущенный период сначала нужно вернуть в работу',
  utility_payment_transition_invalid: 'Это действие больше недоступно. Обновите экран',
  utility_payment_receipt_requires_paid: 'Сначала отметьте платёж выполненным',
  utility_payment_receipt_too_large: 'Файл должен быть не больше 5 МБ',
  utility_payment_receipt_unsupported: 'Поддерживаются JPEG, PNG, WebP и PDF',
};

function base(houseId: string): string {
  return `/api/houses/${encodeURIComponent(houseId)}/utility-payments`;
}

export function useUtilityPayments(houseId: string | null): Loadable<UtilityPaymentsOverview | null> {
  const [state, setState] = useState<Loadable<UtilityPaymentsOverview | null>>({ status: 'loading', data: null, retry: () => {} });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!houseId) {
      setState({ status: 'ready', data: null, retry: () => setAttempt((value) => value + 1) });
      return;
    }
    let active = true;
    setState({ status: 'loading', data: null, retry: () => setAttempt((value) => value + 1) });
    void apiFetch(base(houseId))
      .then((response) => readApiJson<UtilityPaymentsOverview>(response, 'Не удалось загрузить платежи', messages))
      .then((data) => { if (active) setState({ status: 'ready', data, retry: () => setAttempt((value) => value + 1) }); })
      .catch(() => { if (active) setState({ status: 'error', data: null, retry: () => setAttempt((value) => value + 1) }); });
    return () => { active = false; };
  }, [houseId, attempt]);
  return state;
}

export async function saveUtilityPaymentTemplate(
  houseId: string,
  input: UtilityPaymentTemplateInput,
  templateId?: string,
): Promise<UtilityPaymentTemplate> {
  const response = await apiFetch(
    templateId ? `${base(houseId)}/templates/${encodeURIComponent(templateId)}` : `${base(houseId)}/templates`,
    jsonRequest(templateId ? 'PUT' : 'POST', input),
  );
  return (await readApiJson<{ template: UtilityPaymentTemplate }>(response, 'Не удалось сохранить платёж', messages)).template;
}

export async function archiveUtilityPaymentTemplate(houseId: string, template: UtilityPaymentTemplate): Promise<void> {
  const response = await apiFetch(
    `${base(houseId)}/templates/${encodeURIComponent(template.id)}/archive`,
    jsonRequest('POST', { version: template.version }),
  );
  await readApiJson(response, 'Не удалось архивировать шаблон', messages);
}

export async function loadUtilityPaymentPeriods(houseId: string, year: number, cursor?: string): Promise<UtilityPaymentPeriodsPage> {
  const query = new URLSearchParams({ year: String(year) });
  if (cursor) query.set('cursor', cursor);
  const response = await apiFetch(`${base(houseId)}/periods?${query}`);
  return readApiJson<UtilityPaymentPeriodsPage>(response, 'Не удалось загрузить историю', messages);
}

export function useUtilityPaymentPeriod(houseId: string | null, periodId: string): Loadable<UtilityPaymentPeriod | null> {
  const [state, setState] = useState<Loadable<UtilityPaymentPeriod | null>>({ status: 'loading', data: null, retry: () => {} });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!houseId) return;
    let active = true;
    setState({ status: 'loading', data: null, retry: () => setAttempt((value) => value + 1) });
    void apiFetch(`${base(houseId)}/periods/${encodeURIComponent(periodId)}`)
      .then((response) => readApiJson<{ period: UtilityPaymentPeriod }>(response, 'Не удалось открыть платёж', messages))
      .then(({ period }) => { if (active) setState({ status: 'ready', data: period, retry: () => setAttempt((value) => value + 1) }); })
      .catch(() => { if (active) setState({ status: 'error', data: null, retry: () => setAttempt((value) => value + 1) }); });
    return () => { active = false; };
  }, [houseId, periodId, attempt]);
  return state;
}

export async function updateUtilityPaymentPeriod(
  houseId: string,
  periodId: string,
  input: UtilityPaymentPeriodInput,
): Promise<UtilityPaymentPeriod> {
  const response = await apiFetch(`${base(houseId)}/periods/${encodeURIComponent(periodId)}`, jsonRequest('PUT', input));
  return (await readApiJson<{ period: UtilityPaymentPeriod }>(response, 'Не удалось изменить платёж', messages)).period;
}

export async function applyUtilityPaymentAction(
  houseId: string,
  period: UtilityPaymentPeriod,
  action: 'pay' | 'unpay' | 'skip' | 'unskip',
): Promise<UtilityPaymentPeriod> {
  const response = await apiFetch(
    `${base(houseId)}/periods/${encodeURIComponent(period.id)}/${action}`,
    jsonRequest('POST', { version: period.version }),
  );
  return (await readApiJson<{ period: UtilityPaymentPeriod }>(response, 'Не удалось изменить отметку', messages)).period;
}

export async function uploadUtilityPaymentReceipt(houseId: string, periodId: string, file: File): Promise<UtilityPaymentPeriod> {
  const response = await apiFetch(`${base(houseId)}/periods/${encodeURIComponent(periodId)}/receipt`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  return (await readApiJson<{ period: UtilityPaymentPeriod }>(response, 'Не удалось загрузить чек', messages)).period;
}

export async function deleteUtilityPaymentReceipt(houseId: string, periodId: string): Promise<UtilityPaymentPeriod> {
  const response = await apiFetch(`${base(houseId)}/periods/${encodeURIComponent(periodId)}/receipt`, { method: 'DELETE' });
  return (await readApiJson<{ period: UtilityPaymentPeriod }>(response, 'Не удалось удалить чек', messages)).period;
}

export async function downloadUtilityPaymentReceipt(houseId: string, periodId: string, fileName: string): Promise<void> {
  const response = await apiFetch(`${base(houseId)}/periods/${encodeURIComponent(periodId)}/receipt`);
  if (!response.ok) throw new Error('Не удалось открыть чек');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noreferrer';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
