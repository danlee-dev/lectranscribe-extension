// Intercept fetch and XMLHttpRequest to capture YouTube audio stream URLs.
// Must run at document_start in MAIN world before YouTube's player loads.

(function() {
  if (window.__ltFetchPatched) return;
  window.__ltFetchPatched = true;

  // Intercept fetch — capture all googlevideo videoplayback URLs
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url && url.includes("googlevideo.com/videoplayback")) {
        // Store all captured URLs, we'll pick the audio one later
        if (!window.__ltCapturedUrls) window.__ltCapturedUrls = [];
        window.__ltCapturedUrls.push(url);
        // Also try to identify audio specifically
        if (url.includes("mime=audio") || url.includes("mime%3Daudio")) {
          window.__ltCapturedAudioUrl = url;
        }
      }
    } catch {}
    return originalFetch.apply(this, args);
  };

  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try {
      if (typeof url === "string" && url.includes("googlevideo.com/videoplayback")) {
        if (!window.__ltCapturedUrls) window.__ltCapturedUrls = [];
        window.__ltCapturedUrls.push(url);
        if (url.includes("mime=audio") || url.includes("mime%3Daudio")) {
          window.__ltCapturedAudioUrl = url;
        }
      }
    } catch {}
    return originalOpen.call(this, method, url, ...rest);
  };
})();
