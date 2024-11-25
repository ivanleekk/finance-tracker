import { Form, Link, useActionData } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ActionFunctionArgs, json } from "@remix-run/node";
import { signInWithEmailAndPasswordFirebase } from "~/utils/db.server";
import { createUserSession } from "~/utils/session.server";

export let action = async ({ request }: ActionFunctionArgs) => {
    const formData = await request.formData();

    const email = formData.get("email");
    const password = formData.get("password");

    try {
        const { user } = await signInWithEmailAndPasswordFirebase(email, password);
        const token = await user.getIdToken();
        return createUserSession(token, "/portfolio");
    } catch (error) {
        return json({ error: "Invalid email or password" }, { status: 400 });
    }
};

export default function Login() {
    const actionData = useActionData();

    return (
        <div>
            <Form method="post" className="space-y-4">
                {actionData?.error && (
                    <div className="text-red-500">{actionData.error}</div>
                )}
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
    );
}