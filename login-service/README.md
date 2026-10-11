# Fanqie QR login component

Self-hosted companion for `n8n-nodes-fanqie`, using the QR code shown by the official Fanqie author login page. Users scan with Fanqie Novel or Fanqie Writer Assistant; no browser extension or header copying is required.

See [the Chinese deployment and user guide](../docs/QR_LOGIN.md).

This component uses an isolated browser for each login, verifies the author account, and encrypts website sessions on disk. Its OAuth2-compatible callback is an internal connection protocol between your component and n8n, not a public Fanqie OAuth integration. n8n receives an opaque connection token and calls the component's bounded author-request bridge.

```sh
npm ci --ignore-scripts
npm test
docker compose up -d --build
```

Copy `.env.example` to `.env`, configure independent secrets and exact callback URLs, and create `data/` owned by the image's `pwuser` (UID/GID 1001) before starting. Keep `.env` and `data/` across restarts. HTTPS is required for public hosts; trusted LAN HTTP requires explicit configuration.

The service intentionally exposes only QR display, refresh, status, completion and cancel actions. Extra verification that cannot be completed on the phone reports a clear failure. Writes are never automatically retried.
