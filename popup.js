const toggle = document.getElementById('toggle');

chrome.storage.local.get({ moderationEnabled: true }).then(({ moderationEnabled }) => {
  toggle.checked = moderationEnabled;
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ moderationEnabled: toggle.checked });
});

document.getElementById('openDashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

// Treat opening the popup as "seen" — resets the critical-flag badge count.
chrome.runtime.sendMessage({ type: 'clearBadge' }).catch(() => {});
