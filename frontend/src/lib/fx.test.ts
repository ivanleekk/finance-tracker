import { describe, expect, it } from 'vitest';
import { formatRate, impliedRate, impliedRateLabel, isForeignCharge } from './fx';

describe('isForeignCharge', () => {
    it('is false when the charge is in the account\'s own currency', () => {
        expect(isForeignCharge('SGD', 'SGD')).toBe(false);
    });

    it('is true only when both currencies are known and differ', () => {
        expect(isForeignCharge('JPY', 'SGD')).toBe(true);
        // An unknown currency on either side is not a foreign charge: it is a
        // form that has not finished loading, and prompting for a converted
        // amount there asks the user to convert into nothing.
        expect(isForeignCharge('JPY', '')).toBe(false);
        expect(isForeignCharge(null, 'SGD')).toBe(false);
    });
});

describe('impliedRate', () => {
    it('is the charged amount over the billed amount, spread included', () => {
        expect(impliedRate(12000, 124.8)).toBeCloseTo(0.0104, 10);
    });

    it('has no answer when either figure is missing or not positive', () => {
        expect(impliedRate(null, 124.8)).toBeNull();
        expect(impliedRate(12000, null)).toBeNull();
        expect(impliedRate(0, 124.8)).toBeNull();
        expect(impliedRate(12000, -5)).toBeNull();
        expect(impliedRate(12000, Number.NaN)).toBeNull();
    });
});

describe('formatRate', () => {
    it('keeps six decimals below 1 and four above, because that is where the information is', () => {
        expect(formatRate(0.0104)).toBe('0.0104');
        expect(formatRate(0.006712)).toBe('0.006712');
        expect(formatRate(149.23)).toBe('149.23');
    });

    it('drops trailing zeros rather than padding a clean rate out', () => {
        expect(formatRate(1.35)).toBe('1.35');
        expect(formatRate(2)).toBe('2');
    });
});

describe('impliedRateLabel', () => {
    it('names both currencies so the direction cannot be misread', () => {
        expect(impliedRateLabel(12000, 124.8, 'JPY', 'SGD')).toBe('1 JPY = 0.0104 SGD');
    });

    it('is empty while there is nothing to show', () => {
        expect(impliedRateLabel(12000, null, 'JPY', 'SGD')).toBe('');
        expect(impliedRateLabel(12000, 124.8, 'JPY', '')).toBe('');
    });
});
