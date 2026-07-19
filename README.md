# Found

Found is an organisational-memory platform that finds prior decisions, experiments, campaigns, and code before a team repeats the work. This repository contains the CV1 product surface, browser extension demo, integration control plane, seeded ReLoop knowledge, and code prior-art workflow.

## Product surfaces

- `/` — public product landing page
- `/login` — Google OAuth and email-code authentication
- `/workspace` — protected company intelligence workspace
- `/memory/correct` — authenticated, source-preserving memory-update review
- `/code-review` — behaviour-level duplicate implementation check for proposed pull requests
- `/integrations` — Slack, Jira, Google Workspace, GitHub, and Read AI connector control plane
- `/demo-article` — article surface used to demonstrate the browser extension
- `extension/` — Manifest V3 extension that surfaces relevant company initiatives on articles

## Architecture

The application runs on React 19 and supports two deployment surfaces: vinext/Cloudflare Sites for the existing private preview, and dynamic Next.js on Netlify for the public product. Supabase provides public authentication and Postgres persistence on Netlify; the existing Drizzle/D1 contracts remain available to the Sites build.

Source systems remain authoritative. Found stores normalized retrieval records, source URLs, visibility, and allowed principals so answers can link back to Slack, Notion, Jira, GitHub, or campaign evidence. Corrections and relevant Slack changes are appended as versioned memory overlays; Found never edits the underlying source.

## Local development

Requirements: Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Quality checks

```bash
npm run check
```

The check pipeline runs ESLint, strict TypeScript validation, a production build, and server-rendering tests for the home, code-review, and integration routes.

## Security model

- OAuth exchanges and credential storage belong on the server; the browser stores no provider secrets.
- Connector access is scoped to an organisation and requested source permissions.
- Knowledge records preserve source visibility and principal allowlists.
- Retrieval must filter by tenant and effective source permissions before ranking.
- Source links are retained for attribution and auditability.
- Disconnect and deletion flows must revoke provider credentials and remove indexed data.

Public authentication uses server-side code exchange, HTTP-only cookies, PKCE for Google OAuth, and refresh-token rotation. The Postgres migration enables row-level security for organisations, memberships, connections, and permission-aware knowledge. Provider credentials live in a separate service-role-only table.

Hermes is not required for the website to render. In production it is called through the authenticated server endpoint at `/api/knowledge/query`; its URL and token are server-only. Do not run the local Hermes gateway with a local terminal backend.

## Demo data

The `data/` directory contains fictional records for the ReLoop Indian fashion-rental marketplace. It is designed to exercise duplicate-intent matching across product, GTM, customer success, and engineering scenarios.

## Deployment

`npm run build` produces the Sites Worker bundle under `dist/`. `npm run build:netlify` validates the dynamic Netlify build.

### Activate public login

1. Create a Supabase project and run `supabase/migrations/0001_found_foundation.sql`, `supabase/migrations/0002_found_control_plane.sql`, then `supabase/migrations/0003_memory_updates.sql`, in its SQL editor.
2. Add the values from `.env.example` to Netlify's environment-variable settings. Keep `SUPABASE_SERVICE_ROLE_KEY` and `HERMES_API_TOKEN` server-only.
3. In Supabase Authentication, enable email OTP and Google, and add the hosted `/auth/callback` URL to the redirect allowlist.
4. Generate `INTEGRATION_ENCRYPTION_KEY` with `openssl rand -base64 32` and store it only in Netlify.
5. For short-lived demo testing only, `DEMO_ACCESS_EMAIL` and a high-entropy `DEMO_ACCESS_CODE` enable a server-side test login. Remove both before onboarding external users or real company data.
5. Register the provider callbacks below and add each provider's server-side credentials to Netlify:
   - Slack: `/auth/slack/callback`
   - Notion: `/auth/integrations/notion/callback`
   - Atlassian Jira: `/auth/integrations/jira/callback`
   - Google Workspace: `/auth/integrations/google/callback`
   - GitHub App setup: `/auth/integrations/github/callback`
6. Set `GITHUB_APP_INSTALL_URL`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` from a GitHub App configured to request user authorization on install. The callback exchanges the code and verifies the installation belongs to that user before storing the encrypted credential envelope.
7. Redeploy from the connected GitHub repository. The integration screen will show only connection records that exist for the signed-in organisation.

Slack uses the CV1 bot scopes needed for silent, approved public-channel ingestion plus private Slack-native UX in Slack web and desktop: `app_mentions:read`, `channels:history`, `channels:read`, `commands`, `users:read`, `users:read.email`, `im:write`, `chat:write`, and `chat:write.public`. OAuth state is checked before exchange, tokens are encrypted with AES-256-GCM, and only the Supabase service role can read the encrypted credential row. Private-channel ingestion remains disabled until membership ACL synchronization is implemented.

For continuous Slack memory and native Ask Found, add `SLACK_SIGNING_SECRET` and apply [`public/found-slack-app-manifest.yaml`](public/found-slack-app-manifest.yaml) in the Slack app settings. The checked-in manifest configures the hosted OAuth callback, signed Events API, Interactivity, `/found`, App Home, global Ask Found shortcut, message-level prior-work shortcut, required bot scopes, and the `message.channels`, `app_mention`, and `app_home_opened` subscriptions. Reinstall the app after applying a manifest that adds scopes or events. The endpoints reject unsigned or replayed requests, ignore casual/catalogue/unmatched messages, silently write only meaningful public-channel work intent as append-only updates, and use ephemeral responses/modals only for explicit Ask Found or shortcut actions. They never post progress, diagnostics, or errors into public Slack channels.

Notion, Jira, and Google Workspace use server-side authorization-code flows with short-lived state cookies. Notion and Google refresh tokens, Jira offline tokens, and provider access tokens are encrypted as one credential envelope before persistence. GitHub is intentionally modelled as a GitHub App rather than a broad `repo` OAuth grant. Read AI remains an explicit API/export adapter because it does not share the same public OAuth contract as the other providers; the UI does not claim it is connected until a real adapter record exists.
