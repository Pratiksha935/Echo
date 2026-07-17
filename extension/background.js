const FOUND_ORIGIN = "https://sage-profiterole-3b1c22.netlify.app";
const TOKEN_KEY = "found:browser-session";
const PROFILE_KEY = "found:browser-profile";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "found:connect-workspace") {
    connectWorkspace().then(sendResponse).catch(error => sendResponse({ ok: false, error: error?.message || "Connection failed." }));
    return true;
  }
  if (message?.type !== "found:match-page") return;
  matchPage(message.page).then(sendResponse).catch(() => sendResponse({ match: null, reason: "service_unavailable" }));
  return true;
});

async function matchPage(page) {
  const stored = await chrome.storage.local.get([TOKEN_KEY]);
  const token = stored[TOKEN_KEY];
  if (!token) return { match: null, reason: "not_connected" };
  try {
    const response = await fetch(`${FOUND_ORIGIN}/api/browser/match`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        pageText: typeof page?.pageText === "string" ? page.pageText.slice(0, 8000) : "",
        pageTitle: typeof page?.pageTitle === "string" ? page.pageTitle.slice(0, 500) : "",
        pageUrl: typeof page?.pageUrl === "string" ? page.pageUrl.slice(0, 2000) : "",
      }),
    });
    if (response.status === 401 || response.status === 403) {
      await chrome.storage.local.remove([TOKEN_KEY, PROFILE_KEY]);
      return { match: null, reason: response.status === 403 ? "workspace_access_revoked" : "session_expired" };
    }
    if (!response.ok) return { match: null, reason: "service_unavailable" };
    const payload = await response.json();
    return payload?.match ? { match: payload.match, reason: "matched" } : { match: null, reason: "no_match" };
  } catch {
    return { match: null, reason: "service_unavailable" };
  }
}

async function connectWorkspace() {
  const redirectUri = chrome.identity.getRedirectURL("found");
  const authUrl = `${FOUND_ORIGIN}/browser/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;
  const callbackUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  if (!callbackUrl) throw new Error("Found sign-in was cancelled.");
  const params = new URL(callbackUrl).searchParams;
  const token = params.get("token");
  const encodedProfile = params.get("profile");
  if (!token || !encodedProfile) throw new Error("Found did not return a workspace session.");
  const normalized = encodedProfile.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const profile = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), character => character.charCodeAt(0))));
  if (!profile?.email || !profile?.organisationId || !profile?.organisationName) throw new Error("The workspace profile was incomplete.");
  await chrome.storage.local.set({ [TOKEN_KEY]: token, [PROFILE_KEY]: profile });
  return { ok: true, profile };
}
