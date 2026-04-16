const videoList = document.getElementById("video-list");
const empty = document.getElementById("empty");
const status = document.getElementById("status");
const appUrlInput = document.getElementById("app-url");
const urlToggle = document.getElementById("url-toggle");
const urlRow = document.getElementById("url-row");
const speedRow = document.getElementById("speed-row");
const langRow = document.getElementById("lang-row");
const playbackRateSelect = document.getElementById("playback-rate");
const langSelect = document.getElementById("lang-select");

// Project chip + menu (replaces the old Settings-buried <select>).
const projectChip = document.getElementById("project-chip");
const projectChipName = document.getElementById("project-chip-name");
const projectMenu = document.getElementById("project-menu");
const projectMenuScroll = document.getElementById("project-menu-scroll");
const projectMenuNew = document.getElementById("project-menu-new");
let projectCache = [];
let currentProjectId = "";

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

// 설정 토글 — project row는 설정 밖으로 나왔으니 여기서 제외
urlToggle.addEventListener("click", () => {
  urlToggle.classList.toggle("open");
  urlRow.classList.toggle("visible");
  speedRow.classList.toggle("visible");
  langRow.classList.toggle("visible");
});

// --------------------------------------------------------------------
// Project chip + menu
// --------------------------------------------------------------------
// Frequent action (pick which project the next transcription lands in)
// lives at the top of the popup now, not buried in Settings. The chip
// shows the current project name; clicking opens a native-feeling menu
// with every project + "분류 안 함" + a footer link to the site's
// project management page.

function renderProjectChip() {
  const active = projectCache.find((p) => p.id === currentProjectId);
  if (active) {
    projectChipName.textContent = active.name;
    projectChipName.classList.remove("muted");
    projectChip.classList.add("active");
  } else {
    projectChipName.textContent = LT_I18N.t("popupProjectNone");
    projectChipName.classList.add("muted");
    projectChip.classList.remove("active");
  }
}

function renderProjectMenu(error) {
  projectMenuScroll.innerHTML = "";

  // "No project" option — always first.
  const noneOption = document.createElement("button");
  noneOption.type = "button";
  noneOption.className = "project-menu-option none" + (currentProjectId === "" ? " selected" : "");
  noneOption.innerHTML = `
    <span class="name">${LT_I18N.t("popupProjectNone")}</span>
    <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 13 9 17 19 7"/></svg>
  `;
  noneOption.addEventListener("click", () => selectProject(""));
  projectMenuScroll.appendChild(noneOption);

  if (projectCache.length > 0) {
    projectCache.forEach((p) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "project-menu-option" + (p.id === currentProjectId ? " selected" : "");
      const safeName = p.name
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      opt.innerHTML = `
        <span class="name">${safeName}</span>
        <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 13 9 17 19 7"/></svg>
      `;
      opt.addEventListener("click", () => selectProject(p.id));
      projectMenuScroll.appendChild(opt);
    });
  } else if (error === "unauthorized") {
    const empty = document.createElement("div");
    empty.className = "project-menu-empty";
    empty.innerHTML = "사이트 로그인이 필요해요<br>먼저 lectranscribe.com에 로그인하세요";
    projectMenuScroll.appendChild(empty);
  } else if (error === "network" || (typeof error === "string" && error.startsWith("http_"))) {
    const empty = document.createElement("div");
    empty.className = "project-menu-empty";
    empty.textContent = "연결 실패 · Settings에서 앱 URL 확인";
    projectMenuScroll.appendChild(empty);
  } else {
    const empty = document.createElement("div");
    empty.className = "project-menu-empty";
    empty.textContent = "아직 만든 프로젝트가 없어요";
    projectMenuScroll.appendChild(empty);
  }
}

function selectProject(id) {
  currentProjectId = id;
  if (id) chrome.storage.local.set({ selectedProjectId: id });
  else chrome.storage.local.remove(["selectedProjectId"]);
  renderProjectChip();
  renderProjectMenu();
  closeProjectMenu();
}

function openProjectMenu() {
  projectMenu.classList.add("open");
  projectChip.classList.add("open");
  projectChip.setAttribute("aria-expanded", "true");
}

function closeProjectMenu() {
  projectMenu.classList.remove("open");
  projectChip.classList.remove("open");
  projectChip.setAttribute("aria-expanded", "false");
}

projectChip.addEventListener("click", (e) => {
  e.stopPropagation();
  if (projectMenu.classList.contains("open")) closeProjectMenu();
  else openProjectMenu();
});

// Click-outside close
document.addEventListener("click", (e) => {
  if (!projectMenu.classList.contains("open")) return;
  if (projectChip.contains(e.target) || projectMenu.contains(e.target)) return;
  closeProjectMenu();
});

// Esc to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && projectMenu.classList.contains("open")) closeProjectMenu();
});

// "프로젝트 관리하기" — routes through the background so an already-open
// dashboard tab gets focused instead of spawning a new one every time.
projectMenuNew.addEventListener("click", async () => {
  const { appUrl: stored } = await chrome.storage.local.get(["appUrl"]);
  const appUrl = stored || "https://lectranscribe.com";
  chrome.runtime.sendMessage({
    type: "OPEN_URL",
    url: `${appUrl}/dashboard?view=projects`,
  });
  closeProjectMenu();
  window.close();
});

// 언어 선택 변경
langSelect.addEventListener("change", async () => {
  await LT_I18N.setLang(langSelect.value);
  applyTranslations();
  // Re-render video list so dynamic strings like "전사 시작" flip too
  rerenderVideos();
  // Project chip name is set imperatively (not via data-i18n) so it
  // needs a manual refresh to pick up the new locale.
  renderProjectChip();
  renderProjectMenu();
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
      projectCache = res?.projects || [];
      const error = res?.error;

      // Reconcile the stored selectedProjectId with the live project
      // list — if the stored id no longer exists (deleted on the site),
      // drop it so the chip doesn't show a ghost name.
      if (result.selectedProjectId && projectCache.some((p) => p.id === result.selectedProjectId)) {
        currentProjectId = result.selectedProjectId;
      } else {
        if (result.selectedProjectId) chrome.storage.local.remove(["selectedProjectId"]);
        currentProjectId = "";
      }

      renderProjectChip();
      renderProjectMenu(error);
    });
  });

  // 앱 URL 변경 시 저장
  appUrlInput.addEventListener("change", () => {
    chrome.storage.local.set({ appUrl: appUrlInput.value });
  });
  playbackRateSelect.addEventListener("change", () => {
    chrome.storage.local.set({ playbackRate: playbackRateSelect.value });
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
