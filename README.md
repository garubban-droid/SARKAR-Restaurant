# MI EXPRESS BIRYANI — Production Package

This repository contains the customer food-ordering web app, production API, SQLite database layer, admin panel, and rider panel.

## Structure
- `index.html` — customer app
- `server.js` — Express API + database + auth + orders + coupons + referral + rider tracking + optional Razorpay
- `admin.html` — restaurant/admin dashboard at `/admin` (connected to the server admin API)
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
The customer login flow uses a real OTP endpoint. Production is configured for 2Factor: set `OTP_PROVIDER=2factor`, `TWOFACTOR_API_KEY`, and `TWOFACTOR_TEMPLATE_NAME` in Render Environment Variables. The server deliberately refuses to send OTP when no provider is configured; development OTP logging is available only with `ALLOW_DEV_OTP=true`.

### Online payments
Cash on Delivery works without a payment gateway. Online payment support is prepared for Razorpay: set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and optionally `RAZORPAY_WEBHOOK_SECRET`. Keep the secret only on the server. Razorpay's current guidance uses a server-created order and server-side signature verification. See https://razorpay.com/payment-gateway/

### Database
SQLite is used for a simple single-service deployment. On Render, attach a persistent disk if you want the SQLite database to survive service replacement/redeploys. For larger scale, migrate the same schema/data layer to PostgreSQL.

## Admin
The admin panel uses `ADMIN_PASSWORD` as the dashboard key. Change it before deployment. The supplied Admin Panel authenticates with the server-side admin key and uses the `/api/admin/*` control routes. It can manage products, publish/delete coupons, update order status, create riders, assign riders, and update restaurant settings.

## Rider
Create a rider in Admin. The rider logs in at `/rider`, sees assigned orders, updates status, and can share GPS coordinates for customer tracking.

## Important
Do not commit `.env`, database files, OTP auth keys, payment secrets, or admin passwords to GitHub.

## Current payment mode
Online payment is intentionally disabled for the current launch. Customers should use Cash on Delivery (COD). Razorpay variables/code are retained for a later phase and must not be enabled until payment credentials and verification are configured.

## Environment variables
For the current launch, use:
- `OTP_PROVIDER=2factor`
- `TWOFACTOR_API_KEY=<your 2Factor key>`
- `TWOFACTOR_TEMPLATE_NAME=MIEEXPRESSOTP`
- `ENABLE_ONLINE_PAYMENTS=false`

## 2Factor OTP
Set `OTP_PROVIDER=2factor`, `TWOFACTOR_API_KEY`, and `TWOFACTOR_TEMPLATE_NAME` in Render Environment Variables. The server sends OTP through 2Factor's REST API; the OTP itself is generated server-side and stored only as a bcrypt hash.

2Factor API endpoint: `https://2factor.in/API/V1/OTP/SEND`


## Login/OTP connection fix
The customer login page now uses the deployed Render API when the HTML is opened directly from Android/Chrome (`content://`/`file://`), instead of attempting a fetch against the local file origin. The Express API also handles the required CORS preflight for local testing.

For production, open the app from the Render URL so customer pages and `/api/*` are same-origin. Do not put the 2Factor API key in `index.html`; keep it in Render Environment Variables.

## A-Z Admin Control Center
The Admin dashboard at `/admin` is the central control layer for the customer and rider apps. It can now manage:
- Customer App branding, restaurant status, address, delivery fee/radius, opening/closing time, referral reward, hero/ticker/menu titles and other business settings.
- Customer App profile setup, More/Help/Policy content and publish/unpublish controls through the stored settings JSON blocks.
- Full advanced settings JSON for power-user A-Z control.
- Menu products: create, edit, publish/unpublish and delete.
- Coupons: create, edit, publish/unpublish and delete.
- Orders: status updates, rider assignment and deletion.
- Customers: view, edit account information/promotional balance and delete account records.
- Riders: create, edit, enable/disable login access, reset password and delete; assigned orders are unassigned when a rider is deleted.
- Referral events: keep pending, reward or reject.

Changes are stored in the server-side SQLite settings/database layer and are consumed by the Customer App through `/api/settings`, `/api/products`, `/api/coupons/public`, and related API endpoints. The Customer App also performs periodic live synchronization while visible, so published/unpublished menu items, restaurant settings, coupons, profile options and related content refresh automatically without hardcoded Admin-only local data.


## Final connected package
The customer app uses the Express API for settings, menu, coupons, authentication, addresses, orders, tracking, ratings and referral data. Direct `file://` / `content://` opening also has an API bridge to the deployed Render URL; production should still be opened from the Render URL.

The rider app is connected to rider login, assigned orders, status updates, availability, statistics, GPS location and profile data. The server accepts both UI shorthand statuses (`READY`, `OUT_FOR_DELIVERY`, `DELIVERED`) and the database's normal status names.

The admin dashboard is included as `admin.html` and uses the `X-Admin-Key` API authentication flow.

Before production deployment, set `JWT_SECRET`, `ADMIN_PASSWORD`, `TWOFACTOR_API_KEY`, and `PUBLIC_BASE_URL` in Render Environment Variables. Do not commit `.env` or secrets.

## Modular Update System
The project now includes an automatic module loader. Frontend feature files placed in `modules/customer/`, `modules/admin/`, or `modules/rider/` are discovered and loaded automatically. Backend feature files placed in `modules/server/` are loaded by `server.js` at startup. This lets you replace a focused feature file without rebuilding the whole HTML page.

If GitHub is connected to Render with Auto Deploy enabled, pushing a changed module file triggers a new deployment. The frontend loader uses versioned module URLs to reduce stale browser-cache problems. Core authentication, database schema, and existing API contracts remain centralized for stability.

See `MODULES.md` for the exact workflow.
