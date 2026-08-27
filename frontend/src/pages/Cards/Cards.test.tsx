import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Cards from './Cards';
import { render } from '../../test-utils';
import type { CardsLoaderData } from './cards.loader';

/**
 * Rendering coverage for the Cards page.
 *
 * The maths is tested in `lib/cards.test.ts`; what this pins is that a ceiling
 * and a floor reach the screen as *different* statements. Rendering both as
 * "$X left" would be a plausible-looking bug that no unit test of the helpers
 * would catch, because the helpers would still be right.
 */

const loaderData = (): CardsLoaderData => ({
    cards: [
        {
            id: 'card-1',
            financial_account_id: 'acc-1',
            account_name: 'Amex Platinum',
            currency: 'SGD',
            cycle_basis: 'statement',
            statement_day: 18,
            categories: [
                { id: 'cc-1', card_id: 'card-1', name: 'Dining', is_default: true, sort_order: 0, limit_id: 'lim-cap' },
                { id: 'cc-2', card_id: 'card-1', name: 'Everything else', is_default: false, sort_order: 1, limit_id: 'lim-min' },
            ],
            limits: [
                { id: 'lim-cap', card_id: 'card-1', name: 'Dining cap', amount: '1000', direction: 'ceiling', reset_basis: 'cycle' },
                { id: 'lim-min', card_id: 'card-1', name: 'Fee waiver', amount: '800', direction: 'floor', reset_basis: 'cycle' },
            ],
        },
    ],
    statuses: {
        'card-1': {
            card_id: 'card-1',
            account_name: 'Amex Platinum',
            currency: 'SGD',
            cycle_start: '2026-08-19',
            cycle_end: '2026-09-18',
            limits: [
                {
                    limit_id: 'lim-cap',
                    name: 'Dining cap',
                    category_names: ['Dining'],
                    direction: 'ceiling',
                    amount: '1000',
                    spent: '775',
                    remaining: '225',
                    percent_used: 77.5,
                    period_start: '2026-08-19',
                    period_end: '2026-09-18',
                    days_elapsed: 9,
                    days_total: 31,
                    projected_spend: '2669',
                    projected_missed: true,
                    settled: false,
                },
                {
                    limit_id: 'lim-min',
                    name: 'Fee waiver',
                    category_names: ['Everything else'],
                    direction: 'floor',
                    amount: '800',
                    spent: '0',
                    remaining: '800',
                    percent_used: 0,
                    period_start: '2026-08-19',
                    period_end: '2026-09-18',
                    days_elapsed: 9,
                    days_total: 31,
                    projected_spend: '0',
                    projected_missed: true,
                    settled: false,
                },
            ],
            categories: [
                { card_category_id: 'cc-1', name: 'Dining', spent: '775' },
                { card_category_id: 'cc-2', name: 'Everything else', spent: '0' },
            ],
        },
    },
    availableAccounts: [],
});

describe('Cards page', () => {
    it('renders a cap counting down and a minimum counting up', async () => {
        const { container } = render(<Cards />, undefined, { loader: loaderData });

        await waitFor(() => {
            expect(screen.getByText('Amex Platinum')).toBeInTheDocument();
        });

        // The two directions must not read the same. "left" is headroom to
        // protect; "to go" is a shortfall to close.
        expect(container.textContent).toContain('225 left');
        expect(container.textContent).toContain('800 to go');
    });

    it('shows the cycle window rather than a calendar month', async () => {
        const { container } = render(<Cards />, undefined, { loader: loaderData });

        await waitFor(() => {
            expect(screen.getByText('Amex Platinum')).toBeInTheDocument();
        });
        // A card closing on the 18th does not have a calendar "month", and
        // showing one would misrepresent every number on the card. Asserted on
        // the parts rather than the whole string, because the page formats in
        // the viewer's locale ("Aug 19" or "19 Aug" depending on where they are).
        expect(container.textContent).toMatch(/Aug\s*19|19\s*Aug/);
        expect(container.textContent).toMatch(/Sept?\s*18|18\s*Sept?/);
    });

    it('warns about the pace in the direction each limit cares about', async () => {
        const { container } = render(<Cards />, undefined, { loader: loaderData });

        await waitFor(() => {
            expect(screen.getByText('Amex Platinum')).toBeInTheDocument();
        });
        expect(container.textContent).toContain('by the end of the cycle');
        expect(container.textContent).toContain('short of the minimum');
    });

    it('offers setup guidance when there are no cards at all', async () => {
        const empty = (): CardsLoaderData => ({ cards: [], statuses: {}, availableAccounts: [] });
        const { container } = render(<Cards />, undefined, { loader: empty });

        await waitFor(() => {
            expect(screen.getByText('No cards set up yet.')).toBeInTheDocument();
        });
        expect(container.textContent).toContain('liability account');
    });
});
