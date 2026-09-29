import { useState, type FormEvent } from 'react';
import { ArrowCounterClockwise, CalendarBlank, CheckCircle, FilePdf, Receipt, SkipForward, Trash } from '@phosphor-icons/react';
import type { UtilityPaymentPeriod } from '@maxtown/shared';
import { Button, Input, Spinner, Typography } from '../components/platform-ui.tsx';
import { ErrorState, IconTile, ScreenHeading, SkeletonRows } from '../components/ui.tsx';
import {
  applyUtilityPaymentAction,
  deleteUtilityPaymentReceipt,
  downloadUtilityPaymentReceipt,
  updateUtilityPaymentPeriod,
  uploadUtilityPaymentReceipt,
  useUtilityPaymentPeriod,
} from '../data/utilityPayments.ts';
import { formatUtilityDue, utilityCategoryLabels, utilityStateLabels } from './UtilityPaymentsScreen.tsx';

const eventLabels: Record<string, string> = {
  'period-updated': 'Изменены название или срок', paid: 'Отмечено оплаченным', unpaid: 'Отметка оплаты отменена',
  skipped: 'Период пропущен', unskipped: 'Период возвращён', 'receipt-added': 'Добавлен Чек оплаты',
  'receipt-replaced': 'Чек оплаты заменён', 'receipt-deleted': 'Чек оплаты удалён',
};

