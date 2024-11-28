import { dataWithSuccess } from "remix-toast";
import { requireUserSession } from "~/utils/auth.server";
import {db} from "~/utils/db.server";

export async function getUserByRequest(request: Request) {
    const sessionUser = await requireUserSession(request);
    
    if (!sessionUser) {
        return null;
    }

    return (await db.collection('user').where('uid', '==', sessionUser.uid).get()).docs[0]?.data() || null;
}

export async function setUserByRequest(request: Request) {
    const sessionUser = await requireUserSession(request);
    
    if (!sessionUser) {
        return null;
    }

    const data = await request.formData();
    const user = (await db.collection('user').where('uid', '==', sessionUser.uid).get()).docs[0];

    const homeCurrency = data.get('homeCurrency')?.toString().trim().toUpperCase();
    // if user exists, update
    if (user) {
        await db.collection('user').doc(user.id).update({
            homeCurrency: homeCurrency
        });
    } else {
        // if user does not exist, create
        await db.collection('user').add({
            uid: sessionUser.uid,
            email: sessionUser.email,
            homeCurrency: homeCurrency
        });
    }

    return dataWithSuccess(null, 'Settings saved successfully');

}