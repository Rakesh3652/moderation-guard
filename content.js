// Content script: runs on every page. Scans images (NSFW + OCR) and
// on-page text (comments, posts, etc.), blurs/hides flagged content
// based on severity tier, and logs flagged items so the dashboard
// (index.html, opened from the popup) can display them.
//
// TEXT SCORING: uses the real toxic-bert model (text-model.js) instead of
// keyword matching, so it understands meaning rather than just matching
// exact words. Falls back to the keyword lexicon automatically if the
// model can't load. Because real inference is much slower than a keyword
// check, text elements are processed through a rate-limited queue
// (see "TEXT SCAN QUEUE" below) rather than scored all at once.
//
// IMPORTANT DESIGN NOTE: scanning (scoring an element once) and applying
// the visual effect (blur/hide) are kept SEPARATE. Every flagged element
// is stored in `flaggedRegistry` with its tier and original state. The
// on/off toggle just replays applyEffect/revertEffect over that registry
// — it never needs to rescan anything. This is what makes toggling
// off actually restore original content instead of doing nothing.

(async () => {
  const moduleUrl = chrome.runtime.getURL('image-moderation.js');
  const textModelUrl = chrome.runtime.getURL('text-model.js');
  const { loadNsfwModel, loadOcrWorker, moderateImage } = await import(moduleUrl);
  const { loadTextModel, scoreTextWithAI } = await import(textModelUrl);
  const clipModuleUrl = chrome.runtime.getURL('clip-model.js');
const { loadClipModel, classifyImageWithClip } = await import(clipModuleUrl);

  // ---- on/off toggle state, live-updated from the popup ----
  let enabled = true;
  const stored = await chrome.storage.local.get({ moderationEnabled: true });
  enabled = stored.moderationEnabled;

  // Registry of every flagged element seen so far, so toggling can
  // reapply or revert the visual effect without rescanning.
  const flaggedRegistry = [];

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.moderationEnabled) {
      enabled = changes.moderationEnabled.newValue;
      flaggedRegistry.forEach((entry) => {
        if (enabled) applyEffect(entry);
        else revertEffect(entry);
      });
    }
  });

  // IMPORTANT: relative model paths won't resolve against the site being
  // visited, so we build the path against the extension's own bundle.
  const modelPath = chrome.runtime.getURL('models/mobilenet_v2/model.json');
