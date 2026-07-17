const TOKEN_KEY = "found:browser-session";
const PROFILE_KEY = "found:browser-profile";
const runButton = document.getElementById("run");
const status = document.getElementById("status");
const account = document.getElementById("account");
const connectButton = document.getElementById("connect");
const EXTENSION_VERSION = "0.4.9";
const captureForm = document.getElementById("capture");

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
    if (/^https:\/\/www\.google\.[^/]+\/search/i.test(tab.url || "")) {
      status.textContent = "Found does not check search pages.";
      return;
    }
    const runtime = await chrome.tabs.sendMessage(tab.id, { type: "found:runtime-status" });
    if (runtime?.version !== EXTENSION_VERSION) {
      status.textContent = "Reload this page to finish updating Found.";
      return;
    }
    const result = await chrome.tabs.sendMessage(tab.id, { type: "found:run" });
    const messages = {
      matched: "Insight found. The battlecard is open on this page.",
      no_match: "No sufficiently strong insight was found in this workspace.",
      not_connected: "Connect this browser to your signed-in Found workspace first.",
      session_expired: "The Found browser session expired. Reconnect the workspace.",
      workspace_access_revoked: "Workspace access changed. Reconnect with an authorised account.",
      server_rejected: "Found could not check this page.",
      service_unavailable: "Found is temporarily unavailable. Try again shortly.",
      temporary_network_failure: "Found is temporarily offline. Try again shortly.",
      unsupported_page: "Found does not evaluate search-result pages.",
    };
    status.textContent = result?.matched ? messages.matched : messages[result?.reason] || messages.server_rejected;
    await showConnection();
  } catch {
    status.textContent = "Reload this page, then try again.";
  } finally {
    runButton.disabled = false;
  }
});

showConnection();

captureForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button=captureForm.querySelector('button[type="submit"]');button.disabled=true;button.textContent="ADDING…";
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:/.test(tab.url||""))throw new Error("invalid_page");
    const context=await chrome.tabs.sendMessage(tab.id,{type:"found:page-context"});
    const result=await chrome.runtime.sendMessage({type:"found:capture-page",capture:{...context,department:document.getElementById("department").value,note:document.getElementById("note").value.trim()}});
    if(!result?.ok)throw new Error(result?.reason||"capture_failed");
    captureForm.classList.add("saved");button.textContent="ADDED TO FOUND ✓";document.getElementById("note").value="";status.textContent="Saved to the selected department with this page as its source receipt.";
  }catch{button.disabled=false;button.textContent="ADD TO FOUND ↗";status.textContent="Found could not save this page. Reconnect the workspace or reload the page.";}
});

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  status.textContent = "Opening secure Found sign-in…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "found:connect-workspace" });
    if (!result?.ok) throw new Error("connection_failed");
    status.textContent = "Browser connected. Return to the page you were reading.";
    await showConnection();
  } catch {
    status.textContent = "Workspace connection did not finish. Try again.";
  } finally {
    connectButton.disabled = false;
  }
});
