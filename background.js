// Background service worker. Content scripts cannot call chrome.notifications
// directly, so content.js sends a message here whenever something gets
// flagged as critical, and this shows the actual OS-level notification.
// Also maintains a badge count on the extension icon so you can see at a
// glance how many critical items have piled up since you last opened the
// dashboard/popup.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'criticalFlag') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'Critical content flagged',
      message: `${message.pageTitle || message.pageUrl}\n"${(message.detail || '').slice(0, 120)}"`,
      priority: 2,
    });

    chrome.storage.local.get({ criticalBadgeCount: 0 }).then(({ criticalBadgeCount }) => {
      const next = criticalBadgeCount + 1;
      chrome.storage.local.set({ criticalBadgeCount: next });
      chrome.action.setBadgeText({ text: String(next) });
      chrome.action.setBadgeBackgroundColor({ color: '#B00020' });
    });
  }

  if (message.type === 'clearBadge') {
    chrome.storage.local.set({ criticalBadgeCount: 0 });
    chrome.action.setBadgeText({ text: '' });
  }

  return false;
});
