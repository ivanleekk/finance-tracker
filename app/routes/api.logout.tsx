import {ActionFunctionArgs, redirect} from "@remix-run/node";
import {signOut} from "~/utils/session.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    return await signOut(request);
};