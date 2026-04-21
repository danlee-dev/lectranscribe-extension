// LecTranscribe i18n — shared across popup, content scripts, service worker.
//
// Language resolution order:
//   1. User-set override in chrome.storage.local (langOverride)
//   2. Browser UI language (chrome.i18n.getUILanguage / navigator.language)
//   3. Fallback "ko"
//
// Usage:
//   await LT_I18N.init();              // call once before first t()
//   LT_I18N.t('key', { n: 3 });        // interpolated
//   LT_I18N.setLang('en');             // persist + broadcast to other contexts
//   document.addEventListener('lt-lang-changed', rerender);

(function () {
  const DEFAULT_LANG = "ko";

  const MESSAGES = {
    ko: {
      // Popup — static chrome
      popupStandby: "대기중",
      popupDetectedCount: "{n}개 감지",
      popupEmptyTitle: "감지된 영상이<br>없어요",
      popupEmptyBody: "YouTube나 학교 LMS 영상을 재생하면<br>여기서 바로 전사 시작할 수 있어요.",
      popupSettings: "Settings",
      popupAppUrl: "App URL",
      popupRate: "배속",
      popupRate1: "1× · 원본 품질",
      popupRate2: "2× · 추천",
      popupRate4: "4× · 빠름",
      popupProject: "프로젝트",
      popupProjectNone: "분류 안 함",
      popupProjectManage: "프로젝트 관리하기",
      popupLanguage: "언어",
      popupLangAuto: "자동 감지",
      popupLangKo: "한국어",
      popupLangEn: "English",

      // Popup — video items
      popupActionStart: "전사 시작",
      popupActionNext: "전사",
      popupActionProcessing: "처리중...",
      popupErrorGeneric: "오류 발생",
      popupYtUnavailable: "영상 정보를 가져올 수 없어요. 영상을 재생한 후 다시 시도해주세요.",

      // LMS content script (content.js)
      lmsLabel: "강의 감지됨",
      lmsLabelMany: "{n}개 감지됨",

      // YouTube content script (youtube-content.js)
      ytBrand: "LecTranscribe",
      ytRecording: "녹음 중",
      ytCancelled: "녹음 취소됨",
      ytPlayFirst: "영상을 먼저 재생해주세요.",
      ytTitleRecord: "전사 시작",
      ytTitleStop: "녹음 중단",
      ytTitleSettings: "설정",

      // YouTube recording card
      ytCardRemaining: "남은 시간",
      ytCardRate: "배속",
      ytCardClockPlaceholder: "—:—",
      ytAdPaused: "광고 구간 — 일시정지",

      // Mute gate
      ytMuteHeader: "주의",
      ytMuteTitle: "YouTube 플레이어 음소거",
      ytMuteExplain: "<strong style=\"color: rgba(255,255,255,0.92); font-weight: 600;\">YouTube 플레이어 자체</strong>가 음소거 상태예요. 이대로 녹음하면 소리가 안 담겨요.<br><span style=\"color: rgba(255,255,255,0.4);\">(컴퓨터 시스템 볼륨이 아니에요 — 이건 그대로 둬도 돼요.)</span>",
      ytMuteAction: "영상 아래쪽 <strong style=\"color: #fbbf24;\">스피커 아이콘</strong>을 누르거나 <strong style=\"color: #fbbf24;\">M 키</strong>로 해제해주세요. 해제하면 녹음이 자동으로 시작돼요.",
      ytCancel: "취소",

      // YouTube pre-flight status messages (used by handleTranscribeClick path)
      ytGuideIcon: "우측 상단의 LecTranscribe 아이콘을 클릭하면 {rate}배속으로 녹음이 시작돼요.",
      ytGuideProject: "프로젝트 설정은 아이콘 옆 설정 패널에서 할 수 있어요.",

      // YouTube recording flow status (background -> content messages)
      ytStatusChecking: "영상 정보 확인 중...",
      ytStatusPrivateAuth: "비공개 영상이에요. LecTranscribe 인증 확인 중...",
      ytStatusUploading: "녹음을 마무리하고 업로드하고 있어요...",
      ytStatusStarted: "전사가 시작됐어요. 대시보드에서 확인하세요.",
      ytStatusError: "문제가 발생했어요.",
      ytStatusStopped: "녹음이 중단됐어요.",
    },

    en: {
      popupStandby: "Standby",
      popupDetectedCount: "{n} detected",
      popupEmptyTitle: "No videos<br>detected",
      popupEmptyBody: "Play a YouTube or school LMS video<br>to start transcribing here.",
      popupSettings: "Settings",
      popupAppUrl: "App URL",
      popupRate: "Rate",
      popupRate1: "1× · Original quality",
      popupRate2: "2× · Recommended",
      popupRate4: "4× · Fast",
      popupProject: "Project",
      popupProjectNone: "Unfiled",
      popupProjectManage: "Manage projects",
      popupLanguage: "Language",
      popupLangAuto: "Auto",
      popupLangKo: "한국어",
      popupLangEn: "English",

      popupActionStart: "Start",
      popupActionNext: "Transcribe",
      popupActionProcessing: "Processing...",
      popupErrorGeneric: "Error",
      popupYtUnavailable: "Couldn't read the video. Play the video and try again.",

      lmsLabel: "Lecture detected",
      lmsLabelMany: "{n} detected",

      ytBrand: "LecTranscribe",
      ytRecording: "Recording",
      ytCancelled: "Recording cancelled",
      ytPlayFirst: "Play the video first.",
      ytTitleRecord: "Start recording",
      ytTitleStop: "Stop recording",
      ytTitleSettings: "Settings",

      ytCardRemaining: "Time left",
      ytCardRate: "Rate",
      ytCardClockPlaceholder: "—:—",
      ytAdPaused: "Ad break — paused",

      ytMuteHeader: "Warning",
      ytMuteTitle: "YouTube player muted",
      ytMuteExplain: "<strong style=\"color: rgba(255,255,255,0.92); font-weight: 600;\">The YouTube player itself</strong> is muted. Recording now would capture silence.<br><span style=\"color: rgba(255,255,255,0.4);\">(This isn't your system volume — that one is fine as-is.)</span>",
      ytMuteAction: "Click the <strong style=\"color: #fbbf24;\">speaker icon</strong> below the video or press the <strong style=\"color: #fbbf24;\">M key</strong> to unmute. Recording will start automatically once unmuted.",
      ytCancel: "Cancel",

      ytGuideIcon: "Click the LecTranscribe icon in the top right to start recording at {rate}×.",
      ytGuideProject: "You can pick a project in the settings panel next to the icon.",

      ytStatusChecking: "Checking video info...",
      ytStatusPrivateAuth: "Private video detected. Verifying LecTranscribe sign-in...",
      ytStatusUploading: "Finalizing and uploading the recording...",
      ytStatusStarted: "Transcription started. Check your dashboard.",
      ytStatusError: "Something went wrong.",
      ytStatusStopped: "Recording stopped.",
    },
  };

  let currentLang = DEFAULT_LANG;
  let initialized = false;

  function detectBrowserLang() {
    try {
      const ui = (chrome.i18n?.getUILanguage?.() || navigator.language || DEFAULT_LANG).toLowerCase();
      return ui.startsWith("ko") ? "ko" : "en";
    } catch {
      return DEFAULT_LANG;
    }
  }

  function resolveLang(override) {
    if (override === "ko" || override === "en") return override;
    // "auto" or unset → detect
    return detectBrowserLang();
  }

  async function init() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["langOverride"], (result) => {
        currentLang = resolveLang(result.langOverride);
        initialized = true;
        resolve(currentLang);
      });
    });
  }

  function t(key, vars) {
    const table = MESSAGES[currentLang] || MESSAGES[DEFAULT_LANG];
    let str = table[key] ?? MESSAGES[DEFAULT_LANG][key] ?? key;
    if (vars) {
      for (const k of Object.keys(vars)) {
        str = str.split(`{${k}}`).join(String(vars[k]));
      }
    }
    return str;
  }

  async function setLang(value) {
    // value: "ko" | "en" | "auto"
    const stored = value === "auto" ? null : value;
    currentLang = resolveLang(stored);
    await new Promise((resolve) => {
      if (stored === null) {
        chrome.storage.local.remove(["langOverride"], resolve);
      } else {
        chrome.storage.local.set({ langOverride: stored }, resolve);
      }
    });
    // Broadcast to other contexts (popup, other tabs' content scripts, service worker)
    try {
      chrome.runtime.sendMessage({ type: "LT_LANG_CHANGED", lang: currentLang });
    } catch {}
    if (typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent("lt-lang-changed", { detail: { lang: currentLang } }));
    }
  }

  function getLang() {
    return currentLang;
  }

  function getStoredOverride(cb) {
    chrome.storage.local.get(["langOverride"], (result) => {
      cb(result.langOverride || "auto");
    });
  }

  // Cross-context listener — if popup sets lang, content scripts update
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "LT_LANG_CHANGED" && (msg.lang === "ko" || msg.lang === "en")) {
        currentLang = msg.lang;
        if (typeof document !== "undefined") {
          document.dispatchEvent(new CustomEvent("lt-lang-changed", { detail: { lang: currentLang } }));
        }
      }
    });
  }

  // Expose on global for both service worker and page contexts
  const api = { init, t, setLang, getLang, getStoredOverride };
  if (typeof self !== "undefined") self.LT_I18N = api;
  if (typeof window !== "undefined") window.LT_I18N = api;
})();
