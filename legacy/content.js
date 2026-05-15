// VibeX - Instagram Enhanced Controls (Powered by VibeDownloader)
let defaultVolume = 1.0;
let previousVolume = 1.0;
let playbackSpeed = 1.0;
let autoScroll = false;
let hideControls = false;
const processedVideos = new WeakSet();
const videoSettings = new WeakMap();
const autoScrollTimeouts = new WeakMap();
let isAutoScrolling = false;
let lastAutoScrollTime = 0;
let currentActiveVideo = null; // Track the currently active video
const AUTO_SCROLL_DEBOUNCE_MS = 2000; // Minimum 2 seconds between auto-scrolls
const PREVIEW_CONFIG = {
  width: 120,
  height: 214,  // 9:16 ratio for vertical videos (reels/stories)
  debounceMs: 50,  // Debounce for smooth performance
  seekThreshold: 0.3,  // Minimum position change to update preview (seconds)
  cacheFrames: 30  // Number of frames to cache for instant preview
};
// Store preview video elements per video
const videoPreviewElements = new WeakMap();
// Store cached frames per video
const videoFrameCache = new WeakMap();

// Song Recognition API Configuration
const SHAZAM_API_URL = 'https://shazam-vibex-api.onrender.com/api/recognize';
const recognizingVideos = new WeakSet(); // Track which videos are being recognized

// Song Recognition - Extract Audio and Identify
async function recognizeSong(video) {
  if (!video || recognizingVideos.has(video)) return;

  try {
    recognizingVideos.add(video);

    // Show loading modal
    showSongModal(null, 'loading');

    // Get audio from video
    const audioBlob = await extractAudioFromVideo(video);

    if (!audioBlob) {
      throw new Error('Failed to extract audio from video');
    }

    // Send to Shazam API
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.mp3');

    const response = await fetch(SHAZAM_API_URL, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      showSongModal(result, 'success');
    } else {
      throw new Error('Song not recognized');
    }

  } catch (error) {
    console.error('Song recognition error:', error);
    showSongModal(null, 'error', error.message);
  } finally {
    recognizingVideos.delete(video);
  }
}

// AudioWorklet processor code as a string
const RECORDER_WORKLET_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

// Extract audio from video element using AudioWorklet
async function extractAudioFromVideo(video) {
  return new Promise(async (resolve, reject) => {
    let audioContext = null;
    let stream = null;
    let source = null;
    let workletNode = null;

    try {
      // Make sure video is playing
      if (video.paused) {
        await video.play().catch(() => { });
      }

      // Create audio context
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 44100
      });

      // Load the AudioWorklet
      const blob = new Blob([RECORDER_WORKLET_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(workletUrl);

      // Create a media stream from the video element
      if (video.captureStream) {
        stream = video.captureStream();
      } else if (video.mozCaptureStream) {
        stream = video.mozCaptureStream();
      } else {
        throw new Error('Browser does not support audio capture');
      }

      // Get only audio tracks
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track found in video');
      }

      // Create new stream with only audio
      const audioStream = new MediaStream(audioTracks);

      // Create source from stream
      source = audioContext.createMediaStreamSource(audioStream);

      // Create AudioWorkletNode
      workletNode = new AudioWorkletNode(audioContext, 'recorder-processor');

      const audioBuffers = [];

      workletNode.port.onmessage = (event) => {
        audioBuffers.push(new Float32Array(event.data));
      };

      // Connect nodes
      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      // Stop recording after 6 seconds
      setTimeout(() => {
        try {
          // Cleanup
          workletNode.disconnect();
          source.disconnect();
          audioTracks.forEach(track => track.stop());
          audioContext.close();
          URL.revokeObjectURL(workletUrl);

          // Combine all buffers
          if (audioBuffers.length === 0) {
            reject(new Error('No audio data captured'));
            return;
          }

          const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.length, 0);
          const combined = new Float32Array(totalLength);
          let offset = 0;

          for (const buffer of audioBuffers) {
            combined.set(buffer, offset);
            offset += buffer.length;
          }

          // Convert to WAV format
          const wavBlob = encodeWAV(combined, 44100);

          if (wavBlob.size === 0) {
            reject(new Error('Empty audio file'));
            return;
          }

          resolve(wavBlob);
        } catch (error) {
          reject(error);
        }
      }, 6000);

    } catch (error) {
      console.error('Audio extraction error:', error);
      if (audioContext) audioContext.close();
      // Try fallback method
      fetchAndConvertVideo(video).then(resolve).catch(reject);
    }
  });
}

// Encode Float32Array to WAV format
function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

// Helper to write string to DataView
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Fallback: Download video and extract audio
async function fetchAndConvertVideo(video) {
  try {
    // Get the video source URL (not blob)
    const videoSrc = video.src || video.currentSrc;

    if (!videoSrc || videoSrc.startsWith('blob:')) {
      // Can't fetch blob URLs, need to find actual source
      const videoUrl = findActualVideoUrl(video);
      if (!videoUrl) {
        throw new Error('Could not find video source URL');
      }
      return await fetchVideoBlob(videoUrl);
    }

    return await fetchVideoBlob(videoSrc);
  } catch (error) {
    throw new Error('Failed to extract audio: ' + error.message);
  }
}

// Find the actual video URL from Instagram's DOM
function findActualVideoUrl(video) {
  try {
    // Look for source elements
    const sources = video.querySelectorAll('source');
    for (const source of sources) {
      if (source.src && !source.src.startsWith('blob:')) {
        return source.src;
      }
    }

    // Check parent elements for data attributes
    let parent = video.parentElement;
    while (parent && parent !== document.body) {
      const videoUrl = parent.getAttribute('data-video-url') ||
        parent.getAttribute('src') ||
        parent.getAttribute('data-src');
      if (videoUrl && !videoUrl.startsWith('blob:')) {
        return videoUrl;
      }
      parent = parent.parentElement;
    }

    return null;
  } catch (error) {
    return null;
  }
}

// Fetch video and return as blob
async function fetchVideoBlob(url) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.blob();
}

// Show song recognition modal
function showSongModal(data, state, errorMsg = '') {
  // Remove existing modal
  const existingModal = document.querySelector('.vibex-song-modal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'vibex-song-modal';

  if (state === 'loading') {
    modal.innerHTML = `
      <div class="vibex-song-modal-content loading">
        <div class="vibex-song-modal-header">
          <div class="vibex-radar-animation">
            <div class="radar-ripple"></div>
            <div class="radar-ripple delay-1"></div>
            <div class="radar-ripple delay-2"></div>
            <div class="radar-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </div>
          </div>
          <h3>Listening...</h3>
          <p>Identifying the song</p>
        </div>
      </div>
    `;
  } else if (state === 'success' && data) {
    // Use static HTML for structure
    modal.innerHTML = `
      <div class="vibex-song-modal-content success">
        <button id="vibex-close-btn" class="vibex-modal-close" type="button">×</button>
        <div class="vibex-song-result">
          <div class="vibex-song-cover">
            <img class="vibex-cover-img" alt="">
            <div class="vibex-song-badge">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor"/>
              </svg>
              Found!
            </div>
          </div>
          <div class="vibex-song-info">
            <h2 class="vibex-title"></h2>
            <p class="artist vibex-artist"></p>
            <p class="album vibex-album"></p>
            <div class="vibex-song-meta">
              <span class="genre vibex-genre"></span>
              <span class="year vibex-year"></span>
            </div>
          </div>
          <div class="vibex-song-links"></div>
        </div>
      </div>
    `;

    // Populate dynamic data using textContent and attributes for safety
    const img = modal.querySelector('.vibex-cover-img');
    img.src = data.cover_art;
    img.alt = data.title;

    modal.querySelector('.vibex-title').textContent = data.title;
    modal.querySelector('.vibex-artist').textContent = data.artist;
    modal.querySelector('.vibex-album').textContent = data.album || data.label || '';
    modal.querySelector('.vibex-genre').textContent = data.genres || 'Music';
    modal.querySelector('.vibex-year').textContent = data.release_date || '';

    const linksContainer = modal.querySelector('.vibex-song-links');

    // Helper to add links - SAFE VERSION
    const addLink = (url, className, name, svgHtml) => {
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.className = `vibex-song-link ${className}`;

      // Parse SVG safely using DOMParser
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgHtml, 'image/svg+xml');
      const svgElement = svgDoc.documentElement;

      // Append SVG and text safely
      a.appendChild(svgElement);
      a.appendChild(document.createTextNode('\n              '));
      a.appendChild(document.createTextNode(name));
      a.appendChild(document.createTextNode('\n            '));

      linksContainer.appendChild(a);
    };

    addLink(data.spotify_url, 'spotify', 'Spotify',
      '<svg viewBox="0 0 24 24"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" fill="currentColor"/></svg>');

    addLink(data.apple_music_url, 'apple', 'Apple Music',
      '<svg viewBox="0 0 24 24"><path d="M23.998 6.123c0-.848-.32-1.733-.934-2.413c-.51-.574-1.245-1.01-2.04-1.265c-.76-.24-1.58-.36-2.39-.39c-.75-.02-1.53.03-2.28.14c-1.32.18-2.61.47-3.85.83c-.85.25-1.66.53-2.45.85c-.77.31-1.53.64-2.28 1.01c-.79.38-1.57.78-2.35 1.21c-.74.4-1.48.82-2.21 1.26c-.66.39-1.32.79-1.97 1.21c-.43.28-.85.56-1.27.86c-.39.27-.77.54-1.15.83c-.36.27-.71.55-1.06.84c-.34.28-.68.56-1.01.85l-.95.85c-.31.28-.61.56-.91.85c-.28.27-.56.54-.83.81c-.26.26-.51.51-.76.77c-.24.24-.47.48-.7.72c-.22.23-.44.46-.65.69c-.21.23-.41.45-.62.68c-.19.22-.38.44-.57.67c-.18.22-.36.43-.53.65c-.17.21-.34.42-.5.63c-.16.21-.32.41-.47.62c-.15.2-.28.39-.41.59c-.13.19-.26.38-.38.57c-.12.19-.24.37-.35.56c-.11.18-.22.36-.32.54c-.1.18-.2.35-.29.53c-.09.17-.18.34-.26.51c-.08.17-.16.33-.23.5c-.07.16-.14.32-.2.48c-.06.16-.12.31-.17.47c-.05.15-.1.3-.14.45c-.04.15-.08.29-.11.44c-.03.14-.06.28-.08.42c-.02.14-.04.27-.05.41c-.01.13-.02.26-.02.39c0 .13 0 .25.01.38c.01.12.02.25.04.37c.02.12.04.25.07.37c.03.12.06.25.09.37c.04.12.08.24.12.36c.05.12.1.24.15.36c.06.12.12.23.18.35c.07.11.14.23.21.34c.08.11.16.22.25.33c.09.11.18.21.28.32c.1.1.2.2.31.3c.11.1.23.19.35.29c.12.09.25.18.38.27c.13.09.27.17.41.25c.14.08.29.15.44.22c.15.07.31.14.47.2c.16.06.33.12.5.17c.17.05.35.1.53.14c.18.04.37.08.55.11c.19.03.38.05.57.07c.19.02.38.03.58.03c.39 0 .78-.03 1.17-.08c.39-.05.77-.12 1.16-.2c.38-.08.76-.17 1.14-.27c.37-.1.75-.21 1.12-.32c.37-.12.73-.24 1.09-.37c.36-.13.72-.26 1.07-.4c.35-.14.7-.28 1.04-.43c.34-.15.68-.3 1.01-.46c.33-.16.66-.32.98-.49c.32-.17.64-.34.95-.52c.31-.18.61-.36.91-.55c.3-.19.59-.38.88-.58c.28-.2.56-.4.84-.61c.27-.21.54-.42.8-.64c.26-.22.52-.44.77-.67c.25-.23.49-.46.73-.7c.23-.24.46-.48.68-.73c.22-.25.43-.5.64-.76c.2-.26.4-.52.59-.79c.19-.27.37-.54.55-.82c.17-.28.34-.56.5-.85c.16-.29.31-.58.45-.88c.14-.3.27-.6.39-.91c.12-.31.23-.63.33-.95c.1-.32.18-.65.26-.98c.07-.33.13-.67.18-1.01c.05-.34.08-.68.11-1.03c.02-.35.03-.7.03-1.05c0-.35-.01-.7-.04-1.05c-.03-.35-.07-.7-.13-1.04c-.06-.35-.13-.69-.22-1.04c-.09-.34-.19-.69-.31-1.03c-.12-.34-.25-.68-.39-1.01c-.15-.33-.31-.66-.48-.99c-.17-.33-.36-.65-.55-.97c-.2-.32-.41-.63-.63-.94c-.23-.31-.47-.61-.72-.91c-.25-.3-.52-.59-.79-.88c-.28-.29-.57-.57-.87-.84c-.3-.27-.62-.54-.94-.79c-.33-.26-.67-.5-1.02-.74c-.35-.24-.71-.47-1.08-.69c-.37-.22-.75-.42-1.14-.62c-.39-.19-.79-.37-1.2-.54c-.41-.17-.82-.33-1.24-.47c-.42-.14-.85-.27-1.28-.38c-.43-.11-.87-.21-1.31-.29c-.44-.08-.89-.15-1.34-.2c-.45-.05-.9-.08-1.35-.1c-.45-.02-.91-.02-1.36 0c-.45.02-.9.05-1.35.1c-.45.05-.89.12-1.34.2c-.44.08-.88.18-1.32.29c-.43.11-.86.24-1.29.38c-.42.14-.84.3-1.25.47c-.41.17-.81.35-1.21.54c-.39.19-.77.39-1.15.61c-.37.22-.73.45-1.09.69c-.35.24-.69.49-1.03.75c-.33.26-.65.53-.96.81c-.31.28-.6.57-.89.87c-.28.3-.55.61-.81.92c-.26.32-.5.65-.74.98c-.23.34-.45.68-.66 1.03c-.21.35-.4.71-.58 1.07c-.18.37-.34.74-.49 1.12c-.15.38-.28.76-.4 1.15c-.12.39-.22.78-.31 1.18c-.09.4-.16.8-.21 1.2c-.05.41-.09.81-.11 1.22c-.02.41-.03.83-.01 1.24c.02.42.05.83.1 1.25c.05.41.12.83.2 1.24c.08.42.18.83.29 1.25c.11.41.24.83.38 1.24c.15.41.31.82.49 1.23c.18.4.37.81.58 1.21c.21.4.44.79.68 1.18c.24.39.5.77.77 1.15c.27.38.56.75.86 1.12c.3.36.62.72.95 1.07c.33.35.68.69 1.04 1.02c.36.33.74.65 1.13.96c.39.31.79.61 1.21.9c.42.29.85.57 1.29.83c.44.27.9.52 1.36.76c.47.24.95.47 1.43.68c.49.21.99.41 1.49.59c.51.18 1.02.35 1.54.5c.52.15 1.05.28 1.58.4c.53.12 1.07.22 1.61.3c.55.08 1.09.14 1.64.19c.55.05 1.1.08 1.65.09c.55.01 1.1.01 1.65-.01c.55-.02 1.1-.06 1.64-.11c.55-.05 1.09-.12 1.64-.2c.54-.08 1.08-.18 1.62-.29c.53-.11 1.06-.24 1.59-.38c.52-.14 1.04-.3 1.55-.47c.51-.17 1.01-.36 1.51-.56c.49-.2.98-.42 1.46-.65c.48-.23.95-.48 1.42-.74c.46-.26.91-.54 1.36-.83c.44-.29.87-.6 1.3-.92c.42-.32.83-.66 1.23-1.01c.4-.35.78-.72 1.16-1.1c.37-.38.73-.78 1.07-1.19c.34-.41.67-.84 0.99-1.28c.31-.44.61-.89.89-1.36c.28-.47.54-.95.78-1.44c.24-.49.46-.99.67-1.5c.2-.51.39-1.03.55-1.56c.16-.53.3-1.07.42-1.61c.12-.54.21-1.09.29-1.64c.07-.55.12-1.11.15-1.67c.03-.56.04-1.12.03-1.68z" fill="currentColor"/></svg>');

    addLink(data.youtube_music_url, 'youtube-music', 'YouTube Music',
      '<svg viewBox="0 0 24 24"><path d="M12 24c6.627 0 12-5.373 12-12S18.627 0 12 0 0 5.373 0 12s5.373 12 12 12z" fill="#FF0000"/><path d="M9.818 15.568V8.432L15.818 12l-6 3.568z" fill="#fff"/></svg>');

    addLink(data.youtube_url, 'youtube', 'YouTube',
      '<svg viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="currentColor"/></svg>');

    addLink(data.shazam_url, 'shazam', 'Shazam',
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>');

  } else if (state === 'error') {
    modal.innerHTML = `
      <div class="vibex-song-modal-content error">
        <button id="vibex-error-close-btn" class="vibex-modal-close" type="button">×</button>
        <div class="vibex-song-error">
          <div class="error-icon">❌</div>
          <h3>Couldn't Identify Song</h3>
          <p class="vibex-error-msg"></p>
          <button id="vibex-retry-btn" class="vibex-retry-btn">Close</button>
        </div>
      </div>
    `;
    modal.querySelector('.vibex-error-msg').textContent = errorMsg || 'Please try again with a different part of the video';
  }

  document.body.appendChild(modal);

  // Robust event listeners for closing
  // 1. Close button click
  const closeBtn = document.getElementById('vibex-close-btn') || document.getElementById('vibex-error-close-btn');
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.remove();
    };
  }

  // 2. Retry/Close button click
  const retryBtn = document.getElementById('vibex-retry-btn');
  if (retryBtn) {
    retryBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.remove();
    };
  }

  // 3. Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
}

