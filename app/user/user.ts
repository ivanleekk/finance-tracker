import { dataWithError, dataWithSuccess } from "remix-toast";
import yahooFinance from "yahoo-finance2";
import { requireUserSession } from "~/utils/auth.server";
import {db} from "~/utils/db.server";
import { redisReset } from "~/utils/redisClient";

export async function getUserByRequest(request: Request) {
    const sessionUser = await requireUserSession(request);
    
    if (!sessionUser) {
        return null;
    }

    return (await db.collection('user').where('uid', '==', sessionUser.uid).get()).docs[0]?.data() || {homeCurrency: 'USD', homeCurrencySymbol: '$'};
}

export async function setUserByRequest(request: Request) {
    const sessionUser = await requireUserSession(request);
    
    if (!sessionUser) {
        return null;
    }

    const data = await request.formData();
    const user = (await db.collection('user').where('uid', '==', sessionUser.uid).get()).docs[0];

    const homeCurrency = data.get('homeCurrency')?.toString().trim().toUpperCase() || 'USD';
    let forexQuote = null;
    try {
        forexQuote = await yahooFinance.quoteSummary('USD' + homeCurrency + "=X");
    }
    catch (e) {
        return dataWithError(null, 'Invalid currency ' + homeCurrency);
    }
    const homeCurrencySymbol = forexQuote.price?.currencySymbol?.toString() || "$";

    // if user exists, update
    if (user) {
        await db.collection('user').doc(user.id).update({
            homeCurrency: homeCurrency,
            homeCurrencySymbol: homeCurrencySymbol
        });
    } else {
        // if user does not exist, create
        await db.collection('user').add({
            uid: sessionUser.uid,
            email: sessionUser.email,
            homeCurrency: homeCurrency,
            homeCurrencySymbol: homeCurrencySymbol
        });
    }
    
    // reset the redis cache
    await redisReset(request);

    return dataWithSuccess(null, 'Settings saved successfully');

}