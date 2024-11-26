import {db} from "~/utils/db.server";
import {requireUserSession} from "~/utils/auth.server";
import {dataWithError, dataWithSuccess} from "remix-toast";
import { date } from "zod";

export async function getBankInfo(request: Request) {
    const sessionUser = await requireUserSession(request);

    // use redis cache
    // const redisKey = `bank:${sessionUser.uid}`;
    // const cachedValue = await redisClient.get(redisKey);
    // if (cachedValue) {
    //     return JSON.parse(cachedValue);
    // }

    const querySnapshot = await db.collection("bank").where(
        "user", "==", sessionUser.uid
    ).get();

    const data = querySnapshot.docs.map(doc => doc.data());

    // store in redis cache store only for 1 minute since the prices change frequently
    // await redisClient.set(redisKey, JSON.stringify(data), {'EX': 60});

    return data;
}

export async function addBankInfo(request: Request) {
    const sessionUser = await requireUserSession(request);

    const data = await request.formData();
    const bankData = {
        user: sessionUser.uid,
        bankName: data.get('bankName').toString().toUpperCase(),
        balance: Number(data.get('balance')),
        date: data.get('date') || new Date().toDateString(),
    };

    if (isNaN(bankData.balance)) {
        return dataWithError(null, "Balance should be a number");
    }

    if (bankData.bankName.length <= 0) {
        return dataWithError(null, "Bank name should not be empty");
    }

    // check if bank already exists
    const querySnapshot = await db.collection("bank").where(
        "user", "==", sessionUser.uid
    ).where(
        "bankName", "==", bankData.bankName
    ).get();

    if (querySnapshot.docs.length > 0) {
        await db.collection("bank").doc(querySnapshot.docs[0].id).update(bankData);
    } else {
        // add new bank
        await db.collection("bank").add(bankData);
    }

    return dataWithSuccess(null, `${bankData.bankName} added successfully`);
}