// Get or create settings for a specific video
function getVideoSettings(video) {
  if (!videoSettings.has(video)) {
    videoSettings.set(video, {
      volume: defaultVolume,
      speed: playbackSpeed
    });
  }
  return videoSettings.get(video);
}

// Force apply settings to video
function forceApplySettings(video) {
  if (!video) return;
  const settings = getVideoSettings(video);

  video.muted = false;
  video.volume = settings.volume;
  video.playbackRate = settings.speed;

  if (settings.volume === 0) {
    video.muted = true;
  }
}

// Apply settings with retry mechanism
function applyAllVideoSettings(video) {
  if (!video) return;

  forceApplySettings(video);

  setTimeout(() => forceApplySettings(video), 100);
  setTimeout(() => forceApplySettings(video), 300);
}

// Update UI for a specific video
function updateVolumeUI(video) {
  const container = video.closest('.ig-volume-control-container');
  if (!container) return;

  const settings = getVideoSettings(video);
  const volumeIcon = container.querySelector('.ig-volume-icon');
  const slider = container.querySelector('.ig-volume-slider');
  const volumePercent = container.querySelector('.ig-volume-percent');
  const speedButtons = container.querySelectorAll('.ig-speed-btn');
  const autoScrollToggle = container.querySelector('.ig-auto-scroll-toggle');

  if (volumeIcon) {
    // Clear and set icon safely
    volumeIcon.textContent = '';
    const iconSvg = getVolumeIconElement(settings.volume);
    volumeIcon.appendChild(iconSvg);
    volumeIcon.style.display = 'flex';
  }

  if (slider) {
    slider.value = settings.volume * 100;
    slider.style.display = 'block';

    // Update slider background for progress effect
    const percent = settings.volume * 100;
    slider.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${percent}%, rgba(255, 255, 255, 0.15) ${percent}%, rgba(255, 255, 255, 0.15) 100%)`;
  }

  if (volumePercent) {
    volumePercent.textContent = Math.round(settings.volume * 100) + '%';
    volumePercent.style.display = 'block';
  }

  if (autoScrollToggle) {
    autoScrollToggle.checked = autoScroll;
  }

  if (speedButtons) {
    speedButtons.forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.speed) === settings.speed);
    });
  }
}

// Update controls visibility based on settings
function updateControlsVisibility() {
  const volumeControls = document.querySelectorAll('.ig-volume-control');
  const advancedControls = document.querySelectorAll('.ig-advanced-controls');
  const seekBars = document.querySelectorAll('.ig-seekbar-container');

  volumeControls.forEach(control => {
    if (hideControls) {
      control.classList.add('controls-hidden');
    } else {
      control.classList.remove('controls-hidden');
    }
  });

  advancedControls.forEach(control => {
    if (hideControls) {
      control.style.display = 'none';
    } else {
      control.style.display = '';
    }
  });

  seekBars.forEach(bar => {
    if (hideControls) {
      bar.style.display = 'none';
    } else {
      bar.style.display = '';
    }
  });

  const downloadIcons = document.querySelectorAll('.ig-download-icon');
  downloadIcons.forEach(icon => {
    icon.style.display = 'flex';
  });
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.defaultVolume) {
    defaultVolume = changes.defaultVolume.newValue;
    previousVolume = defaultVolume > 0 ? defaultVolume : previousVolume;

    document.querySelectorAll('video').forEach(video => {
      if (processedVideos.has(video)) {
        const settings = getVideoSettings(video);
        settings.volume = defaultVolume;
        applyAllVideoSettings(video);
        updateVolumeUI(video);
      }
    });
  }
  if (changes.playbackSpeed) {
    playbackSpeed = changes.playbackSpeed.newValue;
    document.querySelectorAll('video').forEach(video => {
      if (processedVideos.has(video)) {
        const settings = getVideoSettings(video);
        settings.speed = playbackSpeed;
        video.playbackRate = playbackSpeed;
        updateVolumeUI(video);
      }
    });
  }
  if (changes.autoScroll) {
    autoScroll = changes.autoScroll.newValue;
    // Reset auto-scroll lock when disabled
    if (!autoScroll) {
      isAutoScrolling = false;
      lastAutoScrollTime = 0;
      currentActiveVideo = null;
      // Cleanup all video auto-scroll handlers
      document.querySelectorAll('video').forEach(video => {
        cleanupAutoScroll(video);
      });
    }
    document.querySelectorAll('video').forEach(video => {
      if (processedVideos.has(video)) {
        updateVolumeUI(video);
        setupAutoScroll(video);
      }
    });
  }
  if (changes.hideControls) {
    hideControls = changes.hideControls.newValue;
    updateControlsVisibility();
  }
});

function hideDefaultMuteButtons() {
  // Hide in containers with our controls - ONLY hide the button, NOT parent containers
  const containers = document.querySelectorAll('.ig-volume-control-container');
  containers.forEach(container => {
    const selectors = [
      'div[role="button"][aria-label*="mute" i]',
      'div[role="button"][aria-label*="unmute" i]',
      'div[role="button"][aria-label*="audio" i]',
      'button[aria-label*="mute" i]',
      'button[aria-label*="unmute" i]',
      'button[aria-label*="audio" i]'
    ];
    container.querySelectorAll(selectors.join(', ')).forEach(btn => {
      if (!btn.closest('.ig-volume-control')) {
        // ONLY hide the button itself - DO NOT hide parent containers (they may have captions)
        btn.style.setProperty('opacity', '0', 'important');
        btn.style.setProperty('pointer-events', 'none', 'important');
        btn.style.setProperty('cursor', 'default', 'important');
        btn.style.setProperty('display', 'none', 'important');
        btn.style.setProperty('visibility', 'hidden', 'important');
        btn.style.setProperty('width', '0', 'important');
        btn.style.setProperty('height', '0', 'important');
        btn.style.setProperty('background', 'transparent', 'important');
        btn.style.setProperty('border', 'none', 'important');
        btn.style.setProperty('padding', '0', 'important');
        btn.style.setProperty('margin', '0', 'important');
        btn.style.setProperty('position', 'absolute', 'important');
        btn.style.setProperty('clip', 'rect(0,0,0,0)', 'important');
      }
    });
  });

  // Also hide mute buttons near videos that have our controls - ONLY the button, NOT parents
  document.querySelectorAll('video').forEach(video => {
    if (processedVideos.has(video)) {
      const container = video.closest('.ig-volume-control-container');
      if (container) {
        // Find all mute buttons within the container
        const muteButtons = container.querySelectorAll('button, div[role="button"]');
        muteButtons.forEach(btn => {
          const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
          if ((ariaLabel.includes('mute') || ariaLabel.includes('unmute') || ariaLabel.includes('audio'))
            && !btn.closest('.ig-volume-control')) {
            // ONLY hide the button - DO NOT touch parent containers
            btn.style.setProperty('display', 'none', 'important');
            btn.style.setProperty('visibility', 'hidden', 'important');
            btn.style.setProperty('opacity', '0', 'important');
            btn.style.setProperty('background', 'transparent', 'important');
            btn.style.setProperty('width', '0', 'important');
            btn.style.setProperty('height', '0', 'important');
            btn.style.setProperty('position', 'absolute', 'important');
            btn.style.setProperty('clip', 'rect(0,0,0,0)', 'important');
          }
        });
      }
    }
  });

  // Also hide in dialogs and articles globally - ONLY the button, NOT parents
  const globalSelectors = [
    '[role="dialog"] button[aria-label*="mute" i]',
    '[role="dialog"] button[aria-label*="unmute" i]',
    '[role="dialog"] div[role="button"][aria-label*="mute" i]',
    '[role="dialog"] div[role="button"][aria-label*="unmute" i]',
    'article button[aria-label*="mute" i]',
    'article button[aria-label*="unmute" i]',
    'article div[role="button"][aria-label*="mute" i]',
    'article div[role="button"][aria-label*="unmute" i]'
  ];

  document.querySelectorAll(globalSelectors.join(', ')).forEach(btn => {
    if (!btn.closest('.ig-volume-control')) {
      // ONLY hide the button - DO NOT touch parent containers (captions are there!)
      btn.style.setProperty('display', 'none', 'important');
      btn.style.setProperty('visibility', 'hidden', 'important');
      btn.style.setProperty('opacity', '0', 'important');
      btn.style.setProperty('background', 'transparent', 'important');
      btn.style.setProperty('width', '0', 'important');
      btn.style.setProperty('height', '0', 'important');
      btn.style.setProperty('cursor', 'default', 'important');
      btn.style.setProperty('position', 'absolute', 'important');
      btn.style.setProperty('clip', 'rect(0,0,0,0)', 'important');
    }
  });

  // Remove pointer cursor from all videos with our controls
  document.querySelectorAll('.ig-volume-control-container video').forEach(video => {
    video.style.setProperty('cursor', 'default', 'important');
  });

  removeReelsAudioBadge();
  removeInstagramVolumeSlider();
}

// Track removed audio badges to avoid re-processing
const removedAudioBadges = new WeakSet();

function removeReelsAudioBadge() {
  // CRITICAL: Only run on Reels pages
  if (!isReelsPage()) return;

  // Find all SVG elements with audio-related aria-labels
  const audioSvgs = document.querySelectorAll('svg[aria-label*="audio" i]');

  audioSvgs.forEach(svg => {
    // Check if this SVG is specifically for mute/unmute (not other audio controls)
    const ariaLabel = (svg.getAttribute('aria-label') || '').toLowerCase();
    if (!ariaLabel.includes('audio is') && !ariaLabel.includes('audio')) {
      return; // Skip if not the mute/unmute badge
    }

    // Find the parent button div
    const button = svg.closest('div[role="button"][tabindex="0"]');
    if (!button || removedAudioBadges.has(button)) {
      return; // Already processed or not found
    }

    // CRITICAL: Verify this is the mute/unmute button by checking:
    // 1. It has the specific class structure
    // 2. It's NOT a chat/share/message button
    // 3. It's NOT part of our controls
    const buttonAriaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
    if (buttonAriaLabel.includes('send') ||
      buttonAriaLabel.includes('share') ||
      buttonAriaLabel.includes('message') ||
      buttonAriaLabel.includes('chat')) {
      return; // Don't remove chat/share buttons
    }

    // Check if it's part of our controls
    if (button.closest('.ig-volume-control') || button.closest('.ig-advanced-controls')) {
      return; // Don't remove our own controls
    }

    // Verify it has the expected class structure (the specific classes from the user's HTML)
    const classes = button.className || '';
    if (!classes.includes('x1i10hfl') || !classes.includes('xjqpnuy') || !classes.includes('xqeqjp1')) {
      return; // Not the right button
    }

    // Check size and position - should be small button in top area
    const rect = button.getBoundingClientRect();
    if (rect.width < 20 || rect.width > 50 || rect.height < 20 || rect.height > 50) {
      return; // Wrong size
    }

    // CRITICAL: Make sure it's not a story element
    const storyParent = button.closest('[aria-label*="story" i], [aria-label*="Stories" i]');
    if (storyParent) {
      return; // Skip story elements
    }

    // All checks passed - remove it
    button.remove();
    removedAudioBadges.add(button);
  });
}

// Remove Instagram's default volume slider
function removeInstagramVolumeSlider() {
  // Find and remove the Instagram default volume slider with class .x1fgtraw

  const volumeSliders = document.querySelectorAll('.x1fgtraw');

  volumeSliders.forEach(slider => {
    // Make sure it's not part of our controls
    if (slider.closest('.ig-volume-control') || slider.closest('.ig-advanced-controls')) {
      return; // Don't remove our own controls
    }

    // Remove the element completely
    slider.remove();
  });
}

// Remove the "Control" overlay that appears during upload/thumbnail selection
function removeUploadControls() {
  // Strategy 1: Find div elements with aria-label="Control"
  // Covers most "Crop" and general upload screens
  const controls = document.querySelectorAll('div[aria-label="Control"]');

  controls.forEach(control => {
    // Apply removal styles
    control.style.setProperty('display', 'none', 'important');
    control.style.setProperty('visibility', 'hidden', 'important');
    control.style.setProperty('opacity', '0', 'important');
    control.style.setProperty('pointer-events', 'none', 'important');
  });

  // Strategy 2: Targeted Cover Photo section cleanup
  // The "Cover photo" section often uses different structures or identifying classes
  const findCoverSection = () => {
    // Look for the header "Cover photo"
    const headings = document.querySelectorAll('h1, h2, h3, span');
    for (const h of headings) {
      if (h.textContent.trim() === 'Cover photo') {
        const dialog = h.closest('[role="dialog"]');
        if (dialog) return dialog;
      }
    }
    return null;
  };

  const coverDialog = findCoverSection();
  if (coverDialog) {
    // Inside the Cover Photo dialog, we need to be very aggressive
    // The control overlay specifically often has these characteristics:
    // 1. It's an overlay on the video thumbnail
    // 2. It clearly blocks view

    // Find all potential "Control" buttons/overlays inside the dialog
    const potentialOverlays = coverDialog.querySelectorAll('div[role="button"][tabindex="0"]');
    potentialOverlays.forEach(overlay => {
      // Check if it's likely a video control overlay
      // Usually minimal structure, or purely for interaction
      const ariaLabel = overlay.getAttribute('aria-label');

      // If it explicitly says "Control", hide it (caught by Strategy 1 usually)
      if (ariaLabel === 'Control') {
        overlay.style.setProperty('display', 'none', 'important');
        return;
      }

      // If it has NO aria-label but contains an SVG that looks like a play/speaker icon
      // This is risky so we verify context
      if (!ariaLabel && overlay.querySelector('svg')) {
        // Check if parent is a draggable item or thumbnail container
        if (overlay.parentElement.querySelector('video') || overlay.parentElement.querySelector('img')) {
          // Likely an overlay
          // Double check it's not the "Select from computer" button
          if (!overlay.textContent.includes('Select from computer')) {
            // Check if it's centered/overlaying
            const style = window.getComputedStyle(overlay);
            if (style.position === 'absolute' || style.position === 'fixed') {
              overlay.style.setProperty('display', 'none', 'important');
              overlay.style.setProperty('visibility', 'hidden', 'important');
              overlay.style.setProperty('pointer-events', 'none', 'important');
            }
          }
        }
      }
    });
  }
}

function hideNavigationButtons() {
  // Only hide navigation buttons that are NOT for image carousels
  // We need to be selective to keep Instagram's image carousel arrows

  // Hide only video-specific navigation if any exist from our extension
  document.querySelectorAll('.ig-nav-button').forEach(btn => {
    btn.style.setProperty('display', 'none', 'important');
    btn.style.setProperty('visibility', 'hidden', 'important');
    btn.style.setProperty('opacity', '0', 'important');
    btn.style.setProperty('pointer-events', 'none', 'important');
  });

  // Don't hide Instagram's native carousel buttons
  // We'll be very selective here - only target buttons in video containers
  const videoContainers = document.querySelectorAll('.ig-volume-control-container');
  videoContainers.forEach(container => {
    const navButtons = container.querySelectorAll('button[aria-label*="Next" i], button[aria-label*="Previous" i]');
    navButtons.forEach(btn => {
      // Only hide if it's actually in a video context, not image carousel
      const hasVideo = container.querySelector('video');
      if (hasVideo && !isGif(hasVideo)) {
        btn.style.setProperty('display', 'none', 'important');
        btn.style.setProperty('visibility', 'hidden', 'important');
        btn.style.setProperty('opacity', '0', 'important');
        btn.style.setProperty('pointer-events', 'none', 'important');
      }
    });
  });
}

// Load saved default settings
chrome.storage.sync.get(['defaultVolume', 'playbackSpeed', 'autoScroll', 'hideControls'], (result) => {
  defaultVolume = result.defaultVolume !== undefined ? result.defaultVolume : 1.0;
  previousVolume = defaultVolume > 0 ? defaultVolume : 1.0;
  playbackSpeed = result.playbackSpeed || 1.0;
  autoScroll = result.autoScroll || false;
  hideControls = result.hideControls || false;

  document.querySelectorAll('video').forEach(video => {
    if (processedVideos.has(video)) {
      applyAllVideoSettings(video);
      updateVolumeUI(video);
      updateControlsVisibility();
      if (isReelsPage()) {
        setupAutoScroll(video);
      }
    }
  });
});

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Frame caching system - captures frames during playback for instant preview
function initFrameCache(video) {
  if (videoFrameCache.has(video)) return videoFrameCache.get(video);

  const cache = {
    frames: [],
    duration: 0,
    isCapturing: false,
    captureInterval: null,
    canvas: document.createElement('canvas')
  };
  cache.canvas.width = PREVIEW_CONFIG.width;
  cache.canvas.height = PREVIEW_CONFIG.height;

  videoFrameCache.set(video, cache);
  return cache;
}

function captureFrameToCache(video, cache) {
  if (!video.videoWidth || !video.videoHeight || video.paused) return;

  try {
    const ctx = cache.canvas.getContext('2d', { willReadFrequently: true });
    const videoRatio = video.videoWidth / video.videoHeight;
    const canvasRatio = PREVIEW_CONFIG.width / PREVIEW_CONFIG.height;

    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (videoRatio > canvasRatio) {
      sw = video.videoHeight * canvasRatio;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sh = video.videoWidth / canvasRatio;
      sy = (video.videoHeight - sh) / 2;
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, PREVIEW_CONFIG.width, PREVIEW_CONFIG.height);

    // Store frame with timestamp
    const imageData = ctx.getImageData(0, 0, PREVIEW_CONFIG.width, PREVIEW_CONFIG.height);
    cache.frames.push({
      time: video.currentTime,
      data: imageData
    });
    cache.duration = video.duration;

    // Keep only last N frames evenly distributed
    if (cache.frames.length > PREVIEW_CONFIG.cacheFrames * 2) {
      // Sort by time and keep evenly distributed frames
      cache.frames.sort((a, b) => a.time - b.time);
      const step = Math.floor(cache.frames.length / PREVIEW_CONFIG.cacheFrames);
      const newFrames = [];
      for (let i = 0; i < cache.frames.length; i += step) {
        newFrames.push(cache.frames[i]);
        if (newFrames.length >= PREVIEW_CONFIG.cacheFrames) break;
      }
      cache.frames = newFrames;
    }
  } catch (e) { }
}

function startFrameCapture(video) {
  const cache = initFrameCache(video);
  if (cache.isCapturing) return;

  cache.isCapturing = true;

  // Lightweight: Only capture frames during normal playback (no seeking)
  cache.captureInterval = setInterval(() => {
    if (!video.paused && video.readyState >= 2 && video.videoWidth) {
      captureFrameToCache(video, cache);
    }
  }, 300);  // Capture every 300ms during playback

  // Capture on play event
  video.addEventListener('play', () => {
    if (video.readyState >= 2) captureFrameToCache(video, cache);
  });
}

// Force capture at specific time (used during initial capture)
function captureFrameToCacheForced(video, cache, time) {
  if (!video.videoWidth || !video.videoHeight) return;

  try {
    const ctx = cache.canvas.getContext('2d', { willReadFrequently: true });
    const videoRatio = video.videoWidth / video.videoHeight;
    const canvasRatio = PREVIEW_CONFIG.width / PREVIEW_CONFIG.height;

    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (videoRatio > canvasRatio) {
      sw = video.videoHeight * canvasRatio;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sh = video.videoWidth / canvasRatio;
      sy = (video.videoHeight - sh) / 2;
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, PREVIEW_CONFIG.width, PREVIEW_CONFIG.height);

    // Store frame with timestamp
    const imageData = ctx.getImageData(0, 0, PREVIEW_CONFIG.width, PREVIEW_CONFIG.height);
    cache.frames.push({
      time: time,
      data: imageData
    });
    cache.duration = video.duration;
  } catch (e) { }
}

function stopFrameCapture(video) {
  const cache = videoFrameCache.get(video);
  if (cache && cache.captureInterval) {
    clearInterval(cache.captureInterval);
    cache.isCapturing = false;
  }
}

function getClosestCachedFrame(video, targetTime) {
  const cache = videoFrameCache.get(video);
  if (!cache || cache.frames.length === 0) return null;

  let closest = cache.frames[0];
  let minDiff = Math.abs(closest.time - targetTime);

  for (const frame of cache.frames) {
    const diff = Math.abs(frame.time - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = frame;
    }
  }

  return closest;
}

// Create or get preview video element for real-time seeking
function getOrCreatePreviewVideo(video) {
  if (videoPreviewElements.has(video)) {
    return videoPreviewElements.get(video);
  }

  const videoSrc = video.src || video.currentSrc;
  if (!videoSrc) return null;

  // Store reference with fallback support
  const previewData = {
    video: null,
    canvas: document.createElement('canvas'),
    lastSeekTime: -1,
    isReady: false,
    isSeeking: false,
    useFallback: false,  // Will use main video if true
    mainVideo: video     // Reference to main video for fallback
  };

  previewData.canvas.width = PREVIEW_CONFIG.width;
  previewData.canvas.height = PREVIEW_CONFIG.height;

  // Try to create a clone video first (preferred for non-blocking seeks)
  const createCloneVideo = (withCrossOrigin = true) => {
    const previewVideo = document.createElement('video');
    previewVideo.src = videoSrc;
    previewVideo.muted = true;
    previewVideo.preload = 'auto';
    previewVideo.playsInline = true;
    if (withCrossOrigin) {
      previewVideo.crossOrigin = 'anonymous';
    }
    previewVideo.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999;';
    return previewVideo;
  };

  const previewVideo = createCloneVideo(true);
  previewData.video = previewVideo;

  // Append to body but keep it hidden
  document.body.appendChild(previewVideo);

  // Mark as ready when metadata loads
  previewVideo.addEventListener('loadedmetadata', () => {
    previewData.isReady = true;
    previewData.useFallback = false;
  });

  // Handle errors - try without crossOrigin, then fallback to main video
  previewVideo.addEventListener('error', () => {
    // If CORS fails, try without crossOrigin
    if (previewVideo.crossOrigin) {
      previewVideo.remove();
      const noCorsVideo = createCloneVideo(false);
      previewData.video = noCorsVideo;
      document.body.appendChild(noCorsVideo);

      noCorsVideo.addEventListener('loadedmetadata', () => {
        previewData.isReady = true;
        previewData.useFallback = false;
      });

      noCorsVideo.addEventListener('error', () => {
        // Fall back to using main video (less ideal but works)
        previewData.useFallback = true;
        previewData.isReady = true;
        noCorsVideo.remove();
      });
    } else {
      // Fall back to using main video
      previewData.useFallback = true;
      previewData.isReady = true;
      previewVideo.remove();
    }
  });

  videoPreviewElements.set(video, previewData);
  return previewData;
}

// Real-time frame capture from preview video or main video (fallback)
function capturePreviewFrame(previewData, targetCanvas) {
  if (!previewData || !previewData.isReady) return false;

  // Choose video source: clone video or main video (fallback)
  const video = previewData.useFallback ? previewData.mainVideo : previewData.video;
  if (!video || !video.videoWidth || !video.videoHeight) return false;

  const canvas = previewData.canvas;
  const ctx = canvas.getContext('2d');

  try {
    // Calculate aspect ratio for proper cropping
    const videoRatio = video.videoWidth / video.videoHeight;
    const canvasRatio = PREVIEW_CONFIG.width / PREVIEW_CONFIG.height;

    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;

    if (videoRatio > canvasRatio) {
      // Video is wider - crop sides
      sw = video.videoHeight * canvasRatio;
      sx = (video.videoWidth - sw) / 2;
    } else {
      // Video is taller - crop top/bottom
      sh = video.videoWidth / canvasRatio;
      sy = (video.videoHeight - sh) / 2;
    }

    // Draw to internal canvas
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, PREVIEW_CONFIG.width, PREVIEW_CONFIG.height);

    // Copy to target canvas
    const targetCtx = targetCanvas.getContext('2d');
    targetCtx.drawImage(canvas, 0, 0);

    return true;
  } catch (err) {
    return false;
  }
}

// Seek preview video to specific time
async function seekPreviewVideo(previewData, time) {
  if (!previewData || !previewData.isReady || previewData.isSeeking) return false;

  // Check if we're seeking to the same time (with threshold)
  if (Math.abs(previewData.lastSeekTime - time) < PREVIEW_CONFIG.seekThreshold) {
    return true;
  }

  previewData.isSeeking = true;
  previewData.lastSeekTime = time;

  // If using fallback (main video), we can't actually seek without affecting playback
  // So we just capture the current frame - user will see current position preview
  if (previewData.useFallback) {
    previewData.isSeeking = false;
    return true;
  }

  const video = previewData.video;
  if (!video || !video.duration) {
    previewData.isSeeking = false;
    return false;
  }

  return new Promise((resolve) => {
    const onSeeked = () => {
      previewData.isSeeking = false;
      resolve(true);
    };

    const onError = () => {
      previewData.isSeeking = false;
      resolve(false);
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });

    // Clamp time to valid range
    const clampedTime = Math.max(0, Math.min(time, video.duration - 0.1));
    video.currentTime = clampedTime;

    // Timeout fallback
    setTimeout(() => {
      previewData.isSeeking = false;
      resolve(false);
    }, 500);
  });
}

// Cleanup preview video when main video is removed
function cleanupPreviewVideo(video) {
  const previewData = videoPreviewElements.get(video);
  if (previewData) {
    if (previewData.video && !previewData.useFallback) {
      previewData.video.pause();
      previewData.video.src = '';
      previewData.video.remove();
    }
    videoPreviewElements.delete(video);
  }
}

function createSeekBar(video, container) {
  const seekBarContainer = document.createElement('div');
  seekBarContainer.className = 'ig-seekbar-container';
  const seekBarWrapper = document.createElement('div');
  seekBarWrapper.className = 'ig-seekbar-wrapper';

  // Preview Tooltip
  const previewTooltip = document.createElement('div');
  previewTooltip.className = 'ig-preview-tooltip';
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = PREVIEW_CONFIG.width;
  previewCanvas.height = PREVIEW_CONFIG.height;
  previewCanvas.className = 'ig-preview-canvas';

  // Time display
  const previewTime = document.createElement('div');
  previewTime.className = 'ig-preview-time';
  previewTime.textContent = '0:00';

  // Loading indicator
  const previewLoading = document.createElement('div');
  previewLoading.className = 'ig-preview-loading';
  previewLoading.innerHTML = '<div class="ig-preview-spinner"></div>';
  previewLoading.style.display = 'none';

  previewTooltip.appendChild(previewCanvas);
  previewTooltip.appendChild(previewTime);
  previewTooltip.appendChild(previewLoading);
  seekBarWrapper.appendChild(previewTooltip);

  const seekBarTrack = document.createElement('div');
  seekBarTrack.className = 'ig-seekbar-track';
  const seekBarBg = document.createElement('div');
  seekBarBg.className = 'ig-seekbar-background';
  const bufferedBar = document.createElement('div');
  bufferedBar.className = 'ig-seekbar-buffered';
  bufferedBar.style.width = '0%';
  const progressBar = document.createElement('div');
  progressBar.className = 'ig-seekbar-progress';
  progressBar.style.width = '0%';
  seekBarBg.appendChild(bufferedBar);
  seekBarBg.appendChild(progressBar);
  const seekBar = document.createElement('input');
  seekBar.type = 'range';
  seekBar.min = '0';
  seekBar.max = '1000';
  seekBar.value = '0';
  seekBar.className = 'ig-seekbar';
  seekBarTrack.appendChild(seekBarBg);
  seekBarTrack.appendChild(seekBar);
  seekBarWrapper.appendChild(seekBarTrack);
  seekBarContainer.appendChild(seekBarWrapper);

  // Real-time preview state
  let debounceTimeout = null;
  let isPreviewActive = false;
  let lastPreviewTime = -1;

  // Initialize frame capture when metadata is loaded
  const initPreview = () => {
    startFrameCapture(video);  // Start capturing frames during playback
  };

  // Start initialization as soon as we have metadata
  if (video.readyState >= 1) {
    initPreview();
  } else {
    video.addEventListener('loadedmetadata', initPreview, { once: true });
  }

  // Real-time preview function with debounce
  const updatePreview = async (time, x) => {
    if (!video.duration) return;

    // Update time display
    previewTime.textContent = formatTime(time);

    // Position tooltip - keep within bounds with padding
    const rect = seekBarTrack.getBoundingClientRect();
    const tooltipWidth = PREVIEW_CONFIG.width + 8; // Add padding for border
    const sideGap = 10; // Gap from edges
    let left = x - rect.left - (tooltipWidth / 2);
    // Clamp to stay within the track bounds with side gap
    left = Math.max(sideGap, Math.min(left, rect.width - tooltipWidth - sideGap));
    previewTooltip.style.left = `${left}px`;

    // Show tooltip
    previewTooltip.style.opacity = '1';
    previewTooltip.style.transform = 'translateY(0) scale(1)';

    // Skip if same time (within threshold)
    if (Math.abs(lastPreviewTime - time) < PREVIEW_CONFIG.seekThreshold) {
      return;
    }
    lastPreviewTime = time;

    // Try to use cached frame first (instant, no lag)
    const cachedFrame = getClosestCachedFrame(video, time);
    if (cachedFrame) {
      const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
      ctx.putImageData(cachedFrame.data, 0, 0);
      previewCanvas.style.opacity = '1';
      return;
    }

    // No cached frame - show current video frame (simple, no seeking)
    try {
      const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = PREVIEW_CONFIG.width / PREVIEW_CONFIG.height;
      let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
      if (videoRatio > canvasRatio) {
        sw = video.videoHeight * canvasRatio;
        sx = (video.videoWidth - sw) / 2;
      } else {
        sh = video.videoWidth / canvasRatio;
        sy = (video.videoHeight - sh) / 2;
      }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, PREVIEW_CONFIG.width, PREVIEW_CONFIG.height);
      previewCanvas.style.opacity = '1';
    } catch (e) { }
  };

  const hidePreview = () => {
    isPreviewActive = false;
    lastPreviewTime = -1;
    previewTooltip.style.opacity = '0';
    previewTooltip.style.transform = 'translateY(10px) scale(0.95)';
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
      debounceTimeout = null;
    }
  };

  // Handle mouse movement over seekbar
  seekBar.addEventListener('mousemove', (e) => {
    isPreviewActive = true;

    if (!video.duration) return;

    const rect = seekBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = percent * video.duration;

    // Clear previous debounce
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    // Debounced update for seek (to prevent too many seeks)
    debounceTimeout = setTimeout(() => {
      updatePreview(time, e.clientX);
    }, PREVIEW_CONFIG.debounceMs);

    // Update position and time display immediately
    previewTime.textContent = formatTime(time);
    const tooltipRect = seekBarTrack.getBoundingClientRect();
    const tooltipWidth = PREVIEW_CONFIG.width + 8; // Add padding for border
    const sideGap = 10; // Gap from edges
    let left = e.clientX - tooltipRect.left - (tooltipWidth / 2);
    // Clamp to stay within the track bounds with side gap
    left = Math.max(sideGap, Math.min(left, tooltipRect.width - tooltipWidth - sideGap));
    previewTooltip.style.left = `${left}px`;
    previewTooltip.style.opacity = '1';
    previewTooltip.style.transform = 'translateY(0) scale(1)';
  });

  seekBar.addEventListener('mouseleave', hidePreview);
  seekBar.addEventListener('mouseenter', () => {
    isPreviewActive = true;
    initPreview();
  });

  const updateProgress = () => {
    if (!seekBar.dragging && video.duration) {
      const progress = (video.currentTime / video.duration) * 1000;
      seekBar.value = progress || 0;
      progressBar.style.width = ((video.currentTime / video.duration) * 100) + '%';
    }
  };
  video.addEventListener('timeupdate', updateProgress);

  const updateBuffered = () => {
    if (video.buffered.length > 0 && video.duration > 0) {
      const buffered = video.buffered.end(video.buffered.length - 1);
      bufferedBar.style.width = ((buffered / video.duration) * 100) + '%';
    }
  };
  video.addEventListener('progress', updateBuffered);
  video.addEventListener('loadedmetadata', () => { });

  seekBar.addEventListener('input', (e) => {
    if (video.duration) {
      const time = (e.target.value / 1000) * video.duration;
      video.currentTime = time;
      progressBar.style.width = (e.target.value / 10) + '%';
    }
  });
  seekBar.addEventListener('mousedown', () => { seekBar.dragging = true; });
  seekBar.addEventListener('mouseup', () => { seekBar.dragging = false; });
  seekBar.addEventListener('touchstart', () => { seekBar.dragging = true; });
  seekBar.addEventListener('touchend', () => { seekBar.dragging = false; });

  return seekBarContainer;
}

function createAdvancedControls(video) {
  const advancedPanel = document.createElement('div');
  advancedPanel.className = 'ig-advanced-controls';

  const speedControl = document.createElement('div');
  speedControl.className = 'ig-control-item';

  // Fixed: Replace innerHTML with DOM methods
  const speedLabel = document.createElement('span');
  speedLabel.className = 'ig-control-label';
  speedLabel.textContent = 'Speed';
  const speedButtonsDiv = document.createElement('div');
  speedButtonsDiv.className = 'ig-speed-buttons';
  [0.5, 0.75, 1, 1.25, 1.5, 2].forEach(speed => {
    const btn = document.createElement('button');
    btn.className = 'ig-speed-btn';
    btn.dataset.speed = speed.toString();
    btn.textContent = `${speed}x`;
    speedButtonsDiv.appendChild(btn);
  });
  speedControl.appendChild(speedLabel);
  speedControl.appendChild(speedButtonsDiv);

  const autoScrollControl = document.createElement('div');
  autoScrollControl.className = 'ig-control-item';

  // Fixed: Replace innerHTML with DOM methods
  const autoScrollLabel = document.createElement('span');
  autoScrollLabel.className = 'ig-control-label';
  autoScrollLabel.textContent = 'Auto Scroll';
  const switchLabel = document.createElement('label');
  switchLabel.className = 'ig-switch';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'ig-auto-scroll-toggle';
  const sliderSpan = document.createElement('span');
  sliderSpan.className = 'ig-switch-slider';
  switchLabel.appendChild(checkbox);
  switchLabel.appendChild(sliderSpan);
  autoScrollControl.appendChild(autoScrollLabel);
  autoScrollControl.appendChild(switchLabel);

  const pipControl = document.createElement('div');
  pipControl.className = 'ig-control-item';

  // Fixed: Replace innerHTML with DOM methods
  const pipBtn = document.createElement('button');
  pipBtn.className = 'ig-pip-btn';
  const pipSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  pipSvg.setAttribute('viewBox', '0 0 24 24');
  pipSvg.setAttribute('fill', 'white');
  pipSvg.setAttribute('width', '20');
  pipSvg.setAttribute('height', '20');
  const pipPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pipPath.setAttribute('d', 'M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z');
  pipSvg.appendChild(pipPath);
  pipBtn.appendChild(pipSvg);
  pipBtn.appendChild(document.createTextNode('Picture-in-Picture'));
  pipControl.appendChild(pipBtn);

  const downloadControl = document.createElement('div');
  downloadControl.className = 'ig-control-item';

  // Fixed: Replace innerHTML with DOM methods
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'ig-download-btn';
  const downloadSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  downloadSvg.setAttribute('viewBox', '0 0 24 24');
  downloadSvg.setAttribute('fill', 'white');
  downloadSvg.setAttribute('width', '20');
  downloadSvg.setAttribute('height', '20');
  const downloadPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  downloadPath.setAttribute('d', 'M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z');
  downloadSvg.appendChild(downloadPath);
  downloadBtn.appendChild(downloadSvg);
  downloadBtn.appendChild(document.createTextNode('Download Video'));
  downloadControl.appendChild(downloadBtn);

  const skipControl = document.createElement('div');
  skipControl.className = 'ig-control-item ig-skip-controls';

  // Fixed: Replace innerHTML with DOM methods
  const skipLabel = document.createElement('span');
  skipLabel.className = 'ig-control-label';
  skipLabel.textContent = 'Skip';
  const skipButtonsDiv = document.createElement('div');
  skipButtonsDiv.className = 'ig-skip-buttons';

  // -10s button with SVG
  const skip10Back = document.createElement('button');
  skip10Back.className = 'ig-skip-btn';
  skip10Back.dataset.skip = '-10';
  const svg10Back = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg10Back.setAttribute('viewBox', '0 0 24 24');
  svg10Back.setAttribute('fill', 'white');
  svg10Back.setAttribute('width', '18');
  svg10Back.setAttribute('height', '18');
  const path10Back = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path10Back.setAttribute('d', 'M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z');
  svg10Back.appendChild(path10Back);
  skip10Back.appendChild(svg10Back);
  skip10Back.appendChild(document.createTextNode('10s'));
  skipButtonsDiv.appendChild(skip10Back);

  // -5s button
  const skip5Back = document.createElement('button');
  skip5Back.className = 'ig-skip-btn';
  skip5Back.dataset.skip = '-5';
  skip5Back.textContent = '-5s';
  skipButtonsDiv.appendChild(skip5Back);

  // +5s button
  const skip5Forward = document.createElement('button');
  skip5Forward.className = 'ig-skip-btn';
  skip5Forward.dataset.skip = '5';
  skip5Forward.textContent = '+5s';
  skipButtonsDiv.appendChild(skip5Forward);

  // +10s button with SVG
  const skip10Forward = document.createElement('button');
  skip10Forward.className = 'ig-skip-btn';
  skip10Forward.dataset.skip = '10';
  skip10Forward.appendChild(document.createTextNode('10s'));
  const svg10Forward = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg10Forward.setAttribute('viewBox', '0 0 24 24');
  svg10Forward.setAttribute('fill', 'white');
  svg10Forward.setAttribute('width', '18');
  svg10Forward.setAttribute('height', '18');
  const path10Forward = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path10Forward.setAttribute('d', 'M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z');
  svg10Forward.appendChild(path10Forward);
  skip10Forward.appendChild(svg10Forward);
  skipButtonsDiv.appendChild(skip10Forward);

  skipControl.appendChild(skipLabel);
  skipControl.appendChild(skipButtonsDiv);

  advancedPanel.appendChild(speedControl);
  advancedPanel.appendChild(autoScrollControl);
  advancedPanel.appendChild(skipControl);
  advancedPanel.appendChild(pipControl);
  advancedPanel.appendChild(downloadControl);

  speedControl.querySelectorAll('.ig-speed-btn').forEach(btn => btn.addEventListener('click', () => {
    const speed = parseFloat(btn.dataset.speed);
    const settings = getVideoSettings(video);
    settings.speed = speed;
    video.playbackRate = speed;
    updateVolumeUI(video);
    chrome.storage.sync.set({ playbackSpeed: speed });
  }));

  autoScrollControl.querySelector('.ig-auto-scroll-toggle').addEventListener('change', (e) => {
    autoScroll = e.target.checked;
    chrome.storage.sync.set({ autoScroll: e.target.checked });
    setupAutoScroll(video);
  });

  skipControl.querySelectorAll('.ig-skip-btn').forEach(btn => btn.addEventListener('click', () => video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + parseFloat(btn.dataset.skip)))));
  pipControl.querySelector('.ig-pip-btn').addEventListener('click', async () => {
    try { await (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()); } catch (err) { }
  });
  downloadControl.querySelector('.ig-download-btn').addEventListener('click', () => downloadVideo(video, downloadControl.querySelector('.ig-download-btn')));

  return advancedPanel;
}

async function downloadVideo(video, downloadBtn) {
  const originalHTML = downloadBtn.innerHTML;
  downloadBtn.disabled = true;
  const article = video.closest('article, [role="dialog"]');

  // Create Material Design spinner
  const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spinner.setAttribute('viewBox', '0 0 24 24');
  spinner.setAttribute('width', '20');
  spinner.setAttribute('height', '20');
  spinner.setAttribute('class', 'ig-spinner');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');
  circle.setAttribute('stroke', 'white');
  circle.setAttribute('stroke-width', '3');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke-linecap', 'round');

  spinner.appendChild(circle);

  downloadBtn.textContent = ' Fetching...';
  downloadBtn.insertBefore(spinner, downloadBtn.firstChild);

  void downloadBtn.offsetHeight;

  try {
    let downloadUrl;
    let username = 'video';
    const videoSrc = video.src || video.querySelector('source')?.src;

    if (videoSrc && !videoSrc.startsWith('blob:') && videoSrc.startsWith('http')) {
      downloadUrl = videoSrc;
    } else {
      const postUrl = getCanonicalPostUrl(video, article);

      const apiUrl = `https://stingy-rachele-naeem-5b43a3bb.koyeb.app/api/data?url=${encodeURIComponent(postUrl)}`;

      let response;
      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        try {
          response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
            mode: 'cors',
            cache: 'no-cache',
            credentials: 'omit'
          });

          if (response.ok) {
            break;
          }
        } catch (fetchError) {
          retries++;
          if (retries >= maxRetries) {
            throw new Error(`Network error: ${fetchError.message || 'Failed to fetch'}`);
          }
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      }

      if (!response || !response.ok) {
        throw new Error(`API request failed: ${response ? response.status : 'No response'} ${response ? response.statusText : ''}`);
      }

      const data = await response.json();

      if (!data.success || !data.media || data.media.length === 0) {
        throw new Error('Could not fetch video data from API.');
      }

      let mediaIndex = 0;
      if (data.media.length > 1) {
        mediaIndex = inferMediaIndexForPost(video, article, data.media.length);
      }

      const selectedMedia = data.media[Math.min(mediaIndex, data.media.length - 1)];
      if (!selectedMedia || !selectedMedia.url) {
        throw new Error('No downloadable media found for this slide.');
      }

      downloadUrl = selectedMedia.url;
      username = selectedMedia.username || data.username || 'video';
    }

    // Update to downloading state
    const spinner2 = spinner.cloneNode(true);
    downloadBtn.textContent = ' Downloading...';
    downloadBtn.insertBefore(spinner2, downloadBtn.firstChild);
    void downloadBtn.offsetHeight;

    // Download video as blob for direct download
    try {
      const videoResponse = await fetch(downloadUrl, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache'
      });

      if (!videoResponse.ok) {
        throw new Error('Failed to fetch video');
      }

      const blob = await videoResponse.blob();
      const blobUrl = URL.createObjectURL(blob);

      // Create download link
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `instagram_${username}_${Date.now()}.mp4`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 100);
    } catch (blobError) {
      // Fallback to direct link if blob download fails
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `instagram_${username}_${Date.now()}.mp4`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
      }, 100);
    }

    // Create success checkmark
    const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    checkSvg.setAttribute('viewBox', '0 0 24 24');
    checkSvg.setAttribute('fill', 'white');
    checkSvg.setAttribute('width', '20');
    checkSvg.setAttribute('height', '20');

    const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    checkPath.setAttribute('d', 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z');
    checkSvg.appendChild(checkPath);

    downloadBtn.textContent = ' Downloaded!';
    downloadBtn.insertBefore(checkSvg, downloadBtn.firstChild);

  } catch (error) {
    let errorMessage = 'Unable to download this video. ';
    if (error.message && (error.message.includes('Failed to fetch') || error.message.includes('Network error'))) {
      errorMessage += 'Network error - please check your connection and try again.';
    } else if (error.message && error.message.includes('API request failed')) {
      errorMessage += 'Server error - please try again later.';
    } else {
      errorMessage += error.message || 'Please try again.';
    }
    alert(errorMessage);
    const doc = new DOMParser().parseFromString(originalHTML, 'text/html');
    downloadBtn.replaceChildren(...doc.body.childNodes);
  } finally {
    setTimeout(() => {
      downloadBtn.disabled = false;
      const doc = new DOMParser().parseFromString(originalHTML, 'text/html');
      downloadBtn.replaceChildren(...doc.body.childNodes);
    }, 2000);
  }
}

