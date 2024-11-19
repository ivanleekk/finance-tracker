import {createCookieSessionStorage, redirect} from "@remix-run/node";
import {adminAuth, getSessionToken, signOutFirebase} from "./db.server.js";
import dotenv from "dotenv";

dotenv.config();

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required');
}

const storage = createCookieSessionStorage({
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

export async function createUserSession(idToken, redirectTo) {
    const token = await getSessionToken(idToken)
    const session =  await storage.getSession();
    session.set('token', token);

    return redirect(redirectTo, {
        headers: {
            'Set-Cookie': await storage.commitSession(session),
        },
    });
}

export async function getUserSession(request) {
    const cookieSession = await storage.getSession(request.headers.get("Cookie"));
    const token = cookieSession.get("token");
    if (!token) return null;

    try {
        return await adminAuth.verifySessionCookie(token, true);
    } catch (error) {
        return null;
    }
}

export async function destroyUserSession(request) {
    const session = await storage.getSession(request.headers.get("Cookie"));
    const newCookie = await storage.destroySession(session);
    return redirect("/login", { headers: { "Set-Cookie": newCookie } });
}


export async function signOut(request) {
    await signOutFirebase();
    return await destroyUserSession(request);
}