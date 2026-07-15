# Found — CTO handoff

## What is live

- Production URL: `https://sage-profiterole-3b1c22.netlify.app`
- Source: `https://github.com/Pratiksha935/Echo`
- Deployment: Netlify, connected to `main`
- Product surfaces: landing, login, workspace, integration control plane, browser-extension demo, and code prior-art review

## What the current build proves

Found creates a tenant-isolated company workspace, connects approved sources through server-side authorization, preserves original evidence links and source principals, and exposes company knowledge through protected product surfaces. The public demo uses fictional ReLoop records. Once Supabase is enabled, production workspaces start empty and never inherit the demo records.

## Security boundaries

- Supabase row-level security isolates organisations and memberships.
- Restricted records are checked against the employee's mapped identity in the original provider.
- Provider credentials are encrypted with AES-256-GCM and stored in a service-role-only table.
- OAuth state is checked and expires after ten minutes.
- GitHub installation IDs are validated with the installing user's access token before persistence.
- Source systems remain authoritative; Found retains normalized records, permissions, and deep links.
- Hermes is reached only through an authenticated server endpoint and receives a server-derived organisation ID.

## Activation required

1. Create a Supabase project and apply `0001_found_foundation.sql`, then `0002_found_control_plane.sql`.
2. Add the Supabase public URL/key and service-role key to Netlify.
3. Generate `INTEGRATION_ENCRYPTION_KEY` with `openssl rand -base64 32`.
4. Register the provider callback URLs documented in `README.md` and add their credentials to Netlify.
5. Configure a hosted Hermes/OpenAI-compatible endpoint with the closed-world Found policy.
6. Trigger a Netlify redeploy and complete one real connection per launch provider.

## Honest launch boundary

The authorization and tenancy control planes are implemented. Provider backfill workers, webhook verification, token refresh jobs, disconnect/revocation, audit-log UI, and retention/deletion automation still require production implementation and live-provider verification before Found can be called generally available. Read AI is shown as planned until its API/export contract is selected.

## Verified locally

- ESLint
- strict TypeScript
- 7 server-rendered product tests
- vinext production build
- Next.js/Netlify production build
