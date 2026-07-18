const TOKEN_KEY = "found:browser-session";
const PROFILE_KEY = "found:browser-profile";
const status = document.getElementById("status");
const account = document.getElementById("account");
const connectButton = document.getElementById("connect");
const headline = document.getElementById("headline");
const statePill = document.getElementById("statePill");
const EXTENSION_VERSION = "0.5.2";
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
      headline.textContent = "Open a page";
      statePill.textContent = "QUIET";
      statePill.dataset.state = "quiet";
      status.textContent = "Open any web page. The in-page avatar appears there when Found can run.";
      return;
    }
    if (/^https:\/\/www\.google\.[^/]+\/search/i.test(tab.url)) {
      headline.textContent = "Search skipped";
      statePill.textContent = "QUIET";
      statePill.dataset.state = "quiet";
      status.textContent = "Search-result pages stay quiet. Open a source page, then use the avatar to save it.";
      return;
    }
    if (/^(?:https?:\/\/)?(?:[a-z0-9-]+--)?sage-profiterole-3b1c22\.netlify\.app/i.test(tab.url)) {
      headline.textContent = "Inside Found";
      statePill.textContent = "QUIET";
      statePill.dataset.state = "quiet";
      status.textContent = "Found stays silent inside Found to avoid self-matching loops.";
      return;
    }
    const runtime = await chrome.tabs.sendMessage(tab.id, { type: "found:runtime-status" }).catch(() => null);
    if (runtime?.version !== EXTENSION_VERSION) {
      headline.textContent = "Reload page";
      statePill.textContent = "ATTN";
      statePill.dataset.state = "attention";
      status.textContent = "Reload this tab to finish updating the on-page Found avatar.";
      return;
    }
    headline.textContent = "Avatar is ready";
    statePill.textContent = "LIVE";
    statePill.dataset.state = "matched";
    status.textContent = "Strong matches open automatically. If there is no match, click the avatar to add this URL and comment to memory.";
  } catch {
    headline.textContent = "Page needs reload";
    statePill.textContent = "ATTN";
    statePill.dataset.state = "attention";
    status.textContent = "Reload this page to activate the in-page Found avatar.";
  }
}

async function currentPageContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("invalid_page");
  const context = await chrome.tabs.sendMessage(tab.id, { type: "found:page-context" }).catch(() => ({
    pageText: "",
    pageTitle: tab.title || "",
    pageUrl: tab.url || "",
  }));
  return context;
}

captureForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = captureForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Adding…";
  try {
    const context = await currentPageContext();
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
    status.textContent = "Found will show the avatar on open pages and auto-open only strong matches.";
    await showConnection();
    await showCurrentPageStatus();
  } catch {
    headline.textContent = "Connection incomplete";
    status.textContent = "Workspace connection did not finish. Try again.";
  } finally {
    connectButton.disabled = false;
  }
});

showConnection();
showCurrentPageStatus();
