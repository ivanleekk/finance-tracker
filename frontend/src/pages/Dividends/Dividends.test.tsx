import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import Dividends from './Dividends';
import { render, setupAuth } from '../../test-utils';

describe('Dividends Component Integration', () => {
    beforeAll(async () => {
        await setupAuth();
    });

    it('renders the dividends page shell', async () => {
        render(<Dividends />);

        await waitFor(() => {
            expect(screen.getByText(/Income by month/i)).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: /Upcoming/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /Per-holding yield/i })).toBeInTheDocument();
    });
});
