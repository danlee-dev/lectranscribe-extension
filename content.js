// LMS 페이지용 전사 플로팅 버튼
//
// 디자인 방향:
// - 사각 원형 FAB 대신 바닥-우측에서 슬라이드 업 하는 가로 pill
// - 영상 감지 전엔 숨김 상태 — 페이지를 방해하지 않음
// - 영상 감지 시 등장, hover 하면 확장되며 CTA 문구 노출
// - 다크 네이비 없는 순수 neutral + emerald hairline

let floatingButton = null;
let videoCount = 0;

const STYLES = `
  @keyframes lt-enter { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  #lt-fab { animation: lt-enter 0.42s cubic-bezier(0.22, 1, 0.36, 1); }
`;

function ensureStyles() {
  if (document.getElementById("lt-style")) return;
  const s = document.createElement("style");
  s.id = "lt-style";
  s.textContent = STYLES;
  document.head.appendChild(s);
}

function createFloatingButton() {
  if (floatingButton) return;
  ensureStyles();

  floatingButton = document.createElement("div");
  floatingButton.id = "lectranscribe-float";
  floatingButton.innerHTML = `
    <div id="lt-fab" style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      display: none;
      font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <button id="lt-main-btn" style="
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 11px 16px 11px 14px;
        background: rgba(12, 12, 12, 0.86);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 999px;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.95);
        font-size: 13px;
        font-weight: 500;
        letter-spacing: -0.01em;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(18px) saturate(180%);
        -webkit-backdrop-filter: blur(18px) saturate(180%);
        transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
                    border-color 0.2s ease,
                    padding 0.2s ease,
                    background 0.2s ease;
        overflow: hidden;
      ">
        <!-- top hairline accent -->
        <span aria-hidden="true" style="
          position: absolute;
          top: 0; left: 16px; right: 16px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(52, 211, 153, 0.55), transparent);
        "></span>

        <!-- status indicator (emerald pulse) -->
        <span aria-hidden="true" style="
          position: relative;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 10px rgba(52, 211, 153, 0.75);
          flex-shrink: 0;
        ">
          <span style="
            position: absolute;
            inset: -3px;
            border-radius: 50%;
            border: 1px solid rgba(52, 211, 153, 0.45);
            animation: lt-pulse 1.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
          "></span>
        </span>

        <!-- label (count changes here) -->
        <span id="lt-label" style="
          font-feature-settings: 'tnum' 1;
          white-space: nowrap;
        ">${LT_I18N.t("lmsLabel")}</span>

        <!-- arrow hint -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(52, 211, 153, 0.9)" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; transition: transform 0.2s ease;">
          <path d="M5 12h14"/>
          <path d="M13 6l6 6-6 6"/>
        </svg>
      </button>
    </div>
    <style>
      @keyframes lt-pulse {
        0% { transform: scale(1); opacity: 0.9; }
        100% { transform: scale(2.4); opacity: 0; }
      }
      #lt-main-btn:hover {
        border-color: rgba(52, 211, 153, 0.4) !important;
        background: rgba(16, 16, 16, 0.9) !important;
        padding-right: 20px !important;
      }
      #lt-main-btn:hover svg { transform: translateX(3px); }
      #lt-main-btn:active { transform: scale(0.97); }
    </style>
  `;

  document.body.appendChild(floatingButton);

  const mainBtn = document.getElementById("lt-main-btn");
  mainBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_LATEST" });
  });
}

function updateBadge(count) {
  videoCount = count;
  const fab = document.getElementById("lt-fab");
  const label = document.getElementById("lt-label");

  if (fab) fab.style.display = count > 0 ? "block" : "none";
  if (label) {
    label.textContent = count === 1
      ? LT_I18N.t("lmsLabel")
      : LT_I18N.t("lmsLabelMany", { n: count });
  }
}

// background에서 영상 감지 메시지 수신
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "VIDEO_DETECTED") {
    createFloatingButton();
    updateBadge(message.count);
  }
});

// Re-render label when language changes from popup
document.addEventListener("lt-lang-changed", () => updateBadge(videoCount));

// 페이지 로드 시 — i18n 먼저 초기화, 그 다음 UI 생성
(async () => {
  await LT_I18N.init();
  createFloatingButton();
  chrome.runtime.sendMessage({ type: "GET_CURRENT_TAB_VIDEOS" }, (res) => {
    if (res?.videos?.length > 0) {
      updateBadge(res.videos.length);
    }
  });
})();
