import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import Portfolio from './Portfolio';
import { render, setupAuth } from '../../test-utils';

describe('Portfolio Component Integration', () => {
    beforeAll(async () => {
        await setupAuth();
    });

    it('renders the portfolio page layout', async () => {
        render(<Portfolio />);

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Portfolio' })).toBeInTheDocument();
        });
    });

    it('fetches and displays portfolio data sections', async () => {
        const { container } = render(<Portfolio />);

        await waitFor(() => {
            expect(container.textContent).toContain('Overall Growth');
            expect(container.textContent).toMatch(/TWR \((Ann\.|Period)\)/);
            expect(container.textContent).toContain('Sharpe Ratio');
        });
    });
});
