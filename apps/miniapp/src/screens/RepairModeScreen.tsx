import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Hammer, Wrench } from '@phosphor-icons/react';
import type { HouseRepair, HouseRepairHistoryEntry, HouseRepairStatus, HouseRole } from '@maxtown/shared';
import { Button, Input, Spinner, Textarea, Typography } from '../components/platform-ui.tsx';
import { getCurrentResident } from '../auth/session.ts';
import {
  createHouseRepair,
  canManageHouseRepairs,
  fromDateTimeLocal,
  houseRepairStatusLabel,
  loadHouseRepairHistory,
  loadHouseRepairs,
  splitHouseRepairs,
  toDateTimeLocal,
  updateHouseRepair,
  type HouseRepairInput,
} from '../data/repairMode.ts';

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
type ScreenStatus = 'loading' | 'ready' | 'error';
type RepairDraft = {
  title: string;
  description: string;
  location: string;
  startsAt: string;
  expectedCompletionAt: string;
  contractorName: string;
  contractorContact: string;
  residentImpact: string;
  instructions: string;
  status: Extract<HouseRepairStatus, 'planned' | 'in_progress'>;
};

const emptyDraft = (): RepairDraft => ({
  title: '', description: '', location: '', startsAt: '', expectedCompletionAt: '',
  contractorName: '', contractorContact: '', residentImpact: '', instructions: '', status: 'planned',
});

function toDraft(repair: HouseRepair): RepairDraft {
  return {
    title: repair.title,
    description: repair.description,
    location: repair.location ?? '',
    startsAt: toDateTimeLocal(repair.startsAt),
    expectedCompletionAt: toDateTimeLocal(repair.expectedCompletionAt),
    contractorName: repair.contractorName ?? '',
    contractorContact: repair.contractorContact ?? '',
    residentImpact: repair.residentImpact ?? '',
    instructions: repair.instructions ?? '',
    status: repair.status === 'planned' ? 'planned' : 'in_progress',
  };
}

function displayDate(value: string | null): string {
  return value ? dateTimeFormat.format(new Date(value)) : 'Срок уточняется';
}

export function repairStatusActions(status: HouseRepairStatus): Array<{ status: HouseRepairStatus; label: string }> {
  switch (status) {
    case 'planned': return [{ status: 'in_progress', label: 'Начать' }, { status: 'cancelled', label: 'Отменить' }];
    case 'in_progress': return [{ status: 'paused', label: 'Приостановить' }, { status: 'completed', label: 'Завершить' }, { status: 'cancelled', label: 'Отменить' }];
    case 'paused': return [{ status: 'in_progress', label: 'Продолжить' }, { status: 'completed', label: 'Завершить' }, { status: 'cancelled', label: 'Отменить' }];
    case 'completed': return [{ status: 'in_progress', label: 'Возобновить' }];
    case 'cancelled': return [];
  }
}

export function RepairFacts({ repair }: { repair: HouseRepair }) {
  return (
    <dl className="repair-details">
      <div><dt>Статус</dt><dd>{houseRepairStatusLabel(repair.status)}</dd></div>
      {repair.location ? <div><dt>Место</dt><dd>{repair.location}</dd></div> : null}
      <div><dt>Начало</dt><dd>{repair.startsAt ? displayDate(repair.startsAt) : 'Не указано'}</dd></div>
      <div><dt>Срок</dt><dd>{displayDate(repair.expectedCompletionAt)}</dd></div>
      {repair.contractorName ? <div><dt>Подрядчик</dt><dd>{repair.contractorName}</dd></div> : null}
      {repair.contractorContact ? <div><dt>Контакт подрядчика</dt><dd>{repair.contractorContact}</dd></div> : null}
      {repair.residentImpact ? <div><dt>Влияние на жильцов</dt><dd>{repair.residentImpact}</dd></div> : null}
      {repair.instructions ? <div><dt>Инструкции</dt><dd>{repair.instructions}</dd></div> : null}
    </dl>
  );
}

