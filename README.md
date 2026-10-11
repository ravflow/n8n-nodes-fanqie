# n8n-nodes-fanqie

Fanqie Novel author workspace integration for self-hosted n8n. Manage books, volumes, drafts, chapter submissions, statistics, and income from one node.

This alpha contains 48 curated operations and 365 endpoint candidates extracted from the public author frontend on 2026-10-11. QR connection, Account Get, Book Get Many (an empty list), book categories, and cover upload have been verified with one authenticated author account. Book/volume creation has automated flow tests; live book/chapter writes, nonempty pagination, and encrypted income remain pending. Candidate coverage is not a claim that every historical route is currently available or successfully connected.

This independent community package uses website session APIs. An official public API contract and compatibility guarantees have not been established.

## Install from npm

Public release requires npm maintainer approval. The QR-enabled **0.1.1-alpha.5** source and local archive are available for self-hosted testing; do not assume a staged version is installable from the registry. Once published, install through **Settings → Community nodes → Install**:

```text
n8n-nodes-fanqie@0.1.1-alpha.5
```

Search for **Fanqie Author** in the workflow editor after installation. The alpha uses an explicit version so it does not replace a stable npm `latest` release. This package has not been verified by n8n. Installation requires unverified community packages to be enabled; n8n Cloud availability depends on a separate verification review.

## Install a local archive

Build an archive with `npm run build` and `npm pack`. Install `n8n-nodes-fanqie-0.1.1-alpha.5.tgz` in the n8n user's community-node directory, then restart n8n. The archive includes `login-service/` for deploying the optional QR component.

