const TOKEN_KEY = "found:browser-session";
const PROFILE_KEY = "found:browser-profile";
const runButton = document.getElementById("run");
const status = document.getElementById("status");
const account = document.getElementById("account");
const connectButton = document.getElementById("connect");
const headline = document.getElementById("headline");
const statePill = document.getElementById("statePill");
const EXTENSION_VERSION = "0.5.0";
const captureForm = document.getElementById("capture");

async function showConnection() {
  const stored = await chrome.storage.local.get([TOKEN_KEY, PROFILE_KEY]);
  const profile = stored[PROFILE_KEY];
  account.textContent = stored[TOKEN_KEY] && profile
    ? `${profile.organisationName} · ${profile.email}`
    : "Browser not connected to a Found workspace";
  document.body.classList.toggle("connected", Boolean(stored[TOKEN_KEY] && profile));
  return Boolean(stored[TOKEN_KEY] && profile);
}

async function showCurrentPageStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) {
      status.textContent = "Open a web page and Found will check it automatically.";
      return;
    }
    if (/^https:\/\/www\.google\.[^/]+\/search/i.test(tab.url)) {
      status.textContent = "Search-result pages stay quiet. Open a source page to check company memory.";
      return;
    }
    if (/^(?:https?:\/\/)?(?:[a-z0-9-]+--)?sage-profiterole-3b1c22\.netlify\.app/i.test(tab.url)) {
      status.textContent = "Found stays silent inside Found to avoid self-matching loops.";
      return;
    }
    status.textContent = "Ready on this page. Strong matches auto-open as a clean battlecard.";
  } catch {
    status.textContent = "Found auto-opens a battlecard when this page matches strong company memory.";
  }
}

async function checkCurrentPage({ userInitiated = false } = {}) {
  runButton.disabled = true;
  headline.textContent = userInitiated ? "Checking again" : "Checking this page";
  statePill.textContent = "CHECKING";
  statePill.dataset.state = "checking";
  status.textContent = "Comparing this page with approved workspace memory…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Open a web page first.");
    if (/^https:\/\/www\.google\.[^/]+\/search/i.test(tab.url || "")) {
      headline.textContent = "Search skipped";
      statePill.textContent = "QUIET";
      statePill.dataset.state = "quiet";
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
    headline.textContent = result?.matched ? "Prior work found" : result?.reason === "no_match" ? "No strong match" : "Found is active";
    statePill.textContent = result?.matched ? "FOUND" : result?.reason === "no_match" ? "QUIET" : "LIVE";
    statePill.dataset.state = result?.matched ? "matched" : result?.reason === "no_match" ? "quiet" : "attention";
    status.textContent = result?.matched ? messages.matched : messages[result?.reason] || messages.server_rejected;
    await showConnection();
  } catch {
    headline.textContent = "Page needs reload";
    statePill.textContent = "ATTN";
    statePill.dataset.state = "attention";
    status.textContent = "Reload this page, then try again.";
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener("click", () => checkCurrentPage({ userInitiated: true }));

showConnection().then(connected => {
  if (connected) checkCurrentPage();
});
showCurrentPageStatus();

captureForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = captureForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Adding…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("invalid_page");
    const context = await chrome.tabs.sendMessage(tab.id, { type: "found:page-context" });
    const result = await chrome.runtime.sendMessage({
      type: "found:capture-page",
      capture: {
        ...context,
        department: document.getElementById("department").value,
        note: document.getElementById("note").value.trim(),
      },
    });
    if (!result?.ok) throw new Error(result?.reason || "capture_failed");
    captureForm.classList.add("saved");
    button.textContent = "Added to memory ✓";
    document.getElementById("note").value = "";
    headline.textContent = "Memory updated";
    statePill.textContent = "SAVED";
    statePill.dataset.state = "matched";
    status.textContent = "Saved to the selected department with this page as its source receipt.";
  } catch {
    button.disabled = false;
    button.textContent = "Add to memory ↗";
    headline.textContent = "Save failed";
    statePill.textContent = "ATTN";
    statePill.dataset.state = "attention";
    status.textContent = "Found could not save this page. Reconnect the workspace or reload the page.";
  }
});

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  status.textContent = "Opening secure Found sign-in…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "found:connect-workspace" });
    if (!result?.ok) throw new Error("connection_failed");
    headline.textContent = "Browser connected";
    status.textContent = "Found will rerun the check on the open page automatically.";
    await showConnection();
    await checkCurrentPage();
  } catch {
    headline.textContent = "Connection incomplete";
    status.textContent = "Workspace connection did not finish. Try again.";
  } finally {
    connectButton.disabled = false;
  }
});
