import { getApiUrl } from "./api-url";
import { data, redirect } from "react-router";

export const parseCookies = (cookieString: string | null) => {
    if (!cookieString) return {};
    return cookieString
        .split(';')
        .map(v => v.split('='))
        .reduce((acc, v) => {
            if (v.length === 2) {
                acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(v[1].trim());
            }
            return acc;
        }, {} as Record<string, string>);
};

/**
 * How long SSR waits before each retry of a request that failed transiently.
 * About 2.5s in total: enough to ride out the backend restarting or a proxy that
 * briefly has no upstream, short enough that a backend that is really down still
 * reaches the error page rather than hanging the tab.
 */
export const SSR_RETRY_DELAYS_MS = [250, 750, 1500];

// What a proxy says when it has nothing healthy to forward to. A plain 500 is not
// here on purpose: that is the backend answering, and asking again gets the same.
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * `fetch`, but a GET that could not reach the backend is asked again before
 * anyone sees an error page.
 *
 * Every page's loader runs through this on the server, so a single refused
 * connection — the backend container restarting, or still booting after a
 * deploy — used to throw straight into React Router's 500, while the refresh a
 * moment later worked. Only GET and HEAD are retried: repeating a POST that
 * failed after the backend received it could apply it twice.
 */
export async function fetchWithRetry(
    input: string,
    init: RequestInit = {},
    delays: number[] = SSR_RETRY_DELAYS_MS,
    wait: (ms: number) => Promise<void> = sleep,
): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const retryable = method === "GET" || method === "HEAD";

    for (let attempt = 0; ; attempt++) {
        const canRetry = retryable && attempt < delays.length && !init.signal?.aborted;
        try {
            const response = await fetch(input, init);
            if (!canRetry || !TRANSIENT_STATUSES.has(response.status)) return response;
            console.warn(`[SSR] ${response.status} from ${input}, retrying`);
        } catch (error) {
            if (!canRetry) throw error;
            console.warn(`[SSR] Could not reach ${input}, retrying`, error);
        }
        await wait(delays[attempt]);
    }
}

/**
 * Creates a server-side fetch client that automatically forwards cookies
 * and resolves URLs correctly for the internal Docker network.
 */
