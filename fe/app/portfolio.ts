import { redirect } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { getUserSession } from "./utils/session.server";
import yahooFinance from 'yahoo-finance2';

export async function getPortfolio(request: Request) {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    const querySnapshot = await db.collection("portfolio").where(
        "user", "==", sessionUser.uid
    ).get();
    const data: { id: string; symbol: string; quantity: number; averagePrice: number; totalInitialValue: number; currentPrice: number; totalCurrentValue: number; percentageGainLoss: number; totalGainLoss: number; }[] = [];

    for (const doc of querySnapshot.docs) {
        const docData = doc.data();
        const totalInitialValue = docData.quantity * docData.averagePrice;

        // Fetch current price from Yahoo Finance
        const quote = await yahooFinance.quote(docData.symbol);
        let currentPrice = 0;
        if (!quote) {
            console.log(`Failed to fetch quote for ${docData.symbol}`);
        }
        if (quote && quote.regularMarketPrice) {
            currentPrice = quote.regularMarketPrice;
        }

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

export async function addPortfolioItem(request: Request, symbol: string, quantity: number, averagePrice: number) {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    await db.collection("portfolio").add({
        symbol: symbol.toUpperCase(),
        quantity: quantity,
        averagePrice: averagePrice,
        user: sessionUser.uid
    });

    return null;
}

export async function updatePortfolioItem(request: Request, id: string, quantity: number, averagePrice: number) {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    await db.collection("portfolio").doc(id).update({
        quantity: quantity,
        averagePrice: averagePrice
    });
}

export async function addTrade(request: Request, symbol: string, quantity: number, price: number, tradeType: string) {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }
    symbol = symbol.toUpperCase();
    await db.collection("transaction").add({
        symbol: symbol,
        quantity: quantity,
        price: price,
        tradeType: tradeType,
        datetime: new Date(),
        user: sessionUser.uid
    });

    let portfolioItem = await db.collection("portfolio").where(
        "user", "==", sessionUser.uid
    ).where(
        "symbol", "==", symbol
    ).get();

    if (portfolioItem.docs.length === 0) {
        // Add the new stock to the portfolio
        await addPortfolioItem(request, symbol, quantity, price);
    } else {
        // Update the average price and quantity
        const doc = portfolioItem.docs[0];
        const docData = doc.data();
        let totalInitialValue = 0;
        let newQuantity = 0;
        if (tradeType === "Buy") {

            totalInitialValue = docData.quantity * docData.averagePrice + quantity * price;
            newQuantity = docData.quantity + quantity;
        }
        if (tradeType === "Sell") {
            totalInitialValue = docData.quantity * docData.averagePrice - quantity * price;
            newQuantity = docData.quantity - quantity;
        }
        const newAveragePrice = totalInitialValue / newQuantity;
        await updatePortfolioItem(request, doc.id, newQuantity, newAveragePrice);

    }
    return null;
}