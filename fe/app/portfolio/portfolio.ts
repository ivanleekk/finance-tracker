import {redirect} from "@remix-run/node";
import {db} from "~/utils/db.server";
import {getUserSession} from "../utils/session.server";
import yahooFinance from 'yahoo-finance2';
import redisClient from "~/utils/redisClient";

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
        const quote = (await yahooFinance.quoteSummary(docData.symbol));
        let currentPrice = 0;
        if (!quote) {
            console.log(`Failed to fetch quote for ${docData.symbol}`);
        }
        if (quote && quote.price.regularMarketPrice) {
            currentPrice = quote.price.regularMarketPrice;
        }

        const totalCurrentValue = docData.quantity * currentPrice;
        const totalGainLoss = totalCurrentValue - totalInitialValue;
        const percentageGainLoss = (totalGainLoss / totalInitialValue) * 100;
        // console.log(quote)
        data.push({
            id: doc.id,
            symbol: docData.symbol,
            quantity: docData.quantity,
            averagePrice: docData.averagePrice,
            totalInitialValue: totalInitialValue,
            currentPrice: currentPrice,
            totalCurrentValue: totalCurrentValue,
            percentageGainLoss: percentageGainLoss,
            totalGainLoss: totalGainLoss,
            beta: quote.summaryDetail.beta
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

export async function getTransactions(request: Request) {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    const querySnapshot = await db.collection("transaction").where(
        "user", "==", sessionUser.uid
    ).get();
    const data: { id: string; symbol: string; buySell: string; quantity: number; price: number; totalValue: number; date: string; }[] = [];

    for (const doc of querySnapshot.docs) {
        const docData = doc.data();
        const totalValue = docData.quantity * docData.price;
        data.push({
            id: doc.id,
            symbol: docData.symbol,
            buySell: docData.tradeType,
            quantity: docData.quantity,
            price: docData.price,
            totalValue: totalValue,
            date: docData.datetime.toDate().toISOString()
        });
    }

    return data;
}

export async function getPortfolioStandardDeviation(request: Request, portfolioData: any) {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }   

    // console.log(redisClient)
    // // use redis cache
    const redisKey = `portfolioStandardDeviation:${sessionUser.uid}`;
    const cachedValue = await redisClient.get(redisKey);
    if (cachedValue) {
        return parseFloat(cachedValue);
    }


    // get historical prices for each stock in the portfolio
    const symbols = portfolioData.map((item) => item.symbol);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const totalValue = portfolioData.reduce((acc: number, item: any) => acc + item.totalCurrentValue, 0);

    for (const symbol of portfolioData) {
        symbol.percentageOfPortfolio = symbol.totalCurrentValue / totalValue;
    }

    // find the price movement of the whole portfolio for each day
    // calculate the standard deviation of the price movement

    const portfolioPrices = [];
    for (const symbol of symbols) {
        const quote = await yahooFinance.chart(symbol, {period1: oneYearAgo});
        for (const item of quote.quotes) {
            const date = new Date(item.date).toDateString();
            const price = item.close * portfolioData.find((item) => item.symbol === symbol).quantity;
            const portfolioPrice = portfolioPrices.find((item) => item.date === date);
            if (portfolioPrice) {
                portfolioPrice.price += price;
            } else {
                portfolioPrices.push({date: date, price: price});
            }
        }
    }
    // get the change in price for each day
    const priceChanges = [];
    for (let i = 0; i < portfolioPrices.length - 1; i++) {
        const change = portfolioPrices[i + 1].price - portfolioPrices[i].price;
        priceChanges.push(change);
    }
    // calculate the standard deviation
    const mean = priceChanges.reduce((acc, item) => acc + item, 0) / priceChanges.length;
    const variance = priceChanges.reduce((acc, item) => acc + Math.pow(item - mean, 2), 0) / priceChanges.length;
    const standardDeviation = Math.sqrt(variance);
    // console.log(standardDeviation);
    // normalise this sd by the total value of the portfolio
    const normalisedStandardDeviation = standardDeviation / totalValue;

    // store in redis cache
    await redisClient.set(redisKey, normalisedStandardDeviation.toString(), {'EX': 60 * 60 * 24});

    return normalisedStandardDeviation;
}
