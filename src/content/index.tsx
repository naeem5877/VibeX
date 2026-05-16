// VibeX - Instagram Enhanced Controls
// Modern TypeScript/React Content Script

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Music, X, Search, CheckCircle2, AlertCircle, Play, History, ExternalLink, Library, Disc, Calendar } from 'lucide-react';
import './styles.css';

// ==================== TYPES ====================
interface VideoSettings {
    volume: number;
    speed: number;
}

interface SongResult {
    success: boolean;
    title: string;
    artist: string;
    album?: string;
    label?: string;
    cover_art: string;
    genres?: string;
    release_date?: string;
    spotify_url?: string;
    apple_music_url?: string;
    youtube_music_url?: string;
    youtube_url?: string;
    shazam_url?: string;
}

// ==================== CONSTANTS ====================
const SHAZAM_API_URL = 'https://shazam-vibex-api.onrender.com/api/recognize';
const DOWNLOAD_API_URL = 'https://stingy-rachele-naeem-5b43a3bb.koyeb.app/api/data';

const PREVIEW_CONFIG = {
    width: 120,
    height: 214,
    debounceMs: 50,
    seekThreshold: 0.3,
    cacheFrames: 30
};
const AUTO_SCROLL_DEBOUNCE_MS = 2000;

// ==================== STATE ====================
let defaultVolume = 1.0;
let previousVolume = 1.0;
let playbackSpeed = 1.0;
let autoScroll = false;
let hideControls = false;
let isAutoScrolling = false;
let lastAutoScrollTime = 0;

const processedVideos = new WeakSet<HTMLVideoElement>();
const videoSettings = new WeakMap<HTMLVideoElement, VideoSettings>();
const recognizingVideos = new WeakSet<HTMLVideoElement>();
const autoScrollTimeouts = new WeakMap<HTMLVideoElement, number>();
const videoAutoScrollHandlers = new WeakMap<HTMLVideoElement, any>();
const videoFrameCache = new WeakMap<HTMLVideoElement, VideoCache>();
const videoPreviewElements = new WeakMap<HTMLVideoElement, any>();

interface CachedFrame {
    time: number;
    data: ImageData;
}

interface VideoCache {
    frames: CachedFrame[];
    duration: number;
    isCapturing: boolean;
    captureInterval: any;
    canvas: HTMLCanvasElement;
}

// ==================== PREVIEW & CACHING FUNCTIONS ====================
function initFrameCache(video: HTMLVideoElement): VideoCache {
    if (videoFrameCache.has(video)) return videoFrameCache.get(video)!;

    const cache: VideoCache = {
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

function captureFrameToCache(video: HTMLVideoElement, cache: VideoCache) {
    if (!video.videoWidth || !video.videoHeight || video.paused) return;

    try {
        const ctx = cache.canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

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

        const imageData = ctx.getImageData(0, 0, PREVIEW_CONFIG.width, PREVIEW_CONFIG.height);
        cache.frames.push({
            time: video.currentTime,
            data: imageData
        });
        cache.duration = video.duration;

        // Keep last N frames evenly distributed across the duration
        if (cache.frames.length > PREVIEW_CONFIG.cacheFrames * 2) {
            // Sort by time just in case
            cache.frames.sort((a, b) => a.time - b.time);

            const total = cache.frames.length;
            const target = PREVIEW_CONFIG.cacheFrames;
            const pruned: CachedFrame[] = [];

            for (let i = 0; i < target; i++) {
                // Ensure we pick the first, last, and evenly spaced ones in between
                const index = Math.floor(i * (total - 1) / (target - 1));
                pruned.push(cache.frames[index]);
            }
            cache.frames = pruned;
        }
    } catch (e) { }
}

function startFrameCapture(video: HTMLVideoElement) {
    const cache = initFrameCache(video);
    if (cache.isCapturing) return;

    cache.isCapturing = true;
    cache.captureInterval = setInterval(() => {
        if (!video.paused && video.readyState >= 2 && video.videoWidth) {
            captureFrameToCache(video, cache);
        }
    }, 300);

    video.addEventListener('play', () => {
        if (video.readyState >= 2) captureFrameToCache(video, cache);
    });
}

function stopFrameCapture(video: HTMLVideoElement) {
    const cache = videoFrameCache.get(video);
    if (cache && cache.captureInterval) {
        clearInterval(cache.captureInterval);
        cache.isCapturing = false;
    }
}

function getClosestCachedFrame(video: HTMLVideoElement, targetTime: number) {
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

function getOrCreatePreviewVideo(video: HTMLVideoElement) {
    if (videoPreviewElements.has(video)) return videoPreviewElements.get(video);

    const videoSrc = video.src || video.currentSrc;
    if (!videoSrc) return null;

    const previewData = {
        video: null as HTMLVideoElement | null,
        canvas: document.createElement('canvas'),
        lastSeekTime: -1,
        isReady: false,
        isSeeking: false,
        useFallback: false,
        mainVideo: video
    };

    previewData.canvas.width = PREVIEW_CONFIG.width;
    previewData.canvas.height = PREVIEW_CONFIG.height;

    const createCloneVideo = (withCrossOrigin = true) => {
        const previewVideo = document.createElement('video');
        previewVideo.src = videoSrc;
        previewVideo.muted = true;
        previewVideo.preload = 'auto';
        previewVideo.playsInline = true;
        if (withCrossOrigin) previewVideo.crossOrigin = 'anonymous';
        previewVideo.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999;';
        return previewVideo;
    };

    const previewVideo = createCloneVideo(true);
    previewData.video = previewVideo;
    document.body.appendChild(previewVideo);

    previewVideo.addEventListener('loadedmetadata', () => {
        previewData.isReady = true;
        previewData.useFallback = false;
    });

    previewVideo.addEventListener('error', () => {
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
                previewData.useFallback = true;
                previewData.isReady = true;
                noCorsVideo.remove();
            });
        } else {
            previewData.useFallback = true;
            previewData.isReady = true;
            previewVideo.remove();
        }
    });

    videoPreviewElements.set(video, previewData);
    return previewData;
}

async function seekPreviewVideo(previewData: any, time: number) {
    if (!previewData || !previewData.isReady || previewData.isSeeking) return false;
    if (Math.abs(previewData.lastSeekTime - time) < PREVIEW_CONFIG.seekThreshold) return true;

    previewData.isSeeking = true;
    previewData.lastSeekTime = time;

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
        video.currentTime = Math.max(0, Math.min(time, video.duration - 0.1));
        setTimeout(() => {
            previewData.isSeeking = false;
            resolve(false);
        }, 500);
    });
}

function capturePreviewFrame(previewData: any, targetCanvas: HTMLCanvasElement) {
    if (!previewData || !previewData.isReady) return false;
    const video = previewData.useFallback ? previewData.mainVideo : previewData.video;
    if (!video || !video.videoWidth || !video.videoHeight) return false;

    const ctx = previewData.canvas.getContext('2d');
    try {
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
        const targetCtx = targetCanvas.getContext('2d');
        if (targetCtx) targetCtx.drawImage(previewData.canvas, 0, 0);
        return true;
    } catch (err) { return false; }
}

