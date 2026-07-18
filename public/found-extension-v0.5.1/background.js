const FOUND_ORIGIN = "https://sage-profiterole-3b1c22.netlify.app";
const TOKEN_KEY = "found:browser-session";
const PROFILE_KEY = "found:browser-profile";
const REDIRECT_SUPPRESSION_KEY = "found:recent-outbound-targets";
const REDIRECT_SUPPRESSION_MS = 120_000;

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
  if (message?.type === "found:capture-page") {
    capturePage(message.capture).then(sendResponse).catch(() => sendResponse({ ok: false, reason: "temporary_network_failure" }));
    return true;
  }
  if (message?.type === "found:note-outbound") {
    noteOutbound(message.targetUrl).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "found:redirect-suppression-status") {
    redirectSuppressionStatus(message.pageUrl).then(sendResponse).catch(() => sendResponse({ suppressed: false }));
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

async function capturePage(capture) {
  const stored=await chrome.storage.local.get([TOKEN_KEY]);const token=stored[TOKEN_KEY];
  if(!token)return {ok:false,reason:"not_connected"};
  try{
    const response=await fetch(`${FOUND_ORIGIN}/api/browser/capture`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(capture)});
    const payload=await response.json().catch(()=>null);
    if(response.status===401){await chrome.storage.local.remove([TOKEN_KEY,PROFILE_KEY]);return {ok:false,reason:"session_expired"}}
    if(response.status===403&&payload?.error==="workspace_access_revoked"){await chrome.storage.local.remove([TOKEN_KEY,PROFILE_KEY]);return {ok:false,reason:"workspace_access_revoked"}}
    if(!response.ok||!payload?.ok)return {ok:false,reason:payload?.error||"server_rejected"};
    return payload;
  }catch{return {ok:false,reason:"temporary_network_failure"}}
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
  await notifyOpenTabs();
  return { ok: true, profile };
}

async function noteOutbound(targetUrl) {
  const target = redirectTarget(targetUrl);
  if (!target) return { ok: false };
  const stored = await chrome.storage.local.get([REDIRECT_SUPPRESSION_KEY]);
  const targets = Array.isArray(stored[REDIRECT_SUPPRESSION_KEY]) ? stored[REDIRECT_SUPPRESSION_KEY] : [];
  const now = Date.now();
  const nextTargets = targets.filter(item => item?.expiresAt > now).concat({ ...target, expiresAt: now + REDIRECT_SUPPRESSION_MS });
  await chrome.storage.local.set({ [REDIRECT_SUPPRESSION_KEY]: nextTargets.slice(-12) });
  return { ok: true };
}

async function redirectSuppressionStatus(pageUrl) {
  const target = redirectTarget(pageUrl);
  if (!target) return { suppressed: false };
  const stored = await chrome.storage.local.get([REDIRECT_SUPPRESSION_KEY]);
  const targets = Array.isArray(stored[REDIRECT_SUPPRESSION_KEY]) ? stored[REDIRECT_SUPPRESSION_KEY] : [];
  const now = Date.now();
  const active = targets.filter(item => item?.expiresAt > now);
  if (active.length !== targets.length) await chrome.storage.local.set({ [REDIRECT_SUPPRESSION_KEY]: active });
  return { suppressed: active.some(item => item.origin === target.origin || item.host === target.host) };
}

function redirectTarget(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return { origin: url.origin, host: url.hostname };
  } catch {
    return null;
  }
}

async function notifyOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).catch(() => []);
  await Promise.all(tabs.map(tab => {
    if (!tab.id) return Promise.resolve();
    return chrome.tabs.sendMessage(tab.id, { type: "found:workspace-connected" }).catch(() => null);
  }));
}