function getCanonicalPostUrl(video, article) {
  const absoluteMatch = window.location.href.match(/https:\/\/www\.instagram\.com\/(p|reel)\/[A-Za-z0-9_\-]+/i);
  if (absoluteMatch) {
    return `${absoluteMatch[0].replace(/\/$/, '')}/`;
  }

  const relativeMatch = window.location.pathname.match(/\/(p|reel)\/[A-Za-z0-9_\-]+/i);
  if (relativeMatch) {
    return `https://www.instagram.com${relativeMatch[0].replace(/\/$/, '')}/`;
  }

  if (!article && video) {
    article = video.closest('article, [role="dialog"]');
  }

  if (article) {
    const linkElement = article.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    if (linkElement) {
      try {
        return new URL(linkElement.href, window.location.origin).href.split('?')[0];
      } catch (e) {
        // Ignore URL errors
      }
    }
  }

  return window.location.href.split('?')[0];
}

function inferMediaIndexForPost(video, article, mediaLength) {
  if (!video || mediaLength <= 1) return 0;

  const clampIndex = (idx) => Math.min(Math.max(idx, 0), mediaLength - 1);

  if (!article) {
    article = video.closest('article, [role="dialog"]');
  }

  if (article) {
    const indicator = article.querySelector('[aria-current="true"][aria-label*="slide" i]');
    if (indicator) {
      const label = indicator.getAttribute('aria-label') || '';
      const match = label.match(/slide\s+(\d+)/i);
      if (match) {
        return clampIndex(parseInt(match[1], 10) - 1);
      }
    }

    const slideItem = video.closest('li, [role="listitem"], div[data-testid="media-viewer"], div[data-visualcompletion="mediaOverlay"]');
    if (slideItem && slideItem.parentElement) {
      const siblings = Array.from(slideItem.parentElement.children).filter(node => node.matches('li, [role="listitem"], div[data-testid="media-viewer"], div[data-visualcompletion="mediaOverlay"]'));
      const idx = siblings.indexOf(slideItem);
      if (idx !== -1) {
        return clampIndex(idx);
      }
    }

    const slideWrapper = video.closest('[data-testid="post-container"], article, [role="dialog"]') || article;
    if (slideWrapper) {
      const candidateSections = Array.from(slideWrapper.querySelectorAll('li, [role="listitem"], div[data-testid="media-viewer"], div[data-visualcompletion="mediaOverlay"]'))
        .filter(node => node.querySelector('video, img'));
      if (candidateSections.length > 0) {
        const currentSection = candidateSections.find(section => section.contains(video));
        if (currentSection) {
          const idx = candidateSections.indexOf(currentSection);
          if (idx !== -1) {
            return clampIndex(idx);
          }
        }
      }
    }
  }

  if (article) {
    const videos = Array.from(article.querySelectorAll('video')).filter(v => v.clientWidth > 60 && v.clientHeight > 60);
    const idx = videos.indexOf(video);
    if (idx !== -1) {
      return clampIndex(idx);
    }
  }

  return 0;
}

