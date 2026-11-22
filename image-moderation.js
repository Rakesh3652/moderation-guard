// =====================================================================
// Image Moderation Module
// - NSFW detection via nsfwjs (TensorFlow.js) — runs 100% client-side
// - OCR via tesseract.js — extracts text from images/memes/screenshots,
//   then feeds that text into your EXISTING toxicity scorer (scanText
//   pipeline from script.js) so meme-text harassment gets caught too
// - CLIP — catches stylized/artistic image content OCR can't read as text
// - GIF handling: grabs first/middle/last frame via canvas, scores each
// =====================================================================

let nsfwModel = null;
let nsfwReady = false;
let ocrWorker = null;
let tfLib = null; // cached TensorFlow.js module, loaded once

const MODEL_PATH = './models/mobilenet_v2/model.json';
const NSFW_LABELS = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'];

async function getTf() {
  if (!tfLib) {
    if (typeof globalThis !== 'undefined' && globalThis.tf) {
      tfLib = globalThis.tf;
      if (tfLib.wasm && tfLib.wasm.setWasmPaths) {
        tfLib.wasm.setWasmPaths({
          'tfjs-backend-wasm.wasm': chrome.runtime.getURL('vendor/tfjs-backend-wasm.wasm'),
          'tfjs-backend-wasm-simd.wasm': chrome.runtime.getURL('vendor/tfjs-backend-wasm-simd.wasm'),
          'tfjs-backend-wasm-threaded-simd.wasm': chrome.runtime.getURL('vendor/tfjs-backend-wasm-threaded-simd.wasm'),
        });
      }
      await tfLib.setBackend('wasm');
      await tfLib.ready();
    } else {
      throw new Error('TensorFlow.js not found on globalThis.tf — make sure vendor/tf-core.min.js, tf-converter.min.js, and tf-backend-wasm.min.js are all present and listed before content.js in manifest.json\'s content_scripts.');
    }
  }
  return tfLib;
}

async function loadNsfwModel(onStatus, modelPathOverride) {
  try {
    onStatus && onStatus('Loading TensorFlow.js...');
    const tf = await getTf();
    onStatus && onStatus('Loading NSFW detection model...');
    const path = modelPathOverride || MODEL_PATH;
    nsfwModel = await tf.loadGraphModel(path);
    nsfwReady = true;
    onStatus && onStatus('NSFW model ready.');
    return true;
  } catch (err) {
    console.error('NSFW model failed to load:', err);
    onStatus && onStatus('NSFW model unavailable — check that model.json exists at ' + (modelPathOverride || MODEL_PATH));
    return false;
  }
}

async function loadOcrWorker(onStatus) {
  try {
    onStatus && onStatus('Loading OCR engine...');
    if (typeof globalThis === 'undefined' || !globalThis.Tesseract) {
      throw new Error('Tesseract not found on globalThis — make sure vendor/tesseract.min.js is present and listed before content.js in manifest.json.');
    }
    const Tesseract = globalThis.Tesseract;
    ocrWorker = await Tesseract.createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('vendor/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/'),
      langPath: chrome.runtime.getURL('vendor/'),
      gzip: true,
    });
    onStatus && onStatus('OCR engine ready.');
    return true;
  } catch (err) {
    console.error('OCR worker failed to load:', err);
    onStatus && onStatus('OCR unavailable — check vendor files (see vendor/README.txt).');
    return false;
  }
}

async function extractTextFromImage(imgElementOrCanvas) {
  if (!ocrWorker) return '';
  try {
    const { data } = await ocrWorker.recognize(imgElementOrCanvas);
    return (data && data.text) ? data.text.trim() : '';
  } catch (err) {
    console.error('OCR extraction failed:', err);
    return '';
  }
}

async function classifyImageNsfw(imgElement) {
  if (!nsfwReady) return null;
  try {
    const tf = await getTf();
    const scores = tf.tidy(() => {
      let img = tf.browser.fromPixels(imgElement, 3);
      img = tf.image.resizeBilinear(img, [224, 224]);
      img = tf.cast(img, 'float32');
      img = tf.expandDims(img, 0); // raw 0-255 range; the graph applies its own internal normalization
      const output = nsfwModel.predict(img);
      return output.dataSync();
    });
    const all = NSFW_LABELS.map((className, i) => ({ className, probability: scores[i] }));
    all.sort((a, b) => b.probability - a.probability);
    return { top: all[0], all };
  } catch (err) {
    console.error('NSFW classification failed:', err);
    return null;
  }
}

function nsfwToUnsafeScore(predictions) {
  const byClass = {};
  predictions.forEach(p => byClass[p.className] = p.probability);
  const porn = byClass['Porn'] || 0;
  const hentai = byClass['Hentai'] || 0;
  const sexy = byClass['Sexy'] || 0;
  return Math.min(1, porn + hentai + sexy * 0.5);
}

