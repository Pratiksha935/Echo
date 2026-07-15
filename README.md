# Found

Found is an organisational-memory platform that finds prior decisions, experiments, campaigns, and code before a team repeats the work. This repository contains the CV1 product surface, browser extension demo, integration control plane, seeded ReLoop knowledge, and code prior-art workflow.

## Product surfaces

- `/` — public product landing page
- `/login` — Google OAuth and email-code authentication
- `/workspace` — protected company intelligence workspace
- `/code-review` — behaviour-level duplicate implementation check for proposed pull requests
- `/integrations` — Slack, Jira, Google Workspace, GitHub, and Read AI connector control plane
- `/demo-article` — article surface used to demonstrate the browser extension
- `extension/` — Manifest V3 extension that surfaces relevant company initiatives on articles

## Architecture

The application runs on React 19 and supports two deployment surfaces: vinext/Cloudflare Sites for the existing private preview, and dynamic Next.js on Netlify for the public product. Supabase provides public authentication and Postgres persistence on Netlify; the existing Drizzle/D1 contracts remain available to the Sites build.

Source systems remain authoritative. Found stores normalized retrieval records, source URLs, visibility, and allowed principals so answers can link back to Slack, Notion, Jira, GitHub, or campaign evidence.

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

1. Create a Supabase project and run `supabase/migrations/0001_found_foundation.sql` in its SQL editor.
2. Add the values from `.env.example` to Netlify's environment-variable settings. Keep `SUPABASE_SERVICE_ROLE_KEY` and `HERMES_API_TOKEN` server-only.
3. In Supabase Authentication, enable email OTP and Google, and add the hosted `/auth/callback` URL to the redirect allowlist.
4. Generate `INTEGRATION_ENCRYPTION_KEY` with `openssl rand -base64 32` and store it only in Netlify.
5. Add `https://sage-profiterole-3b1c22.netlify.app/auth/slack/callback` under **OAuth & Permissions → Redirect URLs** in the Slack app, then add its client ID and secret to Netlify.
6. Redeploy from the connected GitHub repository. The integration screen will show only connection records that exist for the signed-in organisation.

Slack uses the minimum CV1 bot scopes needed for approved-channel ingestion and threaded replies: `channels:history`, `channels:read`, `groups:history`, `groups:read`, `users:read`, and `chat:write`. OAuth state is checked before exchange, tokens are encrypted with AES-256-GCM, and only the Supabase service role can read the encrypted credential row. The implementation follows Slack’s OAuth v2 flow and supplies the same HTTPS redirect URI during authorization and code exchange.