export function RepairModeScreen({ houseId, role }: { houseId: string | null; role: HouseRole | null }) {
  const [resolvedHouseId, setResolvedHouseId] = useState(houseId);
  const [resolvedRole, setResolvedRole] = useState(role);
  const [repairs, setRepairs] = useState<HouseRepair[]>([]);
  const [status, setStatus] = useState<ScreenStatus>('loading');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RepairDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<Record<string, HouseRepairHistoryEntry[]>>({});
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState('');

  const refresh = useCallback(async () => {
    if (!resolvedHouseId) return;
    try { setRepairs(await loadHouseRepairs(resolvedHouseId)); setStatus('ready'); }
    catch { setStatus('error'); }
  }, [resolvedHouseId]);

  useEffect(() => {
    setResolvedHouseId(houseId);
    setResolvedRole(role);
    if (houseId && role) return;
    void getCurrentResident().then((me) => {
      const membership = me.memberships.find((item) => item.houseId === houseId) ?? me.memberships[0];
      setResolvedHouseId(houseId ?? membership?.houseId ?? null);
      setResolvedRole(membership?.role ?? null);
    }).catch(() => { if (!houseId) setResolvedHouseId(null); });
  }, [houseId, role]);

  useEffect(() => { void refresh(); }, [refresh]);

  const beginCreate = () => { setEditingId(null); setDraft(emptyDraft()); setNotice(''); };
  const beginEdit = (repair: HouseRepair) => { setEditingId(repair.id); setDraft(toDraft(repair)); setNotice(''); };
  const closeForm = () => { setDraft(null); setEditingId(null); };
  const updateDraft = <K extends keyof RepairDraft>(field: K, value: RepairDraft[K]) => setDraft((current) => current ? { ...current, [field]: value } : current);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolvedHouseId || !draft || !draft.title.trim() || !draft.description.trim()) {
      setNotice('Укажите название и описание работ.');
      return;
    }
    if (draft.expectedCompletionAt && draft.startsAt && Date.parse(draft.expectedCompletionAt) < Date.parse(draft.startsAt)) {
      setNotice('Срок окончания должен быть не раньше начала работ.');
      return;
    }
    const fields = {
      title: draft.title.trim(), description: draft.description.trim(),
      location: draft.location.trim() || null,
      startsAt: fromDateTimeLocal(draft.startsAt),
      expectedCompletionAt: fromDateTimeLocal(draft.expectedCompletionAt),
      contractorName: draft.contractorName.trim() || null,
      contractorContact: draft.contractorContact.trim() || null,
      residentImpact: draft.residentImpact.trim() || null,
      instructions: draft.instructions.trim() || null,
    };
    setSaving(true);
    setNotice('');
    const save = editingId
      ? updateHouseRepair(resolvedHouseId, editingId, fields)
      : createHouseRepair(resolvedHouseId, { ...fields, status: draft.status } satisfies HouseRepairInput);
    void save.then(async () => {
      closeForm();
      setNotice(editingId ? 'Изменения сохранены.' : 'Работа добавлена.');
      await refresh();
    }).catch(() => setNotice('Не удалось сохранить. Проверьте подключение и попробуйте ещё раз.'))
      .finally(() => setSaving(false));
  };

  const changeStatus = (repair: HouseRepair, next: HouseRepairStatus) => {
    if (!resolvedHouseId) return;
    if (repair.status === 'completed' && next === 'in_progress' && !statusNote.trim()) {
      setNotice('Укажите, почему работы возобновляются.');
      return;
    }
    setSaving(true);
    setNotice('');
    void updateHouseRepair(resolvedHouseId, repair.id, { status: next, note: statusNote.trim() || undefined })
      .then(async () => { setStatusNote(''); setNotice('Статус обновлён.'); await refresh(); })
      .catch(() => setNotice('Не удалось изменить статус. Попробуйте ещё раз.'))
      .finally(() => setSaving(false));
  };

  const toggleHistory = (repairId: string) => {
    if (openHistoryId === repairId) { setOpenHistoryId(null); return; }
    setOpenHistoryId(repairId);
    if (!resolvedHouseId || history[repairId]) return;
    setHistoryLoadingId(repairId);
    void loadHouseRepairHistory(resolvedHouseId, repairId)
      .then((entries) => setHistory((current) => ({ ...current, [repairId]: entries })))
      .catch(() => setNotice('Не удалось загрузить историю работы.'))
      .finally(() => setHistoryLoadingId(null));
  };

  if (!resolvedHouseId) {
    return <main className="screen screen--inner inner-content" id="main-content"><section className="decision-card"><Hammer className="icon" aria-hidden /><Typography.Text asChild variant="title"><h1>Сначала вступите в Дом</h1></Typography.Text><Typography.Text asChild variant="description" color="secondary"><p>Информация о работах доступна жильцам Дома.</p></Typography.Text></section></main>;
  }

  const canEdit = canManageHouseRepairs(resolvedRole);
  const groups = splitHouseRepairs(repairs);
  const renderRepair = (repair: HouseRepair, archived = false) => (
    <article className="repair-panel" key={repair.id}>
      <div className="repair-panel__heading"><Wrench className="icon" aria-hidden /><span className={`status-badge ${repair.status === 'completed' ? 'status-badge--positive' : repair.status === 'cancelled' ? 'status-badge--negative' : 'status-badge--themed'}`}>{houseRepairStatusLabel(repair.status)}</span></div>
      <Typography.Text asChild variant="title"><h2>{repair.title}</h2></Typography.Text>
      <Typography.Text asChild variant="body"><p>{repair.description}</p></Typography.Text>
      <RepairFacts repair={repair} />
      {canEdit && (!archived || repair.status === 'completed') ? <div className="repair-actions">
        <Button size="small" variant="secondary" onClick={() => beginEdit(repair)}>Изменить</Button>
        {repairStatusActions(repair.status).map((action) => <Button key={action.status} size="small" variant="secondary" disabled={saving} onClick={() => changeStatus(repair, action.status)}>{action.label}</Button>)}
      </div> : null}
      {canEdit && repair.status === 'completed' ? <label className="repair-field"><span>Причина возобновления</span><Input mode="contrast" size="large" aria-label={`Причина возобновления: ${repair.title}`} value={statusNote} onChange={(event) => setStatusNote(event.target.value)} /></label> : null}
      <button className="text-action repair-history-toggle" type="button" aria-expanded={openHistoryId === repair.id} onClick={() => toggleHistory(repair.id)}>
        {openHistoryId === repair.id ? 'Скрыть историю' : 'История изменений'}
      </button>
      {openHistoryId === repair.id ? <ol className="repair-history" aria-label={`История: ${repair.title}`}>
        {historyLoadingId === repair.id ? <li>Загружаем историю…</li> : null}
        {(history[repair.id] ?? []).map((entry) => <li key={entry.id}>
          <span>{entry.eventType === 'house_repair.created' ? 'Работа создана' : entry.eventType === 'house_repair.migrated' ? 'Перенесено из прежнего режима ремонта' : entry.eventType === 'house_repair.status_changed' ? 'Статус изменён' : 'Данные обновлены'}</span>
          {entry.actor ? <span>{entry.actor.displayName} · {entry.actor.role === 'headman' ? 'Староста' : entry.actor.role === 'responsible' ? 'Ответственный' : entry.actor.role === 'concierge' ? 'Консьерж' : 'Жилец'}</span> : null}
          <time dateTime={entry.occurredAt}>{dateTimeFormat.format(new Date(entry.occurredAt))}</time>
          {typeof entry.details.note === 'string' && entry.details.note ? <p>{entry.details.note}</p> : null}
        </li>)}
        {historyLoadingId !== repair.id && (history[repair.id]?.length ?? 0) === 0 ? <li>История пока пуста.</li> : null}
      </ol> : null}
    </article>
  );

  return (
    <main className="screen screen--inner repair-screen" id="main-content">
      <div className="inner-content stagger">
        <header className="repair-heading">
          <span><Typography.Text asChild variant="header"><h1>Ремонтные работы</h1></Typography.Text><Typography.Text asChild variant="description" color="secondary"><p>Сроки, подрядчики и влияние на жильцов</p></Typography.Text></span>
          <Button size="small" variant="secondary" onClick={() => void refresh()}>Обновить</Button>
        </header>
        {canEdit ? <Button size="medium" variant="primary" onClick={beginCreate}>Добавить работу</Button> : null}
        {status === 'loading' ? <div className="join-checking"><Spinner size={20} />Загружаем работы…</div> : null}
        {status === 'error' ? <div className="community-error" role="alert">Не удалось загрузить ремонтные работы. Проверьте подключение.</div> : null}
        {status === 'ready' ? <>
          <section className="repairs-section" aria-labelledby="repairs-current-heading">
            <Typography.Text asChild variant="subheader"><h2 id="repairs-current-heading">Текущие и запланированные</h2></Typography.Text>
            {groups.current.length ? groups.current.map((repair) => renderRepair(repair)) : <section className="decision-card repair-empty"><Hammer className="icon" aria-hidden /><Typography.Text asChild variant="title"><h3>Работ пока нет</h3></Typography.Text><Typography.Text asChild variant="description" color="secondary"><p>Здесь появятся ремонтные работы вашего Дома.</p></Typography.Text></section>}
          </section>
          {groups.archive.length ? <section className="repairs-section" aria-labelledby="repairs-archive-heading">
            <Typography.Text asChild variant="subheader"><h2 id="repairs-archive-heading">Архив</h2></Typography.Text>
            {groups.archive.map((repair) => renderRepair(repair, true))}
          </section> : null}
        </> : null}
        {draft ? <form className="repair-form" onSubmit={submit}>
          <Typography.Text asChild variant="title"><h2>{editingId ? 'Изменить работу' : 'Новая работа'}</h2></Typography.Text>
          <label className="repair-field"><span>Название</span><Input mode="contrast" size="large" aria-label="Название работы" placeholder="Например, ремонт лифта" maxLength={160} value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} /></label>
          <label className="repair-field"><span>Описание</span><Textarea aria-label="Описание работ" placeholder="Что будут делать" value={draft.description} rows={3} maxLength={2000} onChange={(event) => updateDraft('description', event.target.value)} /></label>
          <label className="repair-field"><span>Место</span><Input mode="contrast" size="large" aria-label="Место работ" placeholder="Подъезд, этаж или зона" maxLength={240} value={draft.location} onChange={(event) => updateDraft('location', event.target.value)} /></label>
          <label className="repair-field"><span>Начало</span><Input type="datetime-local" mode="contrast" size="large" aria-label="Начало работ" value={draft.startsAt} onChange={(event) => updateDraft('startsAt', event.target.value)} /></label>
          <label className="repair-field"><span>Ожидаемый срок</span><Input type="datetime-local" mode="contrast" size="large" aria-label="Ожидаемый срок окончания" value={draft.expectedCompletionAt} onChange={(event) => updateDraft('expectedCompletionAt', event.target.value)} /></label>
          <label className="repair-field"><span>Подрядчик</span><Input mode="contrast" size="large" aria-label="Подрядчик" placeholder="Организация или специалист" maxLength={200} value={draft.contractorName} onChange={(event) => updateDraft('contractorName', event.target.value)} /></label>
          <label className="repair-field"><span>Контакт подрядчика</span><Input mode="contrast" size="large" aria-label="Контакт подрядчика" placeholder="Телефон или ссылка" maxLength={300} value={draft.contractorContact} onChange={(event) => updateDraft('contractorContact', event.target.value)} /></label>
          <label className="repair-field"><span>Влияние на жильцов</span><Textarea aria-label="Влияние на жильцов" placeholder="Шум, доступ, отключения" value={draft.residentImpact} rows={3} maxLength={2000} onChange={(event) => updateDraft('residentImpact', event.target.value)} /></label>
          <label className="repair-field"><span>Инструкции</span><Textarea aria-label="Инструкции жильцам" placeholder="Что нужно учесть жильцам" value={draft.instructions} rows={3} maxLength={2000} onChange={(event) => updateDraft('instructions', event.target.value)} /></label>
          {!editingId ? <fieldset className="repair-status-choice"><legend>Начальный статус</legend><label><input type="radio" name="repair-status" value="planned" checked={draft.status === 'planned'} onChange={() => updateDraft('status', 'planned')} /> Запланирована</label><label><input type="radio" name="repair-status" value="in_progress" checked={draft.status === 'in_progress'} onChange={() => updateDraft('status', 'in_progress')} /> Уже идёт</label></fieldset> : null}
          <div className="repair-actions"><Button type="button" size="medium" variant="secondary" onClick={closeForm}>Отмена</Button><Button type="submit" size="medium" variant="primary" loading={saving}>Сохранить</Button></div>
        </form> : null}
        {notice ? <p className="community-notice" role="status">{notice}</p> : null}
      </div>
    </main>
  );
}
