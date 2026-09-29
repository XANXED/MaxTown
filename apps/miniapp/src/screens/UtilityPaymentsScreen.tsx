import { useMemo, useState, type FormEvent } from 'react';
import { CalendarBlank, CheckCircle, ClockCountdown, Plus, Receipt, Trash } from '@phosphor-icons/react';
import type { UtilityPaymentCategory, UtilityPaymentPeriod, UtilityPaymentTemplate } from '@maxtown/shared';
import { Button, Input, Spinner, Typography } from '../components/platform-ui.tsx';
import { EmptyState, ErrorState, IconTile, ListCard, RowShell, ScreenHeading, SectionHeading, Segmented, SkeletonRows } from '../components/ui.tsx';
import {
  archiveUtilityPaymentTemplate,
  loadUtilityPaymentPeriods,
  saveUtilityPaymentTemplate,
  useUtilityPayments,
} from '../data/utilityPayments.ts';
import { useMembership } from '../auth/membership.tsx';
import { ROUTES, utilityPaymentRoute } from '../routes.ts';
import type { Navigate } from './types.ts';

export const utilityCategoryLabels: Record<UtilityPaymentCategory, string> = {
  rent: 'Квартплата', electricity: 'Электричество', gas: 'Газ', water: 'Вода', heating: 'Отопление',
  'capital-repair': 'Капремонт', intercom: 'Домофон', internet: 'Интернет', other: 'Другое',
};

