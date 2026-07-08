import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import Goals from './Goals';
import { render, setupAuth } from '../../test-utils';

describe('Goals Component Integration', () => {
    beforeAll(async () => {
        await setupAuth();
    });

    it('renders the goals page shell', async () => {
        render(<Goals />);

        await waitFor(() => {
            expect(screen.getByText(/Track progress toward each milestone/i)).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Goals' })).toBeInTheDocument();
    });
});
