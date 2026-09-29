import { describe, expect, it } from 'vitest';
import type { HouseEmergency, HouseEventDetails, HouseSystemState, RequestSummary } from '@maxtown/shared';
import {
  apartmentsCount,
  brokenFirst,
  emergencyDeadline,
  eventEmergency,
  houseSummary,
  knownProblem,
  reportedProblem,
  systemStatusLine,
  withEmergencyUpdate,
  workStatusLabel,
} from './houseState.ts';

const working = (name: string, nextOutage?: HouseSystemState['nextOutage']): HouseSystemState => ({
  name,
  status: 'working',
  nextOutage,
});

const october = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).toISOString();

function problem(title: string, status: RequestSummary['status'] = 'new', overrides: Partial<RequestSummary> = {}): RequestSummary {
  return {
    id: title, number: 1, category: 'Лифты', subcategory: null, title, status, place: 'common-property',
    supportCount: 0, relation: 'none', updatedAt: october(12, 9), ...overrides,
  };
}

describe('houseSummary', () => {
  it('says everything works and mentions the next planned outage', () => {
    expect(houseSummary([working('Вода', { eventId: 'e3', startsAt: october(12, 9), endsAt: october(14, 21) }), working('Лифты')])).toEqual({
      tone: 'positive',
      title: 'Всё работает',
      description: 'Ближайшее Плановое отключение: Вода, 12–14 октября',
    });
    expect(houseSummary([working('Вода'), working('Лифты')]).description).toBe('Все 2 Системы Дома в порядке');
  });

  it('puts an accident first and names the systems', () => {
    expect(
      houseSummary([
        { name: 'Лифты', status: 'accident', eventId: 'e4', since: october(12, 8, 40) },
        { name: 'Вода', status: 'planned-outage', eventId: 'e3' },
        working('Интернет'),
      ]),
    ).toEqual({ tone: 'negative', title: 'Авария: Лифты', description: 'Плановое отключение: Вода' });
  });

  it('с Аварией напоминает и о проблемах Дома', () => {
    expect(houseSummary([{ name: 'Вода', status: 'accident' }], [problem('Не работает лифт')]).description)
      .toBe('Жильцы сообщили ещё о 1 проблеме');
  });

  it('сообщает о проблеме Дома тревожным тоном, пока её не решили', () => {
    expect(houseSummary([working('Лифты')], [problem('Не работает лифт')])).toEqual({
      tone: 'reported',
      title: 'Сообщили о проблеме: Не работает лифт',
      description: 'Ждёт Ответственного',
    });
    expect(houseSummary([working('Лифты')], [problem('Мусор на лестнице', 'in-progress'), problem('Не работает лифт')])).toEqual({
      tone: 'reported',
      title: 'Жильцы сообщили о 2 проблемах',
      description: 'В работе: 1, ждут Ответственного: 1',
    });
  });

  it('reports a planned outage alone and reassures about the rest', () => {
    expect(houseSummary([{ name: 'Вода', status: 'planned-outage' }, working('Лифты')])).toEqual({
      tone: 'attention',
      title: 'Плановое отключение: Вода',
      description: 'Остальные Системы работают',
    });
  });

  it('без данных не утверждает, что всё работает', () => {
    expect(houseSummary([])).toMatchObject({ title: 'Дом подключён' });
  });
});

describe('systemStatusLine', () => {
  it('describes each status for a row', () => {
    const now = new Date(2026, 9, 12, 13);
    expect(systemStatusLine({ name: 'Лифты', status: 'accident', since: october(12, 8, 40) }, now)).toBe('Авария с 08:40');
    expect(systemStatusLine({ name: 'Вода', status: 'planned-outage', until: october(14, 21) }, now)).toBe(
      'Плановое отключение до 14 октября',
    );
    expect(systemStatusLine({ name: 'Лифты', status: 'reported' }, now)).toBe('Сообщили о неполадке');
    expect(systemStatusLine(working('Вода', { eventId: 'e3', startsAt: october(12, 9), endsAt: october(14, 21) }), now)).toBe(
      'Работает. Отключение 12–⁠14 октября',
    );
    expect(systemStatusLine(working('Свет'), now)).toBe('Работает');
  });
});

describe('brokenFirst', () => {
  it('puts accidents, reported problems, planned outages, then working systems', () => {
    const order = brokenFirst([
      working('Свет'),
      { name: 'Вода', status: 'planned-outage' },
      { name: 'Интернет', status: 'reported' },
      { name: 'Лифты', status: 'accident' },
      working('Отопление'),
    ]).map(({ name }) => name);
    expect(order).toEqual(['Лифты', 'Интернет', 'Вода', 'Свет', 'Отопление']);
  });
});

describe('knownProblem и reportedProblem', () => {
  const state = {
    systems: [working('Электричество'), { name: 'Лифты', status: 'accident' as const, eventId: 'e4' }, { name: 'Вода', status: 'reported' as const, requestId: 'r1' }],
    problems: [
      problem('Нет воды в стояке', 'new', { category: 'Вода', subcategory: 'no-water' }),
      problem('Мой лифт', 'new', { subcategory: 'lift-stopped', relation: 'author' }),
      problem('Лифт стоит', 'new', { subcategory: 'lift-stopped' }),
    ],
  };

  it('finds an open accident on the chosen system', () => {
    expect(knownProblem(state, 'Лифты')?.eventId).toBe('e4');
  });

  it('stays quiet for working systems, reported ones, categories without a system and guests', () => {
    expect(knownProblem(state, 'Электричество')).toBeNull();
    expect(knownProblem(state, 'Вода')).toBeNull();
    expect(knownProblem(state, 'Сантехника')).toBeNull();
    expect(knownProblem(null, 'Лифты')).toBeNull();
    expect(knownProblem(state, null)).toBeNull();
  });

  it('предлагает «У меня тоже» на чужую проблему той же Категории и подкатегории, но не на свою', () => {
    expect(reportedProblem(state, 'Вода', 'no-water')?.title).toBe('Нет воды в стояке');
    expect(reportedProblem(state, 'Лифты', 'lift-stopped')?.title).toBe('Лифт стоит');
    // Другая поломка того же лифта — не повод для «У меня тоже».
    expect(reportedProblem(state, 'Лифты', 'lift-doors')).toBeNull();
    // Пока подкатегория не выбрана, не угадываем.
    expect(reportedProblem(state, 'Вода')).toBeNull();
    expect(reportedProblem(state, 'Уборка', 'bins')).toBeNull();
  });
});