async function sampleGifFrames(imgElement, frameCount = 3) {
  const frames = [];
  const canvas = document.createElement('canvas');
  canvas.width = imgElement.naturalWidth || imgElement.width;
  canvas.height = imgElement.naturalHeight || imgElement.height;
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < frameCount; i++) {
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    frames.push(dataUrl);
    if (i < frameCount - 1) await new Promise(r => setTimeout(r, 400));
  }
  return frames;
}

function dataUrlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Converts a (CORS-safe) image into a same-origin data: URI, so CLIP can
// process it without triggering the cross-origin pixel access problem
// we already solved for the NSFW model — a data: URI has no cross-origin
// fetch involved at all.
function imageToDataUrl(imgEl) {
  const canvas = document.createElement('canvas');
  canvas.width = imgEl.naturalWidth || imgEl.width;
  canvas.height = imgEl.naturalHeight || imgEl.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

// Many images are cross-origin from whatever page you're on (stock photo
// thumbnails, CDN-hosted images, etc.), and browsers block reading their
// pixel data unless the source server explicitly allows it via CORS
// headers. This is a browser security restriction we can't force around
// — if a cross-origin server doesn't support it, this clone will simply
// fail to load, and we skip pixel-based checks for that one image
// rather than crashing.
function loadCorsSafeImage(originalImg) {
  return new Promise((resolve, reject) => {
    const clone = new Image();
    clone.crossOrigin = 'anonymous';
    clone.onload = () => resolve(clone);
    clone.onerror = () => reject(new Error('Cross-origin image blocked — source server does not support CORS, cannot classify pixels.'));
    clone.src = originalImg.src;
  });
}

async function moderateImage(imgElement, { isGif = false, scoreTextFn = null, classifyClipFn = null } = {}) {
  const result = {
    nsfw: null,
    unsafeScore: 0,
    clip: null,
    clipUnsafeScore: 0,
    ocrText: '',
    textToxicity: null,
    verdict: 'safe',
    nsfwSkipped: false,
  };

  // Get a CORS-safe copy for pixel access. If this fails, NSFW/CLIP
  // checks are skipped for this specific image only — everything else
  // (other images, text scanning) is unaffected.
  let safeImg = null;
  if (nsfwReady || classifyClipFn) {
    try {
      safeImg = await loadCorsSafeImage(imgElement);
    } catch (err) {
      result.nsfwSkipped = true;
      console.warn('[Moderation Guard] Pixel-based checks skipped (cross-origin, no CORS support):', imgElement.src);
    }
  }

  if (safeImg) {
    if (isGif) {
      const frames = await sampleGifFrames(safeImg, 3);
      let worst = 0, worstPred = null;
      for (const frameDataUrl of frames) {
        const frameImg = await dataUrlToImage(frameDataUrl);
        const cls = await classifyImageNsfw(frameImg);
        if (cls) {
          const score = nsfwToUnsafeScore(cls.all);
          if (score > worst) { worst = score; worstPred = cls; }
        }
      }
      result.unsafeScore = worst;
      result.nsfw = worstPred;
    } else if (nsfwReady) {
      const cls = await classifyImageNsfw(safeImg);
      if (cls) {
        result.unsafeScore = nsfwToUnsafeScore(cls.all);
        result.nsfw = cls;
      }
    }

    // CLIP: run on a single representative frame via a same-origin data
    // URL, so no separate cross-origin fetch is needed.
    if (classifyClipFn) {
      try {
        const dataUrl = imageToDataUrl(safeImg);
        const clipResult = await classifyClipFn(dataUrl);
        if (clipResult) {
          result.clip = clipResult;
          result.clipUnsafeScore = clipResult.unsafeScore;
        }
      } catch (err) {
        console.error('[Moderation Guard] CLIP check failed:', err);
      }
    }
  }

  if (ocrWorker) {
    result.ocrText = await extractTextFromImage(imgElement);
    if (result.ocrText && scoreTextFn) {
      result.textToxicity = await scoreTextFn(result.ocrText);
    }
  }

  const textPct = result.textToxicity ? result.textToxicity.finalPct : 0;
  const imagePct = Math.round(result.unsafeScore * 100);
  const clipPct = Math.round(result.clipUnsafeScore * 100);
  const combinedPct = Math.max(textPct, imagePct, clipPct);

  if (combinedPct >= 90) result.verdict = 'critical';
  else if (combinedPct >= 70) result.verdict = 'toxic';
  else if (combinedPct >= 40) result.verdict = 'mild';
  else result.verdict = 'safe';

  result.combinedPct = combinedPct;
  return result;
}

export {
  loadNsfwModel,
  loadOcrWorker,
  moderateImage,
  classifyImageNsfw,
  extractTextFromImage,
  sampleGifFrames
};