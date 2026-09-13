import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry } from './ssr-helpers';

const noWait = () => Promise.resolve();
const ok = () => new Response('{}', { status: 200 });
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const stubFetch = (...outcomes: Array<() => Response | Error>) => {
    const fetchMock = vi.fn();
    outcomes.forEach(outcome => {
        fetchMock.mockImplementationOnce(async () => {
            const result = outcome();
            if (result instanceof Error) throw result;
            return result;
        });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return fetchMock;
};

describe('fetchWithRetry', () => {
    it('rides out a backend that refuses the first connection', async () => {
        const fetchMock = stubFetch(refused, ok);
        const res = await fetchWithRetry('http://api/accounts', {}, [1, 1, 1], noWait);
        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries a proxy with no upstream', async () => {
        const fetchMock = stubFetch(
            () => new Response('', { status: 502 }),
            () => new Response('', { status: 503 }),
            ok,
        );
        const res = await fetchWithRetry('http://api/accounts', {}, [1, 1, 1], noWait);
        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not retry an answer from the backend itself', async () => {
        for (const status of [401, 404, 500]) {
            const fetchMock = stubFetch(() => new Response('', { status }), ok);
            const res = await fetchWithRetry('http://api/accounts', {}, [1, 1, 1], noWait);
            expect(res.status).toBe(status);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    });

    it('gives up after the last delay and surfaces the failure', async () => {
        const fetchMock = stubFetch(refused, refused, refused);
        await expect(fetchWithRetry('http://api/accounts', {}, [1, 1], noWait)).rejects.toThrow('fetch failed');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('hands back the last transient response rather than inventing one', async () => {
        stubFetch(() => new Response('', { status: 503 }), () => new Response('', { status: 503 }));
        const res = await fetchWithRetry('http://api/accounts', {}, [1], noWait);
        expect(res.status).toBe(503);
    });

    it('never repeats a write', async () => {
        const fetchMock = stubFetch(refused, ok);
        await expect(
            fetchWithRetry('http://api/transactions', { method: 'POST' }, [1, 1], noWait),
        ).rejects.toThrow('fetch failed');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const again = stubFetch(() => new Response('', { status: 503 }), ok);
        const res = await fetchWithRetry('http://api/transactions', { method: 'post' }, [1, 1], noWait);
        expect(res.status).toBe(503);
        expect(again).toHaveBeenCalledTimes(1);
    });

    it('waits the configured delays between attempts', async () => {
        stubFetch(refused, refused, ok);
        const wait = vi.fn(() => Promise.resolve());
        await fetchWithRetry('http://api/accounts', {}, [10, 20, 30], wait);
        expect(wait.mock.calls).toEqual([[10], [20]]);
    });
});

describe('getSSRContext when the backend is unreachable', () => {
    const signedIn = () =>
        new Request('http://web/cards', { headers: { Cookie: 'access_token=t; activeHouseholdId=h1' } });

    it('reports an outage instead of a user with no household', async () => {
        const { getSSRContext } = await import('./ssr-helpers');
        vi.useFakeTimers();
        stubFetch(refused, refused, refused, refused);
        const pending = getSSRContext(signedIn()).catch(e => e);
        await vi.runAllTimersAsync();
        const thrown = await pending;
        vi.useRealTimers();
        expect(thrown).toMatchObject({ init: { status: 503 } });
    });

    it('reports a failing backend the same way', async () => {
        const { getSSRContext } = await import('./ssr-helpers');
        stubFetch(() => new Response('', { status: 500 }));
        await expect(getSSRContext(signedIn())).rejects.toMatchObject({ init: { status: 503 } });
    });

    it('still lets a household-less user through to the onboarding redirects', async () => {
        const { getSSRContext } = await import('./ssr-helpers');
        stubFetch(() => new Response('[]', { status: 200 }));
        const ctx = await getSSRContext(signedIn());
        expect(ctx.householdId).toBeUndefined();
    });
});
