# MI EXPRESS BIRYANI — Modular Update System

The project is organized so future feature changes can be isolated to one file whenever possible.

## Frontend
- Customer modules: `modules/customer/`
- Admin modules: `modules/admin/`
- Rider modules: `modules/rider/`
- Add or replace a `.js` or `.css` file there. The loader discovers it automatically.
- The stable API/database remains in `server.js`.

## Backend
- Backend feature modules: `modules/server/`
- Each `.js` file exports a function and is loaded automatically by `server.js` at startup.
- Use these for new API features so future backend additions do not require editing the main server file.

## Deployment behavior
If the GitHub repository is connected to Render with Auto Deploy enabled, pushing a changed module file triggers a new deployment. The browser module loader adds a version query so changed frontend modules are not stuck in browser cache.

## Important boundary
Existing core database/API routes remain centralized for stability and security. A module should not duplicate an existing route; add a new route or feature module instead. Changes to core authentication/database schema should be reviewed in `server.js`.
