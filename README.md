# n8n-nodes-fanqie

Fanqie Novel author workspace integration for self-hosted n8n. Manage books, volumes, drafts, chapter submissions, statistics, and income from one node.

This alpha contains 46 curated operations and 365 endpoint candidates extracted from the public author frontend on 2026-10-11. Build, lint, and automated tests validate package behavior. No endpoint has been verified with an authenticated author account. Candidate coverage is not a claim that every historical route is currently available or successfully connected.

This independent community package uses website session APIs. An official public API contract and compatibility guarantees have not been established.

## Install from npm

After maintainer approval on npm, the **0.1.1-alpha.3** alpha can be installed by self-hosted n8n users through **Settings → Community nodes → Install**:

```text
n8n-nodes-fanqie@0.1.1-alpha.3
```

Search for **Fanqie Author** in the workflow editor after installation. The alpha uses an explicit version so it does not replace a stable npm `latest` release. This package has not been verified by n8n. Installation requires unverified community packages to be enabled; n8n Cloud availability depends on a separate verification review.

## Install a local archive

Build an archive with `npm run build` and `npm pack`. Install `n8n-nodes-fanqie-0.1.1-alpha.3.tgz` in the n8n user's community-node directory, then restart n8n.

For an npm deployment on Linux or macOS:

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /absolute/path/n8n-nodes-fanqie-0.1.1-alpha.3.tgz
```

For Docker, install as the container's `node` user:

```sh
docker cp n8n-nodes-fanqie-0.1.1-alpha.3.tgz YOUR_N8N_CONTAINER:/tmp/fanqie.tgz
docker exec --user node YOUR_N8N_CONTAINER sh -lc 'mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install /tmp/fanqie.tgz'
docker restart YOUR_N8N_CONTAINER
```

Replace `YOUR_N8N_CONTAINER` with your container name. Persist `/home/node/.n8n` in a volume and enable community nodes, including unverified packages. See [n8n manual installation](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/).

After a local-archive installation, check both workflow execution and **Settings → Community nodes**. On the tested n8n 2.42.6 instance, npm installation loaded the package but did not create its community-management registration. The source archive includes `scripts/register-fanqie-community-package.cjs` for an administrator to register the existing package using n8n's native loader and transactional repository. It verifies that the node loads before creating records and does not overwrite inconsistent registrations. It is an admin helper for n8n 2.42.6, not runtime node code.

```sh
docker cp scripts/register-fanqie-community-package.cjs YOUR_N8N_CONTAINER:/tmp/register-fanqie-community-package.cjs
docker exec --user node YOUR_N8N_CONTAINER node /tmp/register-fanqie-community-package.cjs
```

The helper expects the n8n application at `/usr/local/lib/node_modules/n8n`; set `FANQIE_N8N_APP_DIR` for another installation path. Refresh the community-node page after registration.

For development, use Node.js 24 LTS, run `npm ci --ignore-scripts`, then `npm run dev`. The official n8n CLI also supports an external development instance. This package has no runtime dependencies beyond the `n8n-workflow` peer supplied by n8n.

## Credentials

New node version **1.1** defaults to **Browser Login**. Your n8n administrator deploys the [self-hosted login service](docs/BROWSER_LOGIN.md) once and configures **Fanqie Author Browser Login OAuth2 API** credentials with its URL and client credentials. Click **Connect my account**, complete the official website login in the window that opens, and return automatically to n8n. No browser extension, developer tools, or Cookie/CSRF copying is needed.

The login service uses an isolated remote browser for each connection and n8n's native OAuth credential callback to store the website session securely. It is an independent session bridge; an official Fanqie third-party OAuth interface has not been established. Reconnect through the same credential when the website session expires. The login service is a separate Docker deployment and adds no runtime browser dependency to the npm community package. Real account login remains to be validated.

Existing node version **1** keeps manual-session behavior. Version 1.1 also supports **Manual Session** when needed:

1. Sign in to your own [Fanqie Author Workspace](https://fanqienovel.com/main/writer/).
2. Open developer tools, select Network, and open a successful `/api/author/...` request.
3. In n8n, create **Fanqie Author Session API** credentials. Copy the complete `Cookie`, `X-Secsdk-Csrf-Token`, and matching `User-Agent` into the corresponding fields.
4. Test the credential, then execute **Account → Get**.

Both login modes use n8n's encrypted credential system. Keep session values out of workflow JSON, source control, issue reports, and chat. The node uses the official `fanqienovel.com` origin with redirects disabled.

## Operations

- **Account**: get and update information.
- **Book**: get many, get, create, update, delete, categories, submission groups, outline, visibility, recommendation status, and completion applications.
- **Volume**: get many, create, update, and delete.
- **Draft**: get many, create and save, save existing, latest content, history, snapshots, and delete.
- **Chapter**: get many, content and status, publish submission, scheduled submission, update schedule, search, and delete.
- **Statistics**: author summary, books, summary, trend, chapter metrics, and reading sources.
- **Income**: books, summary, daily, monthly, gifts, gift summary, completion rewards, and reminders.
- **Advanced API**: call a discovered endpoint or another allowed author path, or inspect the catalog offline. Candidates also cover comments, attendance, notifications, short stories, AI tools, and other workspace features.

Required fields are exposed directly. **Parameters (JSON)** supplies additional fields such as `stats_type`, `stats_types`, or account settings. Advanced endpoint choices include known field names and source status; required fields and account entitlements are not inferred.

Use strings for IDs. Plain-text chapters become escaped paragraph HTML. Choose HTML only for content already in the editor's expected format. Cover URIs must already exist in the workspace; a dedicated binary image-upload operation is not included in this release.

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
npm pack
```

Tests use mock HTTP responses, not a live account. See `docs/LIVE_VALIDATION.md` and `docs/endpoint-catalog.json`.

The packed community package was also installed into an isolated n8n 2.42.6 instance. A native workflow execution successfully loaded `n8n-nodes-fanqie.fanqieAuthor` and returned all 365 catalog records without author credentials. This verifies package registration and execution, not authenticated Fanqie API access.

## Publishing

The [public source repository](https://github.com/ravflow/n8n-nodes-fanqie) includes CI and a GitHub Actions publishing workflow. Version tags must match `package.json`. Tagged releases are staged on npm with provenance and require a maintainer's two-factor approval before public installation. Alpha versions use the `alpha` dist-tag; stable versions use `latest`. The workflow can use the `ravflow` organization's shared `NPM_TOKEN` without bypassing two-factor authentication. Manually running the Publish workflow checks this authorization without uploading. See [the publishing guide](docs/PUBLISHING.md) for staged approval and npm Trusted Publishing setup.

Live account validation and encrypted income support are required before claiming a complete author-backend integration or promoting this alpha to a stable release. n8n verification is a separate review and has not been granted.

## License

MIT. The icon is original artwork and does not claim to be Fanqie's official logo.
