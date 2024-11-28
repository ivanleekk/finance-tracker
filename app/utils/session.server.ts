import { createCookieSessionStorage, redirect } from "@remix-run/node";
import { adminAuth, getSessionToken, signOutFirebase } from "./db.server.js";
import dotenv from "dotenv";
import { LRUCache } from 'lru-cache';
import { redirectWithInfo } from "remix-toast";
import { DecodedIdToken } from "node_modules/firebase-admin/lib/auth/token-verifier.js";

dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

const cache = new LRUCache<string, DecodedIdToken>({
    max: 1000, // Maximum number of items in the cache
    ttl: 1000 * 60 * 5 // Time-to-live in milliseconds (5 minutes)
});

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required');
}

export const sessionStorage = createCookieSessionStorage({
    cookie: {
        name: '__session',
        secrets: [sessionSecret],
        sameSite: 'lax',
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 30, // 30 days
    },
});

export async function createUserSession(idToken: string, redirectTo: string) {
    const token = await getSessionToken(idToken)
    const session = await sessionStorage.getSession();
    session.set('token', token);

    return redirectWithInfo(redirectTo, "You are now signed in", {
        headers: {
            'Set-Cookie': await sessionStorage.commitSession(session),
        },
    });
}

export async function getUserSession(request : Request) : Promise<DecodedIdToken | null> {
    const cookieSession = await sessionStorage.getSession(request.headers.get("Cookie"));
    const token = cookieSession.get("token");
    if (!token) return null;

    // Check if the token is in the cache
    if (cache.has(token)) {
        return cache.get(token) || null;
    }

    try {
        const session = await adminAuth.verifySessionCookie(token, true);
        // Store the verified session in the cache
        cache.set(token, session);
        return session;
    } catch (error) {
        return null;
    }
}

export async function destroyUserSession(request: Request) {
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    const newCookie = await sessionStorage.destroySession(session);
    return redirectWithInfo("/login", "You are now signed out", { headers: { "Set-Cookie": newCookie } });
}


export async function signOut(request: Request) {
    await signOutFirebase();
    return await destroyUserSession(request);
}