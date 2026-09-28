import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Hammer, Wrench } from '@phosphor-icons/react';
import { Button, Input, Spinner, Textarea, Typography } from '../components/platform-ui.tsx';
import type { HouseRole, RepairMode } from '@maxtown/shared';
import { getCurrentResident } from '../auth/session.ts';
import { fromDateTimeLocal, loadRepairMode, saveRepairMode, toDateTimeLocal } from '../data/repairMode.ts';

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

export function RepairModeScreen({ houseId, role }: { houseId: string | null; role: HouseRole | null }) {
  const [resolvedHouseId, setResolvedHouseId] = useState(houseId);
  const [resolvedRole, setResolvedRole] = useState(role);
  const [mode, setMode] = useState<RepairMode | null>(null);
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
    if (!resolvedHouseId) return;
    try { setMode(await loadRepairMode(resolvedHouseId)); setStatus('ready'); }
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
    if (!resolvedHouseId || !title.trim() || !description.trim() || !startsAt) {
      setNotice('Укажите название, описание и время начала работ.');
      return;
    }
    if (expectedCompletionAt && Date.parse(expectedCompletionAt) < Date.parse(startsAt)) {
      setNotice('Ожидаемый срок должен быть не раньше начала работ.');
      return;
    }
    setSaving(true);
    setNotice('');
    void saveRepairMode(resolvedHouseId, {
      isActive: true, title: title.trim(), description: description.trim(),
      startsAt: fromDateTimeLocal(startsAt)!,
      expectedCompletionAt: fromDateTimeLocal(expectedCompletionAt) ?? undefined,
      instructions: instructions.trim() || undefined,
    }).then((updated) => { setMode(updated); setEditing(false); setNotice('Режим ремонта обновлён.'); })
      .catch(() => setNotice('Не удалось сохранить. Проверьте подключение и попробуйте ещё раз.'))
      .finally(() => setSaving(false));
  };

  const complete = () => {
    if (!resolvedHouseId) return;
    setSaving(true);
    setNotice('');
    void saveRepairMode(resolvedHouseId, { isActive: false })
      .then((updated) => { setMode(updated); setNotice('Режим ремонта завершён.'); })
      .catch(() => setNotice('Не удалось завершить режим ремонта. Попробуйте ещё раз.'))
      .finally(() => setSaving(false));
  };

  if (!resolvedHouseId) {
    return <main className="screen screen--inner inner-content" id="main-content"><section className="decision-card"><Hammer className="icon" aria-hidden /><Typography.Text asChild variant="title"><h1>Сначала вступите в Дом</h1></Typography.Text><Typography.Text asChild variant="description" color="secondary"><p>Режим ремонта доступен Жильцам Дома.</p></Typography.Text></section></main>;
  }

  const canEdit = resolvedRole === 'headman' || resolvedRole === 'responsible';
  return (
    <main className="screen screen--inner repair-screen" id="main-content">
      <div className="inner-content stagger">
        <header className="repair-heading"><span><Typography.Text asChild variant="header"><h1>Режим ремонта</h1></Typography.Text><Typography.Text asChild variant="description" color="secondary"><p>Информация от Старосты или Ответственного</p></Typography.Text></span><Button size="small" variant="secondary" onClick={() => void refresh()}>Обновить</Button></header>
        {status === 'loading' ? <div className="join-checking"><Spinner size={20} />Загружаем состояние…</div> : null}
        {status === 'error' ? <div className="community-error" role="alert">Не удалось загрузить режим ремонта. Проверьте подключение.</div> : null}
        {status === 'ready' && mode ? (
          mode.isActive ? (
            <section className="repair-panel" aria-labelledby="repair-title">
              <div className="repair-panel__heading"><Wrench className="icon" aria-hidden /><span className="status-badge">Идут работы</span></div>
              <Typography.Text asChild variant="title"><h2 id="repair-title">{mode.title}</h2></Typography.Text>
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
            <section className="decision-card repair-empty"><Hammer className="icon" aria-hidden /><Typography.Text asChild variant="title"><h2>Сейчас ремонт не объявлен</h2></Typography.Text><Typography.Text asChild variant="description" color="secondary"><p>Если в Доме начнутся работы, здесь появятся описание и ожидаемый срок.</p></Typography.Text>{canEdit ? <Button size="medium" variant="primary" onClick={beginEditing}>Объявить о ремонте</Button> : null}</section>
          )
        ) : null}
        {editing ? <form className="repair-form" onSubmit={submit}>
          <Typography.Text asChild variant="title"><h2>{mode?.isActive ? 'Изменить режим ремонта' : 'Объявить о ремонте'}</h2></Typography.Text>
          <Input mode="contrast" size="large" aria-label="Название работ" placeholder="Например, замена стояка" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
          <Textarea aria-label="Описание работ" placeholder="Какие работы будут проходить?" value={description} rows={4} maxLength={2000} onChange={(event) => setDescription(event.target.value)} />
          <label className="repair-field"><span>Начало работ</span><Input type="datetime-local" mode="contrast" size="large" aria-label="Начало работ" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
          <label className="repair-field"><span>Ожидаемый срок окончания</span><Input type="datetime-local" mode="contrast" size="large" aria-label="Ожидаемый срок окончания" value={expectedCompletionAt} onChange={(event) => setExpectedCompletionAt(event.target.value)} /></label>
          <Textarea aria-label="Что нужно сделать жильцам" placeholder="Инструкции жильцам — необязательно" value={instructions} rows={3} maxLength={2000} onChange={(event) => setInstructions(event.target.value)} />
          <div className="repair-actions"><Button type="button" size="medium" variant="secondary" onClick={() => setEditing(false)}>Отмена</Button><Button type="submit" size="medium" variant="primary" loading={saving}>Сохранить</Button></div>
        </form> : null}
        {notice ? <p className="community-notice" role="status">{notice}</p> : null}
      </div>
    </main>
  );
}
