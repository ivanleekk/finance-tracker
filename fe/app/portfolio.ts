import { redirect } from "@remix-run/node";

import { db } from "~/utils/db.server";
import { getUserSession } from "./utils/session.server";

export async function getPortfolio(request: Request) {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    const querySnapshot = await db.collection("portfolio").get();

    const data = [];
    querySnapshot.forEach((doc) => {
        console.log(doc.id, " => ", doc.data());
        const totalInitialValue = doc.data().quantity * doc.data().averagePrice;
        data.push({ ...doc.data(), id: doc.id, totalInitialValue: totalInitialValue });
    });

    return data;
}
