import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HouseRepair, HouseRepairStatus } from '@maxtown/shared';
import { RepairFacts, repairStatusActions } from './RepairModeScreen.tsx';

function repair(status: HouseRepairStatus = 'in_progress'): HouseRepair {
  return {
    id: 'repair-1', houseId: 'house-1', title: 'Замена лифта', description: 'Работы на первом этаже.',
    location: 'Подъезд 1', status, startsAt: '2026-10-01T08:00:00.000Z', expectedCompletionAt: null,
    contractorName: 'ДомСервис', contractorContact: '+7 900 000-00-00',
    residentImpact: 'Лифт временно не работает.', instructions: 'Пользуйтесь лестницей.',
    createdAt: '2026-09-29T08:00:00.000Z', updatedAt: '2026-09-29T08:00:00.000Z',
  };
}

describe('repair work screen presentation', () => {
  it('renders every known field and communicates an unknown expected date', () => {
    const markup = renderToStaticMarkup(createElement(RepairFacts, { repair: repair() }));
    expect(markup).toContain('Подъезд 1');
    expect(markup).toContain('Срок уточняется');
    expect(markup).toContain('ДомСервис');
    expect(markup).toContain('+7 900 000-00-00');
    expect(markup).toContain('Лифт временно не работает.');
    expect(markup).toContain('Пользуйтесь лестницей.');
  });

  it('offers only lifecycle actions allowed for each status, including a reopen action', () => {
    expect(repairStatusActions('planned').map(({ status }) => status)).toEqual(['in_progress', 'cancelled']);
    expect(repairStatusActions('in_progress').map(({ status }) => status)).toEqual(['paused', 'completed', 'cancelled']);
    expect(repairStatusActions('paused').map(({ status }) => status)).toEqual(['in_progress', 'completed', 'cancelled']);
    expect(repairStatusActions('completed')).toEqual([{ status: 'in_progress', label: 'Возобновить' }]);
    expect(repairStatusActions('cancelled')).toEqual([]);
  });
});