function cleanupPreviewVideo(video: HTMLVideoElement) {
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

// ==================== ICON SVGs ====================
const Icons = {
    volumeHigh: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
    volumeLow: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 9v6h4l5 5V4l-5 5H7z"/></svg>`,
    volumeMute: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
    music: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`,
    pip: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/></svg>`,
    skipBack: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>`,
    skipForward: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>`,
    spinner: `<svg viewBox="0 0 24 24" class="vibex-spinner"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    fastForward: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 6v12l8.5-6L13 6zM4 18l8.5-6L4 6v12z"/></svg>`,
};

// ==================== UTILITY FUNCTIONS ====================
function getVideoSettings(video: HTMLVideoElement): VideoSettings {
    if (!videoSettings.has(video)) {
        videoSettings.set(video, {
            volume: defaultVolume,
            speed: playbackSpeed
        });
    }
    return videoSettings.get(video)!;
}

function forceApplySettings(video: HTMLVideoElement): void {
    if (!video) return;
    const settings = getVideoSettings(video);
    video.muted = false;
    video.volume = settings.volume;
    video.playbackRate = settings.speed;
    if (settings.volume === 0) {
        video.muted = true;
    }
}

function applyAllVideoSettings(video: HTMLVideoElement): void {
    if (!video) return;
    forceApplySettings(video);
    setTimeout(() => forceApplySettings(video), 100);
    setTimeout(() => forceApplySettings(video), 300);
}

function formatTime(seconds: number): string {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function isGif(video: HTMLVideoElement): boolean {
    const src = video.src || video.querySelector('source')?.src || '';
    if (src.includes('.gif') || src.includes('image/gif')) return true;
    const isDM = window.location.pathname.includes('/direct/');
    if (isDM) {
        if (video.duration && video.duration < 5) return true;
        if (video.videoWidth && video.videoHeight) {
            const area = video.videoWidth * video.videoHeight;
            if (area < 400 * 400 && video.duration < 10) return true;
        }
    }
    if (video.duration && video.duration < 3) return true;
    if (video.hasAttribute('loop') && video.duration && video.duration < 5) return true;
    return false;
}

function isReelsPage(): boolean {
    return window.location.pathname === '/reels/' || window.location.pathname.startsWith('/reels/');
}

function isInUploadFlow(video: HTMLVideoElement): boolean {
    if (!video) return false;
    const dialog = video.closest('[role="dialog"]');
    if (dialog) {
        const dialogText = dialog.textContent || '';
        if (dialogText.includes('Cover photo') || dialogText.includes('Trim') ||
            dialogText.includes('Select from computer') ||
            (dialogText.includes('Next') && dialogText.includes('Back')) ||
            dialogText.includes('Create new post') || dialogText.includes('New post')) {
            return true;
        }
        if (dialog.querySelector('[role="slider"]')) return true;
        const rect = video.getBoundingClientRect();
        if (rect.width < 150 && rect.height < 150) return true;
    }
    return false;
}

function getVolumeIcon(volume: number): string {
    if (volume === 0) return Icons.volumeMute;
    if (volume < 0.5) return Icons.volumeLow;
    return Icons.volumeHigh;
}

// ==================== LOAD SETTINGS ====================
chrome.storage.sync.get(['defaultVolume', 'playbackSpeed', 'autoScroll', 'hideControls'], (result: { [key: string]: unknown }) => {
    defaultVolume = typeof result.defaultVolume === 'number' ? result.defaultVolume : 1.0;
    previousVolume = defaultVolume > 0 ? defaultVolume : 1.0;
    playbackSpeed = typeof result.playbackSpeed === 'number' ? result.playbackSpeed : 1.0;
    autoScroll = typeof result.autoScroll === 'boolean' ? result.autoScroll : false;
    hideControls = typeof result.hideControls === 'boolean' ? result.hideControls : false;

    document.querySelectorAll('video').forEach((video) => {
        if (processedVideos.has(video as HTMLVideoElement)) {
            applyAllVideoSettings(video as HTMLVideoElement);
            updateVolumeUI(video as HTMLVideoElement);
            updateControlsVisibility();
            if (isReelsPage()) {
                setupAutoScroll(video as HTMLVideoElement);
            }
        }
    });
});

// ==================== STORAGE LISTENER ====================
chrome.storage.onChanged.addListener((changes: { [key: string]: chrome.storage.StorageChange }) => {
    if (changes.defaultVolume) {
        defaultVolume = changes.defaultVolume.newValue as number;
        previousVolume = defaultVolume > 0 ? defaultVolume : previousVolume;
        document.querySelectorAll('video').forEach((video) => {
            if (processedVideos.has(video as HTMLVideoElement)) {
                const settings = getVideoSettings(video as HTMLVideoElement);
                settings.volume = defaultVolume;
                applyAllVideoSettings(video as HTMLVideoElement);
                updateVolumeUI(video as HTMLVideoElement);
            }
        });
    }
    if (changes.playbackSpeed) {
        playbackSpeed = changes.playbackSpeed.newValue as number;
        document.querySelectorAll('video').forEach((video) => {
            if (processedVideos.has(video as HTMLVideoElement)) {
                const settings = getVideoSettings(video as HTMLVideoElement);
                settings.speed = playbackSpeed;
                (video as HTMLVideoElement).playbackRate = playbackSpeed;
                updateVolumeUI(video as HTMLVideoElement);
            }
        });
    }
    if (changes.autoScroll) {
        autoScroll = changes.autoScroll.newValue as boolean;
        if (!autoScroll) {
            isAutoScrolling = false;
            lastAutoScrollTime = 0;
            document.querySelectorAll('video').forEach((video) => {
                cleanupAutoScroll(video as HTMLVideoElement);
            });
        }
        document.querySelectorAll('video').forEach((video) => {
            if (processedVideos.has(video as HTMLVideoElement)) {
                updateVolumeUI(video as HTMLVideoElement);
                setupAutoScroll(video as HTMLVideoElement);
            }
        });
    }
    if (changes.hideControls) {
        hideControls = changes.hideControls.newValue as boolean;
        updateControlsVisibility();
    }
});

// ==================== UI UPDATE FUNCTIONS ====================
function updateVolumeUI(video: HTMLVideoElement): void {
    const container = findControlContainer(video);
    if (!container) return;

    const settings = getVideoSettings(video);
    const volumeIcon = container.querySelector('.vibex-volume-btn');
    const slider = container.querySelector('.vibex-volume-slider') as HTMLInputElement;
    const volumePercent = container.querySelector('.vibex-volume-percent');
    const speedButtons = container.querySelectorAll('.vibex-speed-btn');
    const autoScrollToggle = container.querySelector('.vibex-auto-scroll-toggle') as HTMLInputElement;

    if (volumeIcon) {
        volumeIcon.innerHTML = getVolumeIcon(settings.volume);
    }

    if (slider) {
        slider.value = String(settings.volume * 100);
        const percent = settings.volume * 100;
        slider.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${percent}%, rgba(255, 255, 255, 0.1) ${percent}%)`;
    }

    if (volumePercent) {
        volumePercent.textContent = Math.round(settings.volume * 100) + '%';
    }

    if (autoScrollToggle) {
        autoScrollToggle.checked = autoScroll;
    }

    if (speedButtons) {
        speedButtons.forEach((btn) => {
            btn.classList.toggle('active', parseFloat((btn as HTMLElement).dataset.speed || '1') === settings.speed);
        });
    }
}

function updateControlsVisibility(): void {
    const volumeControls = document.querySelectorAll('.vibex-volume-control');
    const advancedControls = document.querySelectorAll('.vibex-advanced-panel');
    const seekBars = document.querySelectorAll('.vibex-seekbar-container');

    volumeControls.forEach((control) => {
        (control as HTMLElement).style.display = hideControls ? 'none' : '';
    });

    advancedControls.forEach((control) => {
        (control as HTMLElement).style.display = hideControls ? 'none' : '';
    });

    seekBars.forEach((bar) => {
        (bar as HTMLElement).style.display = hideControls ? 'none' : '';
    });
}

// ==================== SONG RECOGNITION ====================
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

async function extractAudioFromVideo(video: HTMLVideoElement): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
        let audioContext: AudioContext | null = null;
        let stream: MediaStream | null = null;

        try {
            if (video.paused) {
                await video.play().catch(() => { });
            }

            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 44100
            });

            const blob = new Blob([RECORDER_WORKLET_CODE], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);
            await audioContext.audioWorklet.addModule(workletUrl);

            if ((video as any).captureStream) {
                stream = (video as any).captureStream();
            } else if ((video as any).mozCaptureStream) {
                stream = (video as any).mozCaptureStream();
            } else {
                throw new Error('Browser does not support audio capture');
            }

            const audioTracks = stream!.getAudioTracks();
            if (audioTracks.length === 0) {
                throw new Error('No audio track found in video');
            }

            const audioStream = new MediaStream(audioTracks);
            const source = audioContext.createMediaStreamSource(audioStream);
            const workletNode = new AudioWorkletNode(audioContext, 'recorder-processor');
            const audioBuffers: Float32Array[] = [];

            workletNode.port.onmessage = (event) => {
                audioBuffers.push(new Float32Array(event.data));
            };

            source.connect(workletNode);
            workletNode.connect(audioContext.destination);

            setTimeout(() => {
                try {
                    workletNode.disconnect();
                    source.disconnect();
                    audioTracks.forEach(track => track.stop());
                    audioContext!.close();
                    URL.revokeObjectURL(workletUrl);

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

                    const wavBlob = encodeWAV(combined, 44100);
                    resolve(wavBlob);
                } catch (error) {
                    reject(error);
                }
            }, 6000);
        } catch (error) {
            console.error('Audio extraction error:', error);
            if (audioContext) audioContext.close();
            reject(error);
        }
    });
}

function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

async function recognizeSong(video: HTMLVideoElement): Promise<void> {
    if (!video || recognizingVideos.has(video)) return;

    const container = findControlContainer(video) || video.parentElement;
    if (!container) return;

    try {
        recognizingVideos.add(video);
        showSongModal(container as HTMLElement, null, 'loading');

        const audioBlob = await extractAudioFromVideo(video);
        if (!audioBlob) throw new Error('Extraction failed');

        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.mp3');

        const response = await fetch(SHAZAM_API_URL, { method: 'POST', body: formData });
        if (!response.ok) throw new Error('API error');

        const result = await response.json();
        if (result.success) {
            showSongModal(container as HTMLElement, result as SongResult, 'success');
        } else {
            throw new Error('No match found');
        }
    } catch (error: any) {
        showSongModal(container as HTMLElement, null, 'error', error.message);
    } finally {
        recognizingVideos.delete(video);
    }
}

const SongResultUI: React.FC<{
    data: SongResult | null;
    state: 'loading' | 'success' | 'error';
    errorMsg?: string;
    onClose: () => void;
}> = ({ data, state, errorMsg, onClose }) => {
    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, scale: 0.8, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: 20 }}
                transition={{ type: "spring", stiffness: 450, damping: 30 }}
                className={`vibex-song-discovery-container-v2 ${state}`}
            >
                {state === 'loading' && (
                    <div className="vibex-card-content-loading-v3">
                        <div className="vibex-sonar-wrapper">
                            <motion.div
                                className="vibex-sonar-aura"
                                animate={{ opacity: [0.4, 0.8, 0.4], scale: [1, 1.05, 1] }}
                                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                            />
                            {[0, 0.6, 1.2].map((delay, i) => (
                                <motion.div
                                    key={i}
                                    className="vibex-sonar-ring"
                                    initial={{ scale: 0.8, opacity: 0 }}
                                    animate={{ scale: 2.5, opacity: [0, 1, 0] }}
                                    transition={{
                                        duration: 2,
                                        repeat: Infinity,
                                        ease: "easeOut",
                                        delay,
                                        times: [0, 0.2, 1]
                                    }}
                                />
                            ))}
                            <motion.div
                                animate={{ y: [0, -4, 0] }}
                                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                            >
                                <Music size={42} className="vibex-loading-icon-sonar" />
                            </motion.div>
                        </div>

                        <div className="vibex-loading-text-v3">
                            <motion.span
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="vibex-loading-title-v3"
                            >
                                Discovering...
                            </motion.span>
                            <motion.span
                                animate={{ opacity: [0.3, 0.6, 0.3] }}
                                transition={{ duration: 1.5, repeat: Infinity }}
                                className="vibex-loading-status-v3"
                            >
                                Scanning frequency
                            </motion.span>
                        </div>
                    </div>
                )}

                {state === 'success' && data && (
                    <div className="vibex-card-immersive-v2">
                        <img src={data.cover_art} alt={data.title} className="vibex-card-immersive-bg" />
                        <div className="vibex-card-immersive-overlay" />

                        <button onClick={onClose} className="vibex-immersive-close">
                            <X size={18} />
                        </button>

                        <div className="vibex-immersive-content">
                            <div className="vibex-immersive-info">
                                <motion.h4
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.1 }}
                                    className="vibex-immersive-title"
                                >
                                    {data.title}
                                </motion.h4>
                                <motion.span
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.2 }}
                                    className="vibex-immersive-artist"
                                >
                                    {data.artist}
                                </motion.span>
                            </div>

                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.3 }}
                                className="vibex-immersive-actions"
                            >
                                <div className="vibex-immersive-links">
                                    {data.spotify_url && (
                                        <a href={data.spotify_url} target="_blank" className="vibex-imm-btn spotify">
                                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2z" /></svg>
                                            <span>Spotify</span>
                                        </a>
                                    )}
                                    {data.youtube_url && (
                                        <a href={data.youtube_url} target="_blank" className="vibex-imm-btn youtube">
                                            <Play size={14} fill="currentColor" />
                                            <span>YouTube</span>
                                        </a>
                                    )}
                                </div>
                            </motion.div>
                        </div>
                    </div>
                )}

                {state === 'error' && (
                    <div className="vibex-card-content-error-v2">
                        <div className="vibex-error-icon-wrap-v2">
                            <AlertCircle size={32} />
                        </div>
                        <div className="vibex-error-info-v2">
                            <span className="vibex-error-title-v2">Matching failed</span>
                            <span className="vibex-error-desc-v2">{errorMsg || "We couldn't identify the audio."}</span>
                        </div>
                        <button onClick={onClose} className="vibex-error-close-v2">
                            <X size={18} />
                        </button>
                    </div>
                )}
            </motion.div>
        </AnimatePresence>
    );
};

function showSongModal(container: HTMLElement, data: SongResult | null, state: 'loading' | 'success' | 'error', errorMsg = ''): void {
    // If container is likely a narrow side panel, try to find the player root
    let target = container;
    if (container.clientWidth < 150) {
        const article = container.closest('article, [role="dialog"]');
        if (article) target = article as HTMLElement;
    }

    let rootEl = target.querySelector('.vibex-song-discovery-root');
    if (!rootEl) {
        rootEl = document.createElement('div');
        rootEl.className = 'vibex-song-discovery-root';
        target.appendChild(rootEl);
    }

    const root = createRoot(rootEl);
    const handleClose = () => {
        root.unmount();
        rootEl?.remove();
    };

    root.render(
        <SongResultUI
            data={data}
            state={state}
            errorMsg={errorMsg}
            onClose={handleClose}
        />
    );

    if (state !== 'loading') {
        setTimeout(handleClose, 8000);
    }
}

// ==================== DOWNLOAD ====================
// onDownloadStart: called when download begins (locks control bar open)
// onDownloadEnd: called when done (lets control bar auto-hide again)
async function downloadVideo(
    video: HTMLVideoElement,
    downloadBtn: HTMLElement,
    onDownloadStart?: () => void,
    onDownloadEnd?: (success: boolean) => void
): Promise<void> {
    const article = video.closest('article, [role="dialog"]');

    // Lock the control bar open
    onDownloadStart?.();
    downloadBtn.setAttribute('disabled', 'true');
    downloadBtn.classList.add('downloading');
    downloadBtn.setAttribute('data-phase', 'fetching');

    try {
        let downloadUrl: string;
        let username = 'video';
        const videoSrc = video.src || video.querySelector('source')?.src;

        if (videoSrc && !videoSrc.startsWith('blob:') && videoSrc.startsWith('http')) {
            downloadUrl = videoSrc;
        } else {
            const postUrl = getCanonicalPostUrl(video, article as Element);
            const apiUrl = `${DOWNLOAD_API_URL}?url=${encodeURIComponent(postUrl)}`;

            let response: Response | null = null;
            let retries = 0;
            const maxRetries = 3;

            while (retries < maxRetries) {
                try {
                    response = await fetch(apiUrl, {
                        method: 'GET',
                        headers: { 'Accept': 'application/json' },
                        mode: 'cors',
                        cache: 'no-cache',
                        credentials: 'omit'
                    });
                    if (response.ok) break;
                } catch (fetchError) {
                    retries++;
                    if (retries >= maxRetries) throw new Error('Network error');
                    await new Promise(resolve => setTimeout(resolve, 1000 * retries));
                }
            }

            if (!response || !response.ok) throw new Error('API request failed');

            const data = await response.json();
            if (!data.success || !data.media || data.media.length === 0)
                throw new Error('Could not fetch video data');

            let mediaIndex = 0;
            if (data.media.length > 1)
                mediaIndex = inferMediaIndexForPost(video, article as Element, data.media.length);

            const selectedMedia = data.media[Math.min(mediaIndex, data.media.length - 1)];
            if (!selectedMedia || !selectedMedia.url) throw new Error('No downloadable media found');

            downloadUrl = selectedMedia.url;
            username = selectedMedia.username || data.username || 'video';
        }

        downloadBtn.setAttribute('data-phase', 'downloading');

        try {
            const videoResponse = await fetch(downloadUrl, { method: 'GET', mode: 'cors', cache: 'no-cache' });
            if (!videoResponse.ok) throw new Error('Failed to fetch video');
            const blob = await videoResponse.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `instagram_${username}_${Date.now()}.mp4`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 100);
        } catch {
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `instagram_${username}_${Date.now()}.mp4`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => document.body.removeChild(a), 100);
        }

        downloadBtn.setAttribute('data-phase', 'success');
        downloadBtn.classList.remove('downloading');
        downloadBtn.classList.add('success');

        // After showing success, close the bar
        setTimeout(() => {
            onDownloadEnd?.(true);
        }, 1500);
    } catch (error: any) {
        alert('Unable to download this video. ' + (error.message || 'Please try again.'));
        downloadBtn.classList.remove('downloading');
        onDownloadEnd?.(false);
    } finally {
        setTimeout(() => {
            downloadBtn.removeAttribute('disabled');
            downloadBtn.removeAttribute('data-phase');
            downloadBtn.classList.remove('downloading', 'success');
        }, 2000);
    }
}

function getCanonicalPostUrl(video: HTMLVideoElement, article: Element | null): string {
    const absoluteMatch = window.location.href.match(/https:\/\/www\.instagram\.com\/(p|reel)\/[A-Za-z0-9_\-]+/i);
    if (absoluteMatch) return `${absoluteMatch[0].replace(/\/$/, '')}/`;

    const relativeMatch = window.location.pathname.match(/\/(p|reel)\/[A-Za-z0-9_\-]+/i);
    if (relativeMatch) return `https://www.instagram.com${relativeMatch[0].replace(/\/$/, '')}/`;

    if (!article && video) article = video.closest('article, [role="dialog"]');
    if (article) {
        const linkElement = article.querySelector('a[href*="/p/"], a[href*="/reel/"]');
        if (linkElement) {
            try {
                return new URL((linkElement as HTMLAnchorElement).href, window.location.origin).href.split('?')[0];
            } catch (e) { }
        }
    }

    return window.location.href.split('?')[0];
}

function inferMediaIndexForPost(video: HTMLVideoElement, article: Element | null, mediaLength: number): number {
    if (!video || mediaLength <= 1) return 0;
    const clampIndex = (idx: number) => Math.min(Math.max(idx, 0), mediaLength - 1);

    if (!article) article = video.closest('article, [role="dialog"]');
    if (article) {
        const indicator = article.querySelector('[aria-current="true"][aria-label*="slide" i]');
        if (indicator) {
            const label = indicator.getAttribute('aria-label') || '';
            const match = label.match(/slide\s+(\d+)/i);
            if (match) return clampIndex(parseInt(match[1], 10) - 1);
        }

        const videos = Array.from(article.querySelectorAll('video')).filter(v => v.clientWidth > 60 && v.clientHeight > 60);
        const idx = videos.indexOf(video);
        if (idx !== -1) return clampIndex(idx);
    }

    return 0;
}

// ==================== SEEKBAR ====================
function createSeekBar(video: HTMLVideoElement, container: Element): HTMLElement {
    const seekBarContainer = document.createElement('div');
    seekBarContainer.className = 'vibex-seekbar-container';

    const seekBarWrapper = document.createElement('div');
    seekBarWrapper.className = 'vibex-seekbar-wrapper';

    const previewTooltip = document.createElement('div');
    previewTooltip.className = 'vibex-preview-tooltip';
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = PREVIEW_CONFIG.width;
    previewCanvas.height = PREVIEW_CONFIG.height;
    previewCanvas.className = 'vibex-preview-canvas';

    const previewTime = document.createElement('div');
    previewTime.className = 'vibex-preview-time';
    previewTime.textContent = '0:00';

    const previewLoading = document.createElement('div');
    previewLoading.className = 'vibex-preview-loading';
    previewLoading.innerHTML = '<div class="vibex-preview-spinner"></div>';
    previewLoading.style.display = 'none';

    previewTooltip.appendChild(previewCanvas);
    previewTooltip.appendChild(previewTime);
    previewTooltip.appendChild(previewLoading);
    seekBarWrapper.appendChild(previewTooltip);

    const seekBarTrack = document.createElement('div');
    seekBarTrack.className = 'vibex-seekbar-track';
    const seekBarBg = document.createElement('div');
    seekBarBg.className = 'vibex-seekbar-bg';
    const bufferedBar = document.createElement('div');
    bufferedBar.className = 'vibex-seekbar-buffered';
    const progressBar = document.createElement('div');
    progressBar.className = 'vibex-seekbar-progress';

    seekBarBg.appendChild(bufferedBar);
    seekBarBg.appendChild(progressBar);

    const seekBar = document.createElement('input');
    seekBar.type = 'range';
    seekBar.min = '0';
    seekBar.max = '1000';
    seekBar.value = '0';
    seekBar.className = 'vibex-seekbar';

    seekBarTrack.appendChild(seekBarBg);
    seekBarTrack.appendChild(seekBar);
    seekBarWrapper.appendChild(seekBarTrack);
    seekBarContainer.appendChild(seekBarWrapper);

    let lastPreviewTime = -1;
    let debounceTimer: any = null;

    const initPreview = () => {
        startFrameCapture(video);
    };

    if (video.readyState >= 1) initPreview();
    else video.addEventListener('loadedmetadata', initPreview, { once: true });

    const updatePreviewPosition = (x: number) => {
        const rect = seekBarTrack.getBoundingClientRect();
        const tooltipActualWidth = PREVIEW_CONFIG.width + 20; // 120px canvas + 20px padding
        const halfWidth = tooltipActualWidth / 2;
        const margin = 10;

        let left = x - rect.left;
        // Clamp so the tooltip center stays within bounds that keep sides on screen
        left = Math.max(halfWidth + margin, Math.min(left, rect.width - halfWidth - margin));
        previewTooltip.style.left = `${left}px`;
    };

    const updatePreview = async (time: number, x: number) => {
        if (!video.duration) return;
        previewTime.textContent = formatTime(time);

        updatePreviewPosition(x);
        previewTooltip.classList.add('visible');

        if (Math.abs(lastPreviewTime - time) < PREVIEW_CONFIG.seekThreshold) return;
        lastPreviewTime = time;

        const cachedFrame = getClosestCachedFrame(video, time);
        if (cachedFrame) {
            const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
            if (ctx) ctx.putImageData(cachedFrame.data, 0, 0);
            return;
        }

        const previewData = getOrCreatePreviewVideo(video);
        if (previewData && previewData.isReady && !previewData.useFallback) {
            previewLoading.style.display = 'flex';
            const success = await seekPreviewVideo(previewData, time);
            if (success) {
                capturePreviewFrame(previewData, previewCanvas);
            }
            previewLoading.style.display = 'none';
        } else {
            try {
                const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
                if (ctx && video.videoWidth && video.videoHeight) {
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
                }
            } catch (e) { }
        }
    };

    const hidePreview = () => {
        lastPreviewTime = -1;
        previewTooltip.classList.remove('visible');
        if (debounceTimer) clearTimeout(debounceTimer);
    };

    seekBar.addEventListener('mousemove', (e) => {
        if (!video.duration) return;
        const rect = seekBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const time = percent * video.duration;

        // Visual updates should be instantaneous for smoothness
        previewTime.textContent = formatTime(time);
        updatePreviewPosition(e.clientX);
        previewTooltip.classList.add('visible');

        // Content update (thumbnail) is debounced
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            updatePreview(time, e.clientX);
        }, PREVIEW_CONFIG.debounceMs);
    });

    seekBar.addEventListener('mouseleave', hidePreview);
    seekBar.addEventListener('mouseenter', initPreview);

    const updateProgress = () => {
        if (!(seekBar as any).dragging && video.duration) {
            const progress = (video.currentTime / video.duration) * 1000;
            seekBar.value = String(progress || 0);
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

    seekBar.addEventListener('input', (e) => {
        if (video.duration) {
            const time = (Number((e.target as HTMLInputElement).value) / 1000) * video.duration;
            video.currentTime = time;
            progressBar.style.width = (Number((e.target as HTMLInputElement).value) / 10) + '%';
        }
    });

    seekBar.addEventListener('mousedown', () => { (seekBar as any).dragging = true; });
    seekBar.addEventListener('mouseup', () => { (seekBar as any).dragging = false; });

    return seekBarContainer;
}

// ==================== AUTO SCROLL ====================

function isSingleReelView(): boolean {
    const path = window.location.pathname;
    if (!path.startsWith('/reels/') || path === '/reels/') return false;
    const segments = path.split('/').filter(Boolean);
    return segments.length === 2 && segments[0] === 'reels';
}

function clickNativeNextReel(currentVideo: HTMLVideoElement): boolean {
    const selectors = [
        'button[aria-label*="Next" i]',
        '[role="button"][aria-label*="Next" i]',
        'button[aria-label*="next" i]',
        'svg[aria-label*="Next" i]',
        'div[aria-label*="Next" i]'
    ];

    const searchRoots: (Element | Document)[] = [];
    if (currentVideo) {
        const scopedContainer = currentVideo.closest('[role="presentation"], article, [data-visualcompletion], div');
        if (scopedContainer) searchRoots.push(scopedContainer);
    }
    searchRoots.push(document);

    for (const root of searchRoots) {
        for (const selector of selectors) {
            let nodes: NodeListOf<Element>;
            try {
                nodes = root.querySelectorAll(selector);
            } catch (_) {
                continue;
            }
            // Convertible using Array.from to iterate with checks
            const nodeList = Array.from(nodes);
            for (const node of nodeList) {
                const clickable = node.closest('button') || node.closest('[role="button"]') || node;
                if (!clickable) continue;
                if (clickable.closest('.vibex-volume-control') || clickable.closest('.vibex-advanced-panel')) continue;
                if (typeof (clickable as HTMLElement).offsetParent === 'undefined' || (clickable as HTMLElement).offsetParent === null) continue;
                (clickable as HTMLElement).click();
                return true;
            }
        }
    }

    return false;
}

function findNextVideo(currentVideo: HTMLVideoElement): HTMLVideoElement | null {
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
        if (isGif(video as HTMLVideoElement)) return false;
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
            video: video as HTMLVideoElement,
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

function setupAutoScroll(video: HTMLVideoElement): void {
    if (!video || !isReelsPage() || !autoScroll) {
        cleanupAutoScroll(video);
        return;
    }

    cleanupAutoScroll(video);
    let hasScrolledForThisVideo = false;

    const handlers: any = {};

    const performScroll = () => {
        if (isAutoScrolling) return;

        const now = Date.now();
        if ((now - lastAutoScrollTime) < AUTO_SCROLL_DEBOUNCE_MS) return;

        // Verify conditions
        if (!autoScroll || !isReelsPage() || !video || !document.body.contains(video)) return;

        // Only scroll if video has ended
        if (!video.ended) return;

        // Prevent duplicate scrolls for same video
        if (hasScrolledForThisVideo) return;

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

    handlers.onEnded = () => {
        if (video.ended && !hasScrolledForThisVideo) {
            performScroll();
        }
    };

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

    video.addEventListener('ended', handlers.onEnded);
    video.addEventListener('play', handlers.onPlay);
    video.addEventListener('timeupdate', handlers.onTimeUpdate);

    videoAutoScrollHandlers.set(video, handlers);
}

function cleanupAutoScroll(video: HTMLVideoElement): void {
    if (!video) return;
    const handlers = videoAutoScrollHandlers.get(video);
    if (handlers) {
        if (handlers.onEnded) video.removeEventListener('ended', handlers.onEnded);
        if (handlers.onPlay) video.removeEventListener('play', handlers.onPlay);
        if (handlers.onTimeUpdate) video.removeEventListener('timeupdate', handlers.onTimeUpdate);
        videoAutoScrollHandlers.delete(video);
    }
}

// ==================== ADVANCED CONTROLS PANEL ====================
function createAdvancedControls(video: HTMLVideoElement): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'vibex-advanced-panel';
    // Reposition for home feed vertical layout
    if (window.location.pathname === '/') {
        panel.style.top = 'auto';
        panel.style.bottom = '80px';
        panel.style.left = 'auto';
        panel.style.right = '16px';
        panel.style.transformOrigin = 'right bottom';
    }

    const settings = getVideoSettings(video);

    panel.innerHTML = `
    <div class="vibex-control-item">
      <span class="vibex-control-label">Speed</span>
      <div class="vibex-speed-buttons">
        ${[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => `
          <button class="vibex-speed-btn ${settings.speed === s ? 'active' : ''}" data-speed="${s}">${s}x</button>
        `).join('')}
      </div>
    </div>
    <div class="vibex-control-item" style="display:flex;justify-content:space-between;align-items:center;">
      <span class="vibex-control-label" style="margin-bottom:0;">Auto Scroll</span>
      <label class="vibex-switch">
        <input type="checkbox" class="vibex-auto-scroll-toggle" ${autoScroll ? 'checked' : ''}>
        <span class="vibex-switch-slider"></span>
      </label>
    </div>
    <div class="vibex-control-item">
      <span class="vibex-control-label">Skip</span>
      <div class="vibex-skip-buttons">
        <button class="vibex-skip-btn" data-skip="-10">${Icons.skipBack}10s</button>
        <button class="vibex-skip-btn" data-skip="-5">-5s</button>
        <button class="vibex-skip-btn" data-skip="5">+5s</button>
        <button class="vibex-skip-btn" data-skip="10">10s${Icons.skipForward}</button>
      </div>
    </div>
    <div class="vibex-control-item">
      <button class="vibex-action-btn vibex-pip-btn">${Icons.pip} Picture-in-Picture</button>
    </div>
    <div class="vibex-control-item" style="border:none;margin:0;padding:0;">
      <button class="vibex-action-btn vibex-panel-download-btn">${Icons.download} Download Video</button>
    </div>
  `;

    // Speed buttons
    panel.querySelectorAll('.vibex-speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = parseFloat((btn as HTMLElement).dataset.speed || '1');
            const s = getVideoSettings(video);
            s.speed = speed;
            video.playbackRate = speed;
            updateVolumeUI(video);
            chrome.storage.sync.set({ playbackSpeed: speed });
            panel.querySelectorAll('.vibex-speed-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Auto scroll
    panel.querySelector('.vibex-auto-scroll-toggle')?.addEventListener('change', (e) => {
        autoScroll = (e.target as HTMLInputElement).checked;
        chrome.storage.sync.set({ autoScroll });
        setupAutoScroll(video);
    });

    // Skip buttons
    panel.querySelectorAll('.vibex-skip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const skip = parseFloat((btn as HTMLElement).dataset.skip || '0');
            video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + skip));
        });
    });

    // PiP
    panel.querySelector('.vibex-pip-btn')?.addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await video.requestPictureInPicture();
            }
        } catch (err) { }
    });

    // Download
    panel.querySelector('.vibex-panel-download-btn')?.addEventListener('click', () => {
        downloadVideo(video, panel.querySelector('.vibex-panel-download-btn') as HTMLElement);
    });

    return panel;
}