describe('режим ЧС', () => {
  const emergency = (overrides: Partial<HouseEmergency> = {}): HouseEmergency => ({
    id: 'a1', title: 'Нет холодной воды', system: 'Вода', openedAt: october(12, 8, 40),
    workStatus: 'repairing', confirmedApartments: 38, deadlineRevised: true,
    confirmedByMe: false, canConfirm: true, canWithdraw: false,
    expectedResolutionAt: october(14, 18),
    ...overrides,
  });

  const accident = (overrides: Partial<HouseEventDetails> = {}): HouseEventDetails => ({
    id: 'a1', kind: 'accident', title: 'Нет холодной воды', startsAt: october(12, 8, 40), endsAt: october(15, 12),
    description: 'Прорыв на вводе', systems: ['Вода'], advice: [],
    emergency: { workStatus: 'repairing', confirmedApartments: 39, deadlineRevised: true, confirmedByMe: true, canConfirm: false, canWithdraw: true },
    ...overrides,
  });

  it('считает квартиры, а не людей; число не отрывается от слова', () => {
    expect(apartmentsCount(1)).toBe('1\u00a0квартира');
    expect(apartmentsCount(3)).toBe('3\u00a0квартиры');
    expect(apartmentsCount(11)).toBe('11\u00a0квартир');
    expect(apartmentsCount(21)).toBe('21\u00a0квартира');
    expect(apartmentsCount(38)).toBe('38\u00a0квартир');
  });

  it('пишет статус работ и срок, перенесённый срок — «Новый срок»', () => {
    expect(workStatusLabel('repairing')).toBe('аварийные работы');
    expect(workStatusLabel('checking')).toBe('выясняют причину');
    expect(emergencyDeadline(emergency())).toEqual({ label: 'Новый срок', value: 'до 14 октября, 18:00' });
    expect(emergencyDeadline(emergency({ deadlineRevised: false }))).toEqual({ label: 'Срок', value: 'до 14 октября, 18:00' });
    expect(emergencyDeadline(emergency({ expectedResolutionAt: undefined }))).toEqual({ label: 'Срок', value: 'уточняется' });
  });

  it('сводка при Аварии — что случилось и что с работами, а не «N человек пожаловались»', () => {
    const systems: HouseSystemState[] = [{ name: 'Вода', status: 'accident', eventId: 'a1' }, working('Лифты')];
    expect(houseSummary(systems, [problem('Мусор на лестнице')], [emergency()])).toEqual({
      tone: 'negative',
      title: 'Нет холодной воды',
      description: 'Аварийные работы, до\u00a014\u00a0октября,\u00a018:00',
    });
    expect(houseSummary(systems, [], [emergency({ workStatus: 'checking', expectedResolutionAt: undefined })]).description)
      .toBe('Выясняют причину, срок уточняется');
    expect(houseSummary(systems, [], [emergency(), emergency({ id: 'a2', title: 'Не работает лифт', system: 'Лифты' })])).toEqual({
      tone: 'negative',
      title: 'Аварии: Нет холодной воды, Не работает лифт',
      description: 'Подробности — в Состоянии дома',
    });
  });

  it('панель в карточке Аварии: срок из События, у закрытой Аварии панели нет', () => {
    expect(eventEmergency(accident())).toEqual({
      workStatus: 'repairing', confirmedApartments: 39, deadlineRevised: true, confirmedByMe: true, canConfirm: false, canWithdraw: true,
      title: 'Нет холодной воды', system: 'Вода', expectedResolutionAt: october(15, 12),
    });
    expect(eventEmergency(accident({ endsAt: undefined }))).not.toHaveProperty('expectedResolutionAt');
    expect(eventEmergency(accident({ resolvedAt: october(14, 12) }))).toBeNull();
    expect(eventEmergency(accident({ emergency: undefined }))).toBeNull();
  });

  it('ответ на «У меня тоже» обновляет свою Аварию, закрытая уходит из Состояния дома', () => {
    const lift = emergency({ id: 'a2', title: 'Не работает лифт', system: 'Лифты' });
    const state = { updatedAt: october(12, 9), emergencies: [emergency(), lift] };

    const confirmed = withEmergencyUpdate(state, accident());
    expect(confirmed.updatedAt).toBe(october(12, 9));
    expect(confirmed.emergencies[0]).toMatchObject({
      id: 'a1', openedAt: october(12, 8, 40), confirmedApartments: 39, confirmedByMe: true, expectedResolutionAt: october(15, 12),
    });
    expect(confirmed.emergencies[1]).toBe(lift);

    expect(withEmergencyUpdate(state, accident({ endsAt: undefined })).emergencies[0]).not.toHaveProperty('expectedResolutionAt');
    expect(withEmergencyUpdate(state, accident({ resolvedAt: october(14, 12) })).emergencies).toEqual([lift]);
  });
});