function findControlContainer(video) {
  // Don't add controls on stories page
  if (window.location.pathname.includes('/stories/')) {
    return null;
  }

  // For post pages (/p/ or /reel/) or dialogs, be more aggressive in finding container
  const isPostPage = window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/');
  const isInDialog = video.closest('[role="dialog"]') !== null;

  let current = video.parentElement;
  let attempts = 0;
  const maxAttempts = (isPostPage || isInDialog) ? 20 : 10; // Go deeper for post pages and dialogs

  while (current && attempts < maxAttempts) {
    attempts++;
    const style = window.getComputedStyle(current);

    // For post pages or dialogs, accept more containers
    if (isPostPage || isInDialog) {
      // Check if this is a good container
      if (style.position === 'relative' || style.position === 'absolute' || style.position === 'fixed') {
        // Make sure it's a reasonable size
        if (current.clientHeight > 100 && current.clientWidth > 100) {
          return current;
        }
      }

      // Look for dialog, article, or main containers
      if (current.getAttribute('role') === 'dialog' ||
        current.tagName === 'ARTICLE' ||
        current.tagName === 'MAIN' ||
        current.classList.contains('x1iyjqo2') || // Instagram video container class
        current.querySelector('video') === video) {
        if (style.position === 'static') {
          current.style.position = 'relative';
        }
        if (current.clientHeight > 100) {
          return current;
        }
      }
    } else {
      if ((style.position === 'relative' || style.position === 'absolute') && current.clientHeight < window.innerHeight * 1.5) {
        return current;
      }
    }

    if (current.tagName === 'ARTICLE' || current.tagName === 'MAIN') {
      if (style.position === 'static') {
        current.style.position = 'relative';
      }
      return current;
    }

    current = current.parentElement;
  }

  // Fallback: use video's parent and set it to relative
  const parent = video.parentElement;
  if (parent) {
    if (window.getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    // Make sure parent has reasonable dimensions
    if (parent.clientHeight < 100 || parent.clientWidth < 100) {
      const grandParent = parent.parentElement;
      if (grandParent && window.getComputedStyle(grandParent).position === 'static') {
        grandParent.style.position = 'relative';
      }
      return grandParent || parent;
    }
    return parent;
  }

  return parent;
}

// Check if we're on the Reels page (feed or individual reel)
function isReelsPage() {
  return window.location.pathname === '/reels/' || window.location.pathname.startsWith('/reels/');
}

function updateReelsPageState() {
  const root = document.documentElement;
  if (!root) return;
  if (isReelsPage()) {
    root.classList.add('vibex-on-reels');
  } else {
    root.classList.remove('vibex-on-reels');
  }
}

function isSingleReelView() {
  const path = window.location.pathname;
  if (!path.startsWith('/reels/') || path === '/reels/') return false;
  const segments = path.split('/').filter(Boolean);
  // Expecting /reels/{id}/ (2 segments, ignoring trailing slash)
  return segments.length === 2 && segments[0] === 'reels';
}

function clickNativeNextReel(currentVideo) {
  const selectors = [
    'button[aria-label*="Next" i]',
    '[role="button"][aria-label*="Next" i]',
    'button[aria-label*="next" i]',
    'svg[aria-label*="Next" i]',
    'div[aria-label*="Next" i]'
  ];

  const searchRoots = [];
  if (currentVideo) {
    const scopedContainer = currentVideo.closest('[role="presentation"], article, [data-visualcompletion], div');
    if (scopedContainer) searchRoots.push(scopedContainer);
  }
  searchRoots.push(document);

  for (const root of searchRoots) {
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = root.querySelectorAll(selector);
      } catch (_) {
        continue;
      }
      for (const node of nodes) {
        const clickable = node.closest('button') || node.closest('[role="button"]') || node;
        if (!clickable) continue;
        if (clickable.closest('.ig-volume-control') || clickable.closest('.ig-advanced-controls')) continue;
        if (typeof clickable.offsetParent === 'undefined' || clickable.offsetParent === null) continue;
        clickable.click();
        return true;
      }
    }
  }

  return false;
}

