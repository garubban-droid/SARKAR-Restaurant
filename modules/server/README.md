# Server Modules

Server modules are loaded automatically by server.js.

Add backend feature files as `.js` inside this folder.

Each module must export a function receiving the shared context:

```js
module.exports = ({
  app,
  db,
  now,
  id,
  requireAdmin,
  requireCustomer,
  requireRider,
  getSetting,
  setSetting,
  defaultSettings
}) => {
  // Register routes/middleware here
};
