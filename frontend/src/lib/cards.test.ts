import { describe, it, expect } from 'vitest';
import {
    cardLimitTone,
    headroomLabel,
    cycleLabel,
    headroomByCategory,
    limitsNeedingAttention,
} from './cards';
import type { CardLimitStatusRow } from '../types/types';

const row = (over: Partial<CardLimitStatusRow> = {}): CardLimitStatusRow => ({
    limit_id: 'lim-1',
    name: 'Dining cap',
    category_names: ['Dining'],
    direction: 'ceiling',
    amount: '1000',
    spent: '240',
    remaining: '760',
    percent_used: 24,
    period_start: '2026-08-19',
    period_end: '2026-09-18',
    days_elapsed: 18,
    days_total: 31,
    projected_spend: '413',
    projected_missed: false,
    settled: false,
    ...over,
});

const money = (v: number) => `$${v.toFixed(0)}`;

describe('cardLimitTone', () => {
    it('reads a comfortable cap as ok', () => {
        expect(cardLimitTone(row())).toBe('ok');
    });

    it('warns before the cap is actually burst', () => {
        // The whole point of the projection: telling someone on the last day is
        // useless.
        expect(cardLimitTone(row({ projected_missed: true }))).toBe('at-risk');
    });

    it('reads a burst cap as over', () => {
        expect(cardLimitTone(row({ settled: true }))).toBe('over');
    });

    it('never reads a minimum spend as over — reaching it is the goal', () => {
        // Same `settled` flag, opposite meaning. A met minimum is a success and
        // must not render in the same red as a burst cap.
        expect(cardLimitTone(row({ direction: 'floor', settled: true }))).toBe('ok');
    });

    it('warns when a minimum is on pace to be missed', () => {
        expect(
            cardLimitTone(row({ direction: 'floor', settled: false, projected_missed: true }))
        ).toBe('at-risk');
    });
});

describe('headroomLabel', () => {
    it('counts down for a cap', () => {
        expect(headroomLabel(row({ remaining: '240' }), money)).toBe('$240 left');
    });

    it('counts up for a minimum', () => {
        expect(
            headroomLabel(row({ direction: 'floor', remaining: '120' }), money)
        ).toBe('$120 to go');
    });

    it('says which thing happened when the number is reached', () => {
        expect(headroomLabel(row({ settled: true }), money)).toBe('Cap reached');
        expect(headroomLabel(row({ direction: 'floor', settled: true }), money)).toBe(
            'Minimum met'
        );
    });
});

describe('cycleLabel', () => {
    it('renders the window as calendar dates', () => {
        // Asserted loosely on the month: ICU abbreviates September as "Sep" or
        // "Sept" depending on version, and pinning one would fail on CI rather
        // than catch a real bug. The day numbers are the part that matters.
        const label = cycleLabel('2026-08-19', '2026-09-18', 'en-GB');
        expect(label.startsWith('19 Aug')).toBe(true);
        expect(label).toContain(' – ');
        expect(label).toContain('18 Sep');
    });

    it('does not shift a boundary date across a timezone', () => {
        // Parsing "2026-08-19" as UTC midnight and rendering it west of
        // Greenwich would show the 18th, which is the wrong cycle entirely.
        expect(cycleLabel('2026-08-19', '2026-08-19', 'en-GB')).toBe('19 Aug – 19 Aug');
    });
});

describe('headroomByCategory', () => {
    const card = {
        categories: [
            { id: 'cat-1', card_id: 'c', name: 'Dining', is_default: true, sort_order: 0, limit_id: 'lim-1' },
            { id: 'cat-2', card_id: 'c', name: 'Groceries', is_default: false, sort_order: 1, limit_id: 'lim-1' },
            { id: 'cat-3', card_id: 'c', name: 'Everything else', is_default: false, sort_order: 2, limit_id: null },
        ],
    };

    it('fans a shared limit out over every category drawing on it', () => {
        const map = headroomByCategory(card, { limits: [row()] });
        expect(map.get('cat-1')?.limit_id).toBe('lim-1');
        expect(map.get('cat-2')?.limit_id).toBe('lim-1');
    });

    it('gives an unmetered category no entry rather than a zero', () => {
        // "Tracked but unmetered" and "nothing left" must not look the same.
        const map = headroomByCategory(card, { limits: [row()] });
        expect(map.has('cat-3')).toBe(false);
    });

    it('omits a category whose limit is missing from the status payload', () => {
        const map = headroomByCategory(card, { limits: [] });
        expect(map.size).toBe(0);
    });
});

describe('limitsNeedingAttention', () => {
    it('keeps only what is worth interrupting someone about', () => {
        const rows = [
            row({ limit_id: 'ok' }),
            row({ limit_id: 'risk', projected_missed: true }),
            row({ limit_id: 'burst', settled: true }),
        ];
        expect(limitsNeedingAttention(rows).map(r => r.limit_id)).toEqual(['risk', 'burst']);
    });

    it('is empty when everything is fine, so the Dashboard shows nothing', () => {
        expect(limitsNeedingAttention([row(), row()])).toEqual([]);
    });
});
