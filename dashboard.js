// Renders the "Extension Activity" panel in index.html. Only works when
// this page is opened as an extension page (chrome-extension://... URL),
// since chrome.storage is not available to a plain webpage served over
// http/https (e.g. via Live Server). Degrades gracefully otherwise.

const TIER_COLORS = {
  safe: 'var(--safe)',
  mild: 'var(--mild)',
  toxic: 'var(--toxic)',
  critical: 'var(--critical)',
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatTime(ts) {
  return new Date(ts).toLocaleString();
}

// ---- toast alerts: a hard-to-miss banner for new critical flags,
// shown in addition to (not instead of) the OS notification from
// background.js — this one is specifically for when you're already
// looking at the dashboard and might otherwise miss a quiet table update.
let toastContainer = null;
function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.style.cssText = `
    position:fixed;top:16px;right:16px;z-index:9999;
    display:flex;flex-direction:column;gap:10px;max-width:360px;
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
}

function showCriticalToast(entry) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.style.cssText = `
    background:var(--critical);color:#fff;padding:14px 16px;border-radius:10px;
    box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:13.5px;line-height:1.5;
    animation:slideIn .25s ease;cursor:pointer;
  `;
  toast.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px;">🚨 Critical content flagged</div>
    <div style="opacity:.9;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">"${escapeHtml((entry.detail || '').slice(0, 80))}"</div>
    <div style="opacity:.75;font-size:11.5px;margin-top:4px;">${escapeHtml(entry.pageTitle || entry.pageUrl || '')}</div>
  `;
  toast.addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 10000); // auto-dismiss after 10s
}

// keyframes for the slide-in animation, injected once
if (!document.getElementById('toastKeyframes')) {
  const style = document.createElement('style');
  style.id = 'toastKeyframes';
  style.textContent = `@keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
  document.head.appendChild(style);
}

let lastKnownLogLength = null; // null = not initialized yet

async function renderDashboard() {
  const statusEl = document.getElementById('dashboardStatus');
  const controlsEl = document.getElementById('dashboardControls');
  const wrapEl = document.getElementById('dashboardTableWrap');

  const isExtensionContext = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  if (!isExtensionContext) {
    statusEl.textContent = 'Not connected to the extension — open this page via the extension popup\'s "Open Dashboard" button to see live activity.';
    return;
  }

  const { moderationLog = [] } = await chrome.storage.local.get({ moderationLog: [] });

  // Detect newly-arrived entries since the last render and toast any
  // that are critical. Skipped on the very first render (lastKnownLogLength
  // === null) so opening the dashboard doesn't replay old alerts.
  if (lastKnownLogLength !== null && moderationLog.length > lastKnownLogLength) {
    moderationLog.slice(lastKnownLogLength).forEach(entry => {
      if (entry.verdict === 'critical') showCriticalToast(entry);
    });
  }
  lastKnownLogLength = moderationLog.length;

  if (moderationLog.length === 0) {
    statusEl.textContent = 'No flagged content yet. Browse with the extension active and check back here.';
    return;
  }

  statusEl.textContent = `${moderationLog.length} flagged item(s), most recent first.`;
  controlsEl.style.display = 'block';

  const rows = [...moderationLog].reverse().map(entry => `
    <tr style="border-bottom:1px solid #E3E8F5;">
      <td style="padding:8px 6px;white-space:nowrap;">${formatTime(entry.timestamp)}</td>
      <td style="padding:8px 6px;">${entry.type === 'image' ? 'Image' : 'Text'}</td>
      <td style="padding:8px 6px;">
        <span style="background:${TIER_COLORS[entry.verdict] || '#999'};color:#fff;padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:700;">
          ${entry.verdict.toUpperCase()}
        </span>
      </td>
      <td style="padding:8px 6px;">${entry.pct}%</td>
      <td style="padding:8px 6px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(entry.detail)}">${escapeHtml(entry.detail)}</td>
      <td style="padding:8px 6px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(entry.pageUrl)}">${escapeHtml(entry.pageTitle || entry.pageUrl)}</td>
    </tr>
  `).join('');

  wrapEl.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--navy);text-align:left;color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;">
            <th style="padding:8px 6px;">Time</th>
            <th style="padding:8px 6px;">Type</th>
            <th style="padding:8px 6px;">Verdict</th>
            <th style="padding:8px 6px;">Score</th>
            <th style="padding:8px 6px;">Detail</th>
            <th style="padding:8px 6px;">Page</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  // Extension pages (chrome-extension://...) cannot load code from a CDN —
  // this is an enforced Manifest V3 restriction, not something fixable via
  // the manifest. The text/image demo panels depend on CDN-loaded models,
  // so they can never work here; hide them and explain why, rather than
  // leaving a confusing "model unavailable" status showing.
  const isExtensionPage = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id
    && location.protocol === 'chrome-extension:';
  if (isExtensionPage) {
    const demoSection = document.getElementById('modelDemoSection');
    const notice = document.getElementById('extensionPageNotice');
    if (demoSection) demoSection.style.display = 'none';
    if (notice) notice.style.display = 'block';
  }

  renderDashboard();

  document.getElementById('clearLogBtn').addEventListener('click', async () => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ moderationLog: [] });
      renderDashboard();
    }
  });

  // Live-update if new items get flagged while the dashboard tab is open
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.moderationLog) renderDashboard();
    });
  }
});
