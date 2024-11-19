import {Form, Link} from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {ActionFunctionArgs} from "@remix-run/node";
import {signInWithEmailAndPasswordFirebase} from "~/utils/db.server";
import {createUserSession} from "~/utils/session.server";

export let action = async ({ request }:ActionFunctionArgs) => {
    let formData = await request.formData();

    let email = formData.get("email");
    let password = formData.get("password");

    const { user } = await signInWithEmailAndPasswordFirebase(email, password);
    const token = await user.getIdToken();
    return createUserSession(token, "/portfolio");
};

export default function Login() {
    return (
        <div>
            <Form method="post">
                <Label>
                    Email
                    <Input type="email" name="email" required />
                </Label>
                <Label>
                    Password
                    <Input type="password" name="password" required />
                </Label>
                <Button type="submit">Login</Button>
            </Form>
            <Link to={"/signup"}>Don't have an account? Sign up here</Link>
        </div>
    )
}