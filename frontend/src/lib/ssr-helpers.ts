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
        const response = await fetch(getApiUrl(path), {
            ...init,
            headers: {
                ...Object.fromEntries(headers),
                ...init?.headers,
            },
        });

        if (response.status === 401) {
            throw redirect("/login");
        }

        return response;
    };

    if (!householdId) {
        try {
            const hRes = await fetch(getApiUrl("/users/households"), {
                headers: { ...Object.fromEntries(headers) }
            });
            if (hRes.ok) {
                const households = await hRes.json();
                if (households.length > 0) {
                    householdId = households[0].id;
                    newCookieHeader = `activeHouseholdId=${householdId}; Path=/; Max-Age=31536000`;
                }
            }
        } catch (e) {
            console.error("Failed to fetch default household in SSR", e);
        }
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
