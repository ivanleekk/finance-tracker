import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Select } from './Select';

const FRUIT = [
    'Apple', 'Banana', 'Cherry', 'Dragonfruit', 'Elderberry',
    'Fig', 'Grape', 'Honeydew', 'Kiwi', 'Lemon',
].map(f => ({ value: f.toLowerCase(), label: f }));

const FEW_OPTIONS = FRUIT.slice(0, 3);

describe('Select Component', () => {
    it('opens the listbox and selects an option by click', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Select value="" onChange={onChange} options={FEW_OPTIONS} />);

        await user.click(screen.getByRole('combobox'));
        await user.click(screen.getByRole('option', { name: 'Banana' }));

        expect(onChange).toHaveBeenCalledWith('banana');
    });

    it('does not render a search input for short option lists', async () => {
        const user = userEvent.setup();
        render(<Select value="" onChange={() => {}} options={FEW_OPTIONS} />);

        await user.click(screen.getByRole('combobox'));
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    });

    it('renders a focused search input for long option lists', async () => {
        const user = userEvent.setup();
        render(<Select value="" onChange={() => {}} options={FRUIT} />);

        await user.click(screen.getByRole('combobox'));
        const search = screen.getByRole('searchbox');
        expect(search).toHaveFocus();
    });

    it('respects the explicit searchable prop over the auto threshold', async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <Select value="" onChange={() => {}} options={FEW_OPTIONS} searchable />
        );
        await user.click(screen.getByRole('combobox'));
        expect(screen.getByRole('searchbox')).toBeInTheDocument();

        await user.keyboard('{Escape}');
        rerender(<Select value="" onChange={() => {}} options={FRUIT} searchable={false} />);
        await user.click(screen.getByRole('combobox'));
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    });

    it('filters options as the user types', async () => {
        const user = userEvent.setup();
        render(<Select value="" onChange={() => {}} options={FRUIT} />);

        await user.click(screen.getByRole('combobox'));
        await user.keyboard('berry');

        const listbox = screen.getByRole('listbox');
        const options = within(listbox).getAllByRole('option');
        expect(options).toHaveLength(1);
        expect(options[0]).toHaveTextContent('Elderberry');
    });

    it('filters case-insensitively on substrings', async () => {
        const user = userEvent.setup();
        render(<Select value="" onChange={() => {}} options={FRUIT} />);

        await user.click(screen.getByRole('combobox'));
        await user.keyboard('GRA');

        const listbox = screen.getByRole('listbox');
        expect(within(listbox).getByRole('option', { name: 'Grape' })).toBeInTheDocument();
        expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    });

    it('shows an empty state when nothing matches', async () => {
        const user = userEvent.setup();
        render(<Select value="" onChange={() => {}} options={FRUIT} />);

        await user.click(screen.getByRole('combobox'));
        await user.keyboard('zzz');

        expect(screen.queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByText('No matches')).toBeInTheDocument();
    });

    it('selects the highlighted filtered option with Enter', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Select value="" onChange={onChange} options={FRUIT} />);

        await user.click(screen.getByRole('combobox'));
        await user.keyboard('kiw{Enter}');

        expect(onChange).toHaveBeenCalledWith('kiwi');
    });

    it('navigates the filtered list with arrow keys', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Select value="" onChange={onChange} options={FRUIT} />);

        await user.click(screen.getByRole('combobox'));
        // "e" matches Apple, Cherry, Elderberry, Grape, Honeydew, Lemon
        await user.keyboard('e{ArrowDown}{Enter}');

        expect(onChange).toHaveBeenCalledWith('cherry');
    });

    it('opens and seeds the search when typing on the closed trigger', async () => {
        const user = userEvent.setup();
        render(<Select value="" onChange={() => {}} options={FRUIT} />);

        screen.getByRole('combobox').focus();
        await user.keyboard('f');

        expect(screen.getByRole('searchbox')).toHaveValue('f');
        const listbox = screen.getByRole('listbox');
        // "f" matches Dragonfruit and Fig
        expect(within(listbox).getAllByRole('option')).toHaveLength(2);
    });

    it('clears the search when the dropdown closes', async () => {
        const user = userEvent.setup();
        render(<Select value="" onChange={() => {}} options={FRUIT} />);

        const trigger = screen.getByRole('combobox');
        await user.click(trigger);
        await user.keyboard('berry{Escape}');
        expect(trigger).toHaveFocus();

        await user.click(trigger);
        expect(screen.getByRole('searchbox')).toHaveValue('');
        expect(screen.getAllByRole('option')).toHaveLength(FRUIT.length);
    });

    it('skips disabled options while navigating the filtered list', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const options = [
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Albatross', disabled: true },
            { value: 'c', label: 'Almond' },
        ];
        render(<Select value="" onChange={onChange} options={options} searchable />);

        await user.click(screen.getByRole('combobox'));
        await user.keyboard('al{ArrowDown}{Enter}');

        // Highlight starts on Alpha; ArrowDown skips disabled Albatross
        expect(onChange).toHaveBeenCalledWith('c');
    });

    it('still supports typeahead when search is disabled', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Select value="" onChange={onChange} options={FRUIT} searchable={false} />);

        screen.getByRole('combobox').focus();
        await user.keyboard('g');

        expect(onChange).toHaveBeenCalledWith('grape');
    });
});
