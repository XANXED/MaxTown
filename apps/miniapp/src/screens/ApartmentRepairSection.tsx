import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Checkbox, NativeSelect } from '@vkontakte/vkui';
import { Buildings, Hammer, HouseLine, MapPin, Wrench } from '@phosphor-icons/react';
import {
  APARTMENT_REPAIR_WORK_TYPES,
  type ApartmentLayoutPosition,
  type ApartmentRepair,
  type ApartmentRepairInput,
  type ApartmentRepairState,
  type ApartmentRepairWorkType,
  type HouseMembershipSummary,
  type HouseRole,
} from '@maxtown/shared';
import { Button, Input, Spinner, Textarea, Typography } from '../components/platform-ui.tsx';
import { EmptyState } from '../components/ui.tsx';
import {
  ApartmentRepairRequestError,
  cancelApartmentRepair,
  completeApartmentRepair,
  createApartmentRepair,
  loadApartmentLayout,
  loadApartmentRepair,
  loadApartmentRepairs,
  saveApartmentLayout,
  updateApartmentRepair,
} from '../data/apartmentRepairs.ts';
import { fromDateTimeLocal, toDateTimeLocal } from '../data/repairMode.ts';

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

const workLabels: Record<ApartmentRepairWorkType, string> = {
  demolition: 'Демонтаж',
  drilling: 'Сверление',
  flooring: 'Полы',
  plumbing: 'Сантехника',
  electrical: 'Электрика',
  finishing: 'Отделка',
  furniture: 'Сборка мебели',
  other: 'Другое',
};

