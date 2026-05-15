// Welcome page script
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', () => {
  const getStartedBtn = document.getElementById('getStartedBtn');
  
  getStartedBtn.addEventListener('click', () => {
    // Mark welcome as seen
    browserAPI.storage.local.set({ hasSeenWelcome: true }, () => {
      // Open Instagram
      browserAPI.tabs.create({
        url: 'https://www.instagram.com'
      });
      // Close welcome page
      window.close();
    });
  });
});

