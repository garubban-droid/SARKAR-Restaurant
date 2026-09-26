MI EXPRESS BIRYANI — FINAL REAL OTP (GET 2 UI PRESERVED)

Files:
- index.html = final integrated GET 1 + unchanged GET 2 UI + real Login/Signup OTP
- server.js = existing backend with /api/customer/auth/send-otp and /api/customer/auth/verify-otp

Important:
1. Set TWOFACTOR_API_KEY in Render Environment Variables. Do not put the API key in index.html.
2. The frontend calls https://sarkar-restaurant-ix8d.onrender.com
3. GET 2 visible design is preserved. It does not add Login/Signup tabs.
4. Continue first attempts Login. If the mobile number does not exist, the app asks for the full name and then sends Signup OTP.
5. OTP is verified by the backend; any random 6-digit code is no longer accepted.
