const videoList = document.getElementById("video-list");
const empty = document.getElementById("empty");
const status = document.getElementById("status");
const appUrlInput = document.getElementById("app-url");
const urlToggle = document.getElementById("url-toggle");
const urlRow = document.getElementById("url-row");
const speedRow = document.getElementById("speed-row");
const projectRow = document.getElementById("project-row");
const playbackRateSelect = document.getElementById("playback-rate");
const projectSelect = document.getElementById("project-select");

// 설정 토글
urlToggle.addEventListener("click", () => {
  urlToggle.classList.toggle("open");
  urlRow.classList.toggle("visible");
  speedRow.classList.toggle("visible");
  projectRow.classList.toggle("visible");
});

// 저장된 설정 불러오기
chrome.storage.local.get(["appUrl", "playbackRate", "selectedProjectId"], (result) => {
  if (result.appUrl) appUrlInput.value = result.appUrl;
  if (result.playbackRate) playbackRateSelect.value = result.playbackRate;

  // 프로젝트 목록 로드 (background.js 경유)
  chrome.runtime.sendMessage({ type: "GET_PROJECTS" }, (res) => {
    if (res?.projects?.length > 0) {
      res.projects.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        projectSelect.appendChild(opt);
      });
      if (result.selectedProjectId) projectSelect.value = result.selectedProjectId;
    }
  });
});

// 앱 URL 변경 시 저장
appUrlInput.addEventListener("change", () => {
  chrome.storage.local.set({ appUrl: appUrlInput.value });
});

// 배속 변경 시 저장
playbackRateSelect.addEventListener("change", () => {
  chrome.storage.local.set({ playbackRate: playbackRateSelect.value });
});

// 프로젝트 변경 시 저장
projectSelect.addEventListener("change", () => {
  chrome.storage.local.set({ selectedProjectId: projectSelect.value });
});

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderVideos(videos) {
  if (!videos || videos.length === 0) {
    empty.style.display = "block";
    videoList.style.display = "none";
    status.textContent = "대기중";
    status.className = "status-badge inactive";
    return;
  }

  empty.style.display = "none";
  videoList.style.display = "block";
  status.textContent = `${videos.length}개 감지`;
  status.className = "status-badge active";

  videoList.innerHTML = videos
    .map(
      (v) => `
    <div class="video-item" data-url="${v.url}">
      <div class="video-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
      <div class="video-info">
        <div class="id">${v.contentId || v.title}</div>
        <div class="time">${v.duration ? formatDuration(v.duration) : formatTime(v.timestamp)}</div>
      </div>
      <div class="video-action">전사 &rarr;</div>
    </div>
  `
    )
    .join("");

  // 클릭 이벤트
  document.querySelectorAll(".video-item").forEach((el) => {
    el.addEventListener("click", () => {
      const videoUrl = el.dataset.url;
      // Check if this is a YouTube video
      if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
        el.querySelector(".video-action").textContent = "처리중...";
        chrome.runtime.sendMessage({ type: "TRANSCRIBE_YOUTUBE" }, (res) => {
          if (res?.ok) {
            window.close();
          } else {
            el.querySelector(".video-action").textContent = res?.error || "오류 발생";
            setTimeout(() => {
              el.querySelector(".video-action").textContent = "전사 →";
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

// 현재 탭 확인: YouTube인지 LMS인지
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.url) return;

  const isYouTube =
    tab.url.includes("youtube.com/watch") ||
    tab.url.includes("youtube.com/shorts/");

  if (isYouTube) {
    // YouTube: 영상 정보 가져오기
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
        empty.querySelector("p").textContent =
          "영상 정보를 가져올 수 없어요. 영상을 재생한 후 다시 시도해주세요.";
      }
    });
  } else {
    // LMS: 기존 동작
    chrome.runtime.sendMessage(
      { type: "GET_CURRENT_TAB_VIDEOS" },
      (response) => {
        renderVideos(response?.videos || []);
      }
    );
  }
});
