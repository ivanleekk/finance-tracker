import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import Settings from './Settings';
import { render, setupAuth } from '../../test-utils';

describe('Settings Component Integration', () => {
    beforeAll(async () => {
        await setupAuth();
    });

    it('renders the settings page sections', async () => {
        render(<Settings />, undefined, {
            loader: () => ({
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
                    require_face_id_for_vault: true,
                    default_new_items_private: true,
                },
                currencies: [],
                transactions: [],
                trades: [],
            }),
        });

        await waitFor(() => {
            expect(screen.getByText(/Private vault/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/Currency & FX/i)).toBeInTheDocument();
        expect(screen.getByText(/Connections & data/i)).toBeInTheDocument();
    });
});