export const utilityStateLabels: Record<UtilityPaymentPeriod['state'], string> = {
  upcoming: 'Впереди', 'due-soon': 'Скоро', 'due-today': 'Сегодня', overdue: 'Не отмечено', paid: 'Оплачено', skipped: 'Пропущено',
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

function localDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

export function formatUtilityDue(value: string): string {
  return dateFormat.format(localDate(value));
}

function formatUtilityMonth(value: string): string {
  return monthFormat.format(localDate(value));
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function UtilityTabs({ active, navigate }: { active: 'payments' | 'readings'; navigate: Navigate }) {
  return (
    <Segmented
      label="Раздел ЖКУ"
      value={active}
      onChange={(value) => navigate(value === 'payments' ? ROUTES.utilities : ROUTES.utilitiesReadings)}
      options={[{ value: 'payments', label: 'Платежи' }, { value: 'readings', label: 'Показания' }]}
    />
  );
}

export function UtilityPaymentsScreen({ houseId, navigate, notify }: {
  houseId: string | null;
  navigate: Navigate;
  notify: (message: string) => void;
}) {
  const membership = useMembership();
  const { status, data, retry } = useUtilityPayments(houseId);
  const [editing, setEditing] = useState<UtilityPaymentTemplate | null | 'new'>(null);
  const [history, setHistory] = useState<{ periods: UtilityPaymentPeriod[]; nextCursor: string | null } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const currentYear = new Date().getFullYear();
  const [historyYear, setHistoryYear] = useState(currentYear);
  const historyYears = Array.from({ length: Math.max(1, currentYear - 2026 + 1) }, (_, index) => currentYear - index);

  const openHistory = async (cursor?: string) => {
    if (!houseId) return;
    setHistoryLoading(true);
    try {
      const page = await loadUtilityPaymentPeriods(houseId, historyYear, cursor);
      setHistory((current) => cursor && current
        ? { periods: [...current.periods, ...page.periods], nextCursor: page.nextCursor }
        : page);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось загрузить историю');
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <main className="screen screen--inner inner-content stagger" id="main-content">
      <ScreenHeading description={membership?.apartmentNumber ? `Квартира ${membership.apartmentNumber}` : undefined}>ЖКУ</ScreenHeading>
      <UtilityTabs active="payments" navigate={navigate} />

      {!membership?.apartmentId ? (
        <div className="list-card">
          <EmptyState icon={Receipt} tone="blue" title="Сначала укажите Квартиру" description="График оплаты общий для участников одной Квартиры" />
        </div>
      ) : membership.role === 'management-company' ? (
        <div className="list-card">
          <EmptyState icon={Receipt} tone="neutral" title="Платежи Квартиры приватны" description="УК не видит сроки, отметки и Чеки оплаты Жильцов" />
        </div>
      ) : status === 'loading' ? (
        <SkeletonRows count={3} />
      ) : status === 'error' || !data ? (
        <ErrorState onRetry={retry} />
      ) : (
        <>
          <section className="utility-summary" aria-labelledby="utility-current-title">
            <SectionHeading id="utility-current-title" title={formatUtilityMonth(data.today)} actionLabel="Добавить" onAction={() => setEditing('new')} />
            {data.periods.length > 0 ? (
              <ListCard label="Платежи текущего месяца">
                {data.periods.map((period) => (
                  <UtilityPeriodRow period={period} key={period.id} onOpen={() => navigate(utilityPaymentRoute(period.id))} />
                ))}
              </ListCard>
            ) : (
              <div className="list-card">
                <EmptyState
                  icon={CalendarBlank}
                  tone="blue"
                  title="График пока пуст"
                  description="Добавьте регулярные платежи, чтобы MaxTown напоминал о сроках"
                  action={<Button size="small" onClick={() => setEditing('new')} iconBefore={<Plus aria-hidden />}>Добавить платёж</Button>}
                />
              </div>
            )}
          </section>

          {editing ? (
            <TemplateForm
              houseId={houseId!}
              template={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => { setEditing(null); retry(); }}
              notify={notify}
            />
          ) : null}

          {data.templates.length > 0 ? (
            <section className="list-group" aria-labelledby="utility-templates-title">
              <h2 className="caps-label list-group__title" id="utility-templates-title">Шаблоны платежей</h2>
              <ListCard label="Шаблоны платежей">
                {data.templates.map((template) => (
                  <RowShell
                    key={template.id}
                    className={template.archivedAt ? 'utility-template--archived' : ''}
                    trailing={template.archivedAt ? <span className="utility-state">В архиве</span> : undefined}
                    onOpen={template.archivedAt ? undefined : () => setEditing(template)}
                  >
                    <IconTile icon={Receipt} tone={template.archivedAt ? 'neutral' : 'blue'} size="small" />
                    <span className="list-row__copy">
                      <Typography.Text asChild variant="body-strong"><span>{template.title}</span></Typography.Text>
                      <Typography.Text asChild variant="description" color="secondary"><span>{utilityCategoryLabels[template.category]} · до {template.dueDay}-го числа</span></Typography.Text>
                    </span>
                  </RowShell>
                ))}
              </ListCard>
            </section>
          ) : null}

          <section className="utility-history" aria-labelledby="utility-history-title">
            <SectionHeading id="utility-history-title" title="История" actionLabel={history ? undefined : 'Показать'} onAction={() => void openHistory()} />
            <label className="contact-form__field utility-history__year"><span>Год</span>
              <select className="utility-select" value={historyYear} onChange={(event) => { setHistoryYear(Number(event.target.value)); setHistory(null); }}>
                {historyYears.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            {historyLoading ? <Spinner size={24} /> : history ? (
              history.periods.length > 0 ? (
                <>
                  <ListCard label={`История платежей за ${historyYear} год`}>
                    {history.periods.map((period) => <UtilityPeriodRow period={period} key={period.id} onOpen={() => navigate(utilityPaymentRoute(period.id))} />)}
                  </ListCard>
                  {history.nextCursor ? <Button variant="secondary" stretched onClick={() => void openHistory(history.nextCursor!)}>Загрузить ещё</Button> : null}
                </>
              ) : <p className="utility-note">За {historyYear} год Платёжных периодов пока нет.</p>
            ) : null}
          </section>
          <p className="utility-note">MaxTown хранит только ваш график и ручные отметки. Он не проверяет оплату и задолженность.</p>
        </>
      )}
    </main>
  );
}

function UtilityPeriodRow({ period, onOpen }: { period: UtilityPaymentPeriod; onOpen: () => void }) {
  const complete = period.state === 'paid' || period.state === 'skipped';
  return (
    <RowShell onOpen={onOpen} className={`utility-period utility-period--${period.state}`}>
      <IconTile icon={period.state === 'paid' ? CheckCircle : period.state === 'overdue' ? ClockCountdown : Receipt} tone={period.state === 'overdue' ? 'coral' : period.state === 'paid' ? 'green' : 'blue'} size="small" />
      <span className="list-row__copy">
        <Typography.Text asChild variant="body-strong"><span>{period.title}</span></Typography.Text>
        <Typography.Text asChild variant="description" color="secondary"><span>{complete ? utilityStateLabels[period.state] : `До ${formatUtilityDue(period.dueOn)}`}</span></Typography.Text>
      </span>
      <span className={`utility-state utility-state--${period.state}`}>{utilityStateLabels[period.state]}</span>
    </RowShell>
  );
}

function TemplateForm({ houseId, template, onSaved, onCancel, notify }: {
  houseId: string;
  template: UtilityPaymentTemplate | null;
  onSaved: () => void;
  onCancel: () => void;
  notify: (message: string) => void;
}) {
  const [category, setCategory] = useState<UtilityPaymentCategory>(template?.category ?? 'rent');
  const [title, setTitle] = useState(template?.title ?? utilityCategoryLabels.rent);
  const [dueDay, setDueDay] = useState(template?.dueDay ?? 10);
  const [startsOn, setStartsOn] = useState((template?.startsOn ?? `${currentMonth()}-01`).slice(0, 7));
  const [saving, setSaving] = useState(false);
  const categories = useMemo(() => Object.entries(utilityCategoryLabels) as Array<[UtilityPaymentCategory, string]>, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await saveUtilityPaymentTemplate(houseId, {
        category, title, dueDay, startsOn: `${startsOn}-01`, ...(template ? { version: template.version } : {}),
      }, template?.id);
      notify(template ? 'Шаблон обновлён' : 'Платёж добавлен');
      onSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось сохранить платёж');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!template) return;
    setSaving(true);
    try {
      await archiveUtilityPaymentTemplate(houseId, template);
      notify('Шаблон перемещён в архив');
      onSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось архивировать шаблон');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="utility-form list-card" onSubmit={submit}>
      <Typography.Text asChild variant="subheader"><h2>{template ? 'Изменить шаблон' : 'Новый платёж'}</h2></Typography.Text>
      <label className="contact-form__field"><span>Категория</span>
        <select className="utility-select" value={category} onChange={(event) => {
          const next = event.target.value as UtilityPaymentCategory;
          setCategory(next);
          if (!template && title === utilityCategoryLabels[category]) setTitle(utilityCategoryLabels[next]);
        }}>
          {categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label className="contact-form__field"><span>Название</span><Input value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="utility-form__grid">
        <label className="contact-form__field"><span>Оплатить до</span><Input type="number" min={1} max={31} required value={dueDay} onChange={(event) => setDueDay(Number(event.target.value))} /></label>
        <label className="contact-form__field"><span>Первый месяц</span><Input type="month" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
      </div>
      <div className="utility-form__actions">
        <Button type="submit" stretched loading={saving}>Сохранить</Button>
        <Button variant="secondary" stretched onClick={onCancel}>Отмена</Button>
        {template ? <Button variant="destructive" stretched iconBefore={<Trash aria-hidden />} onClick={() => void archive()}>В архив</Button> : null}
      </div>
    </form>
  );
}
