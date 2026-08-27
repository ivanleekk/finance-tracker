import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import Transactions from './Transactions';
import { render, setupAuth } from '../../test-utils';

/**
 * Smoke coverage for the Transactions page.
 *
 * Added when the page was split into `useTransactionHistory`, the
 * `LogTransactionDialog` and `transactionsHelpers` — a refactor that moves a lot
 * of JSX and rebinds a couple of dozen props, none of which a type-check can
 * prove still renders. Opening the dialog is the point of the second test: that
 * markup used to be inline, and a mis-wired prop would only show up here.
 */
describe('Transactions page', () => {
    beforeAll(async () => {
        await setupAuth();
    });

    it('renders the page shell', async () => {
        render(<Transactions />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Transactions' })).toBeInTheDocument();
        });
    });

    it('opens the log/transfer dialog with both tabs wired up', async () => {
        const { container } = render(<Transactions />);

        const cta = await screen.findByRole('button', { name: /Log Transaction/i });
        fireEvent.click(cta);

        await waitFor(() => {
            expect(screen.getByText('Log Daily Transaction')).toBeInTheDocument();
        });

        // The tab switcher drives the whole dialog body; if the callback lost its
        // binding in the extraction, the heading below never changes.
        fireEvent.click(screen.getByRole('button', { name: 'Transfer' }));
        await waitFor(() => {
            expect(container.textContent).toContain('Internal Transfer');
        });
    });
});