// ==================== MAIN CONTROL CREATION ====================
const videoToOverlay = new WeakMap<HTMLVideoElement, HTMLElement>();
const overlaySyncers = new Set<() => void>();

function startOverlaySyncLoop() {
    if ((window as any).__vibexOverlaySyncing) return;
    (window as any).__vibexOverlaySyncing = true;
    
    const sync = () => {
        overlaySyncers.forEach(fn => fn());
        requestAnimationFrame(sync);
    };
    requestAnimationFrame(sync);
}

function getGlobalOverlayRoot(): HTMLElement {
    let root = document.getElementById('vibex-global-overlay-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'vibex-global-overlay-root';
        root.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483647;';
        document.body.appendChild(root);
        startOverlaySyncLoop();
    }
    return root;
}

function findControlContainer(video: HTMLVideoElement): Element | null {
    return videoToOverlay.get(video) || null;
}

const DynamicIsland: React.FC<{
    video: HTMLVideoElement;
    seekBar: HTMLElement;
    advancedPanel: HTMLElement;
    homeFeed?: boolean;
}> = ({ video, seekBar, advancedPanel, homeFeed = false }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [volume, setVolume] = useState(defaultVolume);
    const [downloadPhase, setDownloadPhase] = useState<'idle' | 'fetching' | 'downloading' | 'success'>('idle');
    const hideTimeoutRef = useRef<number | null>(null);
    const islandRef = useRef<HTMLDivElement>(null);
    const isDownloading = downloadPhase !== 'idle';

    const updateSettings = useCallback((newVol: number) => {
        const s = getVideoSettings(video);
        s.volume = newVol;
        video.muted = newVol === 0;
        video.volume = newVol;
        setVolume(newVol);
        chrome.storage.sync.set({ defaultVolume: newVol });
    }, [video]);

    useEffect(() => {
        const show = () => {
            setIsVisible(true);
            if (hideTimeoutRef.current) window.clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = window.setTimeout(() => {
                const isManualHover = islandRef.current?.parentElement?.matches(':hover') ||
                    advancedPanel.matches(':hover') ||
                    seekBar.matches(':hover');

                // Don't hide while downloading
                if (!isExpanded && !isPanelOpen && !isManualHover && !advancedPanel.classList.contains('visible') && !isDownloading) {
                    setIsVisible(false);
                } else {
                    hideTimeoutRef.current = window.setTimeout(show, 2000);
                }
            }, 3000);
        };

        // Use document-level mousemove with coordinate check to bypass Instagram's
        // invisible click-catcher divs that eat all mouseenter/mousemove on the video element.
        const handleGlobalMouseMove = (e: MouseEvent) => {
            const rect = video.getBoundingClientRect();
            if (
                rect.width > 0 &&
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top  && e.clientY <= rect.bottom
            ) {
                show();
            }
        };
        document.addEventListener('mousemove', handleGlobalMouseMove, { passive: true });

        return () => {
            document.removeEventListener('mousemove', handleGlobalMouseMove);
            if (hideTimeoutRef.current) window.clearTimeout(hideTimeoutRef.current);
        };
    }, [video, isExpanded, isPanelOpen, advancedPanel, seekBar, isDownloading]);

    // Sync visibility to manual DOM elements
    useEffect(() => {
        if (isVisible) {
            seekBar.classList.add('visible');
        } else {
            seekBar.classList.remove('visible');
            advancedPanel.classList.remove('visible');
            setIsPanelOpen(false);
        }
    }, [isVisible, seekBar, advancedPanel]);

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            const target = e.target as Node;
            const isInsideUI = islandRef.current?.contains(target) ||
                advancedPanel.contains(target) ||
                seekBar.contains(target);

            if (!isInsideUI && isVisible) {
                setIsVisible(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [advancedPanel, seekBar, isVisible]);

    useEffect(() => {
        const listener = (changes: any) => {
            if (changes.defaultVolume) setVolume(changes.defaultVolume.newValue);
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
    }, []);

    const handleMuteToggle = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const newVol = volume > 0 ? 0 : previousVolume;
        updateSettings(newVol);
    };

    const effectivelyExpanded = isExpanded || isPanelOpen || isDownloading;

    return (
        <AnimatePresence initial={false}>
            {isVisible && (
                <motion.div
                    ref={islandRef}
                    initial={{ opacity: 0, scale: 0.9, y: -6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -6 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className={`vibex-volume-control ${effectivelyExpanded ? 'expanded' : 'collapsed'}`}
                    onMouseEnter={() => setIsExpanded(true)}
                    onMouseLeave={() => setIsExpanded(false)}
                    style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
                >
                    <div className="vibex-island-inner">
                        <div className="vibex-main-actions">
                            <button
                                className="vibex-icon-btn vibex-volume-btn"
                                onClick={handleMuteToggle}
                                dangerouslySetInnerHTML={{ __html: getVolumeIcon(volume) }}
                            />
                        </div>

                        {effectivelyExpanded && (
                            <motion.div
                                initial={homeFeed ? { opacity: 0, height: 0 } : { opacity: 0, width: 0 }}
                                animate={homeFeed ? { opacity: 1, height: 'auto' } : { opacity: 1, width: 'auto' }}
                                exit={homeFeed ? { opacity: 0, height: 0 } : { opacity: 0, width: 0 }}
                                transition={{ duration: 0.2, ease: "easeInOut" }}
                                className="vibex-expanded-content"
                                style={homeFeed
                                    ? { display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden' }
                                    : { display: 'flex', alignItems: 'center', overflow: 'hidden' }
                                }
                            >
                                <div className="vibex-slider-container">
                                    <input
                                        type="range"
                                        min="0" max="100"
                                        value={volume * 100}
                                        onChange={(e) => {
                                            const val = Number(e.target.value) / 100;
                                            if (val > 0) previousVolume = val;
                                            updateSettings(val);
                                        }}
                                        className="vibex-volume-slider"
                                        {...(homeFeed ? { orient: 'vertical' } : {})}
                                        style={homeFeed ? {
                                            // Vertical gradient: bottom=low, top=high
                                            background: `linear-gradient(to top, #8b5cf6 0%, #a855f7 ${volume * 100}%, rgba(255, 255, 255, 0.1) ${volume * 100}%)`
                                        } : {
                                            background: `linear-gradient(to right, #8b5cf6 0%, #a855f7 ${volume * 100}%, rgba(255, 255, 255, 0.1) ${volume * 100}%)`
                                        }}
                                    />
                                    <span className="vibex-volume-percent">{Math.round(volume * 100)}%</span>
                                </div>
                                <div className="vibex-action-group">
                                    <button
                                        className={`vibex-icon-btn vibex-download-btn${downloadPhase !== 'idle' ? ` downloading ${downloadPhase}` : ''}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (downloadPhase !== 'idle') return;
                                            setDownloadPhase('fetching');
                                            setIsVisible(true);
                                            setIsExpanded(true);
                                            downloadVideo(
                                                video,
                                                e.currentTarget,
                                                () => { 
                                                    setDownloadPhase('fetching');
                                                },
                                                (success) => { 
                                                    setDownloadPhase('idle');
                                                    if (success) {
                                                        // Auto close on success
                                                        setIsVisible(false);
                                                        setIsExpanded(false);
                                                    }
                                                }
                                            );
                                        }}
                                        title={downloadPhase === 'fetching' ? 'Fetching...' : downloadPhase === 'downloading' ? 'Downloading...' : downloadPhase === 'success' ? 'Done!' : 'Download Video'}
                                    >
                                        {downloadPhase === 'idle' && <span dangerouslySetInnerHTML={{ __html: Icons.download }} />}
                                        {(downloadPhase === 'fetching' || downloadPhase === 'downloading') && (
                                            <span className="vibex-dl-spinner" title={downloadPhase}>
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                                    <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.15)" />
                                                    <path d="M12 3 a9 9 0 0 1 9 9" stroke={downloadPhase === 'fetching' ? '#a855f7' : '#22d3ee'} />
                                                </svg>
                                            </span>
                                        )}
                                        {downloadPhase === 'success' && <span dangerouslySetInnerHTML={{ __html: Icons.check }} />}
                                    </button>
                                    <button
                                        className="vibex-icon-btn vibex-song-btn"
                                        onClick={(e) => { e.stopPropagation(); recognizeSong(video); }}
                                        title="Recognize Song"
                                    >
                                        <span dangerouslySetInnerHTML={{ __html: Icons.music }} />
                                    </button>
                                    <button
                                        className="vibex-icon-btn vibex-settings-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const isOpen = advancedPanel.classList.toggle('visible');
                                            setIsPanelOpen(isOpen);
                                        }}
                                        title="Advanced Controls"
                                    >
                                        <span dangerouslySetInnerHTML={{ __html: Icons.settings }} />
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// Track videos that are pending overlay creation to prevent duplicates
const pendingVideos = new WeakSet<HTMLVideoElement>();

function isHomeFeed(): boolean {
    return window.location.pathname === '/';
}

function createVolumeControl(video: HTMLVideoElement): void {
    if (window.location.pathname.includes('/stories/')) return;
    if (isGif(video)) return;
    if (isInUploadFlow(video)) return;
    if (processedVideos.has(video)) return;
    if (pendingVideos.has(video)) return; // Prevent duplicate from loadedmetadata + 500ms timeout both firing

    pendingVideos.add(video);

    const checkAndCreate = () => {
        if (isGif(video)) return;
        if (isInUploadFlow(video)) return;

        setTimeout(() => {
            pendingVideos.delete(video);
            if (processedVideos.has(video)) return;
            processedVideos.add(video);

            const root = getGlobalOverlayRoot();

            const videoOverlay = document.createElement('div');
            // Add home-feed class so CSS can reposition controls to bottom-right
            videoOverlay.className = isHomeFeed()
                ? 'vibex-control-container vibex-home-feed'
                : 'vibex-control-container';
            videoOverlay.style.cssText = 'pointer-events: none; opacity: 1;';
            videoOverlay.style.setProperty('position', 'absolute', 'important');
            root.appendChild(videoOverlay);
            videoToOverlay.set(video, videoOverlay);

            // Hide controls during page scroll using scroll events
            // (avoids per-frame motion detection which caused permanent opacity:0 bug)
            let scrollTimer: number | null = null;
            const onScroll = () => {
                videoOverlay.style.opacity = '0';
                if (scrollTimer) clearTimeout(scrollTimer);
                scrollTimer = window.setTimeout(() => {
                    const r = video.getBoundingClientRect();
                    if (r.bottom > 0 && r.top < window.innerHeight) {
                        videoOverlay.style.opacity = '1';
                    }
                }, 150);
            };
            window.addEventListener('scroll', onScroll, { passive: true, capture: true });

            const syncFn = () => {
                if (!document.body.contains(video)) {
                    videoOverlay.remove();
                    overlaySyncers.delete(syncFn);
                    processedVideos.delete(video);
                    videoToOverlay.delete(video);
                    window.removeEventListener('scroll', onScroll, { capture: true });
                    return;
                }
                const rect = video.getBoundingClientRect();
                const isOffscreen = rect.width < 50 || rect.height < 50 ||
                    rect.bottom < 0 || rect.top > window.innerHeight ||
                    rect.right < 0 || rect.left > window.innerWidth;

                videoOverlay.style.setProperty('visibility', isOffscreen ? 'hidden' : 'visible');
                videoOverlay.style.top    = `${rect.top}px`;
                videoOverlay.style.left   = `${rect.left}px`;
                videoOverlay.style.width  = `${rect.width}px`;
                videoOverlay.style.height = `${rect.height}px`;
            };

            overlaySyncers.add(syncFn);

            const seekBar = createSeekBar(video, videoOverlay);
            const advancedPanel = createAdvancedControls(video);

            const volumeWrapper = document.createElement('div');
            const reactRoot = createRoot(volumeWrapper);
            reactRoot.render(<DynamicIsland video={video} seekBar={seekBar} advancedPanel={advancedPanel} homeFeed={isHomeFeed()} />);

            applyAllVideoSettings(video);
            setupAutoScroll(video);

            video.addEventListener('play',          () => forceApplySettings(video));
            video.addEventListener('playing',       () => forceApplySettings(video));
            video.addEventListener('loadeddata',    () => forceApplySettings(video));
            video.addEventListener('loadedmetadata',() => forceApplySettings(video));

            video.style.setProperty('cursor', 'default', 'important');
            videoOverlay.append(volumeWrapper, seekBar, advancedPanel);
        }, 150);
    };

    if (video.readyState >= 1) checkAndCreate();
    else {
        // Use { once: true } so the listener auto-removes; 500ms fallback handles preload="none" videos
        video.addEventListener('loadedmetadata', checkAndCreate, { once: true });
        setTimeout(() => {
            // Only fire if loadedmetadata hasn't already handled it
            if (pendingVideos.has(video)) checkAndCreate();
        }, 500);
    }
}

function updateReelsPageState(): void {
    if (isReelsPage()) {
        document.documentElement.classList.add('vibex-on-reels');
    } else {
        document.documentElement.classList.remove('vibex-on-reels');
    }
}

// ==================== OBSERVERS ====================
const observer = new MutationObserver((mutations) => {
    updateReelsPageState();

    for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
            if ((node as Element).nodeType === 1) {
                if ((node as Element).tagName === 'VIDEO') {
                    setTimeout(() => {
                        if (!isGif(node as HTMLVideoElement)) {
                            createVolumeControl(node as HTMLVideoElement);
                            applyAllVideoSettings(node as HTMLVideoElement);
                        }
                    }, 100);
                } else {
                    (node as Element).querySelectorAll?.('video').forEach((v: HTMLVideoElement) => {
                        setTimeout(() => {
                            if (!isGif(v)) {
                                createVolumeControl(v);
                                applyAllVideoSettings(v);
                            }
                        }, 100);
                    });
                }
            }
        });
    }
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial setup
setTimeout(() => {
    document.querySelectorAll('video').forEach((video) => {
        if (!isGif(video as HTMLVideoElement)) {
            createVolumeControl(video as HTMLVideoElement);
            applyAllVideoSettings(video as HTMLVideoElement);
        }
    });
    updateReelsPageState();
}, 1000);

// URL change listener
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        isAutoScrolling = false;
        lastAutoScrollTime = 0;
        updateReelsPageState();

        setTimeout(() => {
            document.querySelectorAll('video').forEach((video) => {
                const v = video as HTMLVideoElement;
                if (!isGif(v) && !processedVideos.has(v)) {
                    createVolumeControl(v);
                    applyAllVideoSettings(v);
                }
                if (isReelsPage() && processedVideos.has(v)) {
                    setupAutoScroll(v);
                }
            });
        }, 500);
    }
}).observe(document, { subtree: true, childList: true });

// Periodic check
setInterval(() => {
    document.querySelectorAll('video').forEach((video) => {
        const v = video as HTMLVideoElement;
        if (isGif(v) || isInUploadFlow(v)) {
            const container = findControlContainer(v);
            if (container) {
                container.remove();
                videoToOverlay.delete(v);
                stopFrameCapture(v);
                cleanupPreviewVideo(v);
                processedVideos.delete(v);
            }
            return;
        }

        if (!processedVideos.has(v) && !isGif(v)) {
            createVolumeControl(v);
        }

        if (processedVideos.has(v) && !isGif(v)) {
            forceApplySettings(v);
            updateVolumeUI(v);
        }
    });
}, 500);

console.log('VibeX - Instagram Enhanced Controls loaded successfully! 🎉');

// ==================== KEYBOARD HANDLING & SPEED CONTROL ====================

// Global state for keyboard long press
const globalKeyboardState = {
    isSpacePressed: false,
    longPressTimer: null as any,
    isLongPressing: false,
    originalSpeed: 1.0,
    speedInterval: null as any
};

let globalKeyboardHandlersAttached = false;

function attachGlobalKeyboardHandlers() {
    if (globalKeyboardHandlersAttached) return;
    globalKeyboardHandlersAttached = true;

    // Prevent scroll when space is pressed
    const preventScroll = (e: Event) => {
        if (globalKeyboardState.isSpacePressed) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    };

    // Keyboard handling (Space) - USE CAPTURE PHASE to prevent scrolling
    const handleKeyDown = (e: KeyboardEvent) => {
        // Don't intercept if user is typing in any editable element
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable ||
            target.closest('[contenteditable="true"]') ||
            target.closest('[role="textbox"]')) {
            return;
        }

        if (e.code === 'Space') {
            // CRITICAL: Prevent default IMMEDIATELY to stop scrolling
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Track that space is pressed
            if (!globalKeyboardState.isSpacePressed) {
                globalKeyboardState.isSpacePressed = true;

                // Find the currently active/visible video
                const activeVideo = findActiveVideo();
                if (!activeVideo) return;

                globalKeyboardState.longPressTimer = setTimeout(() => {
                    startGlobalSpeedup(activeVideo);
                }, 200); // 200ms hold to trigger speed up
            }
        }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
        // Don't intercept if user is typing
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable ||
            target.closest('[contenteditable="true"]') ||
            target.closest('[role="textbox"]')) {
            return;
        }

        if (e.code === 'Space') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            globalKeyboardState.isSpacePressed = false;
            clearTimeout(globalKeyboardState.longPressTimer);

            const activeVideo = findActiveVideo();
            if (!activeVideo) return;

            if (globalKeyboardState.isLongPressing) {
                // Was holding - stop speedup, don't toggle pause
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

function startGlobalSpeedup(video: HTMLVideoElement) {
    if (globalKeyboardState.isLongPressing) return;
    if (!video) return;

    globalKeyboardState.isLongPressing = true;

    // Store original speed
    const settings = getVideoSettings(video);
    globalKeyboardState.originalSpeed = settings ? settings.speed : video.playbackRate;

    // If paused, play it
    if (video.paused) {
        video.play().catch(() => { });
    }

    // Set to 2x initial
    video.playbackRate = 2.0;

    // Start enforcement loop
    clearInterval(globalKeyboardState.speedInterval);
    globalKeyboardState.speedInterval = setInterval(() => {
        if (!video.paused && video.playbackRate !== 2.0) {
            video.playbackRate = 2.0;
        }
    }, 100);

    // Show overlay
    const container = findControlContainer(video);
    if (container) {
        showSpeedOverlay(container as HTMLElement);
    }
}

function stopGlobalSpeedup(video: HTMLVideoElement) {
    if (!globalKeyboardState.isLongPressing) return;
    globalKeyboardState.isLongPressing = false;

    // Stop enforcement
    clearInterval(globalKeyboardState.speedInterval);

    // Restore original speed
    const settings = getVideoSettings(video);
    if (settings) {
        video.playbackRate = settings.speed;
    } else {
        video.playbackRate = globalKeyboardState.originalSpeed || 1.0;
    }

    // Hide overlay
    const container = findControlContainer(video);
    if (container) {
        hideSpeedOverlay(container as HTMLElement);
    }
}

function showSpeedOverlay(container: HTMLElement) {
    let overlay = container.querySelector('.vibex-speed-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'vibex-speed-overlay';
        overlay.innerHTML = `
            <div class="vibex-speed-arrows">
                <div class="vibex-speed-arrow"></div>
                <div class="vibex-speed-arrow"></div>
                <div class="vibex-speed-arrow"></div>
            </div>
            <div class="vibex-speed-badge">
                <div class="vibex-speed-value">2X</div>
                <div class="vibex-speed-label">SPEED</div>
            </div>
        `;
        container.appendChild(overlay);
    }
    // Force reflow
    void (overlay as HTMLElement).offsetWidth;
    overlay.classList.add('visible');
}

function hideSpeedOverlay(container: HTMLElement) {
    const overlay = container.querySelector('.vibex-speed-overlay');
    if (overlay) {
        overlay.classList.remove('visible');
        // Optional: Remove from DOM after transition
        setTimeout(() => {
            if (!overlay.classList.contains('visible')) {
                overlay.remove();
            }
        }, 300);
    }
}

function findActiveVideo(): HTMLVideoElement | null {
    const videos = Array.from(document.querySelectorAll('video')).filter(v => {
        // Exclude likely non-content videos if needed, but for now include all visible
        if (!isElementInViewport(v as HTMLElement)) return false;
        const rect = v.getBoundingClientRect();
        return rect.width > 50 && rect.height > 50;
    });

    if (videos.length === 0) return null;

    // 1. Prioritize playing video
    const playingVideo = videos.find(v => !v.paused && v.readyState > 2);
    if (playingVideo) return playingVideo;

    // 2. Fallback: Find the video closest to the center of the viewport
    const viewportCenter = window.innerHeight / 2;
    let closestVideo: HTMLVideoElement | null = null;
    let minDistance = Infinity;

    videos.forEach(video => {
        const rect = video.getBoundingClientRect();
        const videoCenter = rect.top + rect.height / 2;
        const distance = Math.abs(videoCenter - viewportCenter);

        if (distance < minDistance) {
            minDistance = distance;
            closestVideo = video;
        }
    });

    return closestVideo;
}

function isElementInViewport(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}

// Initialize handlers
attachGlobalKeyboardHandlers();

// ==================== UPDATE CHECKER ====================

const UpdatePopup: React.FC<{
    version: string;
    onClose: () => void;
}> = ({ version, onClose }) => {
    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.9 }}
                className="vibex-update-popup-container"
            >
                <div className="vibex-update-popup-content">
                    <button onClick={onClose} className="vibex-update-close">
                        <X size={18} />
                    </button>
                    <div className="vibex-update-icon">🚀</div>
                    <h3 className="vibex-update-title">VibeX Update Available</h3>
                    <p className="vibex-update-desc">
                        Version <strong>{version}</strong> has launched!
                    </p>
                    <div className="vibex-update-browsers">
                        <p><strong>Chrome / Brave:</strong> You are on an older version. Please manually check or reinstall to update.</p>
                        <p><strong>Edge / Firefox:</strong> Ignore this message, the update will be added soon. You will receive it automatically.</p>
                    </div>
                    <a href="https://github.com/naeem5877/VibeX/releases/latest" target="_blank" className="vibex-update-btn">
                        View Release Notes
                    </a>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

function compareVersions(v1: string, v2: string) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

async function checkForUpdates() {
    try {
        const res = await fetch('https://api.github.com/repos/naeem5877/VibeX/releases/latest');
        if (!res.ok) return;
        const data = await res.json();
        const latestVersion = data.tag_name ? data.tag_name.replace('v', '') : null;
        if (!latestVersion) return;
        
        const currentVersion = chrome.runtime.getManifest().version;
        if (latestVersion !== currentVersion && compareVersions(latestVersion, currentVersion) > 0) {
            const root = getGlobalOverlayRoot();
            const wrapper = document.createElement('div');
            root.appendChild(wrapper);
            const reactRoot = createRoot(wrapper);
            
            const closePopup = () => {
                reactRoot.unmount();
                wrapper.remove();
            };
            
            reactRoot.render(<UpdatePopup version={latestVersion} onClose={closePopup} />);
        }
    } catch (e) {
        console.error("VibeX: Update check failed", e);
    }
}

setTimeout(checkForUpdates, 3000);
