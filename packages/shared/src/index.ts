// Контракты, общие для фронтендов и бэкенда. Доменные типы (заявки, статусы дома)
// появятся здесь по мере того, как их зафиксирует CONTEXT.md.

export type HealthResponse = {
  status: 'ok';
};

/**
 * Состояние Заявки по CONTEXT.md: новая, в работе, Выполненная (ждёт подтверждения
 * Жильца), Закрытая, Отклонённая Ответственным, Отменённая самим Жильцом.
 */
export type RequestStatus = 'new' | 'in-progress' | 'done' | 'closed' | 'rejected' | 'cancelled';

/** Строка Заявки в списке. */
export type RequestSummary = {
  id: string;
  number: number;
  category: string;
  title: string;
  status: RequestStatus;
  /** ISO 8601. */
  updatedAt: string;
};

/** Событие дома: Авария, Плановое отключение или Объявление. */
export type HouseEventKind = 'accident' | 'planned-outage' | 'announcement';

/** Строка События дома в списке. */
export type HouseEventSummary = {
  id: string;
  kind: HouseEventKind;
  title: string;
  /** Готовая подпись периода или времени: «12–14 октября», «с 08:40». */
  period: string;
};
