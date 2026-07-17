# Found browser extension production contract

## Scope

The executable contract in `tests/production-browser-route.e2e.test.mjs` exercises the actual Next.js `/api/browser/match` route against a local HTTP persistence boundary. It signs the same one-hour browser token used in production and supplies a valid Chrome extension origin, organisation membership, Google Docs record, and linked Slack record.

The existing onboarding contract also verifies Google PKCE login, separate Google Workspace and Slack consent, the visible browser-pairing approval, exact `chromiumapp.org` callback validation, and workspace-bound token issuance.

## Demonstrated defect and minimal fix

The v0.4.3 content script made the authenticated match request from the visited-page execution context. That made the request-origin boundary dependent on content-script cross-origin behaviour instead of the extension service worker. Matching now travels through a `found:match-page` runtime message; only `background.js` reads the browser token and calls the production API. The visited page never receives the token.

## Pass criteria

- valid extension-origin preflight returns the exact origin and required headers;
- non-extension origins are rejected;
- expired tokens return `401` with CORS headers;
- revoked membership returns `403 workspace_access_revoked`;
- body-supplied tenant IDs are ignored and both persistence reads use token claims;
- the known Google Docs resource ID returns a source-linked Google Docs + Slack battlecard;
- unrelated/unindexed pages return `{ "match": null }`;
- the downloadable ZIP contains manifest v0.4.3 and is byte-identical to all required extension source files;
- the content script delegates matching to the background worker and contains no match-API URL or bearer header.

## Reproduction

Run `node --test tests/production-browser-route.e2e.test.mjs`. The test starts the actual Next.js development server and a deterministic HTTP persistence fixture, sends real HTTP preflight and match requests, verifies responses and queries, checks the extension sources, and inspects the distributable ZIP.

This contract deliberately does not claim that third-party Google, Slack, Supabase, or Netlify services were live during the deterministic run. Their OAuth route construction and persisted-connection behaviour are covered by the onboarding contract; live credentials remain deployment-owned.

## Validation evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Executable browser-route contract | PASS | 7/7: CORS allow/deny, expiry, revocation, tenant filtering, exact Google resource + Slack evidence, no match, ZIP/runtime boundary |
| Full tests | PASS | `npm test`: 58/58 |
| Lint | PASS | `npm run lint`: 0 errors |
| TypeScript | PASS | `npm run typecheck`: 0 errors |
| Netlify production build | PASS | `npm run build:netlify`: compiled, typechecked, and generated all 21 static pages; `/api/browser/match` emitted as a dynamic route |

No merge or deployment was performed. Provider-hosted consent screens still require a credentialed production smoke run using the steps in `docs/PRODUCTION_ONBOARDING_QA.md`.
