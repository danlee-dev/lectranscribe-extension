// LMS 페이지에 전사 버튼 오버레이 추가

let floatingButton = null;
let videoCount = 0;

function createFloatingButton() {
  if (floatingButton) return;

  floatingButton = document.createElement("div");
  floatingButton.id = "lectranscribe-float";
  floatingButton.innerHTML = `
    <div id="lt-fab" style="
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
      <div id="lt-tooltip" style="
        background: #0f0f17;
        border: 1px solid rgba(52, 211, 153, 0.15);
        border-radius: 12px;
        padding: 12px 16px;
        color: white;
        font-size: 13px;
        display: none;
        max-width: 260px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        backdrop-filter: blur(12px);
      ">
        <div id="lt-video-info" style="color: rgba(255,255,255,0.5); font-size: 12px; line-height: 1.5;"></div>
      </div>
      <button id="lt-main-btn" style="
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background: linear-gradient(135deg, #34d399, #2dd4bf);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 24px rgba(52, 211, 153, 0.3);
        transition: transform 0.15s, box-shadow 0.15s;
        position: relative;
      ">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        <span id="lt-badge" style="
          position: absolute;
          top: -3px;
          right: -3px;
          background: #ef4444;
          color: white;
          font-size: 10px;
          font-weight: 700;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          display: none;
          align-items: center;
          justify-content: center;
        ">0</span>
      </button>
    </div>
  `;

  document.body.appendChild(floatingButton);

  const mainBtn = document.getElementById("lt-main-btn");
  const tooltip = document.getElementById("lt-tooltip");

  mainBtn.addEventListener("mouseenter", () => {
    mainBtn.style.transform = "scale(1.08)";
    mainBtn.style.boxShadow = "0 6px 28px rgba(52, 211, 153, 0.4)";
    if (videoCount > 0) {
      tooltip.style.display = "block";
    }
  });

  mainBtn.addEventListener("mouseleave", () => {
    mainBtn.style.transform = "scale(1)";
    mainBtn.style.boxShadow = "0 4px 24px rgba(52, 211, 153, 0.3)";
    tooltip.style.display = "none";
  });

  mainBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_LATEST" });
  });
}

function updateBadge(count) {
  videoCount = count;
  const badge = document.getElementById("lt-badge");
  const videoInfo = document.getElementById("lt-video-info");

  if (badge) {
    badge.style.display = "flex";
    badge.textContent = String(count);
  }
  if (videoInfo) {
    videoInfo.textContent = `${count}개 영상 감지됨 — 클릭하여 전사`;
  }
}

// background에서 영상 감지 메시지 수신
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "VIDEO_DETECTED") {
    createFloatingButton();
    updateBadge(message.count);

    const tooltip = document.getElementById("lt-tooltip");
    if (tooltip) {
      tooltip.style.display = "block";
      setTimeout(() => { tooltip.style.display = "none"; }, 3000);
    }
  }
});

// 페이지 로드 시: 버튼 생성 + 이미 감지된 영상 있는지 background에 확인
createFloatingButton();

chrome.runtime.sendMessage({ type: "GET_CURRENT_TAB_VIDEOS" }, (res) => {
  if (res?.videos?.length > 0) {
    updateBadge(res.videos.length);
  }
});
