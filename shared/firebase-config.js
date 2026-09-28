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
    serverTimestamp,
    collection,
    getDocs,
    onSnapshot,
    increment
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


export const DEFAULT_GROUP_ID = "open-brotherhood";
export const DEFAULT_GROUP_NAME = "Fellowship of Fathers";

/**
 * Clean & slugify group identifier
 */
export function normalizeGroupId(groupId) {
    if (!groupId) return DEFAULT_GROUP_ID;
    return String(groupId)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || DEFAULT_GROUP_ID;
}

/**
 * Ensures group metadata exists in /groups/{groupId}
 */
export async function createOrJoinGroup(groupId, groupName = "", creatorMetadata = {}) {
    if (!db) return { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME };
    const cleanId = normalizeGroupId(groupId);
    try {
        const groupRef = doc(db, "groups", cleanId);
        const snap = await getDoc(groupRef);
        if (!snap.exists()) {
            const finalName = (groupName && groupName.trim()) ? groupName.trim() : (cleanId === DEFAULT_GROUP_ID ? DEFAULT_GROUP_NAME : cleanId.toUpperCase());
            const payload = {
                id: cleanId,
                name: finalName,
                createdAt: serverTimestamp()
            };
            if (creatorMetadata.userId) payload.createdBy = creatorMetadata.userId;
            await setDoc(groupRef, payload);
            return payload;
        } else {
            return snap.data();
        }
    } catch (err) {
        console.warn("createOrJoinGroup error:", err);
        return { id: cleanId, name: groupName || cleanId };
    }
}

/**
 * Retrieve group metadata
 */
export async function getGroupInfo(groupId) {
    if (!db) return { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME };
    const cleanId = normalizeGroupId(groupId);
    try {
        const groupRef = doc(db, "groups", cleanId);
        const snap = await getDoc(groupRef);
        if (snap.exists()) {
            return snap.data();
        }
        return { id: cleanId, name: cleanId === DEFAULT_GROUP_ID ? DEFAULT_GROUP_NAME : cleanId.toUpperCase() };
    } catch (err) {
        return { id: cleanId, name: cleanId };
    }
}

/**
 * Load user devotional progress for a specific group cohort
 */
export async function loadUserGroupData(groupId, userId) {
    if (!db || !userId) return null;
    const cleanId = normalizeGroupId(groupId);
    try {
        // 1. First check the group subcollection: /groups/{groupId}/members/{userId}
        const memberRef = doc(db, "groups", cleanId, "members", userId);
        const snap = await getDoc(memberRef);
        if (snap.exists()) {
            return snap.data();
        }
        
        // 2. If this is default group or first time, check fallback /users/{userId}
        if (cleanId === DEFAULT_GROUP_ID) {
            const userRef = doc(db, "users", userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                return userSnap.data();
            }
        }
        return null;
    } catch (err) {
        console.error("loadUserGroupData error:", err);
        throw err;
    }
}

/**
 * Save user devotional progress for a specific group cohort
 */
export async function saveUserGroupData(groupId, userId, data, userMetadata = {}) {
    if (!db || !userId) return;
    const cleanId = normalizeGroupId(groupId);
    try {
        const memberRef = doc(db, "groups", cleanId, "members", userId);
        const activeDay = data.currentDay || 1;
        const payload = {
            completedScriptures: data.completedScriptures || [],
            completedCharities: data.completedCharities || [],
            completedDisciplines: data.completedDisciplines || [],
            dailyNotes: data.dailyNotes || {},
            journalIntentions: data.dailyNotes?.[activeDay]?.intentions || data.journalIntentions || "",
            journalReflections: data.dailyNotes?.[activeDay]?.reflections || data.journalReflections || "",
            updatedAt: serverTimestamp()
        };

        if (userMetadata.displayName) payload.displayName = userMetadata.displayName;
        if (userMetadata.email) payload.email = userMetadata.email;
        if (userMetadata.photoURL) payload.photoURL = userMetadata.photoURL;

        // Save into group member document
        await setDoc(memberRef, payload, { merge: true });

        // Ensure group metadata exists
        const groupRef = doc(db, "groups", cleanId);
        await setDoc(groupRef, {
            id: cleanId,
            name: data.groupName || cleanId,
            lastActivity: serverTimestamp()
        }, { merge: true });

        // Also update /users/{userId} user profile with last active group
        const userRef = doc(db, "users", userId);
        await setDoc(userRef, {
            ...payload,
            lastGroupId: cleanId,
            lastGroupName: data.groupName || cleanId
        }, { merge: true });

        return true;
    } catch (err) {
        console.error("saveUserGroupData error:", err);
        throw err;
    }
}

/**
 * Real-time listener for a specific group's brotherhood roster and stats
 */
