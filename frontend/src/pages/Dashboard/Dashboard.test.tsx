import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import Dashboard from './Dashboard';
import { render, setupAuth } from '../../test-utils';

describe('Dashboard Component Integration', () => {
    beforeAll(async () => {
        await setupAuth();
    });

    it('renders the dashboard page and shows initial state', async () => {
        render(<Dashboard />);

        await waitFor(() => {
            // Dashboard doesn't show "Total Net Worth", it shows "Net Worth Trend" and metric cards like "Overall Return"
            expect(screen.getByText(/Net Worth Trend/i)).toBeInTheDocument();
        });
    });

    it('fetches and displays dashboard data layout', async () => {
        render(<Dashboard />);

        await waitFor(() => {
            expect(screen.getByText(/Financial Goals/i)).toBeInTheDocument();
            expect(screen.getByText(/Recent Activity/i)).toBeInTheDocument();
        });

        const cardTitles = screen.getAllByRole('heading');
        expect(cardTitles.length).toBeGreaterThan(0);
    });
});
