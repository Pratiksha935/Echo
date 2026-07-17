const TOKEN_KEY = "found:browser-session";
const PROFILE_KEY = "found:browser-profile";
const runButton = document.getElementById("run");
const status = document.getElementById("status");
const account = document.getElementById("account");
const connectButton = document.getElementById("connect");

async function showConnection() {
  const stored = await chrome.storage.local.get([TOKEN_KEY, PROFILE_KEY]);
  const profile = stored[PROFILE_KEY];
  account.textContent = stored[TOKEN_KEY] && profile
    ? `${profile.organisationName} · ${profile.email}`
    : "Browser not connected to a Found workspace";
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  status.textContent = "Checking live company knowledge…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Open a web page first.");
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css", "update.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: "found:run" });
    const messages = {
      matched: "Insight found. The battlecard is open on this page.",
      no_match: "No sufficiently strong insight was found in this workspace.",
      not_connected: "Connect this browser to your signed-in Found workspace first.",
      session_expired: "The Found browser session expired. Reconnect the workspace.",
      workspace_access_revoked: "Workspace access changed. Reconnect with an authorised account.",
      service_unavailable: "Found could not reach the knowledge service. Try again shortly.",
      unsupported_page: "Found does not evaluate search-result pages.",
    };
    status.textContent = result?.matched ? messages.matched : messages[result?.reason] || messages.service_unavailable;
    await showConnection();
  } catch (error) {
    status.textContent = error?.message || "Found could not run on this page.";
  } finally {
    runButton.disabled = false;
  }
});

showConnection();

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  status.textContent = "Opening secure Found sign-in…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "found:connect-workspace" });
    if (!result?.ok) throw new Error(result?.error || "Workspace connection failed.");
    status.textContent = "Browser connected. Return to the page you were reading.";
    await showConnection();
  } catch (error) {
    status.textContent = error?.message || "Workspace connection failed.";
  } finally {
    connectButton.disabled = false;
  }
});