const nsfwLoaded = await loadNsfwModel((msg) => console.log('[Moderation Guard]', msg), modelPath);
const ocrLoaded = await loadOcrWorker((msg) => console.log('[Moderation Guard]', msg));
const textModelLoaded = await loadTextModel((msg) => console.log('[Moderation Guard]', msg));
const clipLoaded = await loadClipModel((msg) => console.log('[Moderation Guard]', msg));
console.log('[Moderation Guard] NSFW ready:', nsfwLoaded, '| OCR ready:', ocrLoaded, '| Text AI ready:', textModelLoaded, '| CLIP ready:', clipLoaded);

  // ---- logging: flagged items get saved for the dashboard to read ----
  const MAX_LOG_ENTRIES = 300;
  async function logFlagged(entry) {
    const { moderationLog = [] } = await chrome.storage.local.get({ moderationLog: [] });
    moderationLog.push({
      ...entry,
      pageUrl: location.href,
      pageTitle: document.title,
      timestamp: Date.now(),
    });
    while (moderationLog.length > MAX_LOG_ENTRIES) moderationLog.shift();
    await chrome.storage.local.set({ moderationLog });

    if (entry.verdict === 'critical') {
      chrome.runtime.sendMessage({
        type: 'criticalFlag',
        detail: entry.detail,
        pageTitle: document.title,
        pageUrl: location.href,
      }).catch(() => {});
    }
  }

  // ==================== APPLY / REVERT (shared by image + text) ====================
  function applyEffect(entry) {
    if (entry.tier === 'mild') {
      entry.el.style.filter = entry.blurAmount;
      entry.el.style.cursor = 'pointer';
      entry.el.title = 'Flagged content — click to reveal';
    } else {
      if (entry.kind === 'image') {
        entry.el.style.display = 'none';
        if (!entry.placeholder.isConnected) entry.el.insertAdjacentElement('afterend', entry.placeholder);
        entry.placeholder.style.display = '';
      } else {
        entry.el.textContent = `[Comment hidden — flagged ${entry.tier}]`;
      }
    }
  }

  function revertEffect(entry) {
    if (entry.kind === 'image') {
      entry.el.style.filter = 'none';
      entry.el.style.display = '';
      if (entry.placeholder) entry.placeholder.style.display = 'none';
    } else {
      entry.el.style.filter = 'none';
      entry.el.textContent = entry.originalText;
    }
  }

  // ==================== IMAGE SCANNING ====================
  // ==================== IMAGE SCANNING ====================
  const scannedImages = new WeakSet();

  // Real AI models (NSFW, CLIP) plus OCR are heavy per image — running
  // all of them on every image on a page AT ONCE (which is what
  // happened before) is a major source of lag, especially on
  // image-dense pages like Google Images or search results full of
  // favicons. A queue processes images one at a time instead.
  const imageQueue = [];
  let imageQueueRunning = false;

  function enqueueImageScan(img) {
    imageQueue.push(img);
    if (!imageQueueRunning) runImageQueue();
  }

  async function runImageQueue() {
    imageQueueRunning = true;
    while (imageQueue.length > 0) {
      const img = imageQueue.shift();
      await scanImageNow(img);
    }
    imageQueueRunning = false;
  }

  function scanImage(img) {
    if (scannedImages.has(img)) return;
    scannedImages.add(img);
    if (!img.complete || img.naturalWidth === 0) return;
    // Raised from 50 to 80 — Google's own favicons are 64x64 and were
    // slipping through the old threshold, wasting time (and hitting
    // CORS errors in OCR) on icons that could never contain moderatable
    // content anyway.
    if (img.naturalWidth < 80 || img.naturalHeight < 80) return;
    enqueueImageScan(img);
  }

  async function scanImageNow(img) {
    const isGif = img.src.toLowerCase().includes('.gif');
    try {
      const result = await moderateImage(img, { isGif, scoreTextFn: scoreTextWithAI, classifyClipFn: classifyImageWithClip });
      registerImageVerdict(img, result);
    } catch (err) {
      console.error('[Moderation Guard] Image scan failed:', img.src, err);
    }
  }

  function registerImageVerdict(img, result) {
    if (result.verdict === 'safe') return;

    const entry = { kind: 'image', el: img, tier: result.verdict, blurAmount: 'blur(18px)' };

    if (result.verdict === 'mild') {
      img.addEventListener('click', () => {
        img.style.filter = 'none';
        entry.revealedByClick = true;
      }, { once: true });
    } else {
      const placeholder = document.createElement('div');
      placeholder.textContent = `[Image hidden — flagged ${result.verdict}, ${result.combinedPct}%]`;
      placeholder.style.cssText = `
        background:#2a2a2a;color:#fff;padding:12px;border-radius:8px;
        font:13px sans-serif;text-align:center;width:${img.width || 200}px;display:none;
      `;
      entry.placeholder = placeholder;
    }

    flaggedRegistry.push(entry);
    if (enabled) applyEffect(entry);

    logFlagged({
      type: 'image',
      verdict: result.verdict,
      pct: result.combinedPct,
      detail: img.src.slice(0, 300),
    });
  }

  function scanAllImages() {
    document.querySelectorAll('img').forEach(scanImage);
  }

  // ==================== TEXT SCANNING ====================
  // Same leaf-element heuristic as before — targets individual comments/
  // captions, skips wrapper elements that just repeat their children's text.
  const scannedText = new WeakSet();
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'IFRAME']);
  const TEXT_SELECTOR = 'p, span, li, td, div, a, b, strong, em, i, u, dt, dd, blockquote, figcaption, h1, h2, h3, h4, h5, h6';
  const MIN_TEXT_LENGTH = 3;

  // ---- TEXT SCAN QUEUE ----
  // Real AI inference is much slower than a keyword check. Rather than
  // firing off one model call per element instantly (which could mean
  // dozens of simultaneous calls on a busy page), candidate elements are
  // queued and processed one at a time. New elements found in a burst
  // (e.g. infinite scroll loading 30 posts at once) get debounced so the
  // queue fills up first, then drains steadily, instead of everything
  // fighting for the model at once.
  const textQueue = [];
  let queueRunning = false;

  function enqueueTextScan(el, text) {
    textQueue.push({ el, text });
    if (!queueRunning) runTextQueue();
  }

  async function runTextQueue() {
    queueRunning = true;
    while (textQueue.length > 0) {
      const { el, text } = textQueue.shift();
      try {
        const result = await scoreTextWithAI(text);
        registerTextVerdict(el, result, text);
      } catch (err) {
        console.error('[Moderation Guard] Text scan failed:', err);
      }
    }
    queueRunning = false;
  }

  function scanTextElement(el) {
    if (scannedText.has(el)) return;
    if (SKIP_TAGS.has(el.tagName)) return;
    if (el.children.length > 0) return; // only leaf elements
    const text = el.textContent.trim();
    if (text.length < MIN_TEXT_LENGTH) return;
    scannedText.add(el);
    enqueueTextScan(el, text);
  }

  function registerTextVerdict(el, result, originalText) {
    if (result.tier === 'safe') return;

    const entry = { kind: 'text', el, tier: result.tier, blurAmount: 'blur(4px)', originalText };
    flaggedRegistry.push(entry);
    if (enabled) applyEffect(entry);

    if (result.tier === 'mild') {
      el.addEventListener('click', () => {
        el.style.filter = 'none';
        entry.revealedByClick = true;
      }, { once: true });
    }

    logFlagged({
      type: 'text',
      verdict: result.tier,
      pct: result.finalPct,
      detail: originalText.slice(0, 300),
    });
  }

  function scanAllText() {
    document.querySelectorAll(TEXT_SELECTOR).forEach(scanTextElement);
  }

  // ==================== INITIAL SCAN + LIVE WATCH (debounced) ====================
  scanAllImages();
  scanAllText();

  let mutationDebounceTimer = null;
  let pendingNodes = [];

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === 1) pendingNodes.push(node);
      });
    });

    clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(() => {
      const nodes = pendingNodes;
      pendingNodes = [];
      nodes.forEach((node) => {
        if (node.nodeName === 'IMG') scanImage(node);
        else if (node.querySelectorAll) {
          node.querySelectorAll('img').forEach(scanImage);
          node.querySelectorAll(TEXT_SELECTOR).forEach(scanTextElement);
        }
      });
    }, 300); // wait for a burst of DOM changes to settle before scanning
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
