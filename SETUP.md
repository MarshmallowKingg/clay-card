# Setting up Clay Card for the club (about 20 minutes, £0)

## 1. Club database (Google Sheet)

Use a **club Google account** rather than a personal one, so the Sheet stays with the club when committee members change.

1. Create a new Google Sheet called "Clay Card scores".
2. Go to **Extensions → Apps Script**. Delete what's there, paste in `backend/Code.gs`, then save.
3. Go to **Project Settings (⚙) → Script properties → Add property**. Set the name to `PIN` and the value to your club PIN (for example, 4 to 6 digits). Save.
4. Back in the editor, choose `setup` from the function menu and press **Run**. Approve the permissions; it's your own script. A **Scores** tab appears.
5. Go to **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Press **Deploy** and copy the **Web app URL**. It ends in `/exec`.

"Anyone" means anyone with the URL can reach the script, but nothing is read or written without the PIN.

## 2. App settings

Edit `src/config.js`:

```js
CLUB_NAME: 'Notton Clay Club',
API_URL: 'https://script.google.com/macros/s/XXXX/exec',
```

## 3. Hosting

### Option A: GitHub Pages (recommended; every push deploys automatically)
1. Create a GitHub repo and push this folder to `main`.
2. Go to **Settings → Pages → Source: GitHub Actions**.
3. The workflow runs the tests and publishes the app to `https://<user>.github.io/<repo>/`.

### Option B: Netlify Drop (no Git)
Drag the folder onto https://app.netlify.com/drop. To update, drag it again.

## 4. Members

1. Open the link on your phone, then use **Share → Add to Home Screen** (iPhone) or **Install app** (Android).
2. Go to **⚙ Settings**, enter your name and the club PIN, then press **Test connection**.
3. Open the app once while you have signal. After that it works offline.

## Updating the app

1. Make your changes and run `npm test`.
2. Bump `VERSION` in `sw.js` (for example, `claycard-v2`), so phones pick up the new version.
3. Push (GitHub Pages) or re-drop (Netlify).

If you change `backend/Code.gs`, go to **Deploy → Manage deployments → Edit → Version: New version**. This keeps the same URL.

## Data protection

Members' names and scores are personal data held by the club. Mention score records in the club's privacy notice, and share the Sheet only with officers. To change the PIN, edit the script property; members then update it in Settings.
