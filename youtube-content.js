// LecTranscribe — YouTube content script.
// tabCapture audio recording at 4x speed → upload to backend.

let floatingButton = null;
let isProcessing = false;
let abortRecording = null; // set during recording to allow cancellation

const APP_URL_DEFAULT = "https://lectranscribe.vercel.app";
const DEFAULT_PLAYBACK_RATE = 2.0;

async function getPlaybackRate() {
  const result = await chrome.storage.local.get(["playbackRate"]);
  return result.playbackRate ? parseFloat(result.playbackRate) : DEFAULT_PLAYBACK_RATE;
}

function getVideoId() {
  const url = new URL(window.location.href);
  if (url.pathname.startsWith("/shorts/")) {
    return url.pathname.split("/")[2];
  }
  return url.searchParams.get("v");
}

function getVideoTitle() {
  const t = document.querySelector("h1.ytd-watch-metadata yt-formatted-string");
  return t?.textContent?.trim() || document.title.replace(" - YouTube", "");
}

function getVideoDurationSec() {
  const v = document.querySelector("video");
  return v && Number.isFinite(v.duration) ? Math.floor(v.duration) : 0;
}

// ---------------------------------------------------------------------------
// Floating button UI
// ---------------------------------------------------------------------------

function createFloatingButton() {
  if (floatingButton) return;

  floatingButton = document.createElement("div");
  floatingButton.id = "lectranscribe-yt-float";
  floatingButton.innerHTML = `
    <div id="lt-yt-fab" style="
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      font-family: 'Pretendard Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <div id="lt-yt-status" style="
        background: #0c0c0e;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        padding: 10px 14px;
        color: rgba(255,255,255,0.85);
        font-size: 12px;
        display: none;
        max-width: 300px;
        line-height: 1.5;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        backdrop-filter: blur(12px);
      "></div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <select id="lt-yt-project" style="
          background: #0c0c0e;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 6px 8px;
          color: rgba(255,255,255,0.5);
          font-size: 10px;
          outline: none;
          cursor: pointer;
          appearance: none;
          text-align: center;
          max-width: 100px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          backdrop-filter: blur(12px);
          display: none;
        ">
          <option value="">--</option>
        </select>
        <select id="lt-yt-speed" style="
          background: #0c0c0e;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 6px 8px;
          color: rgba(255,255,255,0.7);
          font-size: 11px;
          outline: none;
          cursor: pointer;
          appearance: none;
          text-align: center;
          min-width: 40px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          backdrop-filter: blur(12px);
        ">
          <option value="1">1x</option>
          <option value="2">2x</option>
          <option value="4">4x</option>
        </select>
        <button id="lt-yt-btn" style="
          width: 52px;
          height: 52px;
          border-radius: 16px;
          background: linear-gradient(135deg, #34d399, #14b8a6);
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 24px rgba(52, 211, 153, 0.3);
          transition: transform 0.15s, box-shadow 0.15s;
        " title="LecTranscribe로 전사">
          <svg id="lt-yt-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(floatingButton);

  // Load saved playback rate into the speed selector
  const speedSelect = document.getElementById("lt-yt-speed");
  chrome.storage.local.get(["playbackRate"], (result) => {
    speedSelect.value = result.playbackRate || "2";
  });
  speedSelect.addEventListener("change", () => {
    chrome.storage.local.set({ playbackRate: speedSelect.value });
  });

  // Load projects from the app
  const projectSelect = document.getElementById("lt-yt-project");
  chrome.storage.local.get(["appUrl", "selectedProjectId"], async (result) => {
    const appUrl = result.appUrl || APP_URL_DEFAULT;
    try {
      const res = await fetch(`${appUrl}/api/projects`, { credentials: "include" });
      const data = await res.json();
      if (data.projects?.length > 0) {
        projectSelect.style.display = "";
        data.projects.forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.name;
          projectSelect.appendChild(opt);
        });
        if (result.selectedProjectId) projectSelect.value = result.selectedProjectId;
      }
    } catch {}
  });
  projectSelect.addEventListener("change", () => {
    chrome.storage.local.set({ selectedProjectId: projectSelect.value });
  });

  const btn = document.getElementById("lt-yt-btn");
  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.08)";
    btn.style.boxShadow = "0 6px 28px rgba(52, 211, 153, 0.45)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "scale(1)";
    btn.style.boxShadow = "0 4px 24px rgba(52, 211, 153, 0.3)";
  });
  btn.addEventListener("click", handleTranscribeClick);
}

function setRecordingUI(recording) {
  const btn = document.getElementById("lt-yt-btn");
  const icon = document.getElementById("lt-yt-icon");
  const speed = document.getElementById("lt-yt-speed");
  if (!btn || !icon) return;

  if (recording) {
    btn.style.background = "linear-gradient(135deg, #ef4444, #dc2626)";
    btn.style.boxShadow = "0 4px 24px rgba(239, 68, 68, 0.3)";
    btn.title = "녹음 중단";
    icon.innerHTML = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
    if (speed) speed.style.display = "none";
  } else {
    btn.style.background = "linear-gradient(135deg, #34d399, #14b8a6)";
    btn.style.boxShadow = "0 4px 24px rgba(52, 211, 153, 0.3)";
    btn.title = "LecTranscribe로 전사";
    icon.innerHTML = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';
    if (speed) speed.style.display = "";
  }
}

function setStatus(text, isError = false) {
  const el = document.getElementById("lt-yt-status");
  if (!el) return;
  el.textContent = text;
  el.style.display = "block";
  el.style.color = isError ? "#fca5a5" : "rgba(255,255,255,0.85)";
  el.style.borderColor = isError ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.08)";
}

function hideStatus(delay = 0) {
  setTimeout(() => {
    const el = document.getElementById("lt-yt-status");
    if (el) el.style.display = "none";
  }, delay);
}

// ---------------------------------------------------------------------------
// Background message helpers
// ---------------------------------------------------------------------------

function bgSend(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res) return reject(new Error("No response from background"));
      resolve(res);
    });
  });
}

// ---------------------------------------------------------------------------
// Main: guide user to click extension icon (required for tabCapture)
// ---------------------------------------------------------------------------

function handleTranscribeClick() {
  // If recording, abort it
  if (isProcessing && abortRecording) {
    abortRecording();
    return;
  }

  const videoEl = document.querySelector("video");
  if (!videoEl || !Number.isFinite(videoEl.duration) || videoEl.duration === 0) {
    setStatus("영상을 먼저 재생해주세요.", true);
    hideStatus(5000);
    return;
  }

  // Show current settings info
  chrome.storage.local.get(["playbackRate", "selectedProjectId"], (result) => {
    const rate = result.playbackRate || "2";
    const hasProject = !!result.selectedProjectId;
    const lines = [`우측 상단의 LecTranscribe 아이콘을 클릭하면 ${rate}배속으로 녹음이 시작돼요.`];
    if (!hasProject) lines.push("프로젝트 설정은 아이콘 옆 배속/프로젝트 선택기에서 할 수 있어요.");
    setStatus(lines.join(" "));
  });
}

// ---------------------------------------------------------------------------
// Recording flow: triggered by background after tabCapture starts
// ---------------------------------------------------------------------------

async function runRecordingFlow(tokenData, videoUrl, duration) {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const { transcriptId, userId, uploadToken, uploadEndpoint, deductCredit } = tokenData;
    if (!uploadEndpoint) throw new Error("백엔드 주소를 받지 못했어요");

    const playbackRate = await getPlaybackRate();

    // Reset video to start and play at configured speed
    const videoEl = document.querySelector("video");
    if (videoEl) {
      videoEl.currentTime = 0;
      videoEl.playbackRate = playbackRate;
      try { await videoEl.play(); } catch {}
    }

    setRecordingUI(true);

    const expectedSec = Math.ceil(duration / playbackRate);
    setStatus(`${playbackRate}배속 녹음 중 (약 ${Math.ceil(expectedSec / 60)}분 소요)... 중단하려면 버튼을 누르세요.`);

    // Wait for video to finish (with abort support)
    let aborted = false;
    const startTime = Date.now();
    await new Promise((resolve) => {
      const checkEnd = setInterval(() => {
        const v = document.querySelector("video");
        if (!v || v.ended || v.currentTime >= v.duration - 0.5) {
          clearInterval(checkEnd);
          resolve();
          return;
        }
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const remainingReal = Math.max(0, v.duration - v.currentTime);
        const remainingWall = Math.ceil(remainingReal / playbackRate);
        setStatus(`녹음 중... ${elapsed}초 경과 / 약 ${remainingWall}초 남음`);
      }, 1000);

      // Safety timeout
      const safetyTimer = setTimeout(() => {
        clearInterval(checkEnd);
        resolve();
      }, duration * 1000 * 1.2);

      // Abort handler
      abortRecording = () => {
        aborted = true;
        clearInterval(checkEnd);
        clearTimeout(safetyTimer);
        resolve();
      };
    });

    abortRecording = null;

    // Reset playback rate
    if (videoEl) videoEl.playbackRate = 1.0;

    if (aborted) {
      // User cancelled — stop recording, don't upload
      if (videoEl) videoEl.pause();
      setStatus("녹음이 중단됐어요.", true);
      try { await bgSend({ type: "LT_STOP_RECORDING" }); } catch {}
      hideStatus(3000);
      return;
    }

    // Stop recording + upload in background (avoids ArrayBuffer message transfer)
    setStatus("녹음을 마무리하고 업로드하고 있어요...");
    const stopUpRes = await bgSend({
      type: "LT_STOP_AND_UPLOAD",
      uploadEndpoint,
      fields: {
        transcriptId,
        userId,
        uploadToken,
        url: videoUrl,
        openaiApiKey: "",
        geminiApiKey: "",
        deductCredit: String(!!deductCredit),
        playbackRate: String(playbackRate),
      },
    });

    if (!stopUpRes.ok) {
      throw new Error(stopUpRes.error || "녹음/업로드 실패");
    }

    const appUrl = (await chrome.storage.local.get(["appUrl"])).appUrl || APP_URL_DEFAULT;
    setStatus("전사가 시작됐어요. 대시보드에서 확인하세요.");
    setTimeout(async () => {
      const { selectedProjectId: pid } = await chrome.storage.local.get(["selectedProjectId"]);
      window.open(`${appUrl}/dashboard${pid ? `?project=${pid}` : ""}`, "_blank");
    }, 800);
    hideStatus(5000);
  } catch (e) {
    console.error("[LecTranscribe]", e);
    setStatus(e.message || "문제가 발생했어요.", true);
    hideStatus(6000);
    try { await bgSend({ type: "LT_STOP_RECORDING" }); } catch {}
  } finally {
    isProcessing = false;
    abortRecording = null;
    setRecordingUI(false);
  }
}

// Listen for background messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "LT_RECORDING_STARTED") {
    runRecordingFlow(message.tokenData, message.videoUrl, message.duration);
  } else if (message.type === "LT_RECORDING_STATUS") {
    setStatus(message.message);
  } else if (message.type === "LT_RECORDING_ERROR") {
    setStatus(message.error, true);
    hideStatus(6000);
    isProcessing = false;
  } else if (message.type === "LT_START_AUDIO_EXTRACT") {
    // From popup — guide user to click extension icon for tabCapture
    handleTranscribeClick();
  }
});

// ---------------------------------------------------------------------------
// Init: create button on watch pages, react to SPA navigation
// ---------------------------------------------------------------------------

function init() {
  const videoId = getVideoId();
  if (videoId) {
    createFloatingButton();
  }
}

init();

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    init();
  }
}).observe(document, { subtree: true, childList: true });