const stateLabels: Record<ApartmentRepairState, string> = {
  scheduled: 'Запланирован',
  active: 'Идут работы',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

function roundedLocalDate(offsetMinutes: number): string {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
  return toDateTimeLocal(date.toISOString());
}

function messageForError(error: unknown): string {
  if (!(error instanceof ApartmentRepairRequestError)) return 'Не удалось сохранить изменения. Проверьте подключение.';
  const messages: Record<string, string> = {
    layout_slot_taken: 'Эта ячейка уже занята другой Квартирой.',
    layout_column_not_at_edge: 'Новую Квартиру можно добавить только слева или справа от ряда.',
    layout_locked_by_repair: 'Схему рядом с будущим или активным ремонтом пока нельзя менять.',
    apartment_layout_required: 'Сначала разместите Квартиру на Схеме.',
    apartment_repair_exists: 'У Квартиры уже есть будущий или активный ремонт.',
    repair_start_in_past: 'Начало ремонта не может быть в прошлом.',
    repair_end_in_past: 'Окончание ремонта должно быть в будущем.',
    repair_details_invalid: 'Проверьте виды работ и время ремонта.',
    repair_closed: 'Этот ремонт уже закрыт.',
  };
  return messages[error.code] ?? 'Операция недоступна. Обновите экран и попробуйте ещё раз.';
}

function RepairCard({ repair, onEdit, onCancel, onComplete, busy }: {
  repair: ApartmentRepair;
  onEdit?: () => void;
  onCancel?: () => void;
  onComplete?: () => void;
  busy: boolean;
}) {
  return (
    <article className="repair-panel apartment-repair-card" aria-labelledby={`apartment-repair-${repair.id}`}>
      <div className="repair-panel__heading">
        <span className="repair-card__title"><Wrench className="icon" aria-hidden /><strong id={`apartment-repair-${repair.id}`}>Квартира №{repair.apartmentNumber}</strong></span>
        <span className="status-badge">{stateLabels[repair.state]}</span>
      </div>
      <p>{repair.workTypes.map((type) => workLabels[type]).join(', ')}</p>
      {repair.details ? <p className="repair-card__details">{repair.details}</p> : null}
      <dl className="repair-details">
        <div><dt>Начало</dt><dd>{dateTimeFormat.format(new Date(repair.startsAt))}</dd></div>
        <div><dt>Окончание</dt><dd>{dateTimeFormat.format(new Date(repair.endsAt))}</dd></div>
      </dl>
      {repair.canEdit && (repair.state === 'scheduled' || repair.state === 'active') ? (
        <div className="repair-actions repair-actions--wrap">
          {onEdit ? <Button size="small" variant="secondary" onClick={onEdit}>Изменить</Button> : null}
          {repair.state === 'scheduled' && onCancel ? <Button size="small" variant="destructive" loading={busy} onClick={onCancel}>Отменить</Button> : null}
          {repair.state === 'active' && onComplete ? <Button size="small" variant="primary" loading={busy} onClick={onComplete}>Завершить раньше</Button> : null}
        </div>
      ) : null}
    </article>
  );
}

function LayoutEditor({ layout, membership, role, onSaved }: {
  layout: ApartmentLayoutPosition[];
  membership: HouseMembershipSummary;
  role: HouseRole;
  onSaved: () => Promise<void>;
}) {
  const own = layout.find((apartment) => apartment.apartmentId === membership.apartmentId) ?? null;
  const editable = layout.filter((apartment) => apartment.canEdit);
  const [targetId, setTargetId] = useState(own?.apartmentId ?? editable[0]?.apartmentId ?? '');
  const target = layout.find((apartment) => apartment.apartmentId === targetId) ?? null;
  const [entrance, setEntrance] = useState(target?.entrance ?? 1);
  const [floor, setFloor] = useState(target?.floor ?? 1);
  const [column, setColumn] = useState<number | null>(target?.column ?? null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const next = layout.find((apartment) => apartment.apartmentId === targetId) ?? null;
    setEntrance(next?.entrance ?? 1);
    setFloor(next?.floor ?? 1);
    setColumn(next?.column ?? null);
    setNotice('');
  }, [layout, targetId]);

  const row = layout.filter((apartment) => apartment.apartmentId !== targetId
    && apartment.entrance === entrance && apartment.floor === floor && apartment.column !== null);
  const positionedColumns = row.map((apartment) => apartment.column!);
  const min = positionedColumns.length > 0 ? Math.min(...positionedColumns) : 0;
  const max = positionedColumns.length > 0 ? Math.max(...positionedColumns) : 0;
  const columns = positionedColumns.length === 0
    ? [0]
    : Array.from({ length: max - min + 3 }, (_, index) => min - 1 + index);

  if (role === 'management-company') {
    return <LayoutOverview layout={layout} />;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || column === null) { setNotice('Выберите свободную ячейку.'); return; }
    setSaving(true);
    setNotice('');
    void saveApartmentLayout(membership.houseId, target.apartmentId, { entrance, floor, column })
      .then(onSaved)
      .catch((error) => setNotice(messageForError(error)))
      .finally(() => setSaving(false));
  };

  return (
    <form className="repair-form apartment-layout" onSubmit={submit}>
      <span className="repair-card__title"><MapPin className="icon" aria-hidden /><Typography.Text asChild variant="title"><h2>Схема Квартир</h2></Typography.Text></span>
      <Typography.Text asChild variant="description" color="secondary"><p>Укажите положение, чтобы предупреждения получали только соседи слева, справа, сверху и снизу.</p></Typography.Text>
      {role === 'admin' ? (
        <label className="repair-field"><span>Квартира</span><NativeSelect aria-label="Квартира для размещения" value={targetId} onChange={(event) => setTargetId(event.target.value)}>{editable.map((apartment) => <option value={apartment.apartmentId} key={apartment.apartmentId}>Квартира №{apartment.apartmentNumber}</option>)}</NativeSelect></label>
      ) : null}
      <div className="apartment-layout__coordinates">
        <label className="repair-field"><span>Подъезд</span><Input type="number" min={1} max={100} value={entrance} onChange={(event) => { setEntrance(Number(event.target.value)); setColumn(null); }} /></label>
        <label className="repair-field"><span>Этаж</span><Input type="number" min={1} max={200} value={floor} onChange={(event) => { setFloor(Number(event.target.value)); setColumn(null); }} /></label>
      </div>
      <fieldset className="apartment-layout__row">
        <legend>Положение на этаже</legend>
        <div className="apartment-layout__cells">
          {columns.map((candidate) => {
            const occupant = row.find((apartment) => apartment.column === candidate);
            const selected = column === candidate;
            const allowedForNew = target?.column !== null || row.length === 0
              ? true
              : candidate === min - 1 || candidate === max + 1;
            return (
              <button
                className={`apartment-layout__cell pressable${selected ? ' apartment-layout__cell--selected' : ''}`}
                type="button"
                disabled={Boolean(occupant) || !allowedForNew}
                aria-pressed={selected}
                aria-label={occupant ? `Квартира №${occupant.apartmentNumber}, занято` : selected ? 'Выбранная свободная ячейка' : 'Свободная ячейка'}
                key={candidate}
                onClick={() => setColumn(candidate)}
              >
                {occupant ? `№${occupant.apartmentNumber}` : selected ? `№${target?.apartmentNumber ?? ''}` : 'Свободно'}
              </button>
            );
          })}
        </div>
      </fieldset>
      <LayoutOverview layout={layout} />
      {notice ? <p className="field-error" role="alert">{notice}</p> : null}
      <Button type="submit" size="medium" variant="primary" loading={saving}>Сохранить положение</Button>
    </form>
  );
}

