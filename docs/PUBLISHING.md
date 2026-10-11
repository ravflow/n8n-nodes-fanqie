# Public publishing

Repository: `ravflow/n8n-nodes-fanqie`.
Package: `n8n-nodes-fanqie`.
Current public alpha candidate: `0.1.1-alpha.3`.

Tagged releases are built and staged by GitHub Actions with npm provenance. A maintainer approves the staged package with two-factor authentication before the version becomes publicly installable. Build, lint, and mock tests pass, but author-account API validation and encrypted income support remain pending. Do not describe this alpha as a fully validated integration.

## First release

1. Use the npm account that will own this public package and enable two-factor authentication for final approval.
2. Create a short-lived granular access token with package staging permissions. **Read and write (stage only)** or **Read and write (publish and stage)** is sufficient. **Bypass 2FA** is not required for this workflow. New unscoped packages need new-package access; selected existing packages cannot create this package. See [npm token configuration](https://docs.npmjs.com/creating-and-viewing-access-tokens/).
3. Store the token in the `ravflow` organization's **Settings → Secrets and variables → Actions**, under **NPM_TOKEN**, with repository access set to **All repositories**. Organization projects can share this secret. The npm token's descriptive name can be `github-actions-publish`. Keep the value out of chat, workflow YAML, source code, and issue reports.
4. Confirm CI passes and the package versions match. Manually run the **Publish** workflow on `main` to verify shared-secret access and npm authentication. Manual runs perform a dry-run without uploading.
5. Push the matching version tag:

```sh
git tag 0.1.1-alpha.3
git push origin 0.1.1-alpha.3
```

The GitHub-hosted workflow uses Node.js 24, npm 12.2.0, lint, typecheck, build, tests, and provenance. It rejects mismatched tags. `RELEASE_MODE=true` permits the n8n CLI's prepublish guard within the controlled staging step.

6. Once staging succeeds, sign in to npm, open **Staged Packages**, inspect this version and its provenance, click **Approve**, and complete npm's two-factor verification. Approval publishes the exact staged artifact. See [npm staged publishing](https://docs.npmjs.com/staged-publishing/).

For a new package, npm first creates a public `0.0.0-stage` placeholder. This placeholder is not the working n8n node. The actual alpha and its contents stay private until maintainer approval. Only announce installation after checking the approved version:

```sh
npm view n8n-nodes-fanqie@0.1.1-alpha.3 version repository dist-tags dist.attestations --json
```

Use the exact alpha version in n8n's community-node settings. An alpha does not create a stable `latest` release.

## Subsequent releases with Trusted Publishing

After the package exists, add an npm GitHub Actions Trusted Publisher:

- Organization or user: `ravflow`
- Repository: `n8n-nodes-fanqie`
- Workflow filename: `publish.yml`
- Environment: leave empty for the included workflow
- Allowed action: `npm stage publish`

Staging permission is sufficient; this workflow does not need direct `npm publish` permission. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

Validate the first OIDC upload within npm's setup expiry. This package can then stage releases without the shared token. Migrate other projects before removing or revoking a shared organization token they still need. `npm run release` can bump versions and push later tags; npm approval still follows the staging workflow.

## n8n verification

Approved public npm releases are installable by self-hosted users with unverified community nodes enabled. Verified-node discovery and n8n Cloud availability require a separate review through the [n8n Creator Portal](https://creators.n8n.io/nodes).

Before submission, finish [LIVE_VALIDATION.md](LIVE_VALIDATION.md), adapt encrypted income responses, and run n8n's scanner against the published version. Align the public repository, npm metadata, MIT license, English documentation, and provenance. This project has no established official API contract for the website session APIs; acceptance is not guaranteed.

See [n8n publishing requirements](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes) and [verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines).
