# Changelog

## 0.1.1-alpha.4 - 2026-10-11

- Add a self-hosted QR connection component that displays the official Fanqie login QR code and checks the author account before connecting.
- Store website sessions encrypted with AES-256-GCM in the component; n8n stores a separate opaque connection token.
- Add an OAuth2-compatible callback with state, S256 PKCE, exact callback registration, and single-use codes. This is an internal component protocol, not a claim of official Fanqie OAuth access.
- Route QR-connected author requests through the component, with fixed upstream origin, no redirects, bounded responses, and no write retries.
- Preserve version 1 workflows and manual session credentials; existing nodes can explicitly select QR login, and new version 1.1 nodes default to it.
- Name QR and manual credentials clearly in Chinese. Support server-managed client configuration so users can create a new QR credential and connect without entering service URLs or client secrets.
- Cover grant isolation, expiry, replay, persistence, revocation, upstream boundaries, and legacy workflow compatibility in automated tests.
- An account holder completed the QR flow; native n8n execution verified Account Get and Book Get Many (an empty list). Other interfaces, writes, and encrypted income remain pending live validation.

- Add a Chinese walkthrough for copying session request headers, validating credentials, and troubleshooting missing or expired values.
- Link credential documentation to the walkthrough and show setup instructions, field placeholders, and a clear session-test error in the credential editor.

## 0.1.1-alpha.2 - 2026-10-11

- Stage tagged packages on npm with GitHub provenance and maintainer approval.
- Support shared organization tokens without bypassing two-factor authentication.
- Document the initial placeholder package and the final approval step.
- Retain the experimental API status and pending live account/income validation.

## 0.1.1-alpha.1 - 2026-10-11

- Prepare the first public alpha with accurate integration limitations.
- Add public repository metadata and registry installation instructions.
- Validate tagged releases and publish from GitHub Actions with provenance.
- Support npm Trusted Publishing and an initial publishing-token bootstrap.
- Move the public repository to `ravflow` and use its shared publishing secret.
- Add a manual authorization check and publishing dry-run before the first release.
- Keep live author-account validation and encrypted income support pending.

## 0.1.0 - 2026-10-11

- Initial self-hosted Fanqie Author node and session credentials.
- Added 46 curated operations and 365 frontend-derived endpoint candidates.
- Added form requests, lossless IDs, draft recovery, and explicit submission state.
- Added bounded pagination, read retries, response validation, and tests.
- Included example workflows and provenance publishing configuration.
- Added an idempotent native registration helper for local archive installations on n8n 2.42.6.
- Live account checks and encrypted income response adaptation remain pending.
