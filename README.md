# MI EXPRESS BIRYANI — Complete Production Package

This package contains the integrated customer app, admin panel, rider app, Express API and PostgreSQL schema.

## Routes
- Customer: `/`
- Admin: `/admin`
- Rider: `/rider`
- Health: `/api/health`

## Included functionality
### Customer app
- Phone login/signup with real backend OTP verification
- Customer profile, password, addresses and location
- Menu/products and categories
- Cart and checkout
- Coupon validation and published offers
- COD ordering
- Order history, order detail, rating/review
- Rider/order tracking when location data is available
- Referral link and referral configuration
- Account/help/legal sections already present in the supplied UI

### Admin panel
- Secure admin login
- Restaurant settings and branding
- Product/menu create, edit, publish and delete
- Orders and status management
- Coupons: create, edit, publish/activate and delete
- Delivery-charge management
- Rider create/edit/activate/password management
- Referral settings and referral/fraud records
- Order tracking and daily reports

### Rider app
- Rider login/logout
- Profile and account information
- Online/offline availability
- Assigned/ready orders
- Order status updates through delivery flow
- GPS location updates
- Notifications/settings UI
- Rider statistics and daily/monthly delivery report

## Render setup
Set these environment variables in Render: `DATABASE_URL`, `DATABASE_SSL=true`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RIDER_PHONE`, `RIDER_PASSWORD`, `OTP_PROVIDER=2factor`, `TWOFACTOR_API_KEY`, `TWOFACTOR_TEMPLATE_NAME`, `TWOFACTOR_API_URL`, and `ENABLE_ONLINE_PAYMENTS=false`.

The server initializes the admin/rider account from the environment variables. Never commit real secrets to GitHub.

## OTP
The backend generates a six-digit OTP, sends it through the configured 2Factor endpoint and stores only a hash for verification. The 2Factor endpoint is configurable with `TWOFACTOR_API_URL`; the default is `https://2factor.in/API/V1/OTP/SEND`. The documented request uses `X-API-Key`, recipient, template name and OTP variable. If 2Factor returns HTTP 404, the server now reports a short configuration error instead of dumping the provider's HTML page into the customer UI.

## Payment
Current launch mode is COD. Razorpay code remains available for a later controlled activation, but `ENABLE_ONLINE_PAYMENTS=false` should remain set until credentials and verification are configured.

## Deployment
1. Upload the package contents to the GitHub repository root.
2. Render runs `npm install` then `npm start`.
3. Attach PostgreSQL and set `DATABASE_URL`.
4. Set the environment variables above.
5. Redeploy.
6. Test `/api/health`, then `/`, `/admin`, and `/rider`.
