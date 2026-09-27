# MI EXPRESS BIRYANI — OTP FIXED V3

Complete Customer App + Admin Panel + Rider App + Node/Express backend + PostgreSQL schema.

## OTP integration
The backend first uses the documented 2Factor OTP endpoint. If the provider returns endpoint/version 404, it falls back to 2Factor's documented API-key-in-path SMS endpoint so the server-generated OTP can still be sent and verified by this application.

Render environment variables:
- `OTP_PROVIDER=2factor`
- `TWOFACTOR_API_KEY=<your key>`
- `TWOFACTOR_TEMPLATE_NAME=<approved template, if using OTP endpoint>`
- `TWOFACTOR_SENDER_ID=<your approved sender ID; default TFCTOR>`
- `TWOFACTOR_MESSAGE_TEMPLATE=Your MI EXPRESS BIRYANI OTP is {otp}. Valid for 5 minutes.`

Do not put the API key in `index.html`.

## Important
The 2Factor account must have an active API key and approved DLT/entity/sender/template configuration. Code cannot create provider-side approvals.
