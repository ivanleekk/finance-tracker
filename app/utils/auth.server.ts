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
import {json} from "@remix-run/node";
import {GoogleStrategy} from "remix-auth-google";
import dotenv from "dotenv";
import {redirectWithError} from "remix-toast";

dotenv.config();

const googleStrategy = new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/login/google/callback",
}, async ({  extraParams }) => {
    // Get the user data from your DB or API using the tokens and profile
    const { user } = await signInWithGoogleIdToken(extraParams.id_token);
    const token = await user.getIdToken();
    return createUserSession(token, "/portfolio");
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
                return createUserSession(token, "/portfolio");
            } catch (error) {
                return json({ error: "Invalid email or password" }, { status: 400 });
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
        return createUserSession(token, "/portfolio");
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