import { describe, expect, it } from 'vitest';
import { addMonths, dueDateForMonth, houseDate, reminderTypeFor, utilityPaymentState } from './model.ts';
import { detectUtilityPaymentReceiptType } from './store.ts';

describe('utility payment calendar', () => {
  it('clamps long due days to the end of short months', () => {
    expect(dueDateForMonth('2028-02-01', 31)).toBe('2028-02-29');
    expect(dueDateForMonth('2027-02-01', 29)).toBe('2027-02-28');
    expect(dueDateForMonth('2026-04-01', 31)).toBe('2026-04-30');
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(() => dueDateForMonth('2026-13-01', 10)).toThrow('invalid_date');
  });

  it('computes visible states without claiming a debt', () => {
    const base = { dueOn: '2026-10-10', paidAt: null, skippedAt: null };
    expect(utilityPaymentState({ ...base, today: '2026-10-06' })).toBe('upcoming');
    expect(utilityPaymentState({ ...base, today: '2026-10-07' })).toBe('due-soon');
    expect(utilityPaymentState({ ...base, today: '2026-10-10' })).toBe('due-today');
    expect(utilityPaymentState({ ...base, today: '2026-10-11' })).toBe('overdue');
    expect(utilityPaymentState({ ...base, today: '2026-10-11', paidAt: new Date() })).toBe('paid');
    expect(utilityPaymentState({ ...base, today: '2026-10-11', skippedAt: new Date() })).toBe('skipped');
  });

  it('uses the House timezone and sends only the three scheduled phases', () => {
    const createdAt = new Date('2026-10-01T08:00:00Z');
    expect(houseDate(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10-01');
    expect(reminderTypeFor({ dueOn: '2026-10-10', createdAt, now: new Date('2026-10-07T05:59:00Z') })).toBeNull();
    expect(reminderTypeFor({ dueOn: '2026-10-10', createdAt, now: new Date('2026-10-07T06:00:00Z') })).toBe('three-days');
    expect(reminderTypeFor({ dueOn: '2026-10-10', createdAt, now: new Date('2026-10-10T07:00:00Z') })).toBe('due-today');
    expect(reminderTypeFor({ dueOn: '2026-10-10', createdAt, now: new Date('2026-10-11T07:00:00Z') })).toBe('overdue-once');
    expect(reminderTypeFor({ dueOn: '2026-10-10', createdAt, now: new Date('2026-10-12T07:00:00Z') })).toBeNull();
    expect(reminderTypeFor({ dueOn: '2026-10-10', createdAt: new Date('2026-10-10T07:00:00Z'), now: new Date('2026-10-10T08:00:00Z') })).toBeNull();
  });
});

describe('utility payment receipts', () => {
  it('detects supported files by content instead of the request header', () => {
    expect(detectUtilityPaymentReceiptType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(detectUtilityPaymentReceiptType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectUtilityPaymentReceiptType(Buffer.from('not a receipt'))).toBeNull();
  });
});