// Track removed circles to avoid re-processing
const removedCircles = new WeakSet();

// Remove circle element from Reels page ONLY - More aggressive approach
function removeReelsCircle() {
  // CRITICAL: Only run on Reels pages, never on main feed or stories
  if (!isReelsPage()) return;

  // Make sure we're not on the main feed (stories are on main feed)
  const path = window.location.pathname;
  if (path === '/' || path === '' || !path.includes('/reels/')) {
    return; // Don't remove anything on main feed or non-Reels pages
  }

  // Find all potential circle elements
  const allPotentialCircles = [];

  // Strategy 1: Find by exact class combination and role
  const exactSelectors = [
    'div.x1i10hfl.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo.x13fuv20.x18b5jzi.x1q0q8m5.x1t7ytsu.x972fbf[role="button"][tabindex="0"]',
    'div.x1i10hfl.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo.x13fuv20.x18b5jzi.x1q0q8m5.x1t7ytsu[role="button"][tabindex="0"]',
    'div.x1i10hfl.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo[role="button"][tabindex="0"]',
    'div.x1i10hfl.xjqpnuy.xc5r6h4.xqeqjp1[role="button"][tabindex="0"]'
  ];

  exactSelectors.forEach(selector => {
    try {
      document.querySelectorAll(selector).forEach(div => {
        if (!removedCircles.has(div)) {
          allPotentialCircles.push(div);
        }
      });
    } catch (e) {
      // Ignore selector errors
    }
  });

  // Strategy 2: Find by role="button" and tabindex="0" with matching classes
  if (allPotentialCircles.length === 0) {
    document.querySelectorAll('div[role="button"][tabindex="0"]').forEach(div => {
      if (removedCircles.has(div)) return;

      const ariaLabel = (div.getAttribute('aria-label') || '').toLowerCase();
      const hasShareIcon = !!div.querySelector('svg[aria-label*="share" i], svg[aria-label*="send" i], svg[aria-label*="message" i], svg[aria-label*="chat" i]');
      if ((ariaLabel && (ariaLabel.includes('send') || ariaLabel.includes('share') || ariaLabel.includes('message') || ariaLabel.includes('chat'))) || hasShareIcon) {
        return;
      }

      const classes = div.className || '';
      // Must have the key identifying classes
      if (classes.includes('x1i10hfl') && classes.includes('xjqpnuy') && classes.includes('xqeqjp1')) {
        allPotentialCircles.push(div);
      }
    });
  }

  // Process each potential circle
  allPotentialCircles.forEach(div => {
    if (removedCircles.has(div) || !document.body.contains(div)) return;

    const ariaLabel = (div.getAttribute('aria-label') || '').toLowerCase();
    const hasShareIcon = !!div.querySelector('svg[aria-label*="share" i], svg[aria-label*="send" i], svg[aria-label*="message" i], svg[aria-label*="chat" i]');
    if ((ariaLabel && (ariaLabel.includes('send') || ariaLabel.includes('share') || ariaLabel.includes('message') || ariaLabel.includes('chat'))) || hasShareIcon) {
      return;
    }

    // CRITICAL: Never remove story elements
    const storyParent = div.closest('[aria-label*="story" i], [aria-label*="Stories" i]');
    if (storyParent) {
      return; // Skip story elements completely
    }

    // Check if it's in a horizontal scroll container (stories are horizontal)
    const parent = div.parentElement;
    const hasHorizontalScroll = parent && parent.scrollWidth > parent.clientWidth &&
      parent.scrollHeight <= parent.clientHeight * 1.5;
    if (hasHorizontalScroll) {
      return; // Skip horizontal scroll containers (likely stories)
    }

    // Check size and position - must be approximately 32x32 in top-left area
    const rect = div.getBoundingClientRect();
    if (rect.width >= 24 && rect.width <= 40 &&
      rect.height >= 24 && rect.height <= 40 &&
      rect.top >= 0 && rect.top < 200 &&
      rect.left >= 0 && rect.left < 200) {

      // Make sure it's not part of our controls
      if (!div.closest('.ig-volume-control') && !div.closest('.ig-advanced-controls')) {
        // Remove it and mark as processed
        div.remove();
        removedCircles.add(div);
      }
    }
  });
}

// Dedicated MutationObserver for audio badge removal on Reels pages
let audioBadgeObserver = null;

