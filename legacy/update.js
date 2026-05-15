// Update page script
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('closeBtn');
  
  closeBtn.addEventListener('click', () => {
    // Mark update as seen
    browserAPI.storage.local.set({ hasSeenUpdate: true }, () => {
      // Close update page
      window.close();
    });
  });
});