export function subscribeGroupBrotherhood(groupId, callback) {
    if (!db) {
        callback({ members: [], stats: getEmptyStats() });
        return () => {};
    }
    const cleanId = normalizeGroupId(groupId);
    try {
        const membersCol = collection(db, "groups", cleanId, "members");
        return onSnapshot(membersCol, (snapshot) => {
            const members = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                members.push({
                    uid: docSnap.id,
                    displayName: data.displayName || "Father in Christ",
                    email: data.email || "",
                    photoURL: data.photoURL || "",
                    completedScriptures: data.completedScriptures || [],
                    completedCharities: data.completedCharities || [],
                    completedDisciplines: data.completedDisciplines || [],
                    dailyNotes: data.dailyNotes || {},
                    updatedAt: data.updatedAt ? data.updatedAt.toDate() : null
                });
            });

            // If empty and default group, check legacy /users collection
            if (members.length === 0 && cleanId === DEFAULT_GROUP_ID) {
                const legacyCol = collection(db, "users");
                getDocs(legacyCol).then(legacySnap => {
                    const legacyMembers = [];
                    legacySnap.forEach(d => {
                        const data = d.data();
                        legacyMembers.push({
                            uid: d.id,
                            displayName: data.displayName || "Father in Christ",
                            email: data.email || "",
                            photoURL: data.photoURL || "",
                            completedScriptures: data.completedScriptures || [],
                            completedCharities: data.completedCharities || [],
                            completedDisciplines: data.completedDisciplines || [],
                            dailyNotes: data.dailyNotes || {},
                            updatedAt: data.updatedAt ? data.updatedAt.toDate() : null
                        });
                    });
                    legacyMembers.sort((a, b) => {
                        const aDone = a.completedScriptures.length + a.completedCharities.length + a.completedDisciplines.length;
                        const bDone = b.completedScriptures.length + b.completedCharities.length + b.completedDisciplines.length;
                        return bDone - aDone;
                    });
                    callback({ members: legacyMembers, stats: calculateBrotherhoodStats(legacyMembers) });
                }).catch(() => {
                    callback({ members: [], stats: getEmptyStats() });
                });
                return;
            }

            members.sort((a, b) => {
                const aDone = a.completedScriptures.length + a.completedCharities.length + a.completedDisciplines.length;
                const bDone = b.completedScriptures.length + b.completedCharities.length + b.completedDisciplines.length;
                return bDone - aDone;
            });

            const stats = calculateBrotherhoodStats(members);
            callback({ members, stats });
        }, (error) => {
            console.warn("Group snapshot listener error:", error);
            callback({ members: [], stats: getEmptyStats(), error: error.message });
        });
    } catch (err) {
        console.error("subscribeGroupBrotherhood error:", err);
        callback({ members: [], stats: getEmptyStats() });
        return () => {};
    }
}

/**
 * Real-time listener for Global Stats across all brotherhood cohorts
 */
export function subscribeGlobalStats(callback) {
    if (!db) {
        callback({ totalFathers: 0, totalBrothers: 0, totalHoursKneeling: 0, totalCharities: 0, totalScriptures: 0 });
        return () => {};
    }
    try {
        const usersCol = collection(db, "users");
        return onSnapshot(usersCol, (snapshot) => {
            let totalScriptures = 0;
            let totalCharities = 0;
            let totalKneeling = 0;
            let totalFathers = snapshot.size;

            snapshot.forEach(docSnap => {
                const d = docSnap.data();
                if (d.completedScriptures) totalScriptures += d.completedScriptures.length;
                if (d.completedCharities) totalCharities += d.completedCharities.length;
                if (d.completedDisciplines) totalKneeling += d.completedDisciplines.length;
            });

            const rawHours = (totalKneeling * 0.25).toFixed(1);
            const totalHoursKneeling = rawHours.endsWith('.0') ? parseInt(rawHours) : Number(rawHours);

            callback({
                totalFathers,
                totalBrothers: totalFathers, // backward compatibility
                totalHoursKneeling,
                totalCharities,
                totalScriptures
            });
        }, (err) => {
            console.warn("Global stats listener warning:", err);
            callback({ totalFathers: 0, totalBrothers: 0, totalHoursKneeling: 0, totalCharities: 0, totalScriptures: 0 });
        });
    } catch (err) {
        console.error("subscribeGlobalStats error:", err);
        callback({ totalFathers: 0, totalBrothers: 0, totalHoursKneeling: 0, totalCharities: 0, totalScriptures: 0 });
        return () => {};
    }
}

// Backward-compatible wrappers
export async function loadUserData(userId) {
    return loadUserGroupData(DEFAULT_GROUP_ID, userId);
}

export async function saveUserData(userId, data, userMetadata = {}) {
    return saveUserGroupData(DEFAULT_GROUP_ID, userId, data, userMetadata);
}

export function subscribeBrotherhood(callback) {
    return subscribeGroupBrotherhood(DEFAULT_GROUP_ID, callback);
}

export const subscribeGroupFathers = subscribeGroupBrotherhood;
export const subscribeFathers = subscribeBrotherhood;

