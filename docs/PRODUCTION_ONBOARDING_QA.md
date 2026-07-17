# Found production onboarding QA

This is the release gate for handing Found to a CTO. It covers the production path only: one Found login, two separate source approvals, then an explicitly paired Chrome extension using the same Found account and workspace.

## Automated contract gate

Run:

```sh
node --test tests/production-onboarding-contract.test.mjs
npm run check
```

The contract suite verifies:

- unauthenticated workspace, integration, and extension-pairing routes retain the requested destination through login;
- Google sign-in uses PKCE and preserves a safe `return_to` value in an HttpOnly cookie;
- Google Workspace and Slack use separate routes, state, consent screens, and saved connection records;
- Slack cannot be approved before Google;
- the UI derives `authorised`, `indexed`, and `needs attention` from persisted connection rows, and does not claim indexing merely because OAuth returned;
- Chrome pairing uses `chrome.identity.launchWebAuthFlow`, requires a visible confirmation, and accepts only the exact Chromium callback shape;
- browser tokens are signed, carry the user and organisation, expire after one hour, and cannot be edited to select a different tenant;
- every browser insight revalidates the token's user/organisation membership and filters knowledge by that same organisation;
- an unindexed page returns `match: null`; live auth, integration, and extension paths do not seed or substitute fictional knowledge.

## Expected CTO journey

Use a clean Chrome profile so an existing provider or Found session cannot hide a step.

1. Open the production URL and choose **Log in**.
2. Choose Google sign-in. Complete the Google account prompt.
3. Confirm the browser returns to the originally requested Found page. A rejected, expired, or replayed callback must return to login with a retry message and retain the same safe destination.
4. On onboarding, confirm both required cards start from persisted state. A source with no saved authorization must not appear connected or indexed.
5. Open **Google Workspace — Review & approve**. Review Found's requested read-only scopes on Google's own consent screen, approve, and return to Found.
6. Confirm Google reads **Authorised · not indexed** until a real sync finishes. Only a non-null saved sync time may change it to **Indexed**.
7. Open **Slack — Review & approve** separately. Review Slack's public-channel read scopes on Slack's own consent screen and approve.
8. Enter the workspace only after both saved approvals exist. An empty new tenant must show empty product state, never ReLoop or another tenant's content.
9. Install the unpacked/published Found extension. In the extension choose **Connect workspace**.
10. Chrome opens Found's **Connect this browser?** page. Verify the displayed email and workspace, then explicitly confirm.
11. Open an indexed Google Doc or supported page. The extension may show only a match returned from the signed-in tenant. Open an unrelated/unindexed page and confirm no battle card appears.
12. After one hour, confirm the extension requires pairing again instead of silently extending or falling back to demo data.

Passing the automated suite is necessary but not sufficient. Steps involving provider-hosted consent screens, production environment values, extension packaging, a completed ingestion worker, and token expiry require this live smoke test.

## Failure-state matrix

| Point | Inject or observe | Required result |
| --- | --- | --- |
| Protected page | Open `/workspace`, `/integrations`, or browser authorization signed out | Redirect to login with the full safe relative destination retained |
| Google sign-in | Cancel consent, remove PKCE verifier, or replay the callback | Retry message; no Found session and no connection row |
| Return destination | Supply an absolute or protocol-relative `return_to` | Reject it and use the local fallback; never redirect off-origin |
| Google connector | Cancel source consent or return invalid state | Google remains unapproved; no indexing starts |
| Slack sequencing | Attempt Slack before Google | Return `google_required`; Slack remains unapproved |
| Slack connector | Cancel consent or return invalid state | Slack remains unapproved; no indexing starts |
| Connection storage | Make encrypted persistence fail after provider consent | Show storage failure and do not claim a saved authorization |
| Initial sync | Leave `last_synced_at` null or record a failed run | Show authorised/not indexed or needs attention, never indexed |
| Empty tenant | Log into a newly created production organisation | Empty state only; no seeded/demo records |
| Extension callback | Alter the Chromium extension ID or callback path | Reject pairing; issue no token |
| Pairing origin | Submit the approval form cross-origin | `403 invalid_origin`; issue no token |
| Browser token | Tamper with payload/signature or wait past one hour | `401 unauthorized` |
| Membership | Remove the user from the token's organisation | `403 workspace_access_revoked` on the next insight request |
| Cross-tenant probe | Put another organisation ID in the page request | Ignore it; membership and records remain bound to the signed token's organisation |
| Unindexed page | Open unrelated content | Return `match: null`; fabricate no insight |

## Evidence to retain for sign-off

Record the deployment commit and production URL, the Google and Slack external workspace names, screenshots of both provider consent scope lists, the saved connection status and last-sync time, the Chrome extension ID/version, one positive indexed-page result, one `match: null` result, and the one-hour expiry/re-pair result. Do not record OAuth codes, cookies, provider tokens, browser tokens, encryption keys, or signing secrets.
