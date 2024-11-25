// app/utils/auth.server.ts
import {Authenticator} from "remix-auth";
import {FormStrategy} from "remix-auth-form";
import {
    signInWithEmailAndPasswordFirebase,
    signUpWithEmailAndPasswordFirebase
} from "~/utils/db.server";
import {createUserSession} from "~/utils/session.server";
import {json} from "@remix-run/node";

const authenticator = new Authenticator();

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
    }), "signup-email-password");

export { authenticator };