// Tiny marker content script — runs only on the LecTranscribe website origin.
// The page's install modal reads this attribute to know "already added" vs
// "Add to Chrome", without needing externally_connectable messaging.
(function () {
  try {
    const manifest = chrome.runtime.getManifest();
    document.documentElement.setAttribute(
      "data-lectranscribe-installed",
      manifest.version || "1"
    );
  } catch {
    // noop — if anything fails we simply don't set the marker
  }
})();
