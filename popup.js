const videoList = document.getElementById("video-list");
const empty = document.getElementById("empty");
const status = document.getElementById("status");
const appUrlInput = document.getElementById("app-url");
const urlToggle = document.getElementById("url-toggle");
const urlRow = document.getElementById("url-row");
const speedRow = document.getElementById("speed-row");
const projectRow = document.getElementById("project-row");
const langRow = document.getElementById("lang-row");
const playbackRateSelect = document.getElementById("playback-rate");
const projectSelect = document.getElementById("project-select");
const langSelect = document.getElementById("lang-select");

// Apply translations to any element with [data-i18n] or [data-i18n-html]
function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = LT_I18N.t(key);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    el.innerHTML = LT_I18N.t(key);
  });
}

// 설정 토글 — 언어 행도 함께
urlToggle.addEventListener("click", () => {
  urlToggle.classList.toggle("open");
  urlRow.classList.toggle("visible");
  speedRow.classList.toggle("visible");
  projectRow.classList.toggle("visible");
  langRow.classList.toggle("visible");
});

// 언어 선택 변경
langSelect.addEventListener("change", async () => {
  await LT_I18N.setLang(langSelect.value);
  applyTranslations();
  // Re-render video list so dynamic strings like "전사 시작" flip too
  rerenderVideos();
});

function formatTime(ts) {
  const d = new Date(ts);
  const lang = LT_I18N.getLang() === "en" ? "en-US" : "ko-KR";
  return d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

let lastVideos = [];

function rerenderVideos() {
  if (lastVideos.length > 0) renderVideos(lastVideos);
}

function renderVideos(videos) {
  lastVideos = videos || [];
  if (!videos || videos.length === 0) {
    empty.style.display = "block";
    videoList.style.display = "none";
    status.textContent = LT_I18N.t("popupStandby");
    status.className = "status-badge inactive";
    return;
  }

  empty.style.display = "none";
  videoList.style.display = "block";
  status.textContent = LT_I18N.t("popupDetectedCount", { n: videos.length });
  status.className = "status-badge active";

  videoList.innerHTML = videos
    .map(
      (v, idx) => `
    <div class="video-item${idx === 0 ? " primary" : ""}" data-url="${v.url}">
      <div class="video-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
      <div class="video-info">
        <div class="id">${v.contentId || v.title}</div>
        <div class="time">${v.duration ? formatDuration(v.duration) : formatTime(v.timestamp)}</div>
      </div>
      <div class="video-action">
        <span>${idx === 0 ? LT_I18N.t("popupActionStart") : LT_I18N.t("popupActionNext")}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6"/>
        </svg>
      </div>
    </div>
  `
    )
    .join("");

  // 클릭 이벤트
  document.querySelectorAll(".video-item").forEach((el) => {
    el.addEventListener("click", () => {
      const videoUrl = el.dataset.url;
      if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
        const labelSpan = el.querySelector(".video-action span");
        if (labelSpan) labelSpan.textContent = LT_I18N.t("popupActionProcessing");
        chrome.runtime.sendMessage({ type: "TRANSCRIBE_YOUTUBE" }, (res) => {
          if (res?.ok) {
            window.close();
          } else {
            if (labelSpan) labelSpan.textContent = res?.error || LT_I18N.t("popupErrorGeneric");
            setTimeout(() => {
              if (labelSpan) labelSpan.textContent = LT_I18N.t("popupActionNext");
            }, 3000);
          }
        });
      } else {
        chrome.runtime.sendMessage({
          type: "OPEN_TRANSCRIBE",
          videoUrl,
          appUrl: appUrlInput.value,
        });
        window.close();
      }
    });
  });
}

// Bootstrap — init i18n first, then load settings + videos
(async () => {
  await LT_I18N.init();
  applyTranslations();

  // Reflect stored lang override in the selector
  LT_I18N.getStoredOverride((stored) => {
    langSelect.value = stored; // "auto" | "ko" | "en"
  });

  // 저장된 설정 불러오기
  chrome.storage.local.get(["appUrl", "playbackRate", "selectedProjectId"], (result) => {
    if (result.appUrl) appUrlInput.value = result.appUrl;
    if (result.playbackRate) playbackRateSelect.value = result.playbackRate;

    chrome.runtime.sendMessage({ type: "GET_PROJECTS" }, (res) => {
      const projects = res?.projects || [];
      const error = res?.error;
      if (projects.length > 0) {
        projects.forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.name;
          projectSelect.appendChild(opt);
        });
        if (result.selectedProjectId && projects.some((p) => p.id === result.selectedProjectId)) {
          projectSelect.value = result.selectedProjectId;
        } else if (result.selectedProjectId) {
          chrome.storage.local.remove(["selectedProjectId"]);
        }
      } else {
        if (result.selectedProjectId) {
          chrome.storage.local.remove(["selectedProjectId"]);
        }
        // Empty + error → replace the default "분류 안 함" option with
        // a hint so the user knows whether it's a login issue vs a
        // "genuinely no projects" state. Keeps the original empty
        // option as a fallback for the "truly empty" case.
        if (error === "unauthorized") {
          const hint = projectSelect.querySelector("option[value='']");
          if (hint) hint.textContent = "사이트 로그인 필요";
        } else if (error === "network" || (error && error.startsWith("http_"))) {
          const hint = projectSelect.querySelector("option[value='']");
          if (hint) hint.textContent = "연결 실패 · 앱 URL 확인";
        }
      }
    });
  });

  // 앱 URL 변경 시 저장
  appUrlInput.addEventListener("change", () => {
    chrome.storage.local.set({ appUrl: appUrlInput.value });
  });
  playbackRateSelect.addEventListener("change", () => {
    chrome.storage.local.set({ playbackRate: playbackRateSelect.value });
  });
  projectSelect.addEventListener("change", () => {
    chrome.storage.local.set({ selectedProjectId: projectSelect.value });
  });

  // 현재 탭 확인: YouTube인지 LMS인지
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.url) return;

    const isYouTube =
      tab.url.includes("youtube.com/watch") ||
      tab.url.includes("youtube.com/shorts/");

    if (isYouTube) {
      chrome.runtime.sendMessage({ type: "GET_YOUTUBE_VIDEO" }, (response) => {
        if (response?.video) {
          const v = response.video;
          renderVideos([
            {
              url: v.url,
              title: v.title,
              duration: v.duration,
              contentId: v.title,
              timestamp: Date.now(),
            },
          ]);
        } else {
          empty.style.display = "block";
          const p = empty.querySelector("p");
          if (p) p.textContent = LT_I18N.t("popupYtUnavailable");
        }
      });
    } else {
      chrome.runtime.sendMessage(
        { type: "GET_CURRENT_TAB_VIDEOS" },
        (response) => {
          renderVideos(response?.videos || []);
        }
      );
    }
  });
})();
