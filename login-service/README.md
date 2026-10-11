# Fanqie author login service

Self-hosted companion for the `n8n-nodes-fanqie` Browser Login credential. It presents the official website inside a private, isolated login browser and returns the captured session to n8n through a one-time, PKCE-bound credential callback.

See [Browser Login setup](../docs/BROWSER_LOGIN.md). This is a session bridge, not an official Fanqie authorization server.

```sh
cp .env.example .env
# Configure the HTTPS service origin, exact n8n callback and random client secret.
docker compose up -d --build
```

```sh
node --test tests/*.test.mjs
```

The login UI and server use no request/session/input logging. Author credentials live in n8n's encrypted credential store after connection. Reconnect when the website session expires. Real author-account login remains a separate validation step.
