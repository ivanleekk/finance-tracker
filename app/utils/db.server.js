// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import admin from "firebase-admin";
import { applicationDefault } from "firebase-admin/app";
import {
    createUserWithEmailAndPassword,
    getAuth,
    GoogleAuthProvider,
    signInWithCredential,
    signInWithEmailAndPassword,
    signOut
} from "firebase/auth";
import dotenv from "dotenv";


dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            "type": process.env.FIREBASE_TYPE,
            "project_id": process.env.FIREBASE_PROJECT_ID,
            "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
            "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            "client_email": process.env.FIREBASE_CLIENT_EMAIL,
            "client_id": process.env.FIREBASE_CLIENT_ID,
            "auth_uri": process.env.FIREBASE_AUTH_URI,
            "token_uri": process.env.FIREBASE_TOKEN_URI,
            "auth_provider_x509_cert_url": process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
            "client_x509_cert_url": process.env.FIREBASE_CLIENT_X509_CERT_URL,
            "universe_domain": process.env.FIREBASE_UNIVERSE_DOMAIN
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}



let Firebase;

if (!Firebase) {
    Firebase = initializeApp(firebaseConfig);
}

export const db = admin.firestore();
export const adminAuth = admin.auth();
export const clientAuth = getAuth();

export async function signUpWithEmailAndPasswordFirebase(email, password) {
    return createUserWithEmailAndPassword(clientAuth, email, password);
}

export async function signInWithEmailAndPasswordFirebase(email, password) {
    return signInWithEmailAndPassword(clientAuth, email, password);
}

export async function getSessionToken(idToken) {
    const decodedToken = await adminAuth.verifyIdToken(idToken);

    if (new Date().getTime() / 1000 - decodedToken.auth_time > 5 * 60) {
        throw new Error('Recent sign-in required');
    }
    const twoWeeks = 60 * 60 * 24 * 14 * 1000;
    return adminAuth.createSessionCookie(idToken, { expiresIn: twoWeeks });

}

export async function signOutFirebase() {
    await signOut(clientAuth);
}

export async function signInWithGoogleIdToken(googleIdToken) {
    const credential = GoogleAuthProvider.credential(googleIdToken);

    try {
        return await signInWithCredential(clientAuth, credential); // Use this token for backend verification
    } catch (error) {
        console.error("Error signing in with Google ID token:", error);
        throw error;
    }
}