function setupAudioBadgeRemovalObserver() {
  // Only setup on Reels pages
  if (!isReelsPage()) {
    if (audioBadgeObserver) {
      audioBadgeObserver.disconnect();
      audioBadgeObserver = null;
    }
    return;
  }

  // If observer already exists, don't create another
  if (audioBadgeObserver) return;

  // Create dedicated observer for audio badge removal
  audioBadgeObserver = new MutationObserver((mutations) => {
    // Check if we're still on Reels page
    if (!isReelsPage()) {
      audioBadgeObserver.disconnect();
      audioBadgeObserver = null;
      return;
    }

    // Check if any new nodes were added that might be the audio badge
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) { // Element node
          // If it's the audio badge button itself
          if (node.matches && node.matches('div[role="button"][tabindex="0"]')) {
            const svg = node.querySelector('svg[aria-label*="audio" i]');
            if (svg) {
              setTimeout(() => removeReelsAudioBadge(), 10);
            }
          }

          // If it contains potential audio badge elements
          if (node.querySelectorAll) {
            const hasAudioBadge = node.querySelectorAll('svg[aria-label*="audio" i]');
            if (hasAudioBadge.length > 0) {
              setTimeout(() => removeReelsAudioBadge(), 10);
            }
          }
        }
      });

      // Also check for attribute changes (aria-label might change from "playing" to "muted")
      if (mutation.type === 'attributes' && mutation.attributeName === 'aria-label') {
        const target = mutation.target;
        if (target.tagName === 'SVG' && target.getAttribute('aria-label')?.toLowerCase().includes('audio')) {
          setTimeout(() => removeReelsAudioBadge(), 10);
        }
      }
    });

    // Also run removal check
    removeReelsAudioBadge();
  });

  audioBadgeObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label']
  });

  // Initial removal
  removeReelsAudioBadge();
}

// Dedicated MutationObserver for circle removal on Reels pages
let circleObserver = null;

function setupCircleRemovalObserver() {
  updateReelsPageState();
  // Only setup on Reels pages
  if (!isReelsPage()) {
    if (circleObserver) {
      circleObserver.disconnect();
      circleObserver = null;
    }
    return;
  }

  // If observer already exists, don't create another
  if (circleObserver) return;

  // Create dedicated observer for circle removal
  circleObserver = new MutationObserver((mutations) => {
    // Check if we're still on Reels page
    if (!isReelsPage()) {
      circleObserver.disconnect();
      circleObserver = null;
      return;
    }

    // Check if any new nodes were added that might be the circle
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) { // Element node
          // If it's the circle element itself
          if (node.matches && (
            node.matches('div[role="button"][tabindex="0"]') ||
            (node.className && typeof node.className === 'string' &&
              node.className.includes('x1i10hfl') && node.className.includes('xjqpnuy'))
          )) {
            setTimeout(() => removeReelsCircle(), 50);
          }

          // If it contains potential circle elements
          if (node.querySelectorAll) {
            const hasCircle = node.querySelectorAll('div[role="button"][tabindex="0"]');
            if (hasCircle.length > 0) {
              setTimeout(() => removeReelsCircle(), 50);
            }
          }
        }
      });
    });

    // Also run removal check
    removeReelsCircle();
  });

  circleObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false
  });

  // Initial removal
  removeReelsCircle();
}

// Initial setup
updateReelsPageState();
if (isReelsPage()) {
  setupCircleRemovalObserver();
  setupAudioBadgeRemovalObserver(); // Setup audio badge removal observer
  setTimeout(() => removeReelsCircle(), 100);
  setTimeout(() => removeReelsCircle(), 500);
  setTimeout(() => removeReelsCircle(), 1000);
  setTimeout(() => removeReelsAudioBadge(), 100);
  setTimeout(() => removeReelsAudioBadge(), 500);
  setTimeout(() => removeReelsAudioBadge(), 1000);
}

// Get the currently active video (visible in viewport and playing)
function getCurrentActiveVideo() {
  if (!isReelsPage() || !autoScroll) return null;

  const videos = Array.from(document.querySelectorAll('video')).filter(v => {
    if (isGif(v)) return false;
    if (!document.body.contains(v)) return false;
    const rect = v.getBoundingClientRect();
    // Video must be visible and reasonably sized
    return rect.width > 50 && rect.height > 50 &&
      rect.top >= -rect.height * 0.5 &&
      rect.bottom <= window.innerHeight + rect.height * 0.5;
  });

  if (videos.length === 0) return null;

  // Find the video that's most centered in viewport and playing
  let activeVideo = null;
  let maxScore = -1;
  const viewportCenter = window.innerHeight / 2;

  videos.forEach(video => {
    const rect = video.getBoundingClientRect();
    const videoCenter = rect.top + rect.height / 2;
    const distanceFromCenter = Math.abs(videoCenter - viewportCenter);

    // Score: closer to center = higher score, playing = bonus
    let score = 1000 - distanceFromCenter;
    if (!video.paused && !video.ended) score += 500;
    if (video.currentTime > 0 && video.currentTime < video.duration) score += 200;

    // Prefer videos that are actually in viewport
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) score += 300;

    if (score > maxScore) {
      maxScore = score;
      activeVideo = video;
    }
  });

  return activeVideo;
}

// Find the next video element in the feed
function findNextVideo(currentVideo) {
  if (!currentVideo || !document.body.contains(currentVideo)) {
    return null;
  }

  // Get current video's position
  const currentRect = currentVideo.getBoundingClientRect();
  const currentTop = window.scrollY + currentRect.top;
  const currentBottom = window.scrollY + currentRect.bottom;

  // Find all videos on the page
  const allVideos = Array.from(document.querySelectorAll('video')).filter(video => {
    if (video === currentVideo) return false;
    if (isGif(video)) return false;
    const rect = video.getBoundingClientRect();
    return rect.width > 50 && rect.height > 50;
  });

  if (allVideos.length === 0) {
    return null;
  }

  // Sort videos by position
  const videosWithPosition = allVideos.map(video => {
    const rect = video.getBoundingClientRect();
    return {
      video: video,
      top: window.scrollY + rect.top,
      bottom: window.scrollY + rect.bottom
    };
  }).sort((a, b) => a.top - b.top);

  const minGap = Math.max(40, currentRect.height * 0.2);

  // Find next video below current one
  const nextVideo = videosWithPosition.find(item => item.top >= currentBottom - minGap);
  if (nextVideo) {
    return nextVideo.video;
  }

  // Check for video near viewport
  const viewportBottom = window.scrollY + window.innerHeight;
  const nearViewportVideo = videosWithPosition.find(item => {
    return item.top > currentBottom && item.top < viewportBottom + window.innerHeight;
  });

  if (nearViewportVideo) {
    return nearViewportVideo.video;
  }

  return null;
}

// Store event handlers for proper cleanup
const videoAutoScrollHandlers = new WeakMap();

// Clean auto-scroll implementation
function setupAutoScroll(video) {
  // Early exit if conditions not met
  if (!video || !isReelsPage() || !autoScroll) {
    cleanupAutoScroll(video);
    return;
  }

  // Cleanup any existing handlers first
  cleanupAutoScroll(video);

  // Track if this video has already triggered scroll
  let hasScrolledForThisVideo = false;

  // Create handler object to store all handlers
  const handlers = {
    onEnded: null,
    onTimeUpdate: null,
    onPlay: null,
    checkInterval: null
  };

  // Main scroll function
  const performScroll = () => {
    // Prevent multiple simultaneous scrolls
    if (isAutoScrolling) {
      return;
    }

    const now = Date.now();
    if ((now - lastAutoScrollTime) < AUTO_SCROLL_DEBOUNCE_MS) {
      return;
    }

    // Verify conditions
    if (!autoScroll || !isReelsPage() || !video || !document.body.contains(video)) {
      return;
    }

    // Only scroll if video has ended
    if (!video.ended) {
      return;
    }

    // Prevent duplicate scrolls for same video
    if (hasScrolledForThisVideo) {
      return;
    }

    hasScrolledForThisVideo = true;
    isAutoScrolling = true;
    lastAutoScrollTime = now;

    // Try native navigation first (most reliable)
    if (clickNativeNextReel(video)) {
      setTimeout(() => {
        isAutoScrolling = false;
      }, AUTO_SCROLL_DEBOUNCE_MS);
      return;
    }

    // Fallback: Find and scroll to next video
    const nextVideo = findNextVideo(video);

    if (nextVideo && document.body.contains(nextVideo)) {
      // Scroll to next video
      nextVideo.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Try to play next video after scroll
      setTimeout(() => {
        isAutoScrolling = false;
        if (nextVideo.tagName === 'VIDEO' && nextVideo.paused) {
          nextVideo.play().catch(() => {
            // Retry play after delay
            setTimeout(() => nextVideo.play().catch(() => { }), 500);
          });
        }
      }, AUTO_SCROLL_DEBOUNCE_MS);
    } else if (!isSingleReelView()) {
      // No next video found, scroll down to load more content
      window.scrollBy({ top: window.innerHeight * 0.95, behavior: 'smooth' });

      // Check for new videos after scroll
      let retryCount = 0;
      const maxRetries = 5;

      const checkForNewVideo = () => {
        if (retryCount >= maxRetries || !autoScroll || !isReelsPage()) {
          isAutoScrolling = false;
          return;
        }

        retryCount++;
        const next = findNextVideo(video);

        if (next && document.body.contains(next)) {
          next.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            isAutoScrolling = false;
            if (next.tagName === 'VIDEO' && next.paused) {
              next.play().catch(() => { });
            }
          }, AUTO_SCROLL_DEBOUNCE_MS);
        } else {
          setTimeout(checkForNewVideo, 500);
        }
      };

      setTimeout(checkForNewVideo, 800);
    } else {
      // Single reel view - no more videos
      isAutoScrolling = false;
      hasScrolledForThisVideo = false;
    }
  };

  // Event handler for video ended
  handlers.onEnded = () => {
    if (video.ended && !hasScrolledForThisVideo) {
      performScroll();
    }
  };

  // Event handler for play - reset scroll flag when video restarts
  handlers.onPlay = () => {
    if (video.currentTime < 0.5) {
      hasScrolledForThisVideo = false;
    }
  };

  // Periodic check as backup (in case ended event doesn't fire)
  handlers.onTimeUpdate = () => {
    if (!autoScroll || !isReelsPage() || !video || !document.body.contains(video)) {
      return;
    }

    if (isAutoScrolling) {
      return;
    }

    if (video.ended && !hasScrolledForThisVideo) {
      performScroll();
    }
  };

  // Add event listeners
  video.addEventListener('ended', handlers.onEnded);
  video.addEventListener('play', handlers.onPlay);
  video.addEventListener('timeupdate', handlers.onTimeUpdate);

  // Store handlers for cleanup
  videoAutoScrollHandlers.set(video, handlers);

  // Clear any existing timeout
  if (autoScrollTimeouts.has(video)) {
    clearTimeout(autoScrollTimeouts.get(video));
  }
}

// Cleanup function for auto-scroll
function cleanupAutoScroll(video) {
  if (!video) return;

  // Remove event listeners
  const handlers = videoAutoScrollHandlers.get(video);
  if (handlers) {
    if (handlers.onEnded) {
      video.removeEventListener('ended', handlers.onEnded);
    }
    if (handlers.onPlay) {
      video.removeEventListener('play', handlers.onPlay);
    }
    if (handlers.onTimeUpdate) {
      video.removeEventListener('timeupdate', handlers.onTimeUpdate);
    }
    if (handlers.checkInterval) {
      clearInterval(handlers.checkInterval);
    }
    videoAutoScrollHandlers.delete(video);
  }

  // Clear timeout
  if (autoScrollTimeouts.has(video)) {
    clearTimeout(autoScrollTimeouts.get(video));
    autoScrollTimeouts.delete(video);
  }
}

function isGif(video) {
  // Check if video is actually a GIF
  const src = video.src || video.querySelector('source')?.src || '';

  // Check file extension or mime type first
  if (src.includes('.gif') || src.includes('image/gif')) {
    return true;
  }

  // Check if we're in actual DMs (not just any dialog)
  const isDM = window.location.pathname.includes('/direct/');

  // Only in actual DM page (not reels/posts in dialogs), check for GIFs/stickers
  if (isDM) {
    // Very short duration = likely GIF/sticker
    if (video.duration && video.duration < 5) {
      return true;
    }

    // Very small dimensions in DMs = likely sticker/GIF
    if (video.videoWidth && video.videoHeight) {
      const area = video.videoWidth * video.videoHeight;
      if (area < 400 * 400 && video.duration < 10) {
        return true;
      }
    }
  }

  // Check duration - GIFs are usually very short
  if (video.duration && video.duration < 3) {
    return true;
  }

  // Check if video has loop attribute AND is very short (common for GIFs)
  if (video.hasAttribute('loop') && video.duration && video.duration < 5) {
    return true;
  }

  return false;
}

// Global state for keyboard long press (shared across all videos)
let globalKeyboardState = {
  isSpacePressed: false,
  longPressTimer: null,
  isLongPressing: false,
  wasLongPress: false,
  originalSpeed: 1.0
};

// Global keyboard handlers (only attached once)
let globalKeyboardHandlersAttached = false;

function attachGlobalKeyboardHandlers() {
  if (globalKeyboardHandlersAttached) return;
  globalKeyboardHandlersAttached = true;

  // Prevent scroll when space is pressed
  const preventScroll = (e) => {
    if (globalKeyboardState.isSpacePressed) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  };

  // Keyboard handling (Space) - USE CAPTURE PHASE to prevent scrolling
  const handleKeyDown = (e) => {
    // Don't intercept if user is typing in any editable element
    if (e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.isContentEditable ||
      e.target.closest('[contenteditable="true"]') ||
      e.target.closest('[role="textbox"]')) {
      return;
    }

    if (e.key === ' ') {
      // CRITICAL: Prevent default IMMEDIATELY to stop scrolling
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Track that space is pressed
      if (!globalKeyboardState.isSpacePressed) {
        globalKeyboardState.isSpacePressed = true;
        globalKeyboardState.wasLongPress = false;

        // Find the currently active/visible video
        const activeVideo = findActiveVideo();
        if (!activeVideo) return;

        globalKeyboardState.longPressTimer = setTimeout(() => {
          startGlobalSpeedup(activeVideo);
        }, 150);
      }
    }
  };

  const handleKeyUp = (e) => {
    // Don't intercept if user is typing in any editable element
    if (e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.isContentEditable ||
      e.target.closest('[contenteditable="true"]') ||
      e.target.closest('[role="textbox"]')) {
      return;
    }

    if (e.key === ' ') {
      // CRITICAL: Prevent default IMMEDIATELY to stop scrolling
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      globalKeyboardState.isSpacePressed = false;
      clearTimeout(globalKeyboardState.longPressTimer);

      const activeVideo = findActiveVideo();
      if (!activeVideo) return;

      if (globalKeyboardState.isLongPressing) {
        // Was holding - just stop speedup, don't pause
        stopGlobalSpeedup(activeVideo);
      } else {
        // Was a tap - toggle play/pause
        if (activeVideo.paused) {
          activeVideo.play();
        } else {
          activeVideo.pause();
        }
      }
    }
  };

  // Add with capture:true to intercept BEFORE any other handlers
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keyup', handleKeyUp, true);

  // Prevent scroll events while space is pressed
  window.addEventListener('scroll', preventScroll, { passive: false, capture: true });
  window.addEventListener('wheel', preventScroll, { passive: false, capture: true });
}

