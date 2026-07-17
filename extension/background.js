const FOUND_ORIGIN = "https://sage-profiterole-3b1c22.netlify.app";
const TOKEN_KEY = "found:browser-session";
const PROFILE_KEY = "found:browser-profile";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "found:connect-workspace") return;
  connectWorkspace().then(sendResponse).catch(error => sendResponse({ ok: false, error: error?.message || "Connection failed." }));
  return true;
});

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
