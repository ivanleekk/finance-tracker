import { db } from "~/utils/db.server";
import { requireUserSession } from "~/utils/auth.server";
import { dataWithError, dataWithSuccess } from "remix-toast";
import { bankHistory } from "./bankHistoryColumns";
import { RedisKeys } from "~/utils/redisKeys";
import { redisGet, redisReset, redisSet } from "~/utils/redisClient";

export async function getBankInfo(request: Request) {
    const sessionUser = await requireUserSession(request);

    // Use Redis cache 
    const cachedValue = await redisGet(request, RedisKeys.BANK);
    if (cachedValue) {
        return JSON.parse(cachedValue);
    }

    const querySnapshot = await db
        .collection("bank")
        .where("user", "==", sessionUser.uid)
        .get();

    const data = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
    }));

    // Store in Redis cache
    await redisSet(request, RedisKeys.BANK, JSON.stringify(data));

    return data;
}

export async function addBankInfo(request: Request) {
    const sessionUser = await requireUserSession(request);

    const data = await request.formData();
    const inputDate = data.get("date")?.toString(); // HTML date input
    const standardizedDate = standardizeDate(inputDate); // Standardize to full ISO string

    const bankData = {
        user: sessionUser.uid,
        bankName: data.get("bankName").toString().toUpperCase(),
        balance: Number(data.get("balance")),
        date: standardizedDate, // Use standardized date
        currency: data.get("currency")?.toString(),
    };

    console.log(bankData);

    if (isNaN(bankData.balance)) {
        return dataWithError(null, "Balance should be a number");
    }

    if (bankData.bankName.length <= 0) {
        return dataWithError(null, "Bank name should not be empty");
    }

    // Check if bank already exists
    const querySnapshot = await db
        .collection("bank")
        .where("user", "==", sessionUser.uid)
        .where("bankName", "==", bankData.bankName)
        .get();

    if (querySnapshot.docs.length > 0) {
        const bankDoc = querySnapshot.docs[0];
        const bankRef = db.collection("bank").doc(bankDoc.id);
        const existingData = bankDoc.data();

        const existingLatestDate = new Date(existingData.latestDate || 0);
        const newDate = new Date(bankData.date);

        if (newDate > existingLatestDate) {
            await bankRef.update({
                currentBalance: bankData.balance,
                latestDate: bankData.date,
            });
        }

        const historyRef = bankRef.collection("bankHistory");
        await historyRef.add({
            date: bankData.date,
            balance: bankData.balance,
        });
    } else {
        const bankRef = await db.collection("bank").add({
            user: sessionUser.uid,
            bankName: bankData.bankName,
            currentBalance: bankData.balance,
            latestDate: bankData.date,
        });

        const historyRef = bankRef.collection("bankHistory");
        await historyRef.add({
            date: bankData.date,
            balance: bankData.balance,
        });
    }

    // Clear Redis cache
    await redisReset(request);

    return dataWithSuccess(null, `${bankData.bankName} added successfully`);
}


export async function getBankHistory(request: Request) {
    const sessionUser = await requireUserSession(request);

    // Use Redis cache
    const cachedValue = await redisGet(request, RedisKeys.BANK_HISTORY);
    if (cachedValue) {
        return JSON.parse(cachedValue);
    }

    const data = [];
    const querySnapshot = await db
        .collection("bank")
        .where("user", "==", sessionUser.uid)
        .get();

    for (const bankDoc of querySnapshot.docs) {
        const historySnapshot = await db
            .collection("bank")
            .doc(bankDoc.id)
            .collection("bankHistory")
            .get();

        const history = historySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        data.push({
            bankName: bankDoc.data().bankName,
            currentBalance: bankDoc.data().currentBalance,
            latestDate: bankDoc.data().latestDate,
            history,
        });
    }

    // Store in Redis cache
    await redisSet(request, RedisKeys.BANK_HISTORY, JSON.stringify(data));

    return data;
}

export async function getBankHistoryMonthly(request: Request): Promise<{data: {bankName: string, currentBalance: number, latestDate: string, monthlyData: {year: number, month: number, date: string, balance: number}[]}[], availableYears: string[]}> {
    const sessionUser = await requireUserSession(request);

    // Use Redis cache
    const cachedValue = await redisGet(request, RedisKeys.BANK_HISTORY_MONTHLY);
    if (cachedValue) {
        return JSON.parse(cachedValue);
    }


    const data = [];
    const querySnapshot = await db
        .collection("bank")
        .where("user", "==", sessionUser.uid)
        .get();

    const availableYears = new Set();

    for (const bankDoc of querySnapshot.docs) {
        const historySnapshot = await db
            .collection("bank")
            .doc(bankDoc.id)
            .collection("bankHistory")
            .get();

        const history = historySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        // get the MOST RECENT date for each month in each year
        // and get the balance for that date
        const monthlyData = history.reduce((acc, entry) => {
            const entryDate = new Date(entry.date);
            const year = entryDate.getFullYear();
            availableYears.add(year.toString());
            const month = entryDate.getMonth();

            const existingEntry = acc.find(
                item => item.year === year && item.month === month
            );

            if (!existingEntry) {
                acc.push({
                    year,
                    month,
                    date: entry.date,
                    balance: entry.balance,
                });
            } else {
                const existingDate = new Date(existingEntry.date);
                if (entryDate > existingDate) {
                    existingEntry.date = entry.date;
                    existingEntry.balance = entry.balance;
                }
            }

            return acc;
        }, []);

        data.push({
            bankName: bankDoc.data().bankName,
            currentBalance: bankDoc.data().currentBalance,
            latestDate: bankDoc.data().latestDate,
            monthlyData,
        });
    }

    // Store in Redis cache
    await redisSet(request, RedisKeys.BANK_HISTORY_MONTHLY, JSON.stringify({data, availableYears: Array.from(availableYears).sort()}));

    return {data, availableYears: Array.from(availableYears).sort()};
}

function standardizeDate(inputDate) {
    if (!inputDate) return new Date().toISOString(); // Default to current date
    const date = new Date(inputDate); // Parse the input
    if (isNaN(date.getTime())) throw new Error("Invalid date"); // Ensure it's a valid date
    return date.toISOString(); // Convert to ISO string
}
