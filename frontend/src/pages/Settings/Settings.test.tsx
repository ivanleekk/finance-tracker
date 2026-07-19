import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import userEvent from '@testing-library/user-event';
import Settings from './Settings';
import { render, setupAuth } from '../../test-utils';

const loaderData = {
    user: {
        id: 'mock-user-1',
        email: 'test@example.com',
        name: 'Test User',
        preferred_timezone: 'UTC',
        theme_mode: 'dark',
        primary_color: 'sky',
        secondary_color: 'fuchsia',
        base_color: 'mauve',
        hide_private_from_household: true,
        default_new_items_private: true,
    },
    currencies: [],
    timezones: [{ name: 'UTC', label: 'UTC' }],
};

describe('Settings Component Integration', () => {
    beforeAll(async () => {
        await setupAuth();
    });

    it('renders the merged settings sections', async () => {
        render(<Settings />, undefined, { loader: () => loaderData });

        await waitFor(() => {
            expect(screen.getByText(/Personal Information/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/Household Preferences/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Security/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Appearance/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Privacy & vault/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Data & connections/i })).toBeInTheDocument();
    });

    it('shows the private vault section without a Face ID toggle', async () => {
        render(<Settings />, undefined, { loader: () => loaderData });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Privacy & vault/i })).toBeInTheDocument();
        });
        await userEvent.click(screen.getByRole('button', { name: /Privacy & vault/i }));

        expect(screen.getByText(/Hide private from household/i)).toBeInTheDocument();
        expect(screen.getByText(/Default new items to Private/i)).toBeInTheDocument();
        expect(screen.queryByText(/Face ID/i)).not.toBeInTheDocument();
    });

    it('shows connections without DBS · SGFinDex', async () => {
        render(<Settings />, undefined, { loader: () => loaderData });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Data & connections/i })).toBeInTheDocument();
        });
        await userEvent.click(screen.getByRole('button', { name: /Data & connections/i }));

        expect(screen.getByText(/IBKR · Flex API/i)).toBeInTheDocument();
        expect(screen.queryByText(/DBS/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/SGFinDex/i)).not.toBeInTheDocument();
    });
});
