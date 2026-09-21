SARKAR FULL PACKAGE — Referral Settings Update

This package carries the previous Customer App + Admin Panel together.

Requested change:
Admin Panel > Restaurant Management > 🗣️ Referral settings

Referral Settings page:
- Full page with 🔙 back
- Referral enable/disable
- Reward: Promotional Wallet Balance
- Reward amount editable
- Minimum first-order amount editable
- Referral code prefix editable
- Maximum referrals per customer editable
- Spam threshold editable
- Same-device reward blocking
- Multiple-account signal
- Spam signal detection
- Save Settings
- Delete / Reset Settings

Referral monitoring:
- Total referral count
- Rewarded / Pending / Blocked-Fake counts
- Total reward amount
- Referrer -> referred customer list
- Joined date, status, reward amount
- SAME DEVICE / MULTIPLE ACCOUNT / SPAM / SAME IP signals
- Individual referral/signal delete controls

Customer App:
- Refer & Earn added inside Profile
- Customer gets a referral code and shareable referral link
- New signup can enter referral code
- Referral history and counts
- Promotional balance display
- Reward is credited after the referred customer's first eligible order is Delivered
- Same mobile cannot create another account
- Suspicious same-device/multiple-account/spam patterns are recorded and can block reward according to settings

Security/logic:
- Referral reward is not paid for a cancelled/refunded/non-delivered order.
- Referral reward is credited only once per referred customer.
- The package keeps the previous Customer App and Admin Panel files together.


RIDER UPDATE
- Original Customer App and Referral Settings baseline retained.
- Added public/rider.html.
- Rider testing OTP: POST /api/rider/otp/request returns a testing OTP in the response; no SMS provider/DLT/webhook required.
- Rider registration requires OTP verification, profile fields, and password.
- Rider login remains mobile + password.
- Admin Restaurant Management > Riders opens a full page with Back, compact profile cards, Active/Inactive, and manual/generated password save.
- Existing rider order/delivery/GPS APIs are retained.
