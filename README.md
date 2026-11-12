# MettalFold

Mettalfold agent workflow app (version 41).

- `UI/` holds the browser screens (HTML, CSS, JS) served by the server.
- `Server/` holds the Node.js server: request handling, Google Sheet connection, agent webhooks, tests and tools.

## Run locally
```
cd Server
npm install
cp .env.example .env   # then set APP_PASSWORD and SESSION_SECRET
npm start              # opens on http://localhost:3000
npm test               # automatic checks
```
See `Server/README.md` for connecting the real Google Sheet and agent webhooks. Never commit `.env`.
