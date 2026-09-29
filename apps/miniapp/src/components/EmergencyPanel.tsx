import { useId } from 'react';
import { CaretRight, CheckCircle, Warning } from '@phosphor-icons/react';
import { meTooLabel } from '@maxtown/shared/requests';
import { Button, Typography } from './platform-ui.tsx';
import { apartmentsCount, emergencyDeadline, workStatusLabel, type EmergencyView } from '../data/houseState.ts';

// Режим ЧС (docs/adr/0012): при открытой Аварии Жилец видит, что случилось,
// сколько квартир подтвердили проблему, что с работами и когда устранят, —
// и одной кнопкой говорит «у меня тоже» вместо звонка в УК.

type EmergencyPanelProps = {
  emergency: EmergencyView;
  /** В карточке Аварии заголовок уже в шапке экрана: панель без него. */
  headless?: boolean;
  busy?: boolean;
  /** Поставить (true) или снять (false) отметку «У меня тоже». */
  onConfirm?: (confirmed: boolean) => void;
  /** Открыть карточку Аварии. */
  onOpen?: () => void;
};

export function EmergencyPanel({ emergency, headless = false, busy = false, onConfirm, onOpen }: EmergencyPanelProps) {
  const titleId = useId();
  const deadline = emergencyDeadline(emergency);
  const { canConfirm, canWithdraw, confirmedByMe } = emergency;
  const labelled = headless ? { 'aria-label': 'Что с Аварией сейчас' } : { 'aria-labelledby': titleId };

  return (
    <section className={`emergency-panel${headless ? ' emergency-panel--headless' : ''}`} {...labelled}>
      {headless ? null : (
        <header className="emergency-panel__head">
          <span className="emergency-panel__badge">
            <Warning className="icon icon--small" weight="fill" aria-hidden />
            {emergency.system ? `Авария · ${emergency.system}` : 'Авария'}
          </span>
          <Typography.Text asChild variant="subheader">
            <h2 id={titleId}>{emergency.title}</h2>
          </Typography.Text>
        </header>
      )}

      <dl className="emergency-panel__facts">
        <div className="emergency-panel__fact">
          <dt>Подтвердили проблему</dt>
          <dd className="tabular">{apartmentsCount(emergency.confirmedApartments)}</dd>
        </div>
        <div className="emergency-panel__fact">
          <dt>Статус</dt>
          <dd className={`emergency-panel__status emergency-panel__status--${emergency.workStatus}`}>
            {workStatusLabel(emergency.workStatus)}
          </dd>
        </div>
        <div className="emergency-panel__fact">
          <dt>{deadline.label}</dt>
          <dd className="tabular">{deadline.value}</dd>
        </div>
      </dl>

      {confirmedByMe ? (
        <p className="emergency-panel__mine">
          <CheckCircle className="icon icon--small" weight="fill" aria-hidden />
          <Typography.Text asChild variant="description" color="secondary">
            <span>
              {canWithdraw
                ? 'Вы отметили, что у вас тоже. Уведомим, когда устранят'
                : 'Вы уже сообщили об этой проблеме. Уведомим, когда устранят'}
            </span>
          </Typography.Text>
        </p>
      ) : null}

      {/*
        Одна кнопка на оба действия: после нажатия фокус остаётся на ней.
        Обёртка — чтобы растянутая кнопка VKUI (flex-basis: 0) росла под
        подпись в две строки, а не держала высоту одной.
      */}
      {onConfirm && (canConfirm || canWithdraw) ? (
        <div className="emergency-panel__action">
          <Button
            size="large"
            variant={canConfirm ? 'primary' : 'ghost'}
            stretched
            loading={busy}
            onClick={() => onConfirm(canConfirm)}
          >
            {canConfirm ? meTooLabel(emergency.system) : 'Убрать отметку'}
          </Button>
        </div>
      ) : null}

      {canConfirm && onConfirm ? (
        <Typography.Text asChild variant="description" color="secondary">
          <p className="emergency-panel__hint">Заявку подавать не нужно. Уведомим, когда устранят</p>
        </Typography.Text>
      ) : null}

      {onOpen ? (
        <button className="emergency-panel__more pressable" type="button" onClick={onOpen}>
          Подробнее об Аварии
          <CaretRight className="icon icon--small" aria-hidden />
        </button>
      ) : null}
    </section>
  );
}
