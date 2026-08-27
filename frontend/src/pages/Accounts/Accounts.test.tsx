import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import Accounts from './Accounts';
import { render, setupAuth } from '../../test-utils';

/**
 * Smoke coverage for the Accounts page.
 *
 * Added alongside the split into `accountsHelpers` and `AddAccountModal`. The
 * second test opens the modal because that form used to be inline: it was moved
 * wholesale and rebound to props, and nothing else here would notice if a
 * conditional section stopped rendering.
 */
describe('Accounts page', () => {
    beforeAll(async () => {
        await setupAuth();
    });

    it('renders the page shell', async () => {
        render(<Accounts />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
        });
    });

    it('opens the add-account modal with its form intact', async () => {
        const { container } = render(<Accounts />);

        const cta = await screen.findByRole('button', { name: /Link account/i });
        fireEvent.click(cta);

        await waitFor(() => {
            expect(screen.getByText('Add Manual Account')).toBeInTheDocument();
        });

        // The form's own fields, not just its title: if a section stopped
        // rendering in the move, the modal would still open and look fine.
        expect(container.textContent).toContain('Account Name');
        expect(container.textContent).toMatch(/Currency/i);
        expect(container.textContent).toMatch(/Liquidity|Type/i);
    });
});
