import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './Button';

describe('Button Component', () => {
    it('renders with default props', () => {
        render(<Button>Click me</Button>);
        const button = screen.getByRole('button', { name: /click me/i });
        expect(button).toBeInTheDocument();
        // Should have default primary variant class
        expect(button).toHaveClass('bg-primary-500');
    });

    it('renders different variants', () => {
        const { rerender } = render(<Button variant="secondary">Secondary</Button>);
        expect(screen.getByRole('button', { name: /secondary/i })).toHaveClass('border-primary-200');

        rerender(<Button variant="ghost">Ghost</Button>);
        expect(screen.getByRole('button', { name: /ghost/i })).toHaveClass('text-base-700');

        rerender(<Button variant="danger">Danger</Button>);
        expect(screen.getByRole('button', { name: /danger/i })).toHaveClass('bg-red-500');
    });

    it('renders different sizes', () => {
        const { rerender } = render(<Button size="sm">Small</Button>);
        expect(screen.getByRole('button', { name: /small/i })).toHaveClass('min-h-[44px] sm:min-h-8 px-3 text-sm');

        rerender(<Button size="lg">Large</Button>);
        expect(screen.getByRole('button', { name: /large/i })).toHaveClass('py-2 min-h-[44px] sm:min-h-12 px-8 text-lg');
    });

    it('applies disabled styles and cannot be clicked when disabled', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        render(<Button disabled onClick={onClick}>Disabled</Button>);
        const button = screen.getByRole('button', { name: /disabled/i });

        expect(button).toBeDisabled();
        expect(button).toHaveClass('disabled:opacity-50');

        await user.click(button);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('handles interactions like focus correctly', async () => {
        const user = userEvent.setup();
        render(<Button>Interactive</Button>);
        const button = screen.getByRole('button', { name: /interactive/i });

        await user.tab();
        expect(button).toHaveFocus();
        expect(button).toHaveClass('focus-visible:ring-2');
    });

    it('applies hover classes (simulated)', async () => {
        const user = userEvent.setup();
        render(<Button variant="primary">Hover Me</Button>);
        const button = screen.getByRole('button', { name: /hover me/i });

        // This validates the class exists for Tailwind to pick up, not the computed style.
        expect(button.className).toContain('hover:bg-primary-600');

        await user.hover(button);
        // We ensure that the element receives the hover interaction successfully without errors.
        expect(button).toBeInTheDocument();
    });
});
