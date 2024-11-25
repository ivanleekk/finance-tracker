import {signUpWithEmailAndPasswordFirebase} from "~/utils/db.server";
import {Form, Link} from "@remix-run/react";
import {Label} from "~/components/ui/label";
import {Input} from "~/components/ui/input";
import {Button} from "~/components/ui/button";
import {createUserSession} from "~/utils/session.server";
import {ActionFunctionArgs} from "@remix-run/node";

export const action = async ({request}: ActionFunctionArgs) => {
    const formData = await request.formData();
    const email = formData.get("email");
    const password = formData.get("password");

    const { user } = await signUpWithEmailAndPasswordFirebase(email, password);
    const token = await user.getIdToken();
    return createUserSession(token, "/portfolio");
}

export default function SignUp() {
    return (
        <div>
            <Form method="post" className="space-y-4">
                <Label>
                    Email
                    <Input type="email" name="email" required />
                </Label>
                <Label>
                    Password
                    <Input type="password" name="password" required />
                </Label>
                <Button type="submit">Sign Up</Button>
            </Form>
            <Link to={"/login"}>Already have an account? Login here</Link>
        </div>
    )
}