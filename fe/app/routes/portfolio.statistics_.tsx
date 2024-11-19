import { Card } from "~/components/ui/card";
import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import {getUserSession} from "~/utils/session.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    return null;
};

export default function Statistics() {
    return (
        <div>
            <div className="space-y-2">
                <Card className="w-fit p-2">
                    <h2>Portfolio Beta</h2>
                    <p>0.67</p>
                </Card>
                <Card className="w-fit p-2">
                    <h2>Portfolio Standard Deviation</h2>
                    <p>0.25</p>
                </Card>
                <Card className="w-fit p-2">
                    <h2>Portfolio Sharpe Ratio</h2>
                    <p>0.75</p>
                </Card>
            </div>
        </div>
    );
}