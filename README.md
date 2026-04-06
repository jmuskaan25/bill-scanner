# Bill Scanner - Reimbursements Portal

A browser-based bill scanning and reimbursement submission tool. Upload receipts, extract details automatically using Claude AI, and submit for reimbursement. All data is stored in Firebase.

## Setup

### 1. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Enable **Firestore Database**:
   - Navigate to Firestore Database > Create Database
   - Choose a region and start in **test mode** (update rules later)
3. Enable **Firebase Storage**:
   - Navigate to Storage > Get Started
   - Start in **test mode** (update rules later)
4. Get your Firebase config:
   - Go to Project Settings > General > Your apps > Add a Web app
   - Copy the `firebaseConfig` object

### 2. Firestore Security Rules

Go to Firestore Database > Rules and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /reimbursements/{docId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(['submittedBy', 'email', 'totalAmount', 'status'])
                    && request.resource.data.status == 'pending';
      allow update: if false; // Only allow updates via admin SDK
      allow delete: if false;
    }
  }
}
```

### 3. Storage Security Rules

Go to Storage > Rules and paste:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /bills/{fileName} {
      allow read: if true;
      allow write: if request.resource.size < 20 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*|application/pdf');
    }
  }
}
```

### 4. Configure API Keys

Edit `config.js` and fill in your keys:

```js
const CONFIG = {
  CLAUDE_API_KEY: 'sk-ant-...',     // Your Anthropic API key
  FIREBASE: {
    apiKey: '...',                    // From Firebase config
    authDomain: '....firebaseapp.com',
    projectId: '...',
    storageBucket: '....appspot.com',
    messagingSenderId: '...',
    appId: '...'
  }
};
```

**Important:** `config.js` contains secrets. If deploying to a public GitHub Pages repo, consider using a private repo or environment-based approach.

### 5. Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an API key
3. The app uses `claude-haiku-4-5-20251001` for fast, cost-effective bill extraction
4. Direct browser calls require the `anthropic-dangerous-direct-browser-access` header (already configured)

### 6. Deploy to GitHub Pages

1. Create a GitHub repository
2. Push all files to the `main` branch
3. Go to Settings > Pages > Source: Deploy from branch > `main` / `root`
4. Your app will be live at `https://<username>.github.io/<repo>/`

**Note:** Make sure `config.js` is NOT committed to a public repo. Add it to `.gitignore` if the repo is public, and have each user create their own `config.js` locally.

## Usage

1. Open the app in your browser
2. Upload a bill image (JPG, PNG, WEBP) or PDF
3. Click "Scan Bill" to extract information using AI
4. Review extracted details and fill in your name, email, and purpose
5. Click "Submit Reimbursement" to save to Firebase
6. View recent submissions in the table below

## File Structure

```
bill_scanner/
  index.html    - Main HTML page
  styles.css    - All styles
  app.js        - Application logic (ES module)
  config.js     - API keys and Firebase config (not committed to public repos)
  README.md     - This file
```

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (no build tools)
- **AI:** Claude claude-haiku-4-5-20251001 via Anthropic Messages API (vision)
- **Storage:** Firebase Firestore + Firebase Storage
- **Hosting:** GitHub Pages (or any static host)
