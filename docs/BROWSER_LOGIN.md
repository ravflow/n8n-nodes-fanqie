# Browser login

Browser Login removes manual Cookie and CSRF copying. A self-hosted companion service opens an isolated browser on the official Fanqie author website. The user completes the website's own QR, SMS or verification steps in the login window. The service captures the resulting website session and hands it to n8n's native credential callback.

This is an independent session bridge, not an official Fanqie OAuth integration. The OAuth authorization server is your login service. Fanqie API requests still use website session cookies. An official third-party authorization contract has not been established.

## Administrator setup

1. Download the public source and enter `login-service/`.
2. Copy `.env.example` to `.env`. Set `PUBLIC_URL`, `CLIENT_ID`, a random `CLIENT_SECRET`, and `REDIRECT_URIS` to the exact OAuth callback displayed by n8n. The service currently runs at an origin root, without a URL path prefix.
3. Run `docker compose up -d --build`. The service binds to localhost by default; expose it through your HTTPS reverse proxy.
4. In n8n, create **Fanqie Author Browser Login OAuth2 API** credentials. Enter the service URL and its client ID/secret once. Use a URL reachable by both the user's browser and the n8n server.
5. Click **Connect my account** and complete the login. The popup automatically returns to n8n after the author session is recognized. **I have logged in** also retries the account check.
6. On Fanqie Author node version **1.1**, choose **Browser Login**, select these credentials, and test **Account → Get** before enabling write workflows.

All users of a single existing credential can use its connection without configuring the service again. Separate author accounts require separate credentials and separate login windows. Use n8n project permissions to control access.

For a private LAN deployment, explicitly enable `ALLOW_INSECURE_HTTP=true`, set `PUBLIC_URL=http://YOUR_SERVER:8789`, use the matching HTTP n8n callback, and set `BIND_ADDRESS=YOUR_LAN_ADDRESS`. Use HTTPS when exposing the service outside a trusted LAN. Bind only to the intended interface. Do not expose Chromium's debugging port.

## Login behavior

- Each connection gets a fresh browser context. Existing personal browser cookies are not read.
- The remote login view supports pointer clicks/dragging, scrolling, keyboard input, paste, and Chinese IME. Complete platform challenges manually.
- Both the complete Cookie header and the matching CSRF/User-Agent are captured automatically. Session values are sent only in the token exchange response and are encrypted by n8n in `oauthTokenData`.
- The n8n node sends requests directly to `fanqienovel.com`. The bridge client secret and its access-token marker are never used as Fanqie authentication.
- The login browser closes after the session has been captured. The service keeps no browser profile, screenshot archive, password log, or persistent author-session store. In-progress flows last ten minutes; unredeemed grants last sixty seconds.
- The service URL, client ID/secret and exact callback registration are administrator configuration. There is no shared public login host that receives every community user's session.
- A website session has no official refresh token. If it expires, open the same credential and reconnect. Browser verification or account restrictions may also require reconnection.

## Safeguards and validation

Authorization requires S256 PKCE and an exact registered callback. Browser controls require the originating login window's HttpOnly cookie and same-origin POST. Codes are bound to the client/callback/verifier, expire, and can be redeemed once. Anonymous flows and screenshots are rate limited; at most two isolated login browsers may be active. Browser navigation is limited to HTTPS Fanqie/ByteDance domains needed by the author login; local services and arbitrary websites are blocked.

The companion service uses Playwright separately from the npm community package. The n8n runtime package still has no browser or server runtime dependencies. Docker runs the login service as a non-root user with dropped capabilities, a read-only root filesystem, ephemeral `/tmp`, and resource limits.

Automated tests cover the HTTP callback flow, client/callback/PKCE binding, code replay, expiry, cancellation, browser isolation, destination restrictions, native node session requests and old workflow compatibility. These tests use mock author sessions. A successful real account login, subsequent Account Get and author API operations must be recorded separately before claiming authenticated integration. Website login changes or browser automation restrictions may need adaptation.

Official references: [n8n HTTP credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/), [Playwright Docker](https://playwright.dev/docs/docker), [Fanqie Author Workspace](https://fanqienovel.com/main/writer/).
