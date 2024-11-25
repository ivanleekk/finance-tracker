// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import admin from "firebase-admin";
import {applicationDefault} from "firebase-admin/app";
import {createUserWithEmailAndPassword, signOut, getAuth, signInWithEmailAndPassword} from "firebase/auth";
import dotenv from "dotenv";


dotenv.config();

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyC-tNeIxNn_X6eyj5z1jizoWz9aguFSI7c",
    authDomain: "finance-tracker-5a29c.firebaseapp.com",
    projectId: "finance-tracker-5a29c",
    storageBucket: "finance-tracker-5a29c.firebasestorage.app",
    messagingSenderId: "49464458067",
    appId: "1:49464458067:web:402267ff2c61192f133fa6",
    measurementId: "G-XHV4B21QGD"
};

if (!admin.apps.length) {
    admin.initializeApp({
        credential: applicationDefault(),
        databaseURL: "https://finance-tracker-5a29c.asia-southeast1.firebaseio.com"
    });
}



let Firebase;

if (!Firebase) {
    Firebase = initializeApp(firebaseConfig);
}

export const db = admin.firestore();
export const adminAuth = admin.auth();
export const clientAuth = getAuth(Firebase);

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
    return adminAuth.createSessionCookie(idToken, {expiresIn: twoWeeks});

}

export async function signOutFirebase() {
    await signOut(clientAuth);
}

