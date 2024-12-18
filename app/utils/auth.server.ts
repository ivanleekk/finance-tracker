// app/utils/auth.server.ts
import {Authenticator} from "remix-auth";
import {FormStrategy} from "remix-auth-form";
import {
    signInWithEmailAndPasswordFirebase, signInWithGoogleIdToken,
    signUpWithEmailAndPasswordFirebase
} from "~/utils/db.server";
import {
    createUserSession,
    getUserSession,
    sessionStorage
} from "~/utils/session.server";
import { json } from "@vercel/remix";

import {GoogleStrategy} from "remix-auth-google";
import dotenv from "dotenv";
import {dataWithError, redirectWithError} from "remix-toast";

dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

const googleStrategy = new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/login/google/callback",
}, async ({  extraParams }) => {
    // Get the user data from your DB or API using the tokens and profile
    const { user } = await signInWithGoogleIdToken(extraParams.id_token);
    const token = await user.getIdToken();
    return createUserSession(token, "/dashboard");
    }
);

export const authenticator = new Authenticator(sessionStorage);

authenticator.use(
    new FormStrategy(async ({form}) => {
            const email = form.get("email");
            const password = form.get("password");

            // This is where you would call your authentication function
            // and return the user if they are authenticated
            try {
                const { user } = await signInWithEmailAndPasswordFirebase(email, password);
                const token = await user.getIdToken();
                return createUserSession(token, "/dashboard");
            } catch (error) {
                return dataWithError(null, "Invalid email or password");
            }

        }
    ), "email-password").use(
    new FormStrategy(async ({form}) => {
        // This is where you would call your authentication function
        // and return the user if they are authenticated
        const email = form.get("email");
        const password = form.get("password");

        const { user } = await signUpWithEmailAndPasswordFirebase(email, password);
        const token = await user.getIdToken();
        return createUserSession(token, "/dashboard");
    }), "signup-email-password").use(
    googleStrategy, "google"
);

export async function requireUserSession(request: Request) {
    const userSession = await getUserSession(request);
    if (userSession) {
        return userSession;
    } else {
        throw await redirectWithError("/login", "You must be logged in to access this page");
    }
}