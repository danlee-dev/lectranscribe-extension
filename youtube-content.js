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

// ---------------------------------------------------------------------------
// Styles — injected once so the pill can react via class changes
// ---------------------------------------------------------------------------
const YT_STYLES = `
  @keyframes lt-yt-enter {
    from { transform: translateY(14px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes lt-yt-pulse {
    0% { transform: scale(1); opacity: 0.9; }
    100% { transform: scale(2.4); opacity: 0; }
  }
  #lt-yt-float { animation: lt-yt-enter 0.42s cubic-bezier(0.22, 1, 0.36, 1); }
  #lt-yt-pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 10px 6px 10px 14px;
    background: rgba(12, 12, 12, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    color: rgba(255, 255, 255, 0.92);
    font-size: 12.5px;
    font-weight: 500;
    letter-spacing: -0.01em;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    transition: border-color 0.2s ease, background 0.2s ease;
    overflow: hidden;
  }
  #lt-yt-pill::before {
    content: "";
    position: absolute;
    top: 0;
    left: 16px;
    right: 16px;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(52, 211, 153, 0.55), transparent);
  }
  #lt-yt-pill.recording::before {
    background: linear-gradient(90deg, transparent, rgba(239, 68, 68, 0.7), transparent);
  }
  #lt-yt-pill.error::before {
    background: linear-gradient(90deg, transparent, rgba(251, 191, 36, 0.7), transparent);
  }
  #lt-yt-dot {
    position: relative;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #34d399;
    box-shadow: 0 0 10px rgba(52, 211, 153, 0.75);
    flex-shrink: 0;
  }
  #lt-yt-dot::after {
    content: "";
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 1px solid rgba(52, 211, 153, 0.45);
    animation: lt-yt-pulse 1.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
  }
  #lt-yt-pill.recording #lt-yt-dot { background: #ef4444; box-shadow: 0 0 10px rgba(239, 68, 68, 0.75); }
  #lt-yt-pill.recording #lt-yt-dot::after { border-color: rgba(239, 68, 68, 0.5); animation-duration: 1.2s; }
  #lt-yt-pill.error #lt-yt-dot { background: #fbbf24; box-shadow: 0 0 10px rgba(251, 191, 36, 0.6); }
  #lt-yt-pill.error #lt-yt-dot::after { display: none; }

  #lt-yt-label {
    white-space: nowrap;
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s ease;
  }
  #lt-yt-pill.error #lt-yt-label { color: #fca5a5; }

  #lt-yt-status-card {
    background: rgba(12, 12, 12, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 10px 14px;
    color: rgba(255, 255, 255, 0.92);
    font-size: 12px;
    line-height: 1.55;
    min-width: 220px;
    max-width: 320px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    display: none;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  }
  #lt-yt-status-card.visible { display: block; opacity: 1; transform: translateY(0); }
  #lt-yt-status-card .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  #lt-yt-status-card .row + .row { margin-top: 6px; }
  #lt-yt-status-card .label {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 9.5px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
  }
  #lt-yt-status-card .value {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    letter-spacing: -0.01em;
  }
  #lt-yt-status-card .value.accent { color: #34d399; }
  #lt-yt-status-card .bar {
    margin-top: 8px;
    height: 2px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: 999px;
    overflow: hidden;
  }
  #lt-yt-status-card .bar span {
    display: block;
    height: 100%;
    width: 0;
    background: linear-gradient(90deg, rgba(52, 211, 153, 0.85), rgba(45, 212, 191, 0.85));
    transition: width 0.8s linear;
  }

  .lt-yt-icon-btn {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
    flex-shrink: 0;
  }
  .lt-yt-icon-btn:hover { background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.9); }
  .lt-yt-icon-btn:active { transform: scale(0.94); }
  #lt-yt-main-btn { color: #34d399; }
  #lt-yt-main-btn:hover { background: rgba(52, 211, 153, 0.1); color: #6ee7b7; }
  #lt-yt-pill.recording #lt-yt-main-btn { color: #ef4444; }
  #lt-yt-pill.recording #lt-yt-main-btn:hover { background: rgba(239, 68, 68, 0.1); color: #fca5a5; }


  #lt-yt-panel {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    min-width: 240px;
    background: rgba(12, 12, 12, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    padding: 12px 14px;
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: none;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  }
  #lt-yt-panel.open { display: block; opacity: 1; transform: translateY(0); }
  #lt-yt-panel .row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
  #lt-yt-panel .row + .row { border-top: 1px dashed rgba(255, 255, 255, 0.05); }
  #lt-yt-panel label {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 9.5px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.35);
    min-width: 56px;
  }
  #lt-yt-panel select {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
    font-family: inherit;
    font-size: 12px;
    padding: 4px 0;
    outline: none;
    appearance: none;
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,255,255,0.3)' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0 center;
    padding-right: 16px;
  }
  #lt-yt-panel select:focus { border-color: rgba(52, 211, 153, 0.45); }
  #lt-yt-panel option { background: #141414; color: #fff; }
`;

