import { describe, it, expect } from 'vitest';
import { cardUpdateBody, resetOptions } from './cardForms';

describe('resetOptions', () => {
    it('offers the card year and quarter only once there is an anniversary', () => {
        const without = resetOptions(false);
        const cardYear = without.find(o => o.value === 'card_year');
        expect(cardYear?.disabled).toBe(true);
        expect(String(cardYear?.label)).toMatch(/anniversary first/i);

        const withDate = resetOptions(true);
        expect(withDate.find(o => o.value === 'card_year')?.disabled).toBeFalsy();
        expect(withDate.find(o => o.value === 'card_quarter')?.disabled).toBeFalsy();
    });

    it('keeps every calendar basis available regardless', () => {
        const values = resetOptions(false).filter(o => !o.disabled).map(o => o.value);
        expect(values).toEqual(['cycle', 'calendar_month', 'quarter', 'year']);
    });
});

describe('cardUpdateBody', () => {
    const form = (entries: Record<string, string>) => {
        const fd = new FormData();
        Object.entries(entries).forEach(([k, v]) => fd.append(k, v));
        return fd;
    };

    it('sends the anniversary the user picked', () => {
        expect(cardUpdateBody(form({ cycle_basis: 'statement', statement_day: '18', anniversary_date: '2024-03-14' })))
            .toEqual({ cycle_basis: 'statement', statement_day: 18, anniversary_date: '2024-03-14', foreign_fee_percent: null });
    });

    it('sends an explicit null for a cleared date, which is what clears it', () => {
        const body = cardUpdateBody(form({ cycle_basis: 'statement', statement_day: '18', anniversary_date: '' }));
        expect(body).toHaveProperty('anniversary_date', null);
    });

    it('leaves the statement day out when a calendar card hides the field', () => {
        const body = cardUpdateBody(form({ cycle_basis: 'calendar', anniversary_date: '' }));
        expect(body).not.toHaveProperty('statement_day');
    });

    it('also leaves the statement day out when a statement card clears its visible field, preserving the existing value', () => {
        const body = cardUpdateBody(form({ cycle_basis: 'statement', statement_day: '', anniversary_date: '' }));
        expect(body).not.toHaveProperty('statement_day');
    });
    it("states the foreign fee every time, so clearing the field clears the card's default", () => {
        expect(cardUpdateBody(form({ cycle_basis: 'statement', statement_day: '18', anniversary_date: '', foreign_fee_percent: '3.25' })))
            .toHaveProperty('foreign_fee_percent', 3.25);
        expect(cardUpdateBody(form({ cycle_basis: 'statement', statement_day: '18', anniversary_date: '', foreign_fee_percent: '' })))
            .toHaveProperty('foreign_fee_percent', null);
    });
});
