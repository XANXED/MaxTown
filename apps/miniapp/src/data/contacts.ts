import { useCallback, useEffect, useState } from 'react';
import type { HouseContact, HouseContactInput, HouseContactsResponse } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { demoMode, initialStatus, loadFixtures, type Loadable } from './loadable.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error('contacts_request_failed');
  return response.json() as Promise<T>;
}

function jsonRequest(method: 'POST' | 'PUT', body?: HouseContactInput): RequestInit {
  return {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
}

export function createContactsClient(fetcher: Fetcher = apiFetch) {
  const base = (houseId: string) => `/api/houses/${encodeURIComponent(houseId)}/contacts`;
  return {
    load: (houseId: string) => fetcher(base(houseId)).then((response) => readJson<HouseContactsResponse>(response)),
    save: (houseId: string, input: HouseContactInput, contactId?: string) => {
      const url = contactId ? `${base(houseId)}/${encodeURIComponent(contactId)}` : base(houseId);
      return fetcher(url, jsonRequest(contactId ? 'PUT' : 'POST', input))
        .then((response) => readJson<{ contact: HouseContact }>(response))
        .then(({ contact }) => contact);
    },
    remove: async (houseId: string, contactId: string) => {
      const response = await fetcher(`${base(houseId)}/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('contacts_request_failed');
    },
    refresh: (houseId: string) => fetcher(`${base(houseId)}/import`, jsonRequest('POST'))
      .then((response) => readJson<HouseContactsResponse>(response)),
  };
}

export const contactsClient = createContactsClient();

/** Ссылка для звонка: из номера остаются плюс и цифры. */
export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export const houseContactKindLabels: Record<HouseContact['kind'], string> = {
  management: 'Управляющая организация',
  dispatch: 'Диспетчерская',
  'house-emergency': 'Аварийная служба Дома',
  plumber: 'Сантехник',
  electrician: 'Электрик',
  elevator: 'Лифтовая служба',
  intercom: 'Домофон',
  security: 'Консьерж или охрана',
  'district-police': 'Участковый',
  other: 'Другое',
};

export type HouseContactGroup = {
  kind: HouseContact['kind'];
  label: string;
  contacts: HouseContact[];
};

/** Группы сохраняют порядок, полученный от API, чтобы важные категории оставались первыми. */
export function groupHouseContacts(contacts: HouseContact[]): HouseContactGroup[] {
  const groups = new Map<HouseContact['kind'], HouseContactGroup>();
  for (const contact of contacts) {
    const group = groups.get(contact.kind);
    if (group) group.contacts.push(contact);
    else groups.set(contact.kind, { kind: contact.kind, label: houseContactKindLabels[contact.kind], contacts: [contact] });
  }
  return [...groups.values()];
}

export function useHouseContacts(houseId: string | null): Loadable<HouseContactsResponse | null> {
  const [mode] = useState(demoMode);
  const [status, setStatus] = useState(() => initialStatus(mode));
  const [data, setData] = useState<HouseContactsResponse | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (mode === 'loading' || (mode === 'error' && attempt === 0)) return () => { cancelled = true; };
    if (mode === 'filled') {
      const fixtures = loadFixtures();
      void fixtures?.then(({ sampleContacts }) => {
        if (cancelled) return;
        setData({ contacts: sampleContacts, importState: { status: 'ready', checkedAt: '2026-09-28T09:00:00.000Z' } });
        setStatus('ready');
      });
      return () => { cancelled = true; };
    }
    if (!houseId) {
      setData(null);
      setStatus('ready');
      return () => { cancelled = true; };
    }
    setStatus('loading');
    void contactsClient.load(houseId)
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [attempt, houseId, mode]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return { status, data, retry };
}
