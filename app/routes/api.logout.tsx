import {ActionFunctionArgs, redirect} from "@remix-run/node";
import {signOut} from "~/utils/session.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    await signOut(request);
    return redirect("/");
};