function ensureStyles() {
  if (document.getElementById("lt-yt-style")) return;
  const s = document.createElement("style");
  s.id = "lt-yt-style";
  s.textContent = YT_STYLES;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// DOM creation
// ---------------------------------------------------------------------------

function createFloatingButton() {
  if (floatingButton) return;
  ensureStyles();

  floatingButton = document.createElement("div");
  floatingButton.id = "lectranscribe-yt-float";
  floatingButton.innerHTML = `
    <div id="lt-yt-float" style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
    ">
      <div id="lt-yt-status-card" aria-hidden="true"></div>

      <div id="lt-yt-pill" role="group" aria-label="LecTranscribe">
        <span id="lt-yt-dot" aria-hidden="true"></span>
        <span id="lt-yt-label">${LT_I18N.t("ytBrand")}</span>

        <button id="lt-yt-settings-btn" class="lt-yt-icon-btn" title="${LT_I18N.t("ytTitleSettings")}" aria-label="${LT_I18N.t("ytTitleSettings")}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button id="lt-yt-main-btn" class="lt-yt-icon-btn" title="${LT_I18N.t("ytTitleRecord")}" aria-label="${LT_I18N.t("ytTitleRecord")}">
          <svg id="lt-yt-main-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14"/>
            <path d="M13 6l6 6-6 6"/>
          </svg>
        </button>

      </div>

      <div id="lt-yt-panel" role="dialog" aria-label="${LT_I18N.t("ytTitleSettings")}">
        <div class="row">
          <label>${LT_I18N.t("popupRate")}</label>
          <select id="lt-yt-speed">
            <option value="1">${LT_I18N.t("popupRate1")}</option>
            <option value="2">${LT_I18N.t("popupRate2")}</option>
            <option value="4">${LT_I18N.t("popupRate4")}</option>
          </select>
        </div>
        <div class="row" id="lt-yt-project-row" style="display:none;">
          <label>${LT_I18N.t("popupProject")}</label>
          <select id="lt-yt-project">
            <option value="">${LT_I18N.t("popupProjectNone")}</option>
          </select>
        </div>
        <div class="row">
          <label>${LT_I18N.t("popupLanguage")}</label>
          <select id="lt-yt-lang">
            <option value="auto">${LT_I18N.t("popupLangAuto")}</option>
            <option value="ko">${LT_I18N.t("popupLangKo")}</option>
            <option value="en">${LT_I18N.t("popupLangEn")}</option>
          </select>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(floatingButton);

  // Saved playback rate into speed selector
  const speedSelect = document.getElementById("lt-yt-speed");
  chrome.storage.local.get(["playbackRate"], (result) => {
    speedSelect.value = result.playbackRate || "2";
  });
  speedSelect.addEventListener("change", () => {
    chrome.storage.local.set({ playbackRate: speedSelect.value });
  });

  // Projects from the app — go through the background service worker so the
  // request carries cookies without CORS friction (content scripts run in
  // the YouTube origin and can't send credentialed requests to our backend).
  const projectSelect = document.getElementById("lt-yt-project");
  const projectRow = document.getElementById("lt-yt-project-row");
  chrome.storage.local.get(["selectedProjectId"], (result) => {
    chrome.runtime.sendMessage({ type: "GET_PROJECTS" }, (res) => {
      const projects = res?.projects || [];
      if (projects.length > 0) {
        projectRow.style.display = "flex";
        projects.forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.name;
          projectSelect.appendChild(opt);
        });
        // If the stored selectedProjectId still matches a current project, keep
        // it. Otherwise (deleted / wrong account / orphaned) clear it so we
        // don't attach new transcripts to a non-existent project.
        if (result.selectedProjectId && projects.some((p) => p.id === result.selectedProjectId)) {
          projectSelect.value = result.selectedProjectId;
        } else if (result.selectedProjectId) {
          chrome.storage.local.remove(["selectedProjectId"]);
        }
      } else if (result.selectedProjectId) {
        // Account has no projects at all — drop the stale id.
        chrome.storage.local.remove(["selectedProjectId"]);
      }
    });
  });
  projectSelect.addEventListener("change", () => {
    chrome.storage.local.set({ selectedProjectId: projectSelect.value });
  });

  // Settings toggle
  const panel = document.getElementById("lt-yt-panel");
  const settingsBtn = document.getElementById("lt-yt-settings-btn");
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!floatingButton.contains(e.target)) panel.classList.remove("open");
  });

  // Language selector — reflect stored override + persist on change
  const langSelect = document.getElementById("lt-yt-lang");
  if (langSelect) {
    LT_I18N.getStoredOverride((stored) => { langSelect.value = stored; });
    langSelect.addEventListener("change", async () => {
      await LT_I18N.setLang(langSelect.value);
      // Rebuild UI with new translations
      recreateFloatingButton();
    });
  }

  const mainBtn = document.getElementById("lt-yt-main-btn");
  mainBtn.addEventListener("click", handleTranscribeClick);
}

// Destroy the current pill/panel and rebuild with current language
function recreateFloatingButton() {
  if (floatingButton) {
    floatingButton.remove();
    floatingButton = null;
  }
  const videoId = getVideoId();
  if (videoId) {
    createFloatingButton();
    setFloatVisible(true);
  }
}

function setRecordingUI(recording) {
  const pill = document.getElementById("lt-yt-pill");
  const mainIcon = document.getElementById("lt-yt-main-icon");
  const mainBtn = document.getElementById("lt-yt-main-btn");
  if (!pill || !mainIcon || !mainBtn) return;

  pill.classList.remove("error");
  if (recording) {
    pill.classList.add("recording");
    mainBtn.title = LT_I18N.t("ytTitleStop");
    mainBtn.setAttribute("aria-label", LT_I18N.t("ytTitleStop"));
    mainIcon.setAttribute("stroke-width", "2.4");
    mainIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2"/>';
  } else {
    pill.classList.remove("recording");
    mainBtn.title = LT_I18N.t("ytTitleRecord");
    mainBtn.setAttribute("aria-label", LT_I18N.t("ytTitleRecord"));
    mainIcon.setAttribute("stroke-width", "2.4");
    mainIcon.innerHTML = '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>';
    setLabel(LT_I18N.t("ytBrand"));
    hideStatusCard();
  }
}

function setLabel(text) {
  const el = document.getElementById("lt-yt-label");
  if (el) el.textContent = text;
}

// Status card above the pill — used for recording progress and toast messages
function showStatusCard(html) {
  const el = document.getElementById("lt-yt-status-card");
  if (!el) return;
  el.innerHTML = html;
  requestAnimationFrame(() => el.classList.add("visible"));
}

function hideStatusCard() {
  const el = document.getElementById("lt-yt-status-card");
  if (!el) return;
  el.classList.remove("visible");
  setTimeout(() => {
    if (!el.classList.contains("visible")) el.innerHTML = "";
  }, 220);
}

function renderRecordingCard({ remaining, rate, pct }) {
  showStatusCard(`
    <div class="row">
      <span class="label">${LT_I18N.t("ytCardRemaining")}</span>
      <span class="value accent">${remaining}</span>
    </div>
    <div class="row">
      <span class="label">${LT_I18N.t("ytCardRate")}</span>
      <span class="value">${rate}×</span>
    </div>
    <div class="bar"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>
  `);
}

function setStatus(text, isError = false) {
  const pill = document.getElementById("lt-yt-pill");
  if (!pill) return;
  if (isError) pill.classList.add("error");
  else pill.classList.remove("error");
  setLabel(text);
}

function hideStatus(delay = 0) {
  setTimeout(() => {
    const pill = document.getElementById("lt-yt-pill");
    if (!pill) return;
    if (!pill.classList.contains("recording")) {
      pill.classList.remove("error");
      setLabel("LecTranscribe");
    }
  }, delay);
}

function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Mute gate — block recording start until the user unmutes in YouTube itself
// ---------------------------------------------------------------------------
// Returns "ok" when the video becomes unmuted, "cancel" when the user bails.
// We deliberately do NOT flip videoEl.muted — that would blast audio through
// the user's speakers without consent.
function waitForUnmute(videoEl) {
  return new Promise((resolve) => {
    showStatusCard(`
      <div class="row">
        <span class="label">${LT_I18N.t("ytMuteHeader")}</span>
        <span class="value" style="color: #fbbf24;">${LT_I18N.t("ytMuteTitle")}</span>
      </div>
      <div style="margin-top: 6px; font-size: 11.5px; line-height: 1.6; color: rgba(255,255,255,0.62); word-break: keep-all;">
        ${LT_I18N.t("ytMuteExplain")}
      </div>
      <div style="margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(251, 191, 36, 0.07); border: 1px solid rgba(251, 191, 36, 0.18); font-size: 11.5px; line-height: 1.5; color: rgba(255,255,255,0.78); word-break: keep-all;">
        ${LT_I18N.t("ytMuteAction")}
      </div>
      <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
        <button data-lt-action="cancel" style="
          font-family: inherit;
          font-size: 11.5px;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: rgba(255, 255, 255, 0.5);
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          padding: 5px 11px;
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s;
        " onmouseenter="this.style.color='rgba(255,255,255,0.85)';this.style.borderColor='rgba(255,255,255,0.25)'" onmouseleave="this.style.color='rgba(255,255,255,0.5)';this.style.borderColor='rgba(255,255,255,0.12)'">${LT_I18N.t("ytCancel")}</button>
      </div>
    `);

    const card = document.getElementById("lt-yt-status-card");
    const cancelBtn = card?.querySelector('[data-lt-action="cancel"]');

    const cleanup = () => {
      videoEl.removeEventListener("volumechange", onVolChange);
      cancelBtn?.removeEventListener("click", onCancel);
    };
    const onVolChange = () => {
      if (!videoEl.muted && videoEl.volume >= 0.05) {
        cleanup();
        resolve("ok");
      }
    };
    const onCancel = () => {
      cleanup();
      resolve("cancel");
    };

    videoEl.addEventListener("volumechange", onVolChange);
    cancelBtn?.addEventListener("click", onCancel);
  });
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
    setStatus(LT_I18N.t("ytPlayFirst"), true);
    hideStatus(5000);
    return;
  }

  // Show current settings info
  chrome.storage.local.get(["playbackRate", "selectedProjectId"], (result) => {
    const rate = result.playbackRate || "2";
    const hasProject = !!result.selectedProjectId;
    const lines = [LT_I18N.t("ytGuideIcon", { rate })];
    if (!hasProject) lines.push(LT_I18N.t("ytGuideProject"));
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
      // Detect YouTube-player-level mute / volume-0 which would cause
      // tabCapture to record silence. We do NOT auto-unmute — just warn
      // the user and wait for them to unmute in YouTube, then proceed.
      if (videoEl.muted || videoEl.volume < 0.05) {
        const action = await waitForUnmute(videoEl);
        if (action === "cancel") {
          hideStatusCard();
          try { await bgSend({ type: "LT_STOP_RECORDING" }); } catch {}
          setLabel(LT_I18N.t("ytCancelled"));
          hideStatus(2500);
          return;
        }
      }

      videoEl.currentTime = 0;
      videoEl.playbackRate = playbackRate;
      try { await videoEl.play(); } catch {}
    }

    setRecordingUI(true);
    setLabel(LT_I18N.t("ytRecording"));

    // Initial card with placeholder numbers so it animates in immediately
    renderRecordingCard({
      remaining: LT_I18N.t("ytCardClockPlaceholder"),
      rate: playbackRate,
      pct: 0,
    });

    // Wait for video to finish (with abort support)
    let aborted = false;
    await new Promise((resolve) => {
      const checkEnd = setInterval(() => {
        const v = document.querySelector("video");
        if (!v || v.ended || v.currentTime >= v.duration - 0.5) {
          clearInterval(checkEnd);
          resolve();
          return;
        }
        const remainingReal = Math.max(0, v.duration - v.currentTime);
        const remainingWall = remainingReal / playbackRate;
        renderRecordingCard({
          remaining: formatClock(remainingWall),
          rate: playbackRate,
          pct: (v.currentTime / v.duration) * 100,
        });
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
      setStatus(LT_I18N.t("ytStatusStopped"), true);
      try { await bgSend({ type: "LT_STOP_RECORDING" }); } catch {}
      hideStatus(3000);
      return;
    }

    // Stop recording + upload in background (avoids ArrayBuffer message transfer)
    setStatus(LT_I18N.t("ytStatusUploading"));
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
    setStatus(LT_I18N.t("ytStatusStarted"));
    setTimeout(async () => {
      const { selectedProjectId: pid } = await chrome.storage.local.get(["selectedProjectId"]);
      window.open(`${appUrl}/dashboard${pid ? `?project=${pid}` : ""}`, "_blank");
    }, 800);
    hideStatus(5000);
  } catch (e) {
    console.error("[LecTranscribe]", e);
    setStatus(e.message || LT_I18N.t("ytStatusError"), true);
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

function setFloatVisible(visible) {
  const el = document.getElementById("lt-yt-float");
  if (!el) return;
  el.style.display = visible ? "flex" : "none";
}

function init() {
  const videoId = getVideoId();
  if (videoId) {
    createFloatingButton();
    setFloatVisible(true);
  } else {
    // Non-watch YouTube page (home, subscriptions, search, etc.): hide the
    // pill so it doesn't linger after SPA navigation.
    setFloatVisible(false);
  }
}

// Belt-and-suspenders: if the page unloads mid-recording (user refreshes or
// closes), proactively tell the background to stop. The onUpdated listener in
// background.js also catches this, but sending here reduces the window where
// Chrome's tabCapture indicator would linger.
window.addEventListener("beforeunload", () => {
  if (isProcessing) {
    try { chrome.runtime.sendMessage({ type: "LT_STOP_RECORDING" }); } catch {}
  }
});

// Initialize i18n first, then set up everything else
(async () => {
  await LT_I18N.init();
  init();

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      init();
    }
  }).observe(document, { subtree: true, childList: true });

  // Language flip from another context (popup) — rebuild the pill so all
  // static strings re-render in the new language.
  document.addEventListener("lt-lang-changed", () => {
    recreateFloatingButton();
  });
})();
