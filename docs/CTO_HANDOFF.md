# Found — CTO handoff

Production onboarding sign-off is defined in [`PRODUCTION_ONBOARDING_QA.md`](./PRODUCTION_ONBOARDING_QA.md). Complete both its automated gate and live-provider smoke journey before sharing the build.

## What is live

- Production URL: `https://sage-profiterole-3b1c22.netlify.app`
- Source: `https://github.com/Pratiksha935/Echo`
- Deployment: Netlify, connected to `main`
- Product surfaces: landing, login, workspace, executive pulse, knowledge graph, integration control plane, browser extension, memory-update review, and code prior-art review

## What the current build proves

Found creates a tenant-isolated company workspace, connects approved sources through server-side authorization, preserves original evidence links and source principals, and exposes company knowledge through protected product surfaces. The public demo uses fictional ReLoop records. Once Supabase is enabled, production workspaces start empty and never inherit the demo records.

The current build also proves an append-only learning loop: a user can verify the original source, propose updated context from the extension, confirm it in Found, and see the latest memory layer without Found editing the source system. Relevant Slack events can append to the same memory stream after a conservative intent match.

## Security boundaries

- Supabase row-level security isolates organisations and memberships.
- Restricted records are checked against the employee's mapped identity in the original provider.
- Provider credentials are encrypted with AES-256-GCM and stored in a service-role-only table.
- OAuth state is checked and expires after ten minutes.
- GitHub installation IDs are validated with the installing user's access token before persistence.
- Source systems remain authoritative; Found retains normalized records, permissions, and deep links.
- User and Slack updates are append-only overlays. Original Docs, Slack messages, Jira tickets and code assets are never rewritten.
- Slack Events API delivery is checked with Slack's signing secret and five-minute replay protection.
- Hermes is reached only through an authenticated server endpoint and receives a server-derived organisation ID.

## Activation required

1. Create a Supabase project and apply `0001_found_foundation.sql`, `0002_found_control_plane.sql`, then `0003_memory_updates.sql`.
2. Add the Supabase public URL/key and service-role key to Netlify.
3. Generate `INTEGRATION_ENCRYPTION_KEY` with `openssl rand -base64 32`.
4. Register the provider callback URLs documented in `README.md` and add their credentials to Netlify.
5. Configure a hosted Hermes/OpenAI-compatible endpoint with the closed-world Found policy.
6. Trigger a Netlify redeploy and complete one real connection per launch provider.
7. Add `SLACK_SIGNING_SECRET` to Netlify, set the Slack Events request URL to `https://sage-profiterole-3b1c22.netlify.app/api/slack/events`, set the Slack Interactivity request URL to `https://sage-profiterole-3b1c22.netlify.app/api/slack/interactions`, and subscribe the bot to `message.channels`. Private-channel ingestion stays disabled until member ACL synchronization exists.

## Honest launch boundary

The authorization, tenancy, append-only memory, browser matching, Slack signature-verification and private Slack shortcut/modal paths are implemented. Full Slack App Home administration, private-channel ACL synchronization, token refresh jobs, disconnect/revocation, audit-log administration and retention/deletion automation still require production implementation and live-provider verification before Found can be called generally available. Read AI is shown as planned until its API/export contract is selected.

## Verified locally

- ESLint
- strict TypeScript
- 9 server-rendered and API-boundary product tests
- vinext production build
- Next.js/Netlify production build