// Find the currently active/visible video
function findActiveVideo() {
  const videos = Array.from(document.querySelectorAll('video')).filter(v => {
    if (isGif(v)) return false;
    if (!document.body.contains(v)) return false;

    const rect = v.getBoundingClientRect();
    // Video must be visible and reasonably sized
    return rect.width > 50 && rect.height > 50 &&
      rect.top < window.innerHeight && rect.bottom > 0;
  });

  if (videos.length === 0) return null;

  // Prioritize playing video, then most centered video
  let activeVideo = videos.find(v => !v.paused);

  if (!activeVideo) {
    // Find the video most centered in viewport
    const viewportCenter = window.innerHeight / 2;
    let minDistance = Infinity;

    videos.forEach(video => {
      const rect = video.getBoundingClientRect();
      const videoCenter = rect.top + rect.height / 2;
      const distance = Math.abs(videoCenter - viewportCenter);

      if (distance < minDistance) {
        minDistance = distance;
        activeVideo = video;
      }
    });
  }

  return activeVideo;
}

function startGlobalSpeedup(video) {
  if (globalKeyboardState.isLongPressing) return;
  if (!video) return;

  globalKeyboardState.isLongPressing = true;
  globalKeyboardState.wasLongPress = true;

  // Store original speed
  const settings = getVideoSettings(video);
  globalKeyboardState.originalSpeed = settings ? settings.speed : video.playbackRate;

  // If paused, play it
  if (video.paused) {
    video.play().catch(() => { });
  }

  // Set to 2x and force it
  video.playbackRate = 2.0;

  // Show overlay - check if container exists, if not create a temporary one
  let container = video.closest('.ig-volume-control-container');
  let overlay = null;

  if (container) {
    overlay = container.querySelector('.ig-speed-overlay');
  }

  // If no overlay exists, create a temporary one on the video's parent
  if (!overlay) {
    const parent = video.parentElement;
    if (parent) {
      // Make sure parent has relative positioning
      if (window.getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }

      // Create temporary overlay
      overlay = document.createElement('div');
      overlay.className = 'ig-speed-overlay ig-speed-overlay-temp';
      overlay.textContent = '2x';
      parent.appendChild(overlay);

      // Mark it as temporary so we can clean it up later
      overlay._isTemporary = true;
    }
  }

  if (overlay) {
    overlay.classList.add('visible');
  }

  // Keep forcing 2x speed while long pressing
  const forceSpeed = setInterval(() => {
    if (globalKeyboardState.isLongPressing && video.playbackRate !== 2.0) {
      video.playbackRate = 2.0;
    }
    if (!globalKeyboardState.isLongPressing) {
      clearInterval(forceSpeed);
    }
  }, 50);
}

function stopGlobalSpeedup(video) {
  if (!globalKeyboardState.isLongPressing) return;
  if (!video) return;

  globalKeyboardState.isLongPressing = false;

  // Restore original speed
  const settings = getVideoSettings(video);
  if (settings && settings.speed) {
    video.playbackRate = settings.speed;
  } else {
    video.playbackRate = globalKeyboardState.originalSpeed || 1.0;
  }

  // Hide and cleanup overlay
  const container = video.closest('.ig-volume-control-container');
  let overlay = null;

  if (container) {
    overlay = container.querySelector('.ig-speed-overlay');
  }

  // Check for temporary overlay in parent
  if (!overlay && video.parentElement) {
    overlay = video.parentElement.querySelector('.ig-speed-overlay-temp');
  }

  if (overlay) {
    overlay.classList.remove('visible');

    // Remove temporary overlays
    if (overlay._isTemporary) {
      setTimeout(() => {
        if (overlay.parentElement) {
          overlay.parentElement.removeChild(overlay);
        }
      }, 300); // Wait for fade out animation
    }
  }
}

function setupLongPressSpeed(video, container) {
  if (!video || !container) return;

  // Attach global keyboard handlers once
  attachGlobalKeyboardHandlers();

  // Create overlay if not exists
  let overlay = container.querySelector('.ig-speed-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'ig-speed-overlay';
    overlay.textContent = '2x';
    container.appendChild(overlay);
  }

  let longPressTimer;
  let isLongPressing = false;
  let wasLongPress = false;
  let originalSpeed = 1.0;

  // Store state for click handler access
  container._longPressState = {
    get wasLongPress() { return wasLongPress; },
    set wasLongPress(val) { wasLongPress = val; },
    get isLongPressing() { return isLongPressing; }
  };

  const startSpeedup = () => {
    if (isLongPressing) return;
    isLongPressing = true;
    wasLongPress = true;

    // Store original speed
    const settings = getVideoSettings(video);
    originalSpeed = settings ? settings.speed : video.playbackRate;

    // If paused, play it
    if (video.paused) {
      video.play().catch(() => { });
    }

    // Set to 2x and force it
    video.playbackRate = 2.0;

    // Show overlay
    overlay.classList.add('visible');

    // Keep forcing 2x speed while long pressing
    const forceSpeed = setInterval(() => {
      if (isLongPressing && video.playbackRate !== 2.0) {
        video.playbackRate = 2.0;
      }
      if (!isLongPressing) {
        clearInterval(forceSpeed);
      }
    }, 50);
  };

  const stopSpeedup = () => {
    if (!isLongPressing) return;
    isLongPressing = false;

    // Restore original speed
    const settings = getVideoSettings(video);
    if (settings && settings.speed) {
      video.playbackRate = settings.speed;
    } else {
      video.playbackRate = originalSpeed || 1.0;
    }

    overlay.classList.remove('visible');
  };

  // Mouse/Touch handling
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.ig-volume-control') ||
      e.target.closest('.ig-advanced-controls') ||
      e.target.closest('.ig-seekbar-container')) return;

    wasLongPress = false;
    longPressTimer = setTimeout(() => {
      startSpeedup();
    }, 350);
  };

  const handleMouseUp = () => {
    clearTimeout(longPressTimer);
    if (isLongPressing) {
      stopSpeedup();
      // Keep wasLongPress true briefly to prevent click
      setTimeout(() => {
        wasLongPress = false;
      }, 150);
    } else {
      wasLongPress = false;
    }
  };

  video.addEventListener('mousedown', handleMouseDown, true);
  video.addEventListener('mouseup', handleMouseUp, true);
  video.addEventListener('mouseleave', () => {
    clearTimeout(longPressTimer);
    stopSpeedup();
    wasLongPress = false;
  });

  video.addEventListener('touchstart', (e) => {
    if (e.target.closest('.ig-volume-control') ||
      e.target.closest('.ig-advanced-controls') ||
      e.target.closest('.ig-seekbar-container')) return;

    wasLongPress = false;
    longPressTimer = setTimeout(() => {
      startSpeedup();
    }, 350);
  }, { passive: true });

  video.addEventListener('touchend', () => {
    clearTimeout(longPressTimer);
    if (isLongPressing) {
      stopSpeedup();
      setTimeout(() => {
        wasLongPress = false;
      }, 150);
    } else {
      wasLongPress = false;
    }
  });
  video.addEventListener('touchcancel', () => {
    clearTimeout(longPressTimer);
    stopSpeedup();
    wasLongPress = false;
  });
}

// Helper function to detect if video is in upload/cover photo selection flow
function isInUploadFlow(video) {
  if (!video) return false;

  // Check if video is inside a dialog that contains upload-related text
  const dialog = video.closest('[role="dialog"]');
  if (dialog) {
    const dialogText = dialog.textContent || '';

    // Check for common upload flow indicators
    if (dialogText.includes('Cover photo') ||
      dialogText.includes('Trim') ||
      dialogText.includes('Select from computer') ||
      dialogText.includes('Next') && dialogText.includes('Back') ||
      dialogText.includes('Create new post') ||
      dialogText.includes('New post')) {
      return true;
    }

    // Check for slider role which is used in upload preview
    const hasSlider = dialog.querySelector('[role="slider"]');
    if (hasSlider) {
      return true;
    }

    // Check if the video is very small (likely a thumbnail)
    const rect = video.getBoundingClientRect();
    if (rect.width < 150 && rect.height < 150) {
      return true;
    }
  }

  // Check if the video element itself has upload-related parent classes or attributes
  let parent = video.parentElement;
  let depth = 0;
  while (parent && depth < 10) {
    // Check for aria-label indicators
    const ariaLabel = parent.getAttribute('aria-label');
    if (ariaLabel) {
      if (ariaLabel.includes('Cover') ||
        ariaLabel.includes('Trim') ||
        ariaLabel.includes('slider')) {
        return true;
      }
    }

    // Check for role="slider" which is used in upload previews
    if (parent.getAttribute('role') === 'slider') {
      return true;
    }

    parent = parent.parentElement;
    depth++;
  }

  return false;
}

