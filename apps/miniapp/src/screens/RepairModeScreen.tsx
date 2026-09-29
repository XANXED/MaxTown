import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Hammer, Wrench } from '@phosphor-icons/react';
import { Button, Input, Spinner, Textarea, Typography } from '../components/platform-ui.tsx';
import { Segmented } from '../components/ui.tsx';
import type { HouseMembershipSummary, HouseRepairMode, HouseRole } from '@maxtown/shared';
import { getCurrentResident } from '../auth/session.ts';
import { fromDateTimeLocal, loadRepairMode, saveRepairMode, toDateTimeLocal } from '../data/repairMode.ts';
import { canManageServices } from '../auth/membership.tsx';
import { ApartmentRepairSection } from './ApartmentRepairSection.tsx';

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

function HouseWorksSection({ houseId, role }: { houseId: string; role: HouseRole }) {
  const [mode, setMode] = useState<HouseRepairMode | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [expectedCompletionAt, setExpectedCompletionAt] = useState('');
  const [instructions, setInstructions] = useState('');

  const refresh = useCallback(async () => {
    try { setMode(await loadRepairMode(houseId)); setStatus('ready'); }
    catch { setStatus('error'); }
  }, [houseId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const beginEditing = () => {
    setTitle(mode?.title ?? '');
    setDescription(mode?.description ?? '');
    setStartsAt(toDateTimeLocal(mode?.startsAt ?? null));
    setExpectedCompletionAt(toDateTimeLocal(mode?.expectedCompletionAt ?? null));
    setInstructions(mode?.instructions ?? '');
    setEditing(true);
    setNotice('');
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !description.trim() || !startsAt) { setNotice('Укажите название, описание и время начала работ.'); return; }
    if (expectedCompletionAt && Date.parse(expectedCompletionAt) < Date.parse(startsAt)) { setNotice('Ожидаемый срок должен быть не раньше начала работ.'); return; }
    setSaving(true);
    setNotice('');
    void saveRepairMode(houseId, {
      isActive: true, title: title.trim(), description: description.trim(),
      startsAt: fromDateTimeLocal(startsAt)!,
      expectedCompletionAt: fromDateTimeLocal(expectedCompletionAt) ?? undefined,
      instructions: instructions.trim() || undefined,
    }).then((updated) => { setMode(updated); setEditing(false); setNotice('Работы в Доме обновлены.'); })
      .catch(() => setNotice('Не удалось сохранить. Проверьте подключение и попробуйте ещё раз.'))
      .finally(() => setSaving(false));
  };

  const complete = () => {
    setSaving(true);
    setNotice('');
    void saveRepairMode(houseId, { isActive: false })
      .then((updated) => { setMode(updated); setNotice('Работы в Доме завершены.'); })
      .catch(() => setNotice('Не удалось завершить Работы в Доме. Попробуйте ещё раз.'))
      .finally(() => setSaving(false));
  };

  const canEdit = canManageServices(role);
  if (status === 'loading') return <div className="join-checking"><Spinner size={20} />Загружаем состояние…</div>;
  if (status === 'error') return <div className="community-error" role="alert">Не удалось загрузить Работы в Доме. <Button size="small" variant="secondary" onClick={() => void refresh()}>Повторить</Button></div>;

  return (
    <div className="house-works-section">
      {mode?.isActive ? (
        <section className="repair-panel" aria-labelledby="house-works-title">
          <div className="repair-panel__heading"><Wrench className="icon" aria-hidden /><span className="status-badge">Идут работы</span></div>
          <Typography.Text asChild variant="title"><h2 id="house-works-title">{mode.title}</h2></Typography.Text>
          <Typography.Text asChild variant="body"><p>{mode.description}</p></Typography.Text>
          <dl className="repair-details">
            {mode.startsAt ? <div><dt>Начало</dt><dd>{dateTimeFormat.format(new Date(mode.startsAt))}</dd></div> : null}
            {mode.expectedCompletionAt ? <div><dt>Ожидаемый срок</dt><dd>{dateTimeFormat.format(new Date(mode.expectedCompletionAt))}</dd></div> : null}
            {mode.instructions ? <div><dt>Что нужно сделать</dt><dd>{mode.instructions}</dd></div> : null}
          </dl>
          {mode.updatedBy && mode.updatedAt ? <p className="repair-attribution">Обновил(а) {mode.updatedBy.displayName} · {dateTimeFormat.format(new Date(mode.updatedAt))}</p> : null}
          {canEdit ? <div className="repair-actions"><Button size="medium" variant="secondary" onClick={beginEditing}>Изменить</Button><Button size="medium" variant="primary" onClick={complete} loading={saving}>Завершить работы</Button></div> : null}
        </section>
      ) : (
        <section className="decision-card repair-empty"><Hammer className="icon" aria-hidden /><Typography.Text asChild variant="title"><h2>Сейчас общедомовых работ нет</h2></Typography.Text><Typography.Text asChild variant="description" color="secondary"><p>Здесь Администратор Дома или УК сообщит о работах для всего Дома.</p></Typography.Text>{canEdit ? <Button size="medium" variant="primary" onClick={beginEditing}>Объявить работы</Button> : null}</section>
      )}
      {editing ? <form className="repair-form" onSubmit={submit}>
        <Typography.Text asChild variant="title"><h2>{mode?.isActive ? 'Изменить Работы в Доме' : 'Объявить Работы в Доме'}</h2></Typography.Text>
        <Input aria-label="Название работ" placeholder="Например, замена стояка" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
        <Textarea aria-label="Описание работ" placeholder="Какие работы будут проходить?" value={description} rows={4} maxLength={2000} onChange={(event) => setDescription(event.target.value)} />
        <label className="repair-field"><span>Начало работ</span><Input type="datetime-local" aria-label="Начало работ" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
        <label className="repair-field"><span>Ожидаемый срок окончания</span><Input type="datetime-local" aria-label="Ожидаемый срок окончания" value={expectedCompletionAt} onChange={(event) => setExpectedCompletionAt(event.target.value)} /></label>
        <Textarea aria-label="Что нужно сделать жильцам" placeholder="Инструкции жильцам — необязательно" value={instructions} rows={3} maxLength={2000} onChange={(event) => setInstructions(event.target.value)} />
        <div className="repair-actions"><Button size="medium" variant="secondary" onClick={() => setEditing(false)}>Отмена</Button><Button type="submit" size="medium" variant="primary" loading={saving}>Сохранить</Button></div>
      </form> : null}
      {notice ? <p className="community-notice" role="status">{notice}</p> : null}
    </div>
  );
}

export function RepairModeScreen({ houseId, role, selectedRepairId }: {
  houseId: string | null;
  role: HouseRole | null;
  selectedRepairId?: string;
}) {
  const [membership, setMembership] = useState<HouseMembershipSummary | null>(null);
  const [section, setSection] = useState<'apartment' | 'house'>('apartment');
  const [loadingMembership, setLoadingMembership] = useState(true);

  useEffect(() => {
    setLoadingMembership(true);
    void getCurrentResident().then((me) => {
      // Членство того Дома, что открыт; первое — только если Дом ещё не выбран.
      setMembership(houseId ? me.memberships.find((item) => item.houseId === houseId) ?? null : me.memberships[0] ?? null);
    }).catch(() => setMembership(null)).finally(() => setLoadingMembership(false));
  }, [houseId]);

  if (loadingMembership) return <main className="screen screen--inner inner-content" id="main-content"><div className="join-checking"><Spinner size={20} />Открываем Ремонт…</div></main>;
  const resolvedHouseId = houseId ?? membership?.houseId ?? null;
  const resolvedRole = role ?? membership?.role ?? null;
  if (!resolvedHouseId || !resolvedRole) {
    return <main className="screen screen--inner inner-content" id="main-content"><section className="decision-card"><Hammer className="icon" aria-hidden /><Typography.Text asChild variant="title"><h1>Сначала вступите в Дом</h1></Typography.Text><p>Раздел «Ремонт» доступен участникам Дома.</p></section></main>;
  }

  return (
    <main className="screen screen--inner repair-screen" id="main-content">
      <div className="inner-content stagger">
        <header className="repair-heading"><span><Typography.Text asChild variant="header"><h1>Ремонт</h1></Typography.Text><Typography.Text asChild variant="description" color="secondary"><p>Предупреждения соседей и общедомовые работы</p></Typography.Text></span></header>
        <Segmented label="Раздел ремонта" value={section} onChange={setSection} options={[{ value: 'apartment', label: 'Ремонт Квартиры' }, { value: 'house', label: 'Работы в Доме' }]} />
        {section === 'apartment' ? <ApartmentRepairSection houseId={resolvedHouseId} role={resolvedRole} membership={membership} selectedRepairId={selectedRepairId} /> : <HouseWorksSection houseId={resolvedHouseId} role={resolvedRole} />}
      </div>
    </main>
  );
}
