# Server Modules

Add backend feature files here as `*.js`. They are loaded automatically when the Node server starts.

Each module must export a function receiving the shared context:

```js
module.exports = ({ app, db, now, id, requireAdmin, requireCustomer, requireRider, getSetting, setSetting, defaultSettings }) => {
  // register routes/middleware here
};
```

Render/GitHub redeploys the server after a commit, so replacing one server module does not require editing `server.js`.
