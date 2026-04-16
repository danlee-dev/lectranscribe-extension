// LecTranscribe — service worker.
// 1) LMS auto-detect (existing behavior)
// 2) YouTube tab audio capture via tabCapture + offscreen MediaRecorder
// 3) Proxy fetch/upload to lectranscribe backend

// One-shot migration: users upgrading from v1.4.x have the old
// vercel.app URL cached in chrome.storage.local. Move them to the
// canonical custom domain so next-clicks hit the new site. Runs on
// install AND update; harmless if the value is already the new one.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const { appUrl } = await chrome.storage.local.get(["appUrl"]);
    if (appUrl === "https://lectranscribe.vercel.app") {
      await chrome.storage.local.set({ appUrl: "https://lectranscribe.com" });
    }
  } catch { /* noop */ }
});

const VIDEO_PATTERN = /korea-cms-object\.cdn\.gov-ntruss\.com\/contents7\/kruniv1001\/([^/]+)\/contents\/media_files\/screen\.mp4/;

// ---------------------------------------------------------------------------
// YouTube audio URL capture via webRequest
// ---------------------------------------------------------------------------

const capturedAudioUrls = new Map(); // tabId -> { url, mimeType, contentLength }

// Listen for googlevideo.com audio requests from YouTube player
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const url = details.url;
    // YouTube audio streams contain "mime=audio" or "audio" content type indicators
    if (url.includes("googlevideo.com") && (url.includes("mime=audio") || url.includes("itag=14"))) {
      // Extract mime type from URL
      const mimeMatch = url.match(/mime=([^&]+)/);
      const mime = mimeMatch ? decodeURIComponent(mimeMatch[1]) : "audio/mp4";
      const clenMatch = url.match(/clen=(\d+)/);
      const contentLength = clenMatch ? parseInt(clenMatch[1], 10) : 0;
      const durMatch = url.match(/dur=([\d.]+)/);
      const duration = durMatch ? parseFloat(durMatch[1]) : 0;

      // Get the base URL (without range parameter to download full file)
      let baseUrl = url.replace(/&range=[^&]+/, "");

      capturedAudioUrls.set(details.tabId, {
        url: baseUrl,
        mimeType: mime,
        contentLength,
        duration,
      });
    }
  },
  { urls: ["*://*.googlevideo.com/*"] }
);

function startAudioCapture(tabId, videoId) {
  // Clear any old capture for this tab
  capturedAudioUrls.delete(tabId);
}

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedAudioUrls.delete(tabId);
});

// ---------------------------------------------------------------------------
// Dashboard tab reuse
// ---------------------------------------------------------------------------
//
// When the user transcribes a new video from the extension (YouTube or
// LMS), we used to open a fresh tab every single time. Five lectures
// in a row = five tabs stacked up. The user expects the existing
// dashboard tab to pick up the new transcription instead, the same
// way Gmail/Slack/Notion do with single-window apps.
//
// Strategy: query for any open tab already pointing at the dashboard
// path (any of our known hosts), update its URL + focus it. Fall back
// to opening a new tab if none exists. host_permissions already covers
// these URLs so no extra manifest permission is needed.
async function openOrFocusDashboard(url) {
  const patterns = [
    "https://lectranscribe.com/dashboard*",
    "https://www.lectranscribe.com/dashboard*",
    "https://lectranscribe.vercel.app/dashboard*",
  ];
  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    if (tabs && tabs.length > 0) {
      // Prefer the currently-active dashboard tab if the user happens
      // to have one focused; otherwise take the first match.
      const target = tabs.find((tab) => tab.active) || tabs[0];
      await chrome.tabs.update(target.id, { url, active: true });
      if (target.windowId !== undefined) {
        try { await chrome.windows.update(target.windowId, { focused: true }); } catch { /* noop */ }
      }
      return;
    }
  } catch {
    // Query failed (unusual, but fall through) — we'll just open a new tab.
  }
  chrome.tabs.create({ url });
}

// ---------------------------------------------------------------------------
// LMS auto-detect (unchanged)
// ---------------------------------------------------------------------------

async function getVideosForTab(tabId) {
  const result = await chrome.storage.session.get(`tab_${tabId}`);
  return result[`tab_${tabId}`] || [];
}

async function setVideosForTab(tabId, videos) {
  await chrome.storage.session.set({ [`tab_${tabId}`]: videos });
}

