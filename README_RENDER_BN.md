# MI EXPRESS BIRYANI — Render Ready

এই package-এ Render Web Service-এর জন্য প্রয়োজনীয় backend structure দেওয়া আছে।

## Files
- `server.js` — Node/Express backend
- `package.json` — dependencies + start script
- `schema.sql` — PostgreSQL tables/indexes
- `public/index.html` — MI EXPRESS BIRYANI customer app
- `.env.example` — Render environment variables-এর template

## Render settings
**Service type:** Web Service  
**Language:** Node  
**Build Command:** `npm install`  
**Start Command:** `npm start`  
**Health Check Path:** `/api/health`

Render-এর Node web service-এ build command dependency install করে এবং start command server চালায়।

## Required Environment Variables
1. `DATABASE_URL` — PostgreSQL connection string
2. `JWT_SECRET` — long random secret

সাধারণত PostgreSQL connection-এর জন্য `DATABASE_URL` Render Postgres বা অন্য PostgreSQL provider থেকে নিতে হবে।

## Optional Environment Variables
- `DATABASE_SSL=true`
- `CORS_ORIGIN=https://your-customer-domain.com`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `RIDER_PHONE`
- `RIDER_PASSWORD`
- `RIDER_NAME`
- Razorpay variables

## Important
এই server startup-এর সময় `schema.sql` পড়ে database tables তৈরি/আপডেট করে। তাই `server.js`-এর পাশে `schema.sql` অবশ্যই থাকতে হবে।

`public/index.html`-ও অবশ্যই থাকতে হবে, কারণ `/` route customer app serve করে।

## Deploy
ZIP খুলে **এই root folder-এর সব files** Render-এ source হিসেবে দাও। `server.js`-কে অন্য নামে rename করবে না।

### If using GitHub
Repository root-এ এই structure রাখো:

```text
server.js
package.json
schema.sql
public/index.html
```

তারপর Render Web Service:

```text
Build: npm install
Start: npm start
Health: /api/health
```

## Current screenshot-এর error
`MODULE_NOT_FOUND` হওয়ার প্রধান কারণ ছিল Render যে `server.js` চালাচ্ছিল, deployment source-এ expected file/dependency structure ঠিকভাবে পাওয়া যাচ্ছিল না। এই package-এ filename ও required files একই root structure-এ রাখা হয়েছে।
