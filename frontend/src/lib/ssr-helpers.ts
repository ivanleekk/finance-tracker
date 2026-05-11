import { getApiUrl } from "./api-url";
import { redirect } from "react-router";

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
 * Creates a server-side fetch client that automatically forwards cookies
 * and resolves URLs correctly for the internal Docker network.
 */
export async function getSSRContext(request: Request) {
    const headers = new Headers();
    const cookie = request.headers.get("Cookie");
    if (cookie) headers.set("Cookie", cookie);

    const cookies = parseCookies(cookie);
    let householdId = cookies['activeHouseholdId'];
    let newCookieHeader: string | null = null;
    let refreshSetCookieHeaders: string[] = [];

    const ssrFetch = async (path: string, init?: RequestInit): Promise<Response> => {
        const mergedHeaders = new Headers(headers);
        if (init?.headers) {
            const extraHeaders = new Headers(init.headers);
            extraHeaders.forEach((value, key) => {
                mergedHeaders.set(key, value);
            });
        }

        const response = await fetch(getApiUrl(path), {
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

                return fetch(getApiUrl(path), {
                    ...init,
                    headers: retryHeaders,
                });
            } else {
                console.warn(`[SSR] Refresh failed for ${path}, redirecting to login`);
                throw redirect("/login");
            }
        }

        return response;
    };

    // Optional household verification
    let households: any[] = [];
    try {
        const hRes = await ssrFetch("/users/households");
        if (hRes.ok) {
            households = await hRes.json();
        }
    } catch (e) {
        if (e instanceof Response && e.status === 302) throw e; // Pass through redirects
        console.error("Failed to fetch households in SSR", e);
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
            const hRes = await fetch(getApiUrl("/users/households"), { headers });
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