function LayoutOverview({ layout }: { layout: ApartmentLayoutPosition[] }) {
  const placed = layout.filter((apartment) => apartment.entrance !== null && apartment.floor !== null && apartment.column !== null);
  const entrances = [...new Set(placed.map((apartment) => apartment.entrance!))].sort((a, b) => a - b);
  return (
    <section className="repair-panel apartment-layout-overview" aria-labelledby="layout-overview-title">
      <span className="repair-card__title"><Buildings className="icon" aria-hidden /><Typography.Text asChild variant="title"><h2 id="layout-overview-title">Текущее расположение</h2></Typography.Text></span>
      {entrances.length === 0 ? <p>Квартиры ещё не размещены.</p> : entrances.map((entrance) => {
        const floors = [...new Set(placed.filter((apartment) => apartment.entrance === entrance).map((apartment) => apartment.floor!))].sort((a, b) => b - a);
        return <div className="apartment-layout-overview__entrance" key={entrance}><strong>Подъезд {entrance}</strong>{floors.map((floor) => <div className="apartment-layout-overview__floor" key={floor}><span>{floor} этаж</span><span>{placed.filter((apartment) => apartment.entrance === entrance && apartment.floor === floor).sort((a, b) => a.column! - b.column!).map((apartment) => `№${apartment.apartmentNumber}`).join(' · ')}</span></div>)}</div>;
      })}
    </section>
  );
}