export async function getSSRContext(request: Request) {
    const headers = new Headers();
    const cookie = request.headers.get("Cookie");
    if (cookie) headers.set("Cookie", cookie);

    const cookies = parseCookies(cookie);
    const hasAuthTokens = !!(cookies['access_token'] || cookies['refresh_token']);
    const url = new URL(request.url);
    const isPublicRoute = ['/login', '/signup', '/logout', '/'].includes(url.pathname);

    let householdId = cookies['activeHouseholdId'];
    let newCookieHeader: string | null = null;
    let refreshSetCookieHeaders: string[] = [];

    const ssrFetch = async (path: string, init?: RequestInit & { skipRedirect?: boolean }): Promise<Response> => {
        const mergedHeaders = new Headers(headers);
        if (init?.headers) {
            const extraHeaders = new Headers(init.headers);
            extraHeaders.forEach((value, key) => {
                mergedHeaders.set(key, value);
            });
        }

        const response = await fetchWithRetry(getApiUrl(path), {
            ...init,
            headers: mergedHeaders,
        });

        // Handle 401 by attempting to refresh
        if (
            response.status === 401 && 
            !path.includes('/auth/refresh') && 
            !path.includes('/auth/token')
        ) {
            console.log(`[SSR] 401 detected for ${path}, attempting refresh...`);
            
            const refreshRes = await fetch(getApiUrl("/auth/refresh"), {
                method: "POST",
                headers: mergedHeaders,
            });

            if (refreshRes.ok) {
                console.log(`[SSR] Refresh successful, retrying ${path}`);
                
                // Collect the new Set-Cookie headers to send back to the browser
                const newCookies = refreshRes.headers.getSetCookie();
                refreshSetCookieHeaders.push(...newCookies);

                // Create a new cookie string for the retry
                // We extract the key=value part from each Set-Cookie header
                const newCookieValues = newCookies.map(c => c.split(';')[0]);
                
                // Update our local context headers for subsequent calls
                const currentCookie = headers.get("Cookie") || "";
                const currentCookieParts = currentCookie.split(';').map(p => p.trim()).filter(Boolean);
                
                // Merge: replace existing keys with new ones
                const cookieMap = new Map();
                currentCookieParts.forEach(p => {
                    const [k, v] = p.split('=');
                    cookieMap.set(k, v);
                });
                newCookieValues.forEach(p => {
                    const [k, v] = p.split('=');
                    cookieMap.set(k, v);
                });
                
                const updatedCookieString = Array.from(cookieMap.entries())
                    .map(([k, v]) => `${k}=${v}`)
                    .join('; ');
                
                headers.set("Cookie", updatedCookieString);

                // Retry the original request with updated headers
                const retryHeaders = new Headers(mergedHeaders);
                retryHeaders.set("Cookie", updatedCookieString);

                return fetchWithRetry(getApiUrl(path), {
                    ...init,
                    headers: retryHeaders,
                });
            } else {
                console.warn(`[SSR] Refresh failed for ${path}${init?.skipRedirect ? ' (skipping redirect)' : ''}`);
                
                // Don't redirect if skipRedirect is requested or we're already on a public route/login page
                if (init?.skipRedirect || isPublicRoute || url.pathname === '/login') {
                    return response; // Return the original 401
                }
                
                console.log(`[SSR] Redirecting to login from ${url.pathname}`);
                throw redirect("/login");
            }
        }

        return response;
    };

    // Optional household verification - only if we have tokens and aren't on a public route
    //
    // Not reaching the backend is an outage, and must not be read as "this user has
    // no household": every loader redirects to /households on that, and the root
    // loader reports the user as logged out, so a backend restart used to look
    // like losing your data. A signed-out 401 still falls through to the redirects.
    let households: any[] = [];
    if (hasAuthTokens && !isPublicRoute) {
        let hRes: Response;
        try {
            hRes = await ssrFetch("/users/households", { skipRedirect: true });
        } catch (e) {
            if (e instanceof Response) throw e;
            console.error("Failed to fetch households in SSR", e);
            throw data(null, { status: 503, statusText: "Backend unavailable" });
        }
        if (hRes.ok) {
            households = await hRes.json();
        } else if (hRes.status >= 500) {
            console.error(`[SSR] ${hRes.status} fetching households`);
            throw data(null, { status: 503, statusText: "Backend unavailable" });
        }
    }

    // Determine the best householdId to use
    if (households.length > 0) {
        const isValid = householdId && households.some(h => h.id === householdId);
        if (!isValid) {
            householdId = households[0].id;
            newCookieHeader = `activeHouseholdId=${householdId}; Path=/; Max-Age=31536000`;
        }
    } else {
        householdId = undefined;
    }

    return {
        headers,
        householdId,
        ssrFetch,
        combineHeaders: (existingHeaders?: HeadersInit) => {
            const combined = new Headers(existingHeaders);
            if (newCookieHeader) {
                combined.append("Set-Cookie", newCookieHeader);
            }
            // Add all collected refresh cookies
            refreshSetCookieHeaders.forEach(sc => {
                combined.append("Set-Cookie", sc);
            });
            return combined;
        }
    };
}

// Keep the old helper for compatibility if needed, but refactored to use common logic
export async function getActiveHouseholdId(request: Request, headers: Headers): Promise<string> {
    const cookies = parseCookies(request.headers.get("Cookie"));
    let householdId = cookies['activeHouseholdId'];

    if (!householdId) {
        try {
            const hRes = await fetchWithRetry(getApiUrl("/users/households"), { headers });
            if (hRes.ok) {
                const households = await hRes.json();
                if (households.length > 0) {
                    householdId = households[0].id;
                }
            }
        } catch (e) {
            console.error("Failed to fetch default household in SSR", e);
        }
    }

    if (!householdId) {
        throw new Error("No active household found");
    }

    return householdId;
}
