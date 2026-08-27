import { waitFor, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { CommandBar } from './CommandBar';
import { CommandBarProvider, useCommandBar } from '../../lib/CommandBarContext';
import { render, setupAuth } from '../../test-utils';

/**
 * Smoke coverage for the ⌘K command bar.
 *
 * Added when its ten view components moved to `CommandBarViews.tsx`. The bar
 * renders nothing until it is opened, so the harness below opens it through the
 * context rather than simulating the shortcut — the point of the test is which
 * view the container switches to, not the key handling.
 */
function OpenOnMount() {
    const { open } = useCommandBar();
    useEffect(() => { open(); }, [open]);
    return null;
}

const renderOpen = () =>
    render(
        <CommandBarProvider>
            <OpenOnMount />
            <CommandBar />
        </CommandBarProvider>,
    );

describe('CommandBar', () => {
    beforeAll(async () => {
        await setupAuth();
    });

    it('renders once opened', async () => {
        const { container } = renderOpen();
        await waitFor(() => {
            expect(container.querySelector('input')).toBeTruthy();
        });
    });

    it('switches view as the command changes shape', async () => {
        const { container } = renderOpen();

        const input = await waitFor(() => {
            const el = container.querySelector('input');
            if (!el) throw new Error('command input not rendered');
            return el;
        });

        // A trade and an expense render different views; if the container lost
        // its binding to either, one of these stops changing the preview.
        // The trade view is the one with a Quantity field; the expense view has
        // no such thing. Asserting both directions means the test fails whether
        // the container stopped switching or switched to the wrong view.
        fireEvent.change(input, { target: { value: 'buy 10 VOO' } });
        await waitFor(() => expect(container.textContent).toMatch(/Quantity/i));

        fireEvent.change(input, { target: { value: 'coffee 5.20' } });
        await waitFor(() => expect(container.textContent).not.toMatch(/Quantity/i));
    });
});
