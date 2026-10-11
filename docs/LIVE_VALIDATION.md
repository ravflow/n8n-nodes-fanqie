# Live account validation

Status: **pending author account access**. Automated tests use mock responses. No real books, drafts, publications, account settings, or financial actions have been modified during development.

## Read-only checks

Configure credentials locally, then check Account Get, Book Get Many and Get, Volume Get Many, Draft Get Many, Chapter Get Many and Get, statistics, and income. Record business code, response shape, account entitlement, and date/time interpretation. Exclude Cookie, CSRF, signing tokens, identity data, and full chapter text from evidence.

Use a dedicated test work and existing volume for later write checks. Validate Draft Create, Get Latest, Save, Get History, and Get Snapshot by comparing retrieved content with the input. Check recovery after a failed save.

Submit a chapter only after its actual text and target work have been reviewed and selected for publication. Check audit and publication states independently. Validate scheduling with an explicit timezone and confirm the platform's accepted timestamp. Exercise delete, completion, profile, contract, or other consequential operations only against deliberately selected test data.

Income needs special inspection. If the API returns `X-Muye-Encrypt-Downgrade: 0` or an encryption key header, the node reports pending decryption adaptation. Determine the browser protocol before claiming income functionality for that session. Encrypted text must not be accepted as decoded income.

## Acceptance evidence

All catalog `liveVerified` fields start as false. Save sanitized response shapes and successful request methods/paths for each required operation. Verify only after an authenticated request and a checked result. Record obsolete, app-only, gated, or differently encoded routes as unsupported or replace them with tested alternatives.

Full integration means coverage of the agreed accessible feature list. The frontend also contains historical and privileged routes that a single account may not expose.
