import { describe, it, expect } from 'vitest';
import {
    cardLimitTone,
    headroomLabel,
    cycleLabel,
    headroomByCategory,
    isMeteredCategory,
    limitWindowLabel,
    cardCategoryPickerOptions,
    limitsNeedingAttention,
    limitMeasuresNothing,
} from './cards';
import type { CardLimitStatusRow } from '../types/types';

const row = (over: Partial<CardLimitStatusRow> = {}): CardLimitStatusRow => ({
    limit_id: 'lim-1',
    name: 'Dining cap',
    category_ids: ['cat-1'],
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

    it('names the years when a window crosses into another one', () => {
        expect(cycleLabel('2025-09-14', '2026-09-13', 'en-GB')).toBe('14 Sept 2025 – 13 Sept 2026');
        expect(cycleLabel('2026-12-19', '2027-01-18', 'en-GB')).toBe('19 Dec 2026 – 18 Jan 2027');
    });

    it('does not shift a boundary date across a timezone', () => {
        // Parsing "2026-08-19" as UTC midnight and rendering it west of
        // Greenwich would show the 18th, which is the wrong cycle entirely.
        expect(cycleLabel('2026-08-19', '2026-08-19', 'en-GB')).toBe('19 Aug – 19 Aug');
    });
});

describe('headroomByCategory', () => {
    it('fans a shared limit out over every category counting towards it', () => {
        const map = headroomByCategory({ limits: [row({ category_ids: ['cat-1', 'cat-2'] })] });
        expect(map.get('cat-1')?.map(r => r.limit_id)).toEqual(['lim-1']);
        expect(map.get('cat-2')?.map(r => r.limit_id)).toEqual(['lim-1']);
    });

    it('gives a category every limit it counts towards, in the order the status sent them', () => {
        const map = headroomByCategory({
            limits: [
                row({ limit_id: 'monthly-min', direction: 'floor', category_ids: ['cat-1'] }),
                row({ limit_id: 'annual-cap', category_ids: ['cat-1', 'cat-2'] }),
            ],
        });
        expect(map.get('cat-1')?.map(r => r.limit_id)).toEqual(['monthly-min', 'annual-cap']);
        expect(map.get('cat-2')?.map(r => r.limit_id)).toEqual(['annual-cap']);
    });

    it('gives an unmetered category no entry rather than an empty list', () => {
        // "Tracked but unmetered" and "nothing left" must not look the same.
        const map = headroomByCategory({ limits: [row({ category_ids: ['cat-1'] })] });
        expect(map.has('cat-3')).toBe(false);
        expect(headroomByCategory({ limits: [] }).size).toBe(0);
    });
});

describe('isMeteredCategory', () => {
    const card = {
        limits: [
            { id: 'a', card_id: 'c', name: 'A', amount: '1', direction: 'ceiling' as const, reset_basis: 'cycle' as const, category_ids: ['cat-1'] },
            { id: 'b', card_id: 'c', name: 'B', amount: '1', direction: 'floor' as const, reset_basis: 'year' as const, category_ids: [] },
        ],
    };

    it('is true once any limit counts the category', () => {
        expect(isMeteredCategory(card, 'cat-1')).toBe(true);
    });

    it('is false for a category no limit counts', () => {
        expect(isMeteredCategory(card, 'cat-2')).toBe(false);
    });
});

describe('limitWindowLabel', () => {
    const status = { cycle_start: '2026-08-19', cycle_end: '2026-09-18' };

    it('stays quiet for a limit on the card cycle', () => {
        expect(limitWindowLabel(row(), status)).toBeNull();
    });

    it("labels a limit whose window isn't the cycle", () => {
        expect(
            limitWindowLabel(row({ period_start: '2026-01-01', period_end: '2026-12-31' }), status, 'en-GB')
        ).toBe('1 Jan – 31 Dec');
    });
});

describe('cardCategoryPickerOptions', () => {
    it('states every limit a category counts towards', () => {
        const card = {
            id: 'c', financial_account_id: 'a', account_name: 'Card', currency: 'SGD',
            cycle_basis: 'statement' as const, statement_day: 18, anniversary_date: null, foreign_fee_percent: null,
            categories: [
                { id: 'cat-1', card_id: 'c', name: 'Dining', is_default: true, sort_order: 0 },
                { id: 'cat-2', card_id: 'c', name: 'Travel', is_default: false, sort_order: 1 },
            ],
            limits: [],
        };
        const status = {
            card_id: 'c', account_name: 'Card', currency: 'SGD',
            cycle_start: '2026-08-19', cycle_end: '2026-09-18', categories: [],
            limits: [
                row({ limit_id: 'min', direction: 'floor', remaining: '300', category_ids: ['cat-1'] }),
                row({ limit_id: 'cap', remaining: '11000', category_ids: ['cat-1'] }),
            ],
        };
        const labels = cardCategoryPickerOptions({ card, status }, 'SGD').map(o => o.label);
        expect(labels[1]).toMatch(/^Dining · .*300 to go · .*11,000 left$/);
        expect(labels[2]).toBe('Travel');
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

describe('limitMeasuresNothing', () => {
    it('flags a limit nothing points at', () => {
        // A cap with no categories draws a plausible "0 of $1,000" bar that
        // reads as "nothing spent yet" — the one thing it must not be mistaken
        // for.
        expect(limitMeasuresNothing(row({ category_names: [] }))).toBe(true);
    });

    it('leaves a wired-up limit alone', () => {
        expect(limitMeasuresNothing(row({ category_names: ['Dining'] }))).toBe(false);
    });
});
