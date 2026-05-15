// VibeX Background Script
// Handles extension install and update events

const CURRENT_VERSION = '2.10.0';

// Use browser API if available (Firefox), otherwise use chrome (Chrome/Edge)
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Install/Update handler
function handleInstalled(details) {
  if (details.reason === 'install') {
    // First time installation - show welcome
    browserAPI.storage.local.set({
      lastVersion: CURRENT_VERSION,
      hasSeenWelcome: false
    }, () => {
      browserAPI.tabs.create({
        url: browserAPI.runtime.getURL('welcome.html')
      });
    });
  } else if (details.reason === 'update') {
    // Extension updated - show update log
    browserAPI.storage.local.get(['lastVersion'], (result) => {
      const previousVersion = result.lastVersion || '0.0.0';
      
      if (previousVersion !== CURRENT_VERSION) {
        browserAPI.storage.local.set({
          lastVersion: CURRENT_VERSION,
          previousVersion: previousVersion,
          hasSeenUpdate: false
        }, () => {
          browserAPI.tabs.create({
            url: browserAPI.runtime.getURL('update.html')
          });
        });
      }
    });
  }
}

// Listen for install/update events
browserAPI.runtime.onInstalled.addListener(handleInstalled);

