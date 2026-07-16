# Found security and production-readiness audit

Audit date: 2026-07-16

Scope: authentication and tenant isolation, OAuth state, credential storage,
tracked secrets, Slack capabilities and request validation, Google scopes,
source attribution, demo/live separation, error disclosure, and authentication
and integration-boundary tests.

## Release conclusion

Found is not ready for a production launch with real company data. The controls
implemented in this audit remove unnecessary Slack write/private-channel access,
prevent fictional demo records entering a live Supabase workspace, reject malformed
Slack timestamps and bodies, and retain message-level Slack permalinks. The blockers
below still require deployment configuration or product-boundary decisions.

## Verified controls

- Supabase access and refresh tokens use HTTP-only, SameSite=Lax cookies and Secure
  cookies in production. Google sign-in uses PKCE and a short-lived random state.
- Connector callbacks use short-lived HTTP-only state, provider and organisation
  cookies, then re-check current owner/admin membership for that organisation before
  service-role writes.
- Tenant-facing reads use the user's bearer token, explicit organisation filters,
  and Postgres RLS. Encrypted integration credentials have RLS enabled with no
  browser-facing policy.
- Provider credentials are encrypted server-side with AES-256-GCM and a random
  96-bit IV before the service role writes the ciphertext envelope.
- Google requests `drive.readonly` and `documents.readonly`; it requests no Google
  content-write scope.
- Slack Events verifies the raw body with HMAC-SHA256, uses constant-time comparison,
  and rejects timestamps outside five minutes. Event IDs are protected by unique
  database constraints for idempotent writes.
- User-facing integration/authentication errors use fixed codes or generic messages;
  provider bodies, secrets and stack traces are not returned to the browser.
- Live knowledge records retain their source URL, author, status and external ID.
  Slack event records now retain a message-level permalink rather than a channel-only
  link.

## Fixed in this audit

- Removed Slack `chat:write`, `groups:history`, and `groups:read`. This release has no
  Slack posting implementation or private-channel ACL synchronization.
- Required `SLACK_SIGNING_SECRET` before Slack is shown as configured.
- Rejected non-numeric Slack timestamps and malformed JSON with controlled 401/400
  responses.
- Stopped the normal Supabase OAuth callback from seeding fictional ReLoop demo data.
- Added focused regression tests for Slack scope, replay/signature controls,
  encryption-before-persistence, Google read-only scopes, tenant filtering, and
  demo/live separation.

## Remaining blockers

- The ChatGPT-hosted fallback trusts `oai-authenticated-user-*` request headers when
  Supabase is not configured. Production must either configure Supabase or deploy
  only behind infrastructure that strips client-supplied copies and injects verified
  identity headers. There is no application-level signature check for these headers.
- `DEMO_ACCESS_EMAIL` and `DEMO_ACCESS_CODE` enable a separate shared-secret demo
  session. Both must be absent anywhere real company data is connected.
- The application cannot rotate or decrypt stored integration credentials yet, and
  no disconnect/revocation flow exists. `key_version` is stored but only version 1 is
  implemented.
- Slack events are accepted for public channels in any connected Slack team; there
  is no selected-channel allowlist/backfill implementation. The UI must not claim
  thread replies, private-channel ACL preservation, or full backfill.
- Source URLs supplied to manual memory updates are only constrained to HTTPS. They
  are not resolved server-side against an existing tenant-owned knowledge record,
  so manual update attribution is not strong enough for an untrusted multi-user
  production workspace.
- There is no rate limiting on login, demo-code, knowledge-query, memory-update, or
  Slack event endpoints. Provider/platform controls must be documented and verified
  before launch.
- Test coverage verifies unauthenticated API rejection and source-level boundary
  invariants, but there is no database-backed integration suite proving cross-tenant
  denial under the deployed Supabase RLS policies or callback replay behavior.
- Static fictional demo assets remain shipped in client bundles and tracked data.
  They are visibly labelled in the demo session, but production deployment should
  confirm that demo routes/assets are acceptable or exclude them at build time.

## Required environment variables

Core live authentication and persistence:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INTEGRATION_ENCRYPTION_KEY` (base64-encoded 32-byte key)

Slack:

- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`

Other connectors, only when enabled:

- Notion: `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`
- Jira: `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`
- Google Workspace: `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET`
- GitHub App: `GITHUB_APP_INSTALL_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Read AI: `READ_AI_API_URL`, `READ_AI_API_TOKEN`

Hermes query service, only when knowledge querying is enabled:

- `HERMES_API_URL`
- `HERMES_API_TOKEN`
- `HERMES_MODEL` (optional; defaults in code)

Demo-only and prohibited in a real-data production environment:

- `DEMO_ACCESS_EMAIL`
- `DEMO_ACCESS_CODE`
