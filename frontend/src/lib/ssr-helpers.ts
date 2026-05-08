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

    const ssrFetch = async (path: string, init?: RequestInit) => {
        const headersObj: Record<string, string> = {};
        headers.forEach((value, key) => {
            headersObj[key] = value;
        });

        const response = await fetch(getApiUrl(path), {
            ...init,
            headers: {
                ...headersObj,
                ...init?.headers,
            },
        });

        if (response.status === 401) {
            throw redirect("/login");
        }

        return response;
    };

    // Optional household verification - only if we have a cookie or if it's explicitly requested
    let households: any[] = [];
    try {
        // We only attempt to fetch households if there's a chance the user is logged in
        // or if we need to resolve a householdId.
        const hRes = await fetch(getApiUrl("/users/households"), {
            headers: { ...Object.fromEntries(headers) }
        });
        
        if (hRes.ok) {
            households = await hRes.json();
        }
        // We DO NOT throw a redirect here because getSSRContext is often used in the root loader
        // which must be able to fail gracefully for public pages (like /login) to avoid redirect loops.
    } catch (e) {
        console.error("Failed to fetch households in SSR", e);
    }

    // Determine the best householdId to use
    if (households.length > 0) {
        const isValid = householdId && households.some(h => h.id === householdId);
        if (!isValid) {
            // Default to the first household if the cookie is missing or invalid
            householdId = households[0].id;
            newCookieHeader = `activeHouseholdId=${householdId}; Path=/; Max-Age=31536000`;
        }
    } else {
        // No households found for user
        householdId = undefined;
    }

    return {
        headers,
        householdId,
        ssrFetch,
        // Helper to combine headers for the response
        combineHeaders: (existingHeaders?: HeadersInit) => {
            const combined = new Headers(existingHeaders);
            if (newCookieHeader) {
                combined.append("Set-Cookie", newCookieHeader);
            }
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
