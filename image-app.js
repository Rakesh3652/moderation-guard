// Wires up the "Image Moderation" section added to index.html.
// Uses image-moderation.js (NSFW + OCR) and text-score-lib.js (scores any
// text found inside the image) — same modules used in demo.html.

import { loadNsfwModel, loadOcrWorker, moderateImage } from './image-moderation.js';
import { scoreTextForImage } from './text-score-lib.js';

const statusEl = document.getElementById('imgStatus');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('imgFileInput');
const preview = document.getElementById('imgPreview');
const resultsEl = document.getElementById('imgResults');

// Extension pages (chrome-extension://...) can't load CDN-hosted models —
// a Manifest V3 platform restriction, not a bug. Skip entirely rather
// than attempting a load that will only fail.
const isExtensionPage = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id
  && location.protocol === 'chrome-extension:';

if (!isExtensionPage) {
  (async () => {
    await loadNsfwModel(msg => statusEl.textContent = msg);
    await loadOcrWorker(msg => statusEl.textContent = msg);
    statusEl.textContent = 'Image models ready.';
  })();
}

dropzone.onclick = () => fileInput.click();
dropzone.ondragover = (e) => { e.preventDefault(); dropzone.style.background = '#EAF0FF'; };
dropzone.ondragleave = () => { dropzone.style.background = ''; };
dropzone.ondrop = (e) => {
  e.preventDefault();
  dropzone.style.background = '';
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
};
fileInput.onchange = () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); };

function handleFile(file) {
  const isGif = file.type === 'image/gif';
  const url = URL.createObjectURL(file);
  preview.src = url;
  preview.style.display = 'block';
  preview.onload = async () => {
    resultsEl.classList.add('show');
    resultsEl.innerHTML = '<div class="hint">Scanning...</div>';
    const res = await moderateImage(preview, { isGif, scoreTextFn: scoreTextForImage });
    renderImageResult(res);
  };
}

function renderImageResult(res) {
  const tierColors = { safe: 'var(--safe)', mild: 'var(--mild)', toxic: 'var(--toxic)', critical: 'var(--critical)' };
  const top = res.nsfw ? res.nsfw.top : null;

  let html = `
    <div class="tier-badge" style="background:${tierColors[res.verdict]};">
      <div>
        <div class="tier-name">${res.verdict.toUpperCase()}</div>
        <div class="tier-desc">${top ? 'NSFW label: ' + top.className + ' (' + Math.round(top.probability*100) + '%)' : 'NSFW model unavailable'}</div>
      </div>
      <div class="tier-pct">${res.combinedPct}%</div>
    </div>
  `;

  if (res.ocrText) {
    html += `
      <div class="highlight-box">
        <div class="hb-label">Text found in image</div>
        <div>${escapeHtml(res.ocrText)}</div>
        ${res.textToxicity ? `<div style="margin-top:8px;font-size:12.5px;color:var(--muted);">Text toxicity: ${res.textToxicity.finalPct}% (${res.textToxicity.tier})</div>` : ''}
      </div>
    `;
  } else {
    html += `<div class="hint">No text detected in image.</div>`;
  }

  resultsEl.innerHTML = html;
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}