function createVolumeControl(video) {
  // Don't add controls on stories page
  if (window.location.pathname.includes('/stories/')) {
    return;
  }

  // Don't add controls to GIFs
  if (isGif(video)) {
    return;
  }

  // Don't add controls to videos in upload/cover photo selection screens
  if (isInUploadFlow(video)) {
    return;
  }

  if (processedVideos.has(video)) return;

  // Wait for metadata to load before making final decision
  const checkAndCreate = () => {
    if (isGif(video)) {
      return;
    }

    // Double-check upload flow
    if (isInUploadFlow(video)) {
      return;
    }

    // Add a small delay to ensure DOM is ready
    setTimeout(() => {
      if (processedVideos.has(video)) return;
      processedVideos.add(video);

      const container = findControlContainer(video);
      if (!container) {
        processedVideos.delete(video);
        return;
      }

      // Check if controls already exist
      if (container.querySelector('.ig-volume-control')) {
        return;
      }

      container.classList.add('ig-volume-control-container');
      if (window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      const volumeWrapper = document.createElement('div');
      volumeWrapper.className = 'ig-volume-control';

      const volumeIcon = document.createElement('div');
      volumeIcon.className = 'ig-volume-icon';

      const sliderContainer = document.createElement('div');
      sliderContainer.className = 'ig-volume-slider-container';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.className = 'ig-volume-slider';

      const volumePercent = document.createElement('div');
      volumePercent.className = 'ig-volume-percent';

      const downloadIcon = document.createElement('div');
      downloadIcon.className = 'ig-download-icon';

      // Fixed: Replace innerHTML with DOM methods
      downloadIcon.textContent = '';
      const dlIconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      dlIconSvg.setAttribute('viewBox', '0 0 24 24');
      dlIconSvg.setAttribute('fill', 'white');
      dlIconSvg.setAttribute('width', '20');
      dlIconSvg.setAttribute('height', '20');
      const dlIconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      dlIconPath.setAttribute('d', 'M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z');
      dlIconSvg.appendChild(dlIconPath);
      downloadIcon.appendChild(dlIconSvg);

      const settingsIcon = document.createElement('div');
      settingsIcon.className = 'ig-settings-icon';

      // Fixed: Replace innerHTML with DOM methods
      const settingsIconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      settingsIconSvg.setAttribute('viewBox', '0 0 24 24');
      settingsIconSvg.setAttribute('fill', 'white');
      settingsIconSvg.setAttribute('width', '20');
      settingsIconSvg.setAttribute('height', '20');
      const settingsIconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      settingsIconPath.setAttribute('d', 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z');
      settingsIconSvg.appendChild(settingsIconPath);
      settingsIcon.appendChild(settingsIconSvg);

      sliderContainer.append(slider, volumePercent);

      // Create Find Song button
      const songIcon = document.createElement('div');
      songIcon.className = 'ig-song-icon';
      songIcon.title = 'Find Song';

      const songIconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      songIconSvg.setAttribute('viewBox', '0 0 24 24');
      songIconSvg.setAttribute('fill', 'white');
      songIconSvg.setAttribute('width', '20');
      songIconSvg.setAttribute('height', '20');
      const songIconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      songIconPath.setAttribute('d', 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z');
      songIconSvg.appendChild(songIconPath);
      songIcon.appendChild(songIconSvg);

      // Add click handler for song recognition
      songIcon.addEventListener('click', e => {
        e.stopPropagation();
        recognizeSong(video);
      });

      volumeWrapper.append(volumeIcon, sliderContainer, downloadIcon, songIcon, settingsIcon);

      const settings = getVideoSettings(video);
      settings.volume = defaultVolume;
      applyAllVideoSettings(video);

      setTimeout(() => updateVolumeUI(video), 50);

      const seekBar = createSeekBar(video, container);
      const advancedControls = createAdvancedControls(video);

      // Setup auto-scroll if enabled
      setupAutoScroll(video);

      const enforceVolumeOnPlay = () => {
        forceApplySettings(video);
        updateVolumeUI(video);
      };

      video.addEventListener('play', enforceVolumeOnPlay);
      video.addEventListener('playing', enforceVolumeOnPlay);
      video.addEventListener('loadeddata', enforceVolumeOnPlay);
      video.addEventListener('loadedmetadata', enforceVolumeOnPlay);
      video.addEventListener('canplay', enforceVolumeOnPlay);
      video.addEventListener('volumechange', () => {
        const settings = getVideoSettings(video);
        if (Math.abs(video.volume - settings.volume) > 0.01) {
          video.volume = settings.volume;
          video.muted = settings.volume === 0;
          updateVolumeUI(video);
        }
      });

      let hideTimeout;
      const showControls = () => {
        volumeWrapper.classList.add('visible');
        seekBar.classList.add('visible');
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => {
          if (!advancedControls.classList.contains('visible')) {
            volumeWrapper.classList.remove('visible');
            seekBar.classList.remove('visible');
          }
        }, 2500);
      };

      container.addEventListener('mouseenter', showControls);
      container.addEventListener('mousemove', showControls);
      video.addEventListener('mouseenter', showControls);
      video.addEventListener('mousemove', showControls);

      const keepControlsVisible = () => clearTimeout(hideTimeout);
      volumeWrapper.addEventListener('mouseenter', keepControlsVisible);
      seekBar.addEventListener('mouseenter', keepControlsVisible);

      settingsIcon.addEventListener('click', e => {
        e.stopPropagation();
        advancedControls.classList.toggle('visible');
        if (advancedControls.classList.contains('visible')) keepControlsVisible();
      });

      downloadIcon.addEventListener('click', e => {
        e.stopPropagation();
        const downloadBtn = advancedControls.querySelector('.ig-download-btn');
        if (downloadBtn && !downloadBtn.disabled) {
          const originalIconHTML = downloadIcon.innerHTML;
          downloadIcon.classList.add('downloading');

          // Create Material Design spinner
          const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          spinner.setAttribute('viewBox', '0 0 24 24');
          spinner.setAttribute('width', '20');
          spinner.setAttribute('height', '20');
          spinner.setAttribute('class', 'ig-spinner');

          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', '12');
          circle.setAttribute('cy', '12');
          circle.setAttribute('r', '10');
          circle.setAttribute('stroke', 'white');
          circle.setAttribute('stroke-width', '3');
          circle.setAttribute('fill', 'none');
          circle.setAttribute('stroke-linecap', 'round');

          spinner.appendChild(circle);

          downloadIcon.textContent = '';
          downloadIcon.appendChild(spinner);

          downloadBtn.click();

          setTimeout(() => {
            downloadIcon.classList.remove('downloading');
            const doc = new DOMParser().parseFromString(originalIconHTML, 'text/html');
            downloadIcon.replaceChildren(...doc.body.childNodes);
          }, 3000);
        }
      });

      document.addEventListener('click', e => {
        if (!advancedControls.contains(e.target) && !settingsIcon.contains(e.target)) {
          advancedControls.classList.remove('visible');
        }
      });

      slider.addEventListener('input', e => {
        const vol = e.target.value / 100;
        const settings = getVideoSettings(video);
        if (vol > 0) previousVolume = vol;
        settings.volume = vol;
        video.muted = false;
        video.volume = vol;
        if (vol === 0) video.muted = true;
        updateVolumeUI(video);
        chrome.storage.sync.set({ defaultVolume: vol });
      });

      volumeIcon.addEventListener('click', e => {
        e.stopPropagation();
        const settings = getVideoSettings(video);
        const newVolume = settings.volume > 0 ? 0 : previousVolume;
        settings.volume = newVolume;
        video.muted = newVolume === 0;
        video.volume = newVolume;
        updateVolumeUI(video);
        chrome.storage.sync.set({ defaultVolume: newVolume });
      });

      container.append(volumeWrapper, seekBar, advancedControls);

      const handleKeyboard = (e) => {
        // Don't intercept if user is typing in any editable element
        if (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable ||
          e.target.closest('[contenteditable="true"]') ||
          e.target.closest('[role="textbox"]')) {
          return;
        }

        // Don't handle space - it's handled by setupLongPressSpeed
        const handledKeys = ['arrowleft', 'arrowright', 'm'];
        if (handledKeys.includes(e.key.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
        }

        switch (e.key.toLowerCase()) {
          case 'arrowleft':
            video.currentTime = Math.max(0, video.currentTime - 5);
            break;
          case 'arrowright':
            video.currentTime = Math.min(video.duration, video.currentTime + 5);
            break;
          case 'm':
            volumeIcon.click();
            break;
        }
      };

      container.setAttribute('tabindex', '-1');
      container.addEventListener('keydown', handleKeyboard);

      // Setup 2x speed on long press
      setupLongPressSpeed(video, container);

      // Add click handler to video for pause/play
      // Note: setupLongPressSpeed also adds a click handler with capture:true
      // to prevent clicks after long press
      video.addEventListener('click', (e) => {
        // Don't interfere if clicking on controls
        if (e.target.closest('.ig-volume-control') ||
          e.target.closest('.ig-seekbar-container') ||
          e.target.closest('.ig-advanced-controls')) {
          return;
        }

        // Check if this was a long press - if so, ignore click
        if (container._longPressState && container._longPressState.wasLongPress) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return;
        }

        // This will only fire if not a long press (handled by setupLongPressSpeed)
        e.preventDefault();
        e.stopPropagation();

        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      });

      // Remove pointer cursor from video on home/post pages
      video.style.setProperty('cursor', 'default', 'important');

      setTimeout(() => {
        forceApplySettings(video);
        updateVolumeUI(video);
        updateControlsVisibility();
        // Enforce cursor again
        video.style.setProperty('cursor', 'default', 'important');
      }, 500);
    }, 150);
  };

  // If metadata is already loaded, create immediately
  if (video.readyState >= 1) {
    checkAndCreate();
  } else {
    // Otherwise wait for metadata
    video.addEventListener('loadedmetadata', checkAndCreate, { once: true });
    // Fallback timeout in case metadata never loads
    setTimeout(checkAndCreate, 500);
  }
}

function getVolumeIconElement(volume) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'white');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  if (volume === 0) {
    path.setAttribute('d', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
  } else if (volume < 0.5) {
    path.setAttribute('d', 'M7 9v6h4l5 5V4l-5 5H7z');
  } else {
    path.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z');
  }

  svg.appendChild(path);
  return svg;
}

function getVolumeIcon(volume) {
  // Keep this for backward compatibility but return string representation
  if (volume === 0) return `<svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
  if (volume < 0.5) return `<svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M7 9v6h4l5 5V4l-5 5H7z"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
}

const observer = new MutationObserver((mutations) => {
  hideDefaultMuteButtons();
  hideNavigationButtons();
  removeUploadControls();

  // Setup/update circle removal observer on Reels pages
  if (isReelsPage()) {
    setupCircleRemovalObserver();
    removeReelsCircle();
    setupAudioBadgeRemovalObserver(); // Setup audio badge removal observer
  } else {
    // Disconnect observers if we left Reels page
    if (circleObserver) {
      circleObserver.disconnect();
      circleObserver = null;
    }
    if (audioBadgeObserver) {
      audioBadgeObserver.disconnect();
      audioBadgeObserver = null;
    }
  }

  // Check if a dialog was added
  let dialogAdded = false;

  for (const mutation of mutations) {
    if (mutation.addedNodes.length) {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          // Check if this is a dialog
          if (node.getAttribute?.('role') === 'dialog' || node.querySelector?.('[role="dialog"]')) {
            dialogAdded = true;
          }

          if (node.tagName === 'VIDEO') {
            // Wait a bit to check if it's a GIF
            setTimeout(() => {
              if (!isGif(node)) {
                createVolumeControl(node);
                applyAllVideoSettings(node);
              }
            }, 100);
          }
          else node.querySelectorAll?.('video').forEach(v => {
            setTimeout(() => {
              if (!isGif(v)) {
                createVolumeControl(v);
                applyAllVideoSettings(v);
              }
            }, 100);
          });
        }
      });
    }
  }

  // If a dialog was added, do multiple checks with different delays
  if (dialogAdded) {
    // Immediately hide mute buttons in the dialog
    hideDefaultMuteButtons();

    // Immediate check
    setTimeout(() => {
      document.querySelectorAll('[role="dialog"] video').forEach(video => {
        if (!isGif(video) && !processedVideos.has(video)) {
          createVolumeControl(video);
          applyAllVideoSettings(video);
        }
      });
      hideDefaultMuteButtons();
    }, 100);

    // Second check
    setTimeout(() => {
      document.querySelectorAll('[role="dialog"] video').forEach(video => {
        if (!isGif(video) && !processedVideos.has(video)) {
          createVolumeControl(video);
          applyAllVideoSettings(video);
        }
      });
      hideDefaultMuteButtons();
    }, 500);

    // Third check for stubborn cases
    setTimeout(() => {
      document.querySelectorAll('[role="dialog"] video').forEach(video => {
        if (!isGif(video) && !processedVideos.has(video)) {
          createVolumeControl(video);
          applyAllVideoSettings(video);
        }
      });
      hideDefaultMuteButtons();
    }, 1000);
  }
});

observer.observe(document.body, { childList: true, subtree: true });

setTimeout(() => {
  document.querySelectorAll('video').forEach(video => {
    if (!isGif(video)) {
      createVolumeControl(video);
      applyAllVideoSettings(video);
    }
  });
  hideNavigationButtons();

  // Remove circle element and audio badge on Reels pages
  if (isReelsPage()) {
    removeReelsCircle();
    setupAudioBadgeRemovalObserver(); // Setup audio badge removal observer
  }
}, 1000);

// Additional check for post pages that load slowly
if (window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/')) {
  setTimeout(() => {
    document.querySelectorAll('video').forEach(video => {
      if (!isGif(video) && !processedVideos.has(video)) {
        createVolumeControl(video);
        applyAllVideoSettings(video);
      }
    });
  }, 2000);

  // Extra check for videos in dialogs/modals
  setTimeout(() => {
    document.querySelectorAll('[role="dialog"] video, article video').forEach(video => {
      if (!isGif(video) && !processedVideos.has(video)) {
        createVolumeControl(video);
        applyAllVideoSettings(video);
      }
    });
  }, 3000);
}

setInterval(() => {
  hideDefaultMuteButtons();
  hideNavigationButtons();
  removeUploadControls();

  // Setup/update circle removal observer on Reels pages
  if (isReelsPage()) {
    setupCircleRemovalObserver();
    removeReelsCircle();
    setupAudioBadgeRemovalObserver(); // Setup audio badge removal observer
  }

  // Check for dialog videos specifically
  document.querySelectorAll('[role="dialog"] video, [role="presentation"] video').forEach(video => {
    if (!isGif(video) && !processedVideos.has(video)) {
      createVolumeControl(video);
      applyAllVideoSettings(video);
    }
  });

  // Force default cursor on all videos
  document.querySelectorAll('video').forEach(video => {
    video.style.setProperty('cursor', 'default', 'important');
  });

  document.querySelectorAll('video').forEach(video => {
    // Remove controls from GIFs if they were added by mistake
    if (isGif(video)) {
      const container = video.closest('.ig-volume-control-container');
      if (container) {
        const controls = container.querySelectorAll('.ig-volume-control, .ig-seekbar-container, .ig-advanced-controls');
        controls.forEach(control => control.remove());
        container.classList.remove('ig-volume-control-container');
        processedVideos.delete(video);
      }
      return;
    }

    // Remove controls from upload flow videos (Cover photo, Trim, etc.)
    if (isInUploadFlow(video)) {
      const container = video.closest('.ig-volume-control-container');
      if (container) {
        const controls = container.querySelectorAll('.ig-volume-control, .ig-seekbar-container, .ig-advanced-controls');
        controls.forEach(control => control.remove());
        container.classList.remove('ig-volume-control-container');
        processedVideos.delete(video);
      }
      return;
    }

    // Try to add controls if they're missing (important for modals)
    if (!processedVideos.has(video) && !isGif(video)) {
      const hasControls = video.closest('.ig-volume-control-container')?.querySelector('.ig-volume-control');
      if (!hasControls) {
        createVolumeControl(video);
      }
    }

    if (processedVideos.has(video) && !isGif(video)) {
      // Don't force settings if long press is active
      const container = video.closest('.ig-volume-control-container');
      const isLongPressing = container?._longPressState?.isLongPressing;

      if (!isLongPressing) {
        forceApplySettings(video);
        updateVolumeUI(video);
      }
    }
  });
}, 500);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    setTimeout(() => {
      document.querySelectorAll('video').forEach(video => {
        if (processedVideos.has(video) && !isGif(video)) {
          // Don't force settings if long press is active
          const container = video.closest('.ig-volume-control-container');
          const isLongPressing = container?._longPressState?.isLongPressing;

          if (!isLongPressing) {
            forceApplySettings(video);
            updateVolumeUI(video);
          }
        }
      });
    }, 300);
  }
});

let scrollTimeout;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    document.querySelectorAll('video').forEach(video => {
      if (processedVideos.has(video) && !isGif(video)) {
        // Don't force settings if long press is active
        const container = video.closest('.ig-volume-control-container');
        const isLongPressing = container?._longPressState?.isLongPressing;

        if (!isLongPressing) {
          forceApplySettings(video);
          updateVolumeUI(video);
        }
      }
    });
  }, 200);
}, { passive: true });

// Listen for URL changes (when navigating to /p/ pages)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    // Reset auto-scroll lock on URL change
    isAutoScrolling = false;
    lastAutoScrollTime = 0;
    currentActiveVideo = null;
    updateReelsPageState();

    // URL changed, check for new videos after a delay
    setTimeout(() => {
      document.querySelectorAll('video').forEach(video => {
        if (!isGif(video) && !processedVideos.has(video)) {
          createVolumeControl(video);
          applyAllVideoSettings(video);
        }
        // Setup auto-scroll if on Reels page
        if (isReelsPage() && processedVideos.has(video)) {
          setupAutoScroll(video);
        }
        // Force cursor to default
        video.style.setProperty('cursor', 'default', 'important');
      });

      // Setup/update circle removal observer on Reels pages
      if (isReelsPage()) {
        setupCircleRemovalObserver();
        removeReelsCircle();
      }
    }, 500);

    // Extra check for dialogs
    if (url.includes('/p/') || url.includes('/reel/')) {
      setTimeout(() => {
        document.querySelectorAll('[role="dialog"] video, article video').forEach(video => {
          if (!isGif(video) && !processedVideos.has(video)) {
            createVolumeControl(video);
            applyAllVideoSettings(video);
          }
          // Force cursor to default
          video.style.setProperty('cursor', 'default', 'important');
        });
      }, 1000);
    }
  }
}).observe(document, { subtree: true, childList: true });

// Watch for style attribute changes on videos and enforce cursor
const cursorObserver = new MutationObserver((mutations) => {
  mutations.forEach(mutation => {
    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
      const video = mutation.target;
      if (video.tagName === 'VIDEO') {
        const currentCursor = video.style.cursor;
        if (currentCursor !== 'default') {
          video.style.setProperty('cursor', 'default', 'important');
        }
      }
    }
  });
});

// Observe all videos for style changes
document.querySelectorAll('video').forEach(video => {
  cursorObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
});

// Also observe new videos that get added
const videoAddObserver = new MutationObserver((mutations) => {
  mutations.forEach(mutation => {
    mutation.addedNodes.forEach(node => {
      if (node.tagName === 'VIDEO') {
        node.style.setProperty('cursor', 'default', 'important');
        cursorObserver.observe(node, { attributes: true, attributeFilter: ['style'] });
      } else if (node.querySelectorAll) {
        node.querySelectorAll('video').forEach(video => {
          video.style.setProperty('cursor', 'default', 'important');
          cursorObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
        });
      }
    });
  });
});

videoAddObserver.observe(document.body, { childList: true, subtree: true });