export function UtilityPaymentScreen({ houseId, periodId, notify }: {
  houseId: string | null;
  periodId: string;
  notify: (message: string) => void;
}) {
  const loadable = useUtilityPaymentPeriod(houseId, periodId);
  const [local, setLocal] = useState<UtilityPaymentPeriod | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const period = local ?? loadable.data;

  const action = async (name: 'pay' | 'unpay' | 'skip' | 'unskip') => {
    if (!houseId || !period) return;
    setBusy(true);
    try {
      setLocal(await applyUtilityPaymentAction(houseId, period, name));
      notify(name === 'pay' ? 'Платёж отмечен' : name === 'unpay' ? 'Отметка отменена' : name === 'skip' ? 'Период пропущен' : 'Период возвращён');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось изменить отметку');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file || !houseId || !period) return;
    setBusy(true);
    try {
      setLocal(await uploadUtilityPaymentReceipt(houseId, period.id, file));
      notify('Чек оплаты сохранён');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось загрузить чек');
    } finally {
      setBusy(false);
    }
  };

  if (loadable.status === 'loading' && !period) return <main className="screen screen--inner inner-content" id="main-content"><ScreenHeading>Платёж</ScreenHeading><SkeletonRows count={3} /></main>;
  if (loadable.status === 'error' || !period || !houseId) return <main className="screen screen--inner inner-content" id="main-content"><ScreenHeading>Платёж</ScreenHeading><ErrorState onRetry={loadable.retry} /></main>;

  return (
    <main className="screen screen--inner inner-content stagger" id="main-content">
      <ScreenHeading description={`${utilityCategoryLabels[period.category]} · ${formatUtilityDue(period.dueOn)}`}>{period.title}</ScreenHeading>
      <section className={`utility-detail utility-detail--${period.state}`} aria-live="polite">
        <IconTile icon={period.state === 'paid' ? CheckCircle : CalendarBlank} tone={period.state === 'paid' ? 'green' : period.state === 'overdue' ? 'coral' : 'blue'} size="large" />
        <div>
          <span className={`utility-state utility-state--${period.state}`}>{utilityStateLabels[period.state]}</span>
          <Typography.Text asChild variant="body" color="secondary"><p>{period.state === 'overdue' ? 'Срок прошёл, но оплата ещё не отмечена в MaxTown.' : `Срок оплаты — ${formatUtilityDue(period.dueOn)}.`}</p></Typography.Text>
        </div>
      </section>

      {editing ? <PeriodEdit period={period} houseId={houseId} onSaved={(next) => { setLocal(next); setEditing(false); }} onCancel={() => setEditing(false)} notify={notify} /> : null}

      <div className="utility-actions">
        {period.state === 'paid' ? (
          <Button variant="secondary" stretched loading={busy} iconBefore={<ArrowCounterClockwise aria-hidden />} onClick={() => void action('unpay')}>Отменить отметку</Button>
        ) : period.state === 'skipped' ? (
          <Button stretched loading={busy} iconBefore={<ArrowCounterClockwise aria-hidden />} onClick={() => void action('unskip')}>Вернуть период</Button>
        ) : (
          <>
            <Button stretched loading={busy} iconBefore={<CheckCircle aria-hidden />} onClick={() => void action('pay')}>Отметить оплаченным</Button>
            <Button variant="secondary" stretched disabled={busy} onClick={() => setEditing(true)}>Изменить срок</Button>
            <Button variant="secondary" stretched disabled={busy} iconBefore={<SkipForward aria-hidden />} onClick={() => void action('skip')}>Пропустить месяц</Button>
          </>
        )}
      </div>

      {period.state === 'paid' ? (
        <section className="list-group" aria-labelledby="utility-receipt-title">
          <h2 className="caps-label list-group__title" id="utility-receipt-title">Чек оплаты</h2>
          <div className="list-card utility-receipt">
            {period.receipt ? (
              <>
                <button className="utility-receipt__file pressable" type="button" disabled={busy} onClick={() => {
                  setBusy(true);
                  void downloadUtilityPaymentReceipt(houseId, period.id, period.receipt!.fileName)
                    .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Не удалось открыть чек'))
                    .finally(() => setBusy(false));
                }}>
                  <IconTile icon={period.receipt.contentType === 'application/pdf' ? FilePdf : Receipt} tone="blue" size="small" />
                  <span><strong>{period.receipt.fileName}</strong><small>Добавил {period.receipt.uploadedBy}</small></span>
                </button>
                <Button variant="secondary" disabled={busy} iconBefore={<Trash aria-hidden />} onClick={() => {
                  setBusy(true);
                  void deleteUtilityPaymentReceipt(houseId, period.id)
                    .then((next) => { setLocal(next); notify('Чек удалён'); })
                    .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Не удалось удалить чек'))
                    .finally(() => setBusy(false));
                }}>Удалить</Button>
              </>
            ) : <Typography.Text asChild variant="body" color="secondary"><p>Чек необязателен и виден только участникам вашей Квартиры.</p></Typography.Text>}
            <label className="utility-file-button">
              <span>{period.receipt ? 'Заменить файл' : 'Добавить файл'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={(event) => void upload(event.target.files?.[0])} />
            </label>
          </div>
        </section>
      ) : null}

      {period.events && period.events.length > 0 ? (
        <section className="list-group" aria-labelledby="utility-events-title">
          <h2 className="caps-label list-group__title" id="utility-events-title">История действий</h2>
          <div className="list-card utility-events">
            {period.events.map((event) => (
              <div className="utility-event" key={event.id}>
                <span>{eventLabels[event.action] ?? event.action}</span>
                <small>{event.actorName} · {new Date(event.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {busy ? <Spinner size={20} aria-label="Сохраняем" /> : null}
    </main>
  );
}

function PeriodEdit({ period, houseId, onSaved, onCancel, notify }: {
  period: UtilityPaymentPeriod;
  houseId: string;
  onSaved: (period: UtilityPaymentPeriod) => void;
  onCancel: () => void;
  notify: (message: string) => void;
}) {
  const [title, setTitle] = useState(period.title);
  const [dueOn, setDueOn] = useState(period.dueOn);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      onSaved(await updateUtilityPaymentPeriod(houseId, period.id, { title, dueOn, version: period.version }));
      notify('Платёж обновлён');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось изменить платёж');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="utility-form list-card" onSubmit={submit}>
      <label className="contact-form__field"><span>Название</span><Input value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="contact-form__field"><span>Срок оплаты</span><Input type="date" value={dueOn} required onChange={(event) => setDueOn(event.target.value)} /></label>
      <div className="utility-form__actions"><Button type="submit" stretched loading={saving}>Сохранить</Button><Button variant="secondary" stretched onClick={onCancel}>Отмена</Button></div>
    </form>
  );
}
