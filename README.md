# SkillSwap setup

This project keeps the existing React/Vite website and adds a Node.js/Express API backed by MySQL. The WebRTC signaling service remains in `server/signaling.js`.

## 1. Start XAMPP and create the database

1. Open the XAMPP Control Panel and start **MySQL** and **Apache**.
2. Open [http://localhost/phpmyadmin](http://localhost/phpmyadmin).
3. Select **Import**. Choose `server/schema.sql`, then select **Import** at the bottom. The script creates the `skillswap` database and its tables.
4. In the project root, copy `.env.example` to `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Open `.env` in VS Code. Set `DB_USER` and `DB_PASSWORD` to the MySQL account used by XAMPP. A default local XAMPP install often uses `root` with a blank password; keep the values that match your installation.
6. Generate a private JWT secret in a terminal:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Paste the result into `JWT_SECRET` in `.env`. Do not commit `.env` or paste this secret into frontend code.

## 2. Install and run

From the project root (`D:\website practice\web wala`):

```powershell
npm install
npm run dev
```

`npm run dev` starts three local processes:

- Website: `http://localhost:5173`
- Express API: `http://localhost:8788`
- Video signaling: `ws://localhost:8787`

Vite forwards `/api` requests to Express. Keep the terminal open while using the site. The API health check is `http://localhost:8788/api/health`; it should return `{"status":"ok","database":"connected"}`.

## 3. Try the features

Use two separate accounts (for example, a normal browser window and an Incognito window) to try partner-to-partner features.

1. **Registration and login:** open **Create an account**, register with a name, email and password of at least 8 characters. Log out, then log in with the same credentials. A duplicate email should be rejected.
2. **Create a profile:** open **My Skills**. Add a skill to teach and a skill to learn. Save your headline, About text, learning goal and availability. Reload the page; the values should still be there.
3. **Skill matching:** create a second account and add reciprocal skills (one account teaches JavaScript and wants Python; the other teaches Python and wants JavaScript). Open **Skill Partners** or **AI Match** and search. Matching users should appear with a rule-based score.
4. **Exchange request:** from the first account send a request to the matching partner. In the second account, open **My Exchanges** and accept it. The first account should see the accepted status after reload.
5. **Schedule:** from either account schedule a future Online Video Exchange or Offline session. Try an overlapping time for another exchange; the API should reject it. The saved session should appear in My Exchanges after reload.
6. **Feedback and completion:** end an online call to complete it, or use the session completion control in the existing interface. Submit ratings and feedback. Reload and confirm the completed session and review remain saved.

The earlier local-only demo records stay in the browser. The first time a real account loads backend data, the prior exchange JSON is also copied to the `skillswap-local-demo-backup` localStorage key; it is not imported into MySQL.

## 4. API routes

All authenticated routes expect `Authorization: Bearer <JWT>`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Check API and MySQL connection |
| POST | `/api/auth/register` | Create account; password stored as bcrypt hash |
| POST | `/api/auth/login` | Verify password and return a short-lived JWT |
| GET | `/api/auth/me` | Return signed-in user and profile |
| GET / PUT | `/api/profile` | Read or save profile and skills |
| GET | `/api/matches?skill=Python` | Find matching users from saved skills |
| GET / POST | `/api/requests` | List or send exchange requests |
| PATCH | `/api/requests/:id` | Accept, reject or cancel a request |
| POST | `/api/requests/:id/sessions` | Schedule or reschedule; checks time conflicts |
| PATCH | `/api/sessions/:id/status` | Complete or cancel a session |
| POST | `/api/sessions/:id/feedback` | Save one review per completed session and reviewer |

## 5. Security and deployment

- Passwords are hashed with bcrypt. The JWT signing secret and MySQL credentials are read from `.env`; `.gitignore` excludes it.
- For production, use a managed MySQL database and a Node.js host for the API. Set `DB_*`, `JWT_SECRET`, `CLIENT_ORIGIN`, and `PORT` as private host environment variables. Use a unique production secret and HTTPS.
- GitHub Pages can host the built frontend (`npm run build` creates `dist/`), but it cannot run Express or MySQL. Deploy the API separately, set `VITE_API_URL` to its HTTPS API base before building the frontend, and set `CLIENT_ORIGIN` to the frontend URL.
- The video call also needs the signaling service available over secure WebSockets (`wss://`). Set `VITE_SIGNALING_URL` to that URL for a deployed frontend. For reliable calls across restrictive networks, configure a TURN service through the existing `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` build variables.

## Verification notes

`npm run build` and Node syntax checks pass. Basic API smoke checks return 400 for invalid registration input and 401 for a protected route without a token. Full account, profile, matching, request, schedule and feedback tests require XAMPP MySQL to be running and the schema imported; MySQL was not running during the initial smoke checks.
