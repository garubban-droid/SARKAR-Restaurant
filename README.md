# MI EXPRESS BIRYANI — Environment / GET1 Update

## Render Environment Variables
Use the same variable names shown in the Render Environment screen:
- ADMIN_EMAIL
- ADMIN_PASSWORD
- DATABASE_URL
- ENABLE_ONLINE_PAYMENTS
- JWT_SECRET
- OTP_PROVIDER
- TWOFACTOR_API_KEY
- TWOFACTOR_TEMPLATE_NAME

Real secret values must be entered only in Render. `.env.example` contains placeholders only.

## GET 1
GET 1 has been removed from the customer startup flow. The customer now opens the existing login/OTP screen directly; GET 2 UI and the rest of the customer app are retained.
