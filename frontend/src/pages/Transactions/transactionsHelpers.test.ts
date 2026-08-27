import { describe, it, expect } from 'vitest';
import { emptyTransactionForm, mccSelectOptions } from './transactionsHelpers';
import type { MccResponse } from '../../types/types';

const mcc = (code: string, name: string, is_brand = false, group = 'General'): MccResponse =>
    ({ code, name, group, is_brand });

describe('mccSelectOptions', () => {
    it('keeps the catalogue order and opens with a blank choice', () => {
        const options = mccSelectOptions([mcc('5411', 'Grocery Stores'), mcc('5812', 'Restaurants')]);

        expect(options[0]).toEqual({ value: '', label: '— None —' });
        expect(options.map(o => o.value)).toEqual(['', '5411', '5812']);
    });

    it('heads the brand block once, with a disabled row carrying its group name', () => {
        const options = mccSelectOptions([
            mcc('5411', 'Grocery Stores'),
            mcc('3000', 'UNITED AIRLINES', true, 'Airline, hotel and car rental brands'),
            mcc('3001', 'AMERICAN AIRLINES', true, 'Airline, hotel and car rental brands'),
        ]);

        const header = options.filter(o => o.disabled);
        expect(header).toHaveLength(1);
        expect(header[0].label).toBe('Airline, hotel and car rental brands');

        // Immediately before the first brand, never before a general code.
        const headerIndex = options.findIndex(o => o.disabled);
        expect(options[headerIndex + 1].value).toBe('3000');
        expect(options[headerIndex - 1].value).toBe('5411');
    });

    it('adds no header when the catalogue has no brand rows', () => {
        const options = mccSelectOptions([mcc('5411', 'Grocery Stores')]);
        expect(options.some(o => o.disabled)).toBe(false);
    });

    it('survives an empty catalogue, which is what a failed fetch produces', () => {
        expect(mccSelectOptions([])).toEqual([{ value: '', label: '— None —' }]);
    });
});

describe('emptyTransactionForm', () => {
    it('carries the caller-supplied account and currency', () => {
        const form = emptyTransactionForm('acct-1', 'SGD');
        expect(form.accountId).toBe('acct-1');
        expect(form.currency).toBe('SGD');
    });

    it('blanks every field a submit must not carry over', () => {
        // The reason this factory exists: the initial state and the post-submit
        // reset were two copies of one literal, so a newly added field could be
        // present on open and silently dropped on reset. `mcc` was such a field.
        const form = emptyTransactionForm('acct-1', 'USD');
        expect(form.mcc).toBe('');
        expect(form.categoryId).toBe('');
        expect(form.amount).toBe('');
        expect(form.description).toBe('');
        expect(form.owedBy).toBe('');
        expect(form.owedAmount).toBe('');
    });
});