function getEmptyStats() {
    return {
        totalFathers: 0,
        totalBrothers: 0,
        totalHoursKneeling: 0,
        totalCharities: 0,
        totalScriptures: 0,
        totalCompletedDays: 0
    };
}

function calculateBrotherhoodStats(members) {
    let totalKneelingSessions = 0;
    let totalCharities = 0;
    let totalScriptures = 0;
    let totalCompletedDays = 0;

    members.forEach(m => {
        totalScriptures += m.completedScriptures.length;
        totalCharities += m.completedCharities.length;
        totalKneelingSessions += m.completedDisciplines.length;

        // A day is fully complete if all 3 requirements are marked
        for (let day = 1; day <= 10; day++) {
            if (m.completedScriptures.includes(day) && 
                m.completedCharities.includes(day) && 
                m.completedDisciplines.includes(day)) {
                totalCompletedDays++;
            }
        }
    });

    // 15 minutes per kneeling session = 0.25 hours
    const rawHours = (totalKneelingSessions * 0.25).toFixed(1);
    const totalHoursKneeling = rawHours.endsWith('.0') ? parseInt(rawHours) : Number(rawHours);

    return {
        totalFathers: members.length,
        totalBrothers: members.length,
        totalHoursKneeling,
        totalCharities,
        totalScriptures,
        totalCompletedDays
    };
}

// ------------------------------------------------------------------------------
// 5. SECTION ACCESS CONTROL
// ------------------------------------------------------------------------------
// The single source of truth for "may this user read this section?" is the
// entitlement document written by the Stripe webhook Cloud Function:
//
//   /users/{uid}/entitlements/sections   { sections: ["genesis"], grandfathered: bool }
//
// The browser can READ that document and can never write it (see
// firestore.rules), so a user cannot grant themselves access from the console.
// Anyone who was already using the app before payments launched has
// `grandfathered: true` there, and keeps every current and future section.

const ENTITLEMENTS_COLLECTION = 'entitlements';
const ENTITLEMENTS_DOC = 'sections';

// Small in-memory cache so the catalog and the section page do not re-read the
// same document on every render. 60 seconds is short enough that a fresh
// purchase shows up on the next page load.
const ENTITLEMENT_CACHE_MS = 60 * 1000;
const _entitlementCache = new Map();

/**
 * Read a user's entitlements straight from Firestore (bypassing the cache).
 * @returns {Promise<{sections: string[], grandfathered: boolean}>}
 */
export async function fetchEntitlements(userId) {
    if (!db || !userId) return { sections: [], grandfathered: false };
    const ref = doc(db, 'users', userId, ENTITLEMENTS_COLLECTION, ENTITLEMENTS_DOC);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    return {
        sections: Array.isArray(data.sections) ? data.sections : [],
        grandfathered: data.grandfathered === true
    };
}

/**
 * Cached entitlements for a user.
 */
export async function getEntitlements(userId) {
    if (!userId) return { sections: [], grandfathered: false };
    const cached = _entitlementCache.get(userId);
    if (cached && Date.now() - cached.at < ENTITLEMENT_CACHE_MS) {
        return cached.value;
    }
    const value = await fetchEntitlements(userId);
    _entitlementCache.set(userId, { value, at: Date.now() });
    return value;
}

/** Drop the cache (call after a checkout returns, or on sign-out). */
export function clearEntitlementCache(userId) {
    if (userId) {
        _entitlementCache.delete(userId);
    } else {
        _entitlementCache.clear();
    }
}

/**
 * Check if a user has access to a specific section.
 *
 * Note this is a *convenience* check for the UI: because the devotional text
 * ships inside genesis/index.html, the paywall cannot be a hard security
 * boundary on its own. It stops honest misuse and gives a clean purchase flow.
 *
 * @returns {Promise<{hasAccess: boolean, reason: string}>}
 */
export async function checkSectionAccess(userId, sectionSlug) {
    if (!db || !userId) return { hasAccess: false, reason: 'not-signed-in' };

    try {
        const entitlements = await getEntitlements(userId);

        if (entitlements.grandfathered) {
            return { hasAccess: true, reason: 'grandfathered' };
        }
        if (entitlements.sections.includes(sectionSlug)) {
            return { hasAccess: true, reason: 'purchased' };
        }
        return { hasAccess: false, reason: 'not-purchased' };
    } catch (err) {
        // A rules or network failure must fail closed: no access, and the
        // access gate shows the purchase panel rather than the content.
        console.error('checkSectionAccess error:', err);
        return { hasAccess: false, reason: 'error' };
    }
}

/**
 * Get the current user's Firebase Auth ID token for API calls.
 * Used by the Stripe checkout flow to authenticate with Cloud Functions.
 */
export async function getAuthToken() {
    if (!auth || !auth.currentUser) return null;
    try {
        return await auth.currentUser.getIdToken();
    } catch (err) {
        console.error("getAuthToken error:", err);
        return null;
    }
}