For an npm deployment on Linux or macOS:

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /absolute/path/n8n-nodes-fanqie-0.1.1-alpha.5.tgz
```

For Docker, install as the container's `node` user:

```sh
docker cp n8n-nodes-fanqie-0.1.1-alpha.5.tgz YOUR_N8N_CONTAINER:/tmp/fanqie.tgz
docker exec --user node YOUR_N8N_CONTAINER sh -lc 'mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install /tmp/fanqie.tgz'
docker restart YOUR_N8N_CONTAINER
```

Replace `YOUR_N8N_CONTAINER` with your container name. Persist `/home/node/.n8n` in a volume and enable community nodes, including unverified packages. See [n8n manual installation](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/).

After a local-archive installation, check both workflow execution and **Settings → Community nodes**. On the tested n8n 2.42.6 instance, npm installation loaded the package but did not create its community-management registration. The source archive includes `scripts/register-fanqie-community-package.cjs` for an administrator to register the existing package using n8n's native loader and transactional repository. It verifies that the node loads before creating records and does not overwrite inconsistent registrations. It is an admin helper for n8n 2.42.6, not runtime node code.

```sh
docker cp scripts/register-fanqie-community-package.cjs YOUR_N8N_CONTAINER:/tmp/register-fanqie-community-package.cjs
docker exec --user node YOUR_N8N_CONTAINER node /tmp/register-fanqie-community-package.cjs
```

The helper expects the n8n application at `/usr/local/lib/node_modules/n8n`; set `FANQIE_N8N_APP_DIR` for another installation path. Refresh the community-node page after registration. When upgrading an existing local registration, back up first and pass `-e FANQIE_REPLACE_REGISTERED_PACKAGE=true` to `docker exec`; this updates only this package through n8n's transactional repository.

For development, use Node.js 24 LTS, run `npm ci --ignore-scripts`, then `npm run dev`. The official n8n CLI also supports an external development instance. This package has no runtime dependencies beyond the `n8n-workflow` peer supplied by n8n.

## Credentials

**扫码方式：[番茄作者扫码连接教程](docs/QR_LOGIN.md)。** Administrators deploy the included login component and configure its client once through n8n's native credential overwrites. Users create **番茄作者 · 扫码登录（Fanqie） OAuth2 API**, click Connect, scan the official QR with Fanqie Novel or Fanqie Writer Assistant, and return automatically after the account check. New version 1.1 nodes default to QR login. Existing version 1 nodes retain manual authentication by default and now allow explicitly selecting QR login.

Website sessions are encrypted in the component. n8n stores only an opaque connection token and sends author requests through the component's fixed-origin bridge. The component's OAuth2-compatible callback is not an official Fanqie developer OAuth grant. Additional interface compatibility still requires live validation.

**中文逐步教程：[Cookie、CSRF Token 和 User Agent 怎么填](docs/CREDENTIALS.md)**，包含浏览器操作、复制格式、凭据验证和常见问题。

1. Sign in to your own [Fanqie Author Workspace](https://fanqienovel.com/main/writer/).
2. Open developer tools, select Network, and open a successful `/api/author/...` request.
3. In n8n, create **番茄作者 · 手动登录态（Fanqie） API** credentials. Copy the complete `Cookie`, `X-Secsdk-Csrf-Token`, and matching `User-Agent` into the corresponding fields.
4. Test the credential, then execute **Account → Get**.

Cookie and CSRF values are masked and stored by n8n's credential system. Keep them out of workflow JSON, source control, issue reports, and chat. Re-enter both fields when the session expires. The node uses the official `fanqienovel.com` origin with redirects disabled.

Copy only the full header values, without the `Cookie:`, `X-Secsdk-Csrf-Token:`, or `User-Agent:` prefixes. The preset User Agent is not automatically read from your browser. If a successful request has no CSRF header, consult [the credential guide](docs/CREDENTIALS.md#找不到-cookie-或-csrf) before guessing a value.

## Cover upload and book creation

**[封面上传与自动建书教程](docs/COVER_AND_BOOK.md)**: Upload PNG/JPEG binary data or Base64 using **Media → Upload Cover**, or use **Book → Create With Cover** to validate the book details, upload the image, create the book and optionally create its first volume. AI images use the official AI-origin labeling parameters. Failed multi-step writes expose the cover/book IDs for recovery. Manual and QR credentials are supported.

The included [AI-cover workflow](examples/ai-cover-and-create-book.json) connects a standard image generation node to cover processing and book creation. Choose your own image-generation and author credentials before running it.

## Operations

- **Account**: get and update information.
- **Book**: get many, get, create, create with cover and optional first volume, update, delete, categories, submission groups, outline, visibility, recommendation status, and completion applications.
- **Media**: upload a PNG/JPEG cover from binary data or Base64 and return the cover URI, with AI-origin labeling when selected.
- **Volume**: get many, create, update, and delete.
- **Draft**: get many, create and save, save existing, latest content, history, snapshots, and delete.
- **Chapter**: get many, content and status, publish submission, scheduled submission, update schedule, search, and delete.
- **Statistics**: author summary, books, summary, trend, chapter metrics, and reading sources.
- **Income**: books, summary, daily, monthly, gifts, gift summary, completion rewards, and reminders.
- **Advanced API**: call a discovered endpoint or another allowed author path, or inspect the catalog offline. Candidates also cover comments, attendance, notifications, short stories, AI tools, and other workspace features.

Required fields are exposed directly. **Parameters (JSON)** supplies additional fields such as `stats_type`, `stats_types`, or account settings. Advanced endpoint choices include known field names and source status; required fields and account entitlements are not inferred.

Use strings for IDs. Plain-text chapters become escaped paragraph HTML. Choose HTML only for content already in the editor's expected format. Obtain cover URIs with **Media → Upload Cover**, or let **Book → Create With Cover** upload and pass the URI automatically.

## Draft and publication workflow

1. **Book → Get Many** obtains the target book ID.
2. **Volume → Get Many** obtains the volume ID and name.
3. **Draft → Create** creates an empty draft, then saves your title and content with `publish_status=0`.
4. Inspect **Draft → Get Latest** before submitting.
5. **Chapter → Publish** or **Schedule** submits the existing chapter ID with `publish_status=1`. Declare the actual AI usage.
6. **Chapter → Get** or **Get Many** checks the actual audit and publication state.

Submission outputs contain `submitted: true` and `publicationVerified: false`. Submission does not prove approval or publication. Schedules accept an explicit timezone, such as `2030-01-01T08:00:00+08:00`, or Unix seconds. Platform scheduling, quotas, and review rules still apply.

Writes are never automatically retried. If creation succeeds but saving fails, the error includes `item_id`; resume with **Draft → Save**. After a publish timeout, inspect the chapter before retrying. For workflow-level retries, resume from an existing chapter ID instead of repeating creation.

## Pagination and errors

List operations support Return All and Limit, start at page zero, and respect end markers. Repeated pages, unknown schemas, or Max Pages limits report errors rather than silently returning partial data. Limited retries apply to transient read failures.

Empty responses, verification challenges, invalid business codes, redirects, and unexpected formats are errors. Request credentials are not logged or forwarded to another API host.

Some income requests use encrypted responses in the website client. This release consumes plaintext responses and identifies encryption headers, but does not implement the website's income encryption protocol. If encryption is enforced for your session, income queries report that adaptation is required. Session-dependent signing or verification also needs authenticated integration work.

## Examples and validation

Import the JSON files in `examples/`. They read account/book data or inspect the catalog and do not submit chapters.

```sh
npm run build
npm run lint
npm test
npm run test:login
npm pack
```

Tests use mock HTTP responses, not a live account. See `docs/LIVE_VALIDATION.md` and `docs/endpoint-catalog.json`.

The packed community package was also installed into an isolated n8n 2.42.6 instance. A native workflow execution successfully loaded `n8n-nodes-fanqie.fanqieAuthor` and returned all 365 catalog records without author credentials. This verifies package registration and execution, not authenticated Fanqie API access.

## Publishing

The [public source repository](https://github.com/ravflow/n8n-nodes-fanqie) includes CI and a GitHub Actions publishing workflow. Version tags must match `package.json`. Tagged releases are staged on npm with provenance and require a maintainer's two-factor approval before public installation. Alpha versions use the `alpha` dist-tag; stable versions use `latest`. The workflow can use the `ravflow` organization's shared `NPM_TOKEN` without bypassing two-factor authentication. Manually running the Publish workflow checks this authorization without uploading. See [the publishing guide](docs/PUBLISHING.md) for staged approval and npm Trusted Publishing setup.

Live account validation and encrypted income support are required before claiming a complete author-backend integration or promoting this alpha to a stable release. n8n verification is a separate review and has not been granted.

## License

MIT. The icon is original artwork and does not claim to be Fanqie's official logo.