function RepairForm({ repair, houseId, onSaved, onClose }: {
  repair: ApartmentRepair | null;
  houseId: string;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [workTypes, setWorkTypes] = useState<ApartmentRepairWorkType[]>(repair?.workTypes ?? []);
  const [details, setDetails] = useState(repair?.details ?? '');
  const [startsAt, setStartsAt] = useState(toDateTimeLocal(repair?.startsAt ?? null) || roundedLocalDate(10));
  const [endsAt, setEndsAt] = useState(toDateTimeLocal(repair?.endsAt ?? null) || roundedLocalDate(130));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const toggle = (type: ApartmentRepairWorkType, checked: boolean) => {
    setWorkTypes((current) => checked ? [...current, type] : current.filter((item) => item !== type));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const start = fromDateTimeLocal(startsAt);
    const end = fromDateTimeLocal(endsAt);
    if (workTypes.length === 0 || !start || !end || Date.parse(end) <= Date.parse(start)) {
      setNotice('Выберите работы и укажите корректный период.');
      return;
    }
    const input: ApartmentRepairInput = { workTypes, ...(details.trim() ? { details: details.trim() } : {}), startsAt: start, endsAt: end };
    setSaving(true);
    setNotice('');
    const save = repair ? updateApartmentRepair(houseId, repair.id, input) : createApartmentRepair(houseId, input);
    void save.then(onSaved).then(onClose).catch((error) => setNotice(messageForError(error))).finally(() => setSaving(false));
  };

  return (
    <form className="repair-form" onSubmit={submit}>
      <Typography.Text asChild variant="title"><h2>{repair ? 'Изменить Ремонт Квартиры' : 'Запланировать Ремонт Квартиры'}</h2></Typography.Text>
      <fieldset className="repair-work-types"><legend>Виды работ</legend>{APARTMENT_REPAIR_WORK_TYPES.map((type) => <Checkbox checked={workTypes.includes(type)} onChange={(event) => toggle(type, event.target.checked)} key={type}>{workLabels[type]}</Checkbox>)}</fieldset>
      <Textarea aria-label="Пояснение к ремонту" placeholder="Что важно знать соседям — необязательно" value={details} rows={3} maxLength={2000} onChange={(event) => setDetails(event.target.value)} />
      <label className="repair-field"><span>Начало</span><Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
      <label className="repair-field"><span>Окончание</span><Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
      {notice ? <p className="field-error" role="alert">{notice}</p> : null}
      <div className="repair-actions"><Button size="medium" variant="secondary" onClick={onClose}>Закрыть</Button><Button type="submit" size="medium" variant="primary" loading={saving}>Сохранить</Button></div>
    </form>
  );
}

export function ApartmentRepairSection({ houseId, role, membership, selectedRepairId }: {
  houseId: string;
  role: HouseRole;
  membership: HouseMembershipSummary | null;
  selectedRepairId?: string;
}) {
  const [layout, setLayout] = useState<ApartmentLayoutPosition[]>([]);
  const [repairs, setRepairs] = useState<ApartmentRepair[]>([]);
  const [selectedRepair, setSelectedRepair] = useState<ApartmentRepair | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editingLayout, setEditingLayout] = useState(false);
  const [editingRepair, setEditingRepair] = useState<ApartmentRepair | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [nextLayout, nextRepairs, detail] = await Promise.all([
        loadApartmentLayout(houseId),
        loadApartmentRepairs(houseId),
        selectedRepairId ? loadApartmentRepair(houseId, selectedRepairId) : Promise.resolve(null),
      ]);
      setLayout(nextLayout);
      setRepairs(nextRepairs);
      setSelectedRepair(detail);
      setStatus('ready');
    } catch { setStatus('error'); }
  }, [houseId, selectedRepairId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const ownPosition = layout.find((apartment) => apartment.apartmentId === membership?.apartmentId) ?? null;
  useEffect(() => {
    if (status === 'ready' && role === 'resident' && ownPosition && ownPosition.column === null) setEditingLayout(true);
  }, [ownPosition, role, status]);

  const ownOpenRepair = useMemo(() => repairs.find((repair) => repair.apartmentId === membership?.apartmentId
    && (repair.state === 'scheduled' || repair.state === 'active')) ?? null, [membership?.apartmentId, repairs]);
  const visibleRepairs = selectedRepair ? [selectedRepair] : repairs;

  const changeState = (action: 'cancel' | 'complete', repair: ApartmentRepair) => {
    setBusy(true);
    setNotice('');
    const request = action === 'cancel' ? cancelApartmentRepair(houseId, repair.id) : completeApartmentRepair(houseId, repair.id);
    void request.then(refresh).catch((error) => setNotice(messageForError(error))).finally(() => setBusy(false));
  };

  if (!membership) {
    return <section className="decision-card repair-empty"><HouseLine className="icon" aria-hidden /><Typography.Text asChild variant="title"><h2>Сначала привяжитесь к Квартире</h2></Typography.Text><p>Ремонт Квартиры доступен после привязки Квартиры к вашему участию в Доме.</p></section>;
  }
  if (status === 'loading') return <div className="join-checking"><Spinner size={20} />Загружаем ремонты…</div>;
  if (status === 'error') return <section className="community-error" role="alert"><p>Не удалось загрузить Ремонты Квартир.</p><Button size="small" variant="secondary" onClick={() => void refresh()}>Повторить</Button></section>;

  return (
    <div className="apartment-repair-section">
      {role === 'resident' && !membership.apartmentId ? (
        <section className="decision-card repair-empty"><HouseLine className="icon" aria-hidden /><Typography.Text asChild variant="title"><h2>Сначала привяжитесь к Квартире</h2></Typography.Text><p>Укажите Квартиру в профиле Дома, затем вернитесь сюда.</p></section>
      ) : editingLayout || role === 'management-company' ? (
        <LayoutEditor layout={layout} membership={membership} role={role} onSaved={async () => { await refresh(); setEditingLayout(false); setNotice('Положение Квартиры сохранено.'); }} />
      ) : (
        <div className="repair-section-actions">
          <Button size="small" variant="secondary" onClick={() => setEditingLayout(true)}>{role === 'admin' ? 'Настроить схему' : 'Изменить положение'}</Button>
          {ownPosition && ownPosition.column !== null && !ownOpenRepair ? <Button size="small" variant="primary" onClick={() => setEditingRepair(null)}>Запланировать ремонт</Button> : null}
        </div>
      )}

      {editingRepair !== undefined ? <RepairForm repair={editingRepair} houseId={houseId} onSaved={refresh} onClose={() => setEditingRepair(undefined)} /> : null}
      {notice ? <p className="community-notice" role="status">{notice}</p> : null}

      {visibleRepairs.length === 0 ? (
        <div className="list-card"><EmptyState icon={Hammer} tone="coral" title="Ремонтов рядом нет" description={role === 'resident' ? 'Здесь появятся ваши и смежные Ремонты Квартир' : 'В Доме пока нет Ремонтов Квартир'} /></div>
      ) : (
        <section className="apartment-repair-list" aria-labelledby="apartment-repairs-title">
          <Typography.Text asChild variant="title"><h2 id="apartment-repairs-title">{selectedRepair ? 'Ремонт Квартиры' : role === 'resident' ? 'Ваши и смежные ремонты' : 'Ремонты Квартир в Доме'}</h2></Typography.Text>
          {visibleRepairs.map((repair) => <RepairCard repair={repair} busy={busy} key={repair.id} onEdit={repair.canEdit && (repair.state === 'scheduled' || repair.state === 'active') ? () => setEditingRepair(repair) : undefined} onCancel={repair.canEdit && repair.state === 'scheduled' ? () => changeState('cancel', repair) : undefined} onComplete={repair.canEdit && repair.state === 'active' ? () => changeState('complete', repair) : undefined} />)}
        </section>
      )}
    </div>
  );
}
