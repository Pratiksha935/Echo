const FOUND_ORIGIN = "https://sage-profiterole-3b1c22.netlify.app";
const TOKEN_KEY = "found:browser-session";
const PROFILE_KEY = "found:browser-profile";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "found:connect-workspace") {
    connectWorkspace().then(sendResponse).catch(() => sendResponse({ ok: false, reason: "connection_failed" }));
    return true;
  }
  if (message?.type === "found:match-page") {
    matchPage(message.page).then(sendResponse).catch(() => sendResponse({ match: null, reason: "temporary_network_failure" }));
    return true;
  }
  if (message?.type === "found:append-memory") {
    appendMemory(message.update).then(sendResponse).catch(() => sendResponse({ ok: false, reason: "temporary_network_failure" }));
    return true;
  }
  return;
});

async function matchPage(page) {
  const stored = await chrome.storage.local.get([TOKEN_KEY]);
  const token = stored[TOKEN_KEY];
  if (!token) return { match: null, reason: "not_connected" };
  const body = {
    pageText: typeof page?.pageText === "string" ? page.pageText.slice(0, 8000) : "",
    pageTitle: typeof page?.pageTitle === "string" ? page.pageTitle.slice(0, 500) : "",
    pageUrl: typeof page?.pageUrl === "string" ? page.pageUrl.slice(0, 2000) : "",
  };
  try {
    const response = await fetch(`${FOUND_ORIGIN}/api/browser/match`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401) {
      await chrome.storage.local.remove([TOKEN_KEY, PROFILE_KEY]);
      return { match: null, reason: "session_expired" };
    }
    if (response.status === 403 && payload?.error === "workspace_access_revoked") {
      await chrome.storage.local.remove([TOKEN_KEY, PROFILE_KEY]);
      return { match: null, reason: "workspace_access_revoked" };
    }
    if (response.status === 429 || response.status >= 500) return { match: null, reason: "service_unavailable" };
    if (!response.ok || !payload || !("match" in payload)) return { match: null, reason: "server_rejected" };
    return payload.match ? { match: payload.match, reason: "matched" } : { match: null, reason: "no_match" };
  } catch {
    return { match: null, reason: "temporary_network_failure" };
  }
}

async function appendMemory(update) {
  const stored = await chrome.storage.local.get([TOKEN_KEY]);
  const token = stored[TOKEN_KEY];
  if (!token) return { ok: false, reason: "not_connected" };
  const body = {
    recordId: typeof update?.recordId === "string" ? update.recordId.slice(0, 200) : "",
    sourceUrl: typeof update?.sourceUrl === "string" ? update.sourceUrl.slice(0, 2000) : "",
    updateText: typeof update?.updateText === "string" ? update.updateText.trim().slice(0, 800) : "",
  };
  if (!body.recordId || body.updateText.length < 12) return { ok: false, reason: "invalid_update" };
  try {
    const response = await fetch(`${FOUND_ORIGIN}/api/browser/memory-update`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401) {
      await chrome.storage.local.remove([TOKEN_KEY, PROFILE_KEY]);
      return { ok: false, reason: "session_expired" };
    }
    if (response.status === 403 && payload?.error === "workspace_access_revoked") {
      await chrome.storage.local.remove([TOKEN_KEY, PROFILE_KEY]);
      return { ok: false, reason: "workspace_access_revoked" };
    }
    if (response.status === 429 || response.status >= 500) return { ok: false, reason: "service_unavailable" };
    if (!response.ok || !payload?.ok) return { ok: false, reason: payload?.error || "server_rejected" };
    return { ok: true, createdAt: payload.createdAt };
  } catch {
    return { ok: false, reason: "temporary_network_failure" };
  }
}

async function connectWorkspace() {
  const redirectUri = chrome.identity.getRedirectURL("found");
  const authUrl = `${FOUND_ORIGIN}/browser/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;
  const callbackUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  if (!callbackUrl) throw new Error("cancelled");
  const callback = new URL(callbackUrl);
  if (callback.origin !== new URL(redirectUri).origin || callback.pathname !== new URL(redirectUri).pathname) throw new Error("invalid_callback");
  const params = callback.searchParams;
  const token = params.get("token");
  const encodedProfile = params.get("profile");
  if (!token || !encodedProfile) throw new Error("missing_session");
  const normalized = encodedProfile.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const profile = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), character => character.charCodeAt(0))));
  if (!profile?.email || !profile?.organisationId || !profile?.organisationName) throw new Error("invalid_profile");
  await chrome.storage.local.set({ [TOKEN_KEY]: token, [PROFILE_KEY]: profile });
  return { ok: true, profile };
}
