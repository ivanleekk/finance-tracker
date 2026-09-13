import { describe, it, expect } from 'vitest';
import { describeRouteError } from './ErrorBoundary';

// `isRouteErrorResponse` recognises the shape React Router serialises a thrown
// `data(...)`/Response into.
const routeError = (status: number, body?: unknown) => ({
    status,
    statusText: status === 404 ? 'Not Found' : 'Error',
    internal: false,
    data: body,
});

describe('describeRouteError', () => {
    it('names a missing page as missing', () => {
        expect(describeRouteError(routeError(404)).title).toBe('Page Not Found');
    });

    it('tells the reader an unreachable backend is temporary, not what fetch said', () => {
        const { message } = describeRouteError(new TypeError('fetch failed'));
        expect(message).not.toContain('fetch failed');
        expect(message).toMatch(/temporary/);
    });

    it('treats a 5xx the same way', () => {
        expect(describeRouteError(routeError(503)).title).toBe("We couldn't load this page");
    });

    it('passes on what a 4xx said about itself', () => {
        expect(describeRouteError(routeError(403, { message: 'Not your household' })).message)
            .toBe('Not your household');
    });

});
