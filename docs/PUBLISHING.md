# Public publishing

Repository: `ravflow/n8n-nodes-fanqie`.
Package: `n8n-nodes-fanqie`.
First public version: `0.1.1-alpha.1`.

The current alpha has not been published to npm. Package build, lint, and mock tests pass, but author-account API validation and encrypted income support remain pending. Do not describe this version as a fully validated integration. Update this status after a successful registry publish.

## First release

1. Use an npm account that will own this public package. Complete npm's account verification and publishing authentication requirements.
2. For this new unscoped package, create a short-lived npm granular access token that can create and publish packages. Select **Read and write (publish and stage)** and enable **Bypass 2FA** for the non-interactive GitHub Actions publish. A token restricted to existing selected packages cannot create this new package; use npm's appropriate new-package access. See [npm token configuration](https://docs.npmjs.com/creating-and-viewing-access-tokens/).
3. Store the token directly in the `ravflow` organization's **Settings → Secrets and variables → Actions**, under **NPM_TOKEN**, with repository access set to **All repositories**. Organization-owned projects can share this secret. The token name on npm can be `github-actions-publish`; it is only a descriptive label. Never put the value in chat, workflow YAML, source code, or issue reports.
4. Confirm CI passes, `package.json` and `package-lock.json` versions match, and the release notes describe the actual validated scope.
5. Manually run the **Publish** workflow on `main` to verify that the shared secret is available and npm authentication works. This runs a publishing dry-run only. After it succeeds, push the matching version tag:

```sh
git tag 0.1.1-alpha.1
git push origin 0.1.1-alpha.1
```

The publish workflow uses a GitHub-hosted runner, Node.js 24, npm 12.2.0, lint, typecheck, build, mock tests, and npm provenance. It rejects a tag that does not match the package version. `RELEASE_MODE=true` permits the n8n CLI's prepublish guard only within the controlled publishing step.

After the workflow succeeds, verify registry metadata before announcing availability:

```sh
npm view n8n-nodes-fanqie@0.1.1-alpha.1 version repository dist-tags dist.attestations --json
```

Use the exact prerelease version when installing from n8n's community-node settings. An alpha publication does not create a stable `latest` release.

## Subsequent releases with Trusted Publishing

After the package exists, open its npm settings and add a GitHub Actions Trusted Publisher:

- Organization or user: `ravflow`
- Repository: `n8n-nodes-fanqie`
- Workflow filename: `publish.yml`
- Environment: leave empty for the included workflow
- Allowed action: enable direct `npm publish`, which this workflow uses

The current npm default can allow only `npm stage publish`; explicitly enabling direct publishing is necessary for this workflow. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

Validate the first OIDC publication within npm's stated setup expiry. Once OIDC succeeds, this package can publish without the shared **NPM_TOKEN**. Before removing or revoking an organization-wide token, migrate any other projects that still use it. Subsequent tagged releases use short-lived OIDC authentication and retain provenance.

Use `npm run release` for later interactive version bumps, changelog updates, commits, and tags. Keep the changelog's scope and validation status accurate.

## n8n verification

A public npm package is installable by self-hosted users with unverified community nodes enabled. Discovery as a verified node and n8n Cloud availability require a separate review through the [n8n Creator Portal](https://creators.n8n.io/nodes).

Before submission, finish the authenticated checks in [LIVE_VALIDATION.md](LIVE_VALIDATION.md), adapt encrypted income responses, and run n8n's package scanner against the actual published version. Keep the public GitHub repository, npm repository metadata, MIT license, English node UI/documentation, and provenance aligned. Website session APIs have no established public API contract in this project; acceptance is not guaranteed.

See [n8n publishing requirements](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes) and [verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines).
