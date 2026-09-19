// ==============================================================================
// FIREBASE CONFIGURATION & SERVICE WRAPPER
// ==============================================================================
// This file initializes Firebase Authentication (Google Sign-In) and
// Cloud Firestore (database) using modern browser ES modules without needing npm.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ------------------------------------------------------------------------------
// 1. FIREBASE CREDENTIALS
// Replace the placeholder values below with your Firebase Project Web App config.
// (You get this from the Firebase Console -> Project Settings -> General -> Web App)
// ------------------------------------------------------------------------------
export const firebaseConfig = {
    apiKey: "AIzaSyDUKj586-eSBweXvjNriB1-S_MC8CKUQkw",
    authDomain: "genesis-devotional.firebaseapp.com",
    projectId: "genesis-devotional",
    storageBucket: "genesis-devotional.firebasestorage.app",
    messagingSenderId: "680090594132",
    appId: "1:680090594132:web:039abc7498976673e9f6c1"
};

// Check whether real credentials have been provided
export const isConfigured = () => {
    return firebaseConfig.apiKey && 
           firebaseConfig.apiKey !== "YOUR_API_KEY" && 
           firebaseConfig.projectId !== "YOUR_PROJECT_ID";
};

// ------------------------------------------------------------------------------
// 2. INITIALIZATION
// ------------------------------------------------------------------------------
let app = null;
let auth = null;
let db = null;
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

if (isConfigured()) {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("Firebase initialized successfully.");
    } catch (err) {
        console.warn("Firebase initialization error:", err);
    }
} else {
    console.info("Firebase is running in Local Guest Mode. Add your Firebase credentials to firebase-config.js to enable cloud sync.");
}

// ------------------------------------------------------------------------------
// 3. AUTHENTICATION HELPERS
// ------------------------------------------------------------------------------

/**
 * Trigger Google Sign-In Popup.
 * Returns the user object on success.
 */
export async function loginWithGoogle() {
    if (!auth) {
        throw new Error("Firebase credentials not configured yet. Please update firebase-config.js with your project keys.");
    }
    try {
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
    } catch (error) {
        console.error("Google Sign-In Error:", error);
        throw error;
    }
}

/**
 * Sign out the currently signed-in user.
 */
export async function logoutUser() {
    if (!auth) return;
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Sign-out Error:", error);
        throw error;
    }
}

/**
 * Listen for user login/logout state changes.
 * @param {Function} callback function(user)
 */
export function onAuthStateChange(callback) {
    if (!auth) {
        callback(null);
        return () => {};
    }
    return onAuthStateChanged(auth, callback);
}

// ------------------------------------------------------------------------------
// 4. FIRESTORE DATABASE HELPERS
// ------------------------------------------------------------------------------

/**
 * Load user's devotional progress & journal from Cloud Firestore.
 * Document path: /users/{userId}
 * @param {string} userId - Firebase Auth user UID
 */
export async function loadUserData(userId) {
    if (!db || !userId) return null;
    try {
        const userRef = doc(db, "users", userId);
        const snapshot = await getDoc(userRef);
        if (snapshot.exists()) {
            return snapshot.data();
        } else {
            return null; // Document doesn't exist yet (first time user)
        }
    } catch (error) {
        console.error("Error loading user data from Firestore:", error);
        throw error;
    }
}

/**
 * Save user devotional progress & journal to Cloud Firestore.
 * Document path: /users/{userId}
 * @param {string} userId - Firebase Auth user UID
 * @param {object} data - { completedScriptures, completedCharities, completedDisciplines, journalIntentions, journalReflections }
 * @param {object} userMetadata - { displayName, email, photoURL }
 */
export async function saveUserData(userId, data, userMetadata = {}) {
    if (!db || !userId) return;
    try {
        const userRef = doc(db, "users", userId);
        const payload = {
            completedScriptures: data.completedScriptures || [],
            completedCharities: data.completedCharities || [],
            completedDisciplines: data.completedDisciplines || [],
            journalIntentions: data.journalIntentions || "",
            journalReflections: data.journalReflections || "",
            updatedAt: serverTimestamp()
        };

        if (userMetadata.displayName) payload.displayName = userMetadata.displayName;
        if (userMetadata.email) payload.email = userMetadata.email;
        if (userMetadata.photoURL) payload.photoURL = userMetadata.photoURL;

        await setDoc(userRef, payload, { merge: true });
        return true;
    } catch (error) {
        console.error("Error saving user data to Firestore:", error);
        throw error;
    }
}
