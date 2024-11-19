import { redirect } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { getUserSession } from "./utils/session.server";
import yahooFinance from 'yahoo-finance2';

export async function getPortfolio(request: Request) {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    const querySnapshot = await db.collection("portfolio").get();
    const data: { id: string; symbol: string; quantity: number; averagePrice: number; totalInitialValue: number; currentPrice: number; totalCurrentValue: number; percentageGainLoss: number; totalGainLoss: number; }[] = [];

    for (const doc of querySnapshot.docs) {
        const docData = doc.data();
        const totalInitialValue = docData.quantity * docData.averagePrice;

        // Fetch current price from Yahoo Finance
        const quote = await yahooFinance.quote(docData.symbol);
        const currentPrice = quote.regularMarketPrice;

        const totalCurrentValue = docData.quantity * currentPrice;
        const totalGainLoss = totalCurrentValue - totalInitialValue;
        const percentageGainLoss = (totalGainLoss / totalInitialValue) * 100;

        data.push({
            id: doc.id,
            symbol: docData.symbol,
            quantity: docData.quantity,
            averagePrice: docData.averagePrice,
            totalInitialValue: totalInitialValue,
            currentPrice: currentPrice,
            totalCurrentValue: totalCurrentValue,
            percentageGainLoss: percentageGainLoss,
            totalGainLoss: totalGainLoss
        });
    }

    return data;
}