async function handleVideoDetected(url, tabId) {
  const match = url.match(VIDEO_PATTERN);
  if (!match) return;

  const contentId = match[1];
  const tabVideos = await getVideosForTab(tabId);

  if (tabVideos.find((v) => v.contentId === contentId)) return;

  const cleanUrl = url.split("?")[0];
  tabVideos.push({ url: cleanUrl, contentId, timestamp: Date.now() });
  await setVideosForTab(tabId, tabVideos);

  chrome.action.setBadgeText({ text: String(tabVideos.length), tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#34d399", tabId });

  chrome.tabs.sendMessage(tabId, {
    type: "VIDEO_DETECTED",
    url: cleanUrl,
    contentId,
    count: tabVideos.length,
  }).catch(() => {});
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => { handleVideoDetected(details.url, details.tabId); },
  { urls: ["*://korea-cms-object.cdn.gov-ntruss.com/*screen.mp4*"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => { handleVideoDetected(details.url, details.tabId); },
  {
    urls: ["https://korea-cms-object.cdn.gov-ntruss.com/*"],
    types: ["media", "xmlhttprequest", "other"],
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab_${tabId}`);
});

// ---------------------------------------------------------------------------
// Offscreen document lifecycle (for tabCapture MediaRecorder)
// ---------------------------------------------------------------------------

// Track offscreen creation state to avoid races. createDocument throws if
// an offscreen already exists, so we lock and check before creating.
let offscreenCreating = null;

async function ensureOffscreenDocument() {
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existing.length > 0) return;

  offscreenCreating = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Recording YouTube tab audio for transcription",
  });
  try {
    await offscreenCreating;
  } catch (e) {
    // If creation failed because one already exists (race), that's fine
    if (!String(e).includes("Only a single offscreen")) {
      throw e;
    }
  } finally {
    offscreenCreating = null;
  }
}

async function closeOffscreenDocument() {
  try {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (existing.length > 0) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {
    console.warn("[LecTranscribe bg] closeOffscreenDocument:", e);
  }
}

// Force cleanup of all recording state - call before starting a new recording
// to recover from any prior failure that left things in a bad state.
async function forceCleanupRecording() {
  // Try to tell offscreen to stop (best effort)
  try {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stop-recording" });
  } catch {}
  // Always close the offscreen document to release tab capture stream
  await closeOffscreenDocument();
  recordingState.clear();
  stopKeepAlive();
}

// ---------------------------------------------------------------------------
// Recording state (per tab)
// ---------------------------------------------------------------------------

const recordingState = new Map(); // tabId -> { startedAt, originalRate }

// Per-tab popup management: YouTube watch pages use action.onClicked (no popup),
// everything else uses the default popup.html.
function isYouTubeWatchUrl(url) {
  return !!url && (url.includes("youtube.com/watch") || url.includes("youtube.com/shorts/"));
}

async function syncPopupForTab(tab) {
  if (!tab?.id) return;
  try {
    if (isYouTubeWatchUrl(tab.url)) {
      // YouTube: disable popup so action.onClicked fires (required for tabCapture)
      await chrome.action.setPopup({ tabId: tab.id, popup: "" });
    } else {
      await chrome.action.setPopup({ tabId: tab.id, popup: "popup.html" });
    }
  } catch {}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    syncPopupForTab(tab);

    // If the tab that was being recorded navigated/refreshed, the captured
    // MediaStream is now orphaned (its consumer content script is gone).
    // Force-stop the offscreen recorder so Chrome releases the tabCapture
    // indicator and future start-recording calls aren't blocked by an
    // "active stream" conflict.
    if (recordingState.has(tabId)) {
      console.log("[LecTranscribe bg] recording tab navigated/reloaded — cleaning up");
      forceCleanupRecording().catch(() => {});
    }
  }
  // Fetch interceptor is now injected via manifest content_scripts (youtube-intercept.js)
});

// Tab closed while recording → same cleanup path
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingState.has(tabId)) {
    console.log("[LecTranscribe bg] recording tab closed — cleaning up");
    forceCleanupRecording().catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    syncPopupForTab(tab);
  } catch {}
});

async function getYoutubeVideoMeta(tabId) {
  // Read video id, title, duration from the YouTube tab DOM
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const url = new URL(window.location.href);
      const videoId = url.pathname.startsWith("/shorts/")
        ? url.pathname.split("/")[2]
        : url.searchParams.get("v");
      const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string");
      const title = titleEl?.textContent?.trim() || document.title.replace(" - YouTube", "");
      const v = document.querySelector("video");
      const duration = v && Number.isFinite(v.duration) ? Math.floor(v.duration) : 0;
      return { videoId, title, duration };
    },
  });
  return result || {};
}

// Listen for action button click - this is the only context where
// chrome.tabCapture.getMediaStreamId() works due to activeTab permission.
let actionClickProcessing = false;
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.url) return;
  if (!isYouTubeWatchUrl(tab.url)) return;
  if (actionClickProcessing) return;
  if (recordingState.has(tab.id)) return;
  actionClickProcessing = true;
  let tokenData = null;
  let appUrl = "https://lectranscribe.com";

  try {
    // 1. Read video metadata from the page
    const meta = await getYoutubeVideoMeta(tab.id);
    if (!meta.videoId) throw new Error("영상 ID를 찾을 수 없어요");

    const videoUrl = `https://www.youtube.com/watch?v=${meta.videoId}`;
    appUrl = (await chrome.storage.local.get(["appUrl"])).appUrl || appUrl;

    chrome.tabs.sendMessage(tab.id, {
      type: "LT_RECORDING_STATUS",
      message: "영상 정보 확인 중...",
    }).catch(() => {});

    // All YouTube videos use tabCapture (server-side download blocked by YouTube)
    if (!meta.duration) throw new Error("영상을 먼저 재생해주세요");

    chrome.tabs.sendMessage(tab.id, {
      type: "LT_RECORDING_STATUS",
      message: "비공개 영상이에요. LecTranscribe 인증 확인 중...",
    }).catch(() => {});

    const { selectedProjectId } = await chrome.storage.local.get(["selectedProjectId"]);
    const tokenRes = await fetch(`${appUrl}/api/transcribe-upload-token`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl, title: meta.title, ...(selectedProjectId ? { projectId: selectedProjectId } : {}) }),
    });

    if (tokenRes.status === 401) {
      chrome.tabs.create({ url: `${appUrl}/auth/login` });
      throw new Error("LecTranscribe 로그인이 필요해요");
    }
    if (tokenRes.status === 402) {
      throw new Error("크레딧이 부족해요. LecTranscribe에서 충전해주세요.");
    }
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      throw new Error(`토큰 발행 실패: ${errText.slice(0, 150)}`);
    }
    const tokenData = await tokenRes.json();

    // Force cleanup any stale recording state before starting new one
    await forceCleanupRecording();

    // Start tab capture (must run synchronously in the action.onClicked handler)
    await startTabRecording(tab.id);

    // Tell content script: recording is on, wait for video to finish
    chrome.tabs.sendMessage(tab.id, {
      type: "LT_RECORDING_STARTED",
      tokenData,
      duration: meta.duration,
      videoUrl,
    }).catch(() => {});
  } catch (e) {
    console.error("[LecTranscribe bg] action click error:", e);
    await forceCleanupRecording();
    // Mark the transcript as failed if it was created
    if (typeof tokenData !== "undefined" && tokenData?.transcriptId) {
      fetch(`${appUrl}/api/transcripts/${tokenData.transcriptId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "failed" }),
      }).catch(() => {});
    }
    chrome.tabs.sendMessage(tab.id, {
      type: "LT_RECORDING_ERROR",
      error: String(e?.message || e),
    }).catch(() => {});
  } finally {
    actionClickProcessing = false;
  }
});

async function startTabRecording(tabId) {
  // Always force-cleanup before starting. Prior failures may leave the
  // offscreen document or tab stream alive, causing:
  //   "Cannot capture a tab with an active stream"
  //   "Only a single offscreen document may be created"
  await forceCleanupRecording();

  // Small delay to let Chrome release the stream after closing offscreen
  await new Promise((r) => setTimeout(r, 200));

  // Get a stream ID for this tab (must be called from service worker)
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });

  await ensureOffscreenDocument();

  // Send to offscreen to start recording
  let startRes;
  try {
    startRes = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "start-recording",
      streamId,
    });
  } catch (e) {
    await closeOffscreenDocument();
    throw new Error(`Offscreen message failed: ${e?.message || e}`);
  }

  if (!startRes?.ok) {
    await closeOffscreenDocument();
    throw new Error(startRes?.error || "Failed to start recording");
  }

  recordingState.set(tabId, { startedAt: Date.now() });

  // Keep the service worker alive during the long recording.
  // MV3 SW gets suspended after ~30s idle, which would lose recordingState.
  startKeepAlive();

  return { ok: true };
}

// Keep the service worker alive by sending periodic noop messages to offscreen.
let keepAliveInterval = null;
function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => {});
  }, 20 * 1000);
}
function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

async function hasOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return existing.length > 0;
}

async function stopTabRecording(tabId) {
  // Service worker may have been suspended during the long recording, in
  // which case our in-memory recordingState is empty. The source of truth
  // for "is recording active" is the offscreen document existence.
  const offscreenAlive = await hasOffscreenDocument();
  if (!offscreenAlive) {
    throw new Error("녹음 세션이 만료됐어요. 다시 시도해주세요.");
  }

  let stopRes;
  try {
    stopRes = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "stop-recording",
    });
  } catch (e) {
    await closeOffscreenDocument();
    throw new Error(`녹음 종료 메시지 실패: ${e?.message || e}`);
  }

  recordingState.delete(tabId);
  await closeOffscreenDocument();
  stopKeepAlive();

  if (!stopRes?.ok) {
    throw new Error(stopRes?.error || "Failed to stop recording");
  }

  // Convert base64 back to ArrayBuffer
  const binary = atob(stopRes.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return {
    fileBuffer: bytes.buffer,
    contentType: stopRes.contentType || "audio/webm",
    byteLength: stopRes.byteLength || bytes.buffer.byteLength,
  };
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ----- LMS popup compatibility -----
  if (message.type === "GET_CURRENT_TAB_VIDEOS") {
    const getTabId = sender.tab
      ? Promise.resolve(sender.tab.id)
      : new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs[0]?.id);
          });
        });

    getTabId.then(async (tabId) => {
      if (tabId) {
        const videos = await getVideosForTab(tabId);
        sendResponse({ videos });
      } else {
        sendResponse({ videos: [] });
      }
    });
    return true;
  }

  // ----- Projects list for popup -----
  //
  // Historically this silently swallowed errors into `projects: []`, so
  // a logged-out or cookie-less user saw "분류 안 함" with no hint that
  // anything was wrong. Now we surface the HTTP status + the tried URL
  // so the popup can render "사이트 로그인 필요" when it's really 401,
  // and the user can tell whether the extension even reached the API.
  if (message.type === "GET_PROJECTS") {
    (async () => {
      // Normalize stale vercel.app URLs at read time too — the
      // onInstalled migration only fires on install/update, so users
      // who never triggered an update still had the old host cached.
      // Normalizing here makes the fix self-healing on every popup.
      let appUrl = (await chrome.storage.local.get(["appUrl"])).appUrl || "https://lectranscribe.com";
      if (/lectranscribe\.vercel\.app/.test(appUrl)) {
        appUrl = "https://lectranscribe.com";
        try { await chrome.storage.local.set({ appUrl }); } catch {}
      }
      try {
        const res = await fetch(`${appUrl}/api/projects`, { credentials: "include" });
        if (res.status === 401 || res.status === 403) {
          sendResponse({ projects: [], error: "unauthorized", appUrl });
          return;
        }
        if (!res.ok) {
          sendResponse({ projects: [], error: `http_${res.status}`, appUrl });
          return;
        }
        const data = await res.json();
        sendResponse({ projects: data.projects || [], appUrl });
      } catch (e) {
        console.error("[LecTranscribe bg] GET_PROJECTS failed:", e);
        sendResponse({ projects: [], error: "network", appUrl });
      }
    })();
    return true;
  }

  // ----- YouTube video info for popup -----
  if (message.type === "GET_YOUTUBE_VIDEO") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !isYouTubeWatchUrl(tab.url)) {
          sendResponse({ video: null });
          return;
        }
        const meta = await getYoutubeVideoMeta(tab.id);
        if (!meta.videoId) {
          sendResponse({ video: null });
          return;
        }
        sendResponse({
          video: {
            videoId: meta.videoId,
            title: meta.title,
            duration: meta.duration,
            url: `https://www.youtube.com/watch?v=${meta.videoId}`,
          },
        });
      } catch (e) {
        sendResponse({ video: null, error: String(e) });
      }
    })();
    return true;
  }

  // ----- YouTube transcribe from popup -----
  if (message.type === "TRANSCRIBE_YOUTUBE") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }

        // Send message to content script to start audio extraction flow
        chrome.tabs.sendMessage(tab.id, { type: "LT_START_AUDIO_EXTRACT" });
        sendResponse({ ok: true, action: "extracting" });
      } catch (e) {
        console.error("[LecTranscribe bg] transcribe youtube error:", e);
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  // ----- Extract audio stream URL from YouTube (MAIN world) -----
  if (message.type === "LT_EXTRACT_AUDIO") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No tab id" });
      return;
    }
    (async () => {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            // Return video ID - the background will handle the rest
            const urlParams = new URLSearchParams(window.location.search);
            const videoId = urlParams.get("v") ||
              (window.location.pathname.startsWith("/shorts/") ? window.location.pathname.split("/")[2] : null);
            return { videoId };
          },
        });

        const videoId = result?.result?.videoId;
        if (!videoId) {
          sendResponse({ ok: false, error: "영상 ID를 찾을 수 없어요." });
          return;
        }

        // Read captured URLs from the fetch interceptor
        const [captureResult] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            // First try the specifically identified audio URL
            let url = window.__ltCapturedAudioUrl;

            // If not found, search through all captured URLs
            if (!url && window.__ltCapturedUrls?.length > 0) {
              // Try to find audio URL by checking for audio indicators
              url = window.__ltCapturedUrls.find(u =>
                u.includes("mime=audio") || u.includes("mime%3Daudio")
              );
              // If still not found, use the first captured URL (likely has both audio+video)
              if (!url) {
                url = window.__ltCapturedUrls[0];
              }
            }

            if (!url) {
              return { error: "오디오 스트림을 찾을 수 없어요. 영상을 재생한 후 다시 시도해주세요.", capturedCount: (window.__ltCapturedUrls || []).length };
            }

            // Remove range parameter to download full file
            const fullUrl = url.replace(/&range=[^&]+/, "");

            const mimeMatch = fullUrl.match(/mime=([^&]+)/);
            const mime = mimeMatch ? decodeURIComponent(mimeMatch[1]) : "audio/mp4";
            const clenMatch = fullUrl.match(/clen=(\d+)/);
            const contentLength = clenMatch ? parseInt(clenMatch[1], 10) : 0;
            const durMatch = fullUrl.match(/dur=([\d.]+)/);
            const duration = durMatch ? parseFloat(durMatch[1]) : 0;

            return { url: fullUrl, mimeType: mime, contentLength, duration };
          },
        });

        const data = captureResult?.result;
        if (data?.error) {
          sendResponse({ ok: false, error: data.error + (data.capturedCount ? ` (captured: ${data.capturedCount})` : "") });
        } else if (data?.url) {
          sendResponse({ ok: true, streamInfo: data });
        } else {
          sendResponse({ ok: false, error: "오디오 스트림을 추출할 수 없어요." });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  // ----- Download audio from googlevideo + upload to backend in one step -----
  if (message.type === "LT_DOWNLOAD_AND_UPLOAD") {
    (async () => {
      try {
        // Download audio from YouTube
        const dlRes = await fetch(message.audioUrl);
        if (!dlRes.ok) {
          sendResponse({ ok: false, error: `오디오 다운로드 실패 (HTTP ${dlRes.status})` });
          return;
        }
        const audioBlob = await dlRes.blob();
        const sizeMB = (audioBlob.size / 1024 / 1024).toFixed(1);
        console.log("[LecTranscribe bg] downloaded audio:", sizeMB, "MB");

        if (audioBlob.size < 10000) {
          sendResponse({ ok: false, error: `다운로드된 오디오가 너무 작아요 (${audioBlob.size} bytes)` });
          return;
        }

        // Upload to backend
        const formData = new FormData();
        const file = new File([audioBlob], message.fileName || "audio.m4a", { type: message.fileType || "audio/mp4" });
        formData.append("file", file);
        for (const [k, v] of Object.entries(message.fields || {})) {
          formData.append(k, String(v));
        }

        const upRes = await fetch(message.uploadEndpoint, { method: "POST", body: formData });
        const upText = await upRes.text();
        console.log("[LecTranscribe bg] upload response:", upRes.status);

        if (!upRes.ok) {
          sendResponse({ ok: false, error: `업로드 실패 (HTTP ${upRes.status}): ${upText.slice(0, 200)}` });
          return;
        }

        sendResponse({ ok: true, sizeMB });
      } catch (e) {
        console.error("[LecTranscribe bg] download+upload error:", e);
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  if (message.type === "OPEN_LATEST") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    (async () => {
      const tabVideos = await getVideosForTab(tabId);
      if (tabVideos.length > 0) {
        const latest = tabVideos[tabVideos.length - 1];
        const result = await chrome.storage.local.get(["appUrl", "selectedProjectId"]);
        const appUrl = result.appUrl || "https://lectranscribe.com";
        const pid = result.selectedProjectId;
        const url = `${appUrl}/dashboard?video=${encodeURIComponent(latest.url)}${pid ? `&project=${pid}` : ""}`;
        openOrFocusDashboard(url);
      }
    })();
    return true;
  }

  if (message.type === "OPEN_TRANSCRIBE") {
    (async () => {
      const appUrl = message.appUrl || "https://lectranscribe.com";
      const { selectedProjectId: pid } = await chrome.storage.local.get(["selectedProjectId"]);
      const url = `${appUrl}/dashboard?video=${encodeURIComponent(message.videoUrl)}${pid ? `&project=${pid}` : ""}`;
      openOrFocusDashboard(url);
    })();
    return true;
  }

  // Generic "open this URL on the site", used by the popup's
  // "프로젝트 관리하기" link so it reuses an existing dashboard tab
  // via openOrFocusDashboard instead of stacking new ones.
  if (message.type === "OPEN_URL") {
    if (message.url) openOrFocusDashboard(message.url);
    return false;
  }

  // ----- Tab capture recording -----
  if (message.type === "LT_STOP_RECORDING") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No tab id from sender" });
      return;
    }
    forceCleanupRecording()
      .then(() => {
        actionClickProcessing = false;
        sendResponse({ ok: true });
      })
      .catch((e) => {
        actionClickProcessing = false;
        console.error("[LecTranscribe bg] stop recording error:", e);
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
    return true;
  }

  // ----- Stop recording + upload in one step (avoids ArrayBuffer message transfer) -----
  if (message.type === "LT_STOP_AND_UPLOAD") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No tab id" });
      return;
    }
    (async () => {
      try {
        const result = await stopTabRecording(tabId);
        const fileBuffer = result.fileBuffer;
        const contentType = result.contentType || "audio/webm";
        const sizeMB = (fileBuffer.byteLength / 1024 / 1024).toFixed(1);
        console.log("[LecTranscribe bg] recorded audio:", sizeMB, "MB");

        if (fileBuffer.byteLength < 10000) {
          sendResponse({ ok: false, error: "녹음된 오디오가 비어있어요. 영상이 음소거 상태인지 확인해주세요." });
          return;
        }

        // Upload directly from background
        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: contentType });
        const file = new File([blob], "audio.webm", { type: contentType });
        formData.append("file", file);
        for (const [k, v] of Object.entries(message.fields || {})) {
          formData.append(k, String(v));
        }

        const upRes = await fetch(message.uploadEndpoint, { method: "POST", body: formData });
        const upText = await upRes.text();
        console.log("[LecTranscribe bg] upload response:", upRes.status, sizeMB, "MB");

        if (!upRes.ok) {
          sendResponse({ ok: false, error: `업로드 실패 (HTTP ${upRes.status})` });
          return;
        }

        sendResponse({ ok: true, sizeMB });
      } catch (e) {
        console.error("[LecTranscribe bg] stop+upload error:", e);
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  // ----- Backend communication -----
  if (message.type === "LT_FETCH") {
    (async () => {
      try {
        const { url, options } = message;
        const res = await fetch(url, options || {});
        const text = await res.text();
        sendResponse({ ok: res.ok, status: res.status, body: text });
      } catch (e) {
        sendResponse({ ok: false, status: 0, error: String(e) });
      }
    })();
    return true;
  }

  if (message.type === "LT_UPLOAD") {
    (async () => {
      try {
        const { url, fileBuffer, fileName, fileType, fields } = message;
        console.log("[LecTranscribe bg] uploading to:", url, "size:", fileBuffer?.byteLength);
        if (!url) {
          sendResponse({ ok: false, status: 0, error: "Upload URL is empty" });
          return;
        }
        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: fileType || "audio/webm" });
        formData.append("file", new File([blob], fileName || "audio.webm", { type: fileType }));
        for (const [k, v] of Object.entries(fields || {})) {
          formData.append(k, String(v));
        }
        const res = await fetch(url, { method: "POST", body: formData });
        const text = await res.text();
        console.log("[LecTranscribe bg] upload response:", res.status);
        sendResponse({ ok: res.ok, status: res.status, body: text });
      } catch (e) {
        console.error("[LecTranscribe bg] upload error:", e);
        sendResponse({ ok: false, status: 0, error: String(e) });
      }
    })();
    return true;
  }
});
