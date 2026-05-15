// VibeX Popup Script
document.addEventListener('DOMContentLoaded', () => {
    // Get all elements
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    const speedButtons = document.querySelectorAll('.speed-btn');
    const autoScrollToggle = document.getElementById('autoScrollToggle');
    const resetBtn = document.getElementById('resetBtn');
    const shortcutsToggle = document.getElementById('shortcutsToggle');
    const shortcutsContent = document.getElementById('shortcutsContent');

    // Shortcuts Toggle Handler
    shortcutsToggle.addEventListener('click', () => {
        shortcutsToggle.classList.toggle('expanded');
        shortcutsContent.classList.toggle('collapsed');
    });

    // Load saved settings
    chrome.storage.sync.get(['defaultVolume', 'playbackSpeed', 'autoScroll'], (result) => {
        // Volume
        const volume = result.defaultVolume !== undefined ? result.defaultVolume : 1.0;
        volumeSlider.value = volume * 100;
        volumeValue.textContent = Math.round(volume * 100) + '%';

        // Speed
        const speed = result.playbackSpeed || 1.0;
        speedButtons.forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
        });

        // Auto Scroll
        autoScrollToggle.checked = result.autoScroll || false;
    });

    // Volume Slider
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        volumeValue.textContent = e.target.value + '%';
        chrome.storage.sync.set({ defaultVolume: volume });
    });

    // Speed Buttons
    speedButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = parseFloat(btn.dataset.speed);
            speedButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            chrome.storage.sync.set({ playbackSpeed: speed });
        });
    });

    // Auto Scroll Toggle
    autoScrollToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ autoScroll: e.target.checked });
    });

    // Reset Button
    resetBtn.addEventListener('click', () => {
        // Reset to defaults
        const defaults = {
            defaultVolume: 1.0,
            playbackSpeed: 1.0,
            autoScroll: false
        };

        chrome.storage.sync.set(defaults, () => {
            // Update UI
            volumeSlider.value = 100;
            volumeValue.textContent = '100%';
            speedButtons.forEach(btn => {
                btn.classList.toggle('active', parseFloat(btn.dataset.speed) === 1.0);
            });
            autoScrollToggle.checked = false;

            // Show feedback
            resetBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2"/></svg> Reset!';
            resetBtn.style.background = 'rgba(52, 199, 89, 0.25)';
            resetBtn.style.color = '#34c759';
            resetBtn.style.borderColor = 'rgba(52, 199, 89, 0.5)';

            setTimeout(() => {
                resetBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" stroke="currentColor" stroke-width="2"/><path d="M21 3v5h-5" stroke="currentColor" stroke-width="2"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" stroke="currentColor" stroke-width="2"/><path d="M3 21v-5h5" stroke="currentColor" stroke-width="2"/></svg> Reset to Default';
                resetBtn.style.background = '';
                resetBtn.style.color = '';
                resetBtn.style.borderColor = '';
            }, 2000);
        });
    });
});