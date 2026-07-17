# CTO onboarding release handoff

## Expected journey

1. Open `/integrations`. An unauthenticated visitor is redirected to sign-in with `/integrations` preserved as the return path.
2. Sign in. Found resolves only a workspace membership belonging to that authenticated user; a requested workspace must also match that membership.
3. Review Google Workspace access and continue to Google's consent screen. Cancelling grants no access and starts no indexing.
4. Return to Found. Google is shown as authorised or indexed; Slack is now unlocked.
5. Review Slack access and continue to Slack's separate consent screen. Google approval never implies Slack approval.
6. Return to Found. `ENTER WORKSPACE` appears only after both Google and Slack connections exist.
7. Open `/browser/connect` from the extension. Found pairs the extension to the signed-in user and selected workspace, then stores the signed browser token and profile.
8. Return to the page being reviewed. Extension matches are restricted to the organisation embedded in the signed pairing token.

Production sign-in and OAuth callbacks do not seed demo knowledge. Demo access is a separate, explicitly configured code path and must never be used as a fallback for a missing production workspace.

## Expected failure states

| Failure | Expected result |
| --- | --- |
| No authenticated session | Redirect to sign-in; preserve the intended Found return path. |
| Authenticated user has no permitted workspace | Do not expose workspace data; integration/browser pairing remains unavailable. |
| Google consent cancelled or fails | Store no Google connection, start no indexing, keep Slack locked, and show an authorisation failure. |
| Slack attempted before Google | Reject with `google_required`; do not start Slack OAuth. |
| Slack consent cancelled or fails | Store no Slack connection, keep workspace entry unavailable, and show an authorisation failure. |
| Connection saved but initial indexing incomplete | Show `AUTHORISED · NOT INDEXED`; do not claim indexed content. |
| Provider sync needs attention | Show `NEEDS ATTENTION`; retain the provider-specific connection boundary. |
| Extension session is unauthenticated | Show `Sign in to connect.` and clear any stored token/profile. |
| User lacks workspace access | Show `Workspace access required.` and clear any stored token/profile. |
| Pairing request fails | Show the retry state; do not claim the browser is connected. |
| Paired access is later revoked or expires | Clear the stored token/profile and return no company match. |
| Cross-tenant organisation ID is supplied | Membership/RLS checks return no foreign organisation or knowledge records. |
| Production workspace is missing | Show an unavailable/empty production state; never seed or substitute ReLoop demo data. |

Release evidence is executable in `tests/cto-onboarding.test.mjs` and runs under `npm run check`.
