const runButton = document.getElementById("run");
const status = document.getElementById("status");

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  status.textContent = "Checking this page…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Open a web page first.");
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css", "update.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: "found:run" });
    status.textContent = result?.matched
      ? "Match found. The battlecard is open on this page."
      : "No matching company knowledge was found for this page.";
  } catch (error) {
    status.textContent = error?.message || "Found could not run on this page.";
  } finally {
    runButton.disabled = false;
  }
});
