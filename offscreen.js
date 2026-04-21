// LecTranscribe — Offscreen document for tab audio recording.
// Receives a streamId from background, captures audio with getUserMedia,
// records with MediaRecorder, and returns the blob to background when done.

let mediaRecorder = null;
let chunks = [];
let stream = null;
let resolveDone = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  if (message.type === "start-recording") {
    startRecording(message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }

  if (message.type === "stop-recording") {
    stopRecording()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // Ad-aware pause/resume so non-Premium users don't get ad audio mixed
  // into their lecture recording. youtube-content.js detects
  // `.html5-video-player.ad-showing` and sends these messages. When
  // paused, MediaRecorder stops emitting chunks but the captured tab
  // stream stays open — resume() picks right back up without a gap.
  if (message.type === "pause-recording") {
    try {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.pause();
        console.log("[LecTranscribe offscreen] recording paused (ad)");
      }
      sendResponse({ ok: true, state: mediaRecorder?.state || "none" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return false;
  }

  if (message.type === "resume-recording") {
    try {
      if (mediaRecorder && mediaRecorder.state === "paused") {
        mediaRecorder.resume();
        console.log("[LecTranscribe offscreen] recording resumed");
      }
      sendResponse({ ok: true, state: mediaRecorder?.state || "none" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return false;
  }
});

async function startRecording(streamId) {
  if (mediaRecorder) {
    throw new Error("Already recording");
  }

  // Get the audio stream from the captured tab
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    // We must also request video to satisfy the API even though we don't use it
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });

  // Continue playing the audio in the offscreen document so the user still
  // hears it (otherwise tabCapture mutes the original tab).
  const audio = new Audio();
  audio.srcObject = new MediaStream(stream.getAudioTracks());
  audio.play().catch(() => {});

  // MediaRecorder with audio-only track for smaller file
  const audioOnlyStream = new MediaStream(stream.getAudioTracks());
  mediaRecorder = new MediaRecorder(audioOnlyStream, {
    mimeType: "audio/webm;codecs=opus",
    audioBitsPerSecond: 64000, // 64kbps - whisper-friendly
  });

  chunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.start(1000); // collect chunks every second
  console.log("[LecTranscribe offscreen] recording started");
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error("Not recording"));
      return;
    }

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      console.log("[LecTranscribe offscreen] recording stopped, size:", arrayBuffer.byteLength);

      // Convert to base64 for reliable message transfer
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      // Stop all tracks
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      mediaRecorder = null;
      chunks = [];

      resolve({ base64, contentType: "audio/webm", byteLength: arrayBuffer.byteLength });
    };

    mediaRecorder.stop();
  });
}
