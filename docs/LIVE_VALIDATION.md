# Live account validation

Status: **QR connection, three read endpoints and cover upload verified by 2026-10-12**. An account holder scanned the official QR, confirmed login, and returned to n8n. Native n8n execution successfully called Account Get (one account item) and Book Get Many (an empty list). The same QR connection read book categories for both audiences and uploaded an unattached 600×800 test cover, receiving business code 0 and a real image URI/URL. Book/volume creation has automated flow tests; real book/chapter writes, nonempty pagination and encrypted income remain pending. No books, drafts, publications, account settings or financial actions were changed by these tests.

Verified through the QR component bridge:

- `GET /api/author/account/info/v0/`: business code 0 and a nonempty account object.
- `GET /api/author/book/book_list/v0`: business code 0 and a successfully decoded empty list.
- `GET /api/author/book/category_list/v0/`: business code 0, 182 categories for female audience (0) and 154 for male audience (1).
- `POST /api/author/data/upload_pic_v2/v0/`: multipart PNG upload, HTTP 200, business code 0, and returned `pic_uri` / `pic_url`; AI-origin labeling parameters were included.

Evidence retains only success status, item counts, and request methods/paths. An empty list does not validate nonempty pagination or book-specific operations.

## Read-only checks

Configure credentials locally, then check Account Get, Book Get Many and Get, Volume Get Many, Draft Get Many, Chapter Get Many and Get, statistics, and income. Record business code, response shape, account entitlement, and date/time interpretation. Exclude Cookie, CSRF, signing tokens, identity data, and full chapter text from evidence.

Use a dedicated test work and existing volume for later write checks. Validate Draft Create, Get Latest, Save, Get History, and Get Snapshot by comparing retrieved content with the input. Check recovery after a failed save.

Submit a chapter only after its actual text and target work have been reviewed and selected for publication. Check audit and publication states independently. Validate scheduling with an explicit timezone and confirm the platform's accepted timestamp. Exercise delete, completion, profile, contract, or other consequential operations only against deliberately selected test data.

Income needs special inspection. If the API returns `X-Muye-Encrypt-Downgrade: 0` or an encryption key header, the node reports pending decryption adaptation. Determine the browser protocol before claiming income functionality for that session. Encrypted text must not be accepted as decoded income.

## Acceptance evidence

All catalog `liveVerified` fields start as false. Save sanitized response shapes and successful request methods/paths for each required operation. Verify only after an authenticated request and a checked result. Record obsolete, app-only, gated, or differently encoded routes as unsupported or replace them with tested alternatives.

Full integration means coverage of the agreed accessible feature list. The frontend also contains historical and privileged routes that a single account may not expose.
