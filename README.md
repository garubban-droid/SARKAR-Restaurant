# MI EXPRESS BIRYANI — Production Package

This repository contains the customer food-ordering web app, production API, SQLite database layer, admin panel, and rider panel.

## Structure
- `index.html` — customer app
- `server.js` — Express API + database + auth + orders + coupons + referral + rider tracking + optional Razorpay
- `admin.html` — restaurant/admin dashboard at `/admin`
- `rider.html` — delivery rider dashboard at `/rider`
- `data/` — persistent SQLite database directory
- `.env.example` — required environment variables
- `render.yaml` — Render deployment configuration

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and set a long random `JWT_SECRET` and `ADMIN_PASSWORD`.
3. `npm install --omit=dev`
4. `npm start`
5. Customer: `http://localhost:10000/`
6. Admin: `http://localhost:10000/admin`
7. Rider: `http://localhost:10000/rider`

## Production requirements
### OTP
The customer splash flow uses OTP endpoints. Configure MSG91 credentials in the environment before production. The server deliberately refuses to send OTP when no provider is configured; development OTP logging is available only with `ALLOW_DEV_OTP=true`. MSG91 documents Send OTP and Verify OTP as its OTP flow. See the official docs: https://docs.msg91.com/otp

### Online payments
Cash on Delivery works without a payment gateway. Online payment support is prepared for Razorpay: set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and optionally `RAZORPAY_WEBHOOK_SECRET`. Keep the secret only on the server. Razorpay's current guidance uses a server-created order and server-side signature verification. See https://razorpay.com/payment-gateway/

### Database
SQLite is used for a simple single-service deployment. On Render, attach a persistent disk if you want the SQLite database to survive service replacement/redeploys. For larger scale, migrate the same schema/data layer to PostgreSQL.

## Admin
The admin panel uses `ADMIN_PASSWORD` as the dashboard key. Change it before deployment. It can manage products, publish/delete coupons, update order status, create riders, assign riders, and update restaurant settings.

## Rider
Create a rider in Admin. The rider logs in at `/rider`, sees assigned orders, updates status, and can share GPS coordinates for customer tracking.

## Important
Do not commit `.env`, database files, OTP auth keys, payment secrets, or admin passwords to GitHub.

## Current payment mode
Online payment is intentionally disabled for the current launch. Customers should use Cash on Delivery (COD). Razorpay variables/code are retained for a later phase and must not be enabled until payment credentials and verification are configured.

## 2Factor OTP
Set `OTP_PROVIDER=2factor`, `TWOFACTOR_API_KEY`, and `TWOFACTOR_TEMPLATE_NAME` in Render Environment Variables. The server sends OTP through 2Factor's REST API; the OTP itself is generated server-side and stored only as a bcrypt hash. 2Factor documents its OTP API at https://2factor.in/API/V1/OTP/SEND.


## Login/OTP connection fix
The customer login page now uses the deployed Render API when the HTML is opened directly from Android/Chrome (`content://`/`file://`), instead of attempting a fetch against the local file origin. The Express API also handles the required CORS preflight for local testing.

For production, open the app from the Render URL so customer pages and `/api/*` are same-origin. Do not put the 2Factor API key in `index.html`; keep it in Render Environment Variables.
