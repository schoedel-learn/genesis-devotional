# Setup Guide: Google Sign-In & Cloud Sync for genesis.catholic.work

This guide explains how to connect your devotional website to Google Sign-In and Cloud Firestore so different users can log in and have their personal progress saved in the cloud.

---

### Key Concepts (Defined Inline)
- **Firebase Authentication**: A Google service that handles user login popups and securely verifies user identity without needing your own server.
- **Cloud Firestore**: A flexible, real-time cloud database from Google that stores data in documents. Each user gets their own private document under `/users/{userId}`.
- **Authorized Domain**: A security whitelist of website domains permitted to trigger Google Sign-In for your Firebase project.
- **Firestore Security Rules**: Server-side rules ensuring that user A can never view or modify user B's personal journal or checklists.

---

### Step 1: Create Your Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or **Create a project**).
3. Name it (e.g., `genesis-devotional`).
4. Google Analytics is optional; you can disable or enable it, then click **Create project**.

---

### Step 2: Enable Google Sign-In
1. In the left sidebar, click **Build** -> **Authentication**.
2. Click **Get started**.
3. Under the **Sign-in method** tab, click **Google**.
4. Toggle the **Enable** switch to ON.
5. Choose your public-facing project support email from the dropdown.
6. Click **Save**.

---

### Step 3: Authorize Your Domains
Google blocks logins from unauthorized domains for security.
1. In **Authentication**, click the **Settings** tab at the top.
2. Select **Authorized domains** in the submenu.
3. Verify that `localhost` is present (for testing on your computer).
4. Click **Add domain** and enter:
genesis.catholic.work
5. Click **Done**.

---

### Step 4: Create Cloud Firestore Database
1. In the left sidebar, click **Build** -> **Firestore Database**.
2. Click **Create database**.
3. Choose a location closest to your users (e.g., `nam5 (us-central)`).
4. For security rules, select **Start in production mode** and click **Create**.
5. Once created, click the **Rules** tab at the top.
6. Paste the following rules (already saved in your `firestore.rules` file):

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}

7. Click **Publish**.

---

### Step 5: Add Your Web App Credentials to `firebase-config.js`
1. Click the **Gear icon ⚙️** next to **Project Overview** (top-left) -> **Project settings**.
2. Scroll down to the **Your apps** card and click the **Web icon `</>`**.
3. Name the app (e.g. `genesis-web`) and click **Register app**.
4. You will see a `firebaseConfig` object looking like this:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "genesis-devotional.firebaseapp.com",
  projectId: "genesis-devotional",
  storageBucket: "genesis-devotional.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```
5. Open `firebase-config.js` in your project folder:
   Replace the placeholder values in `firebaseConfig` with your actual keys.

---

### Step 6: Deploying to `genesis.catholic.work`

#### Option A: Deploy via Firebase Hosting (Recommended - Free SSL & CDN)
1. Log in to Firebase CLI from your terminal:
firebase login

2. Initialize hosting in this directory:
firebase init hosting
(Select "Use an existing project", pick your project, set public directory to `.` and answer `N` to single-page app overwrite).

3. Deploy the site and database rules:
firebase deploy

4. Connect your custom domain:
   - In Firebase Console -> **Build** -> **Hosting** -> click **Add custom domain**.
   - Enter `genesis.catholic.work`.
   - Firebase will give you two `A` records (IP addresses).
   - Go to your DNS provider for `catholic.work` and create an `A` record for host `genesis` pointing to those IPs.
   - SSL certificates are automatically provisioned within a few hours.

#### Option B: Deploy via Existing Hostinger VPS / Dokploy / Nginx
If you are hosting `catholic.work` subdomains on your VPS:
1. Upload the files (`index.html`, `firebase-config.js`, `firestore.rules`) to your server directory (e.g., via SFTP or Git).
2. Point Nginx/Traefik to serve that directory for host `genesis.catholic.work`.
3. Because all authentication and database communication happens directly from the user's browser to Google's servers, no backend Node/Python server is required on your VPS!
