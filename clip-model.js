// CLIP-based zero-shot image classification — catches stylized/artistic
// content that OCR structurally cannot read (e.g. a logo where letters
// are formed from negative space, rather than printed characters).
// Instead of reading characters, CLIP compares the WHOLE image against
// a list of text descriptions and scores how well each one matches —
// closer to how a person recognizes an image at a glance, rather than
// reading it letter by letter.

let clipPipeline = null;
let clipReady = false;

// Labels chosen to catch offensive gestures/imagery that OCR can't read
// as text. The first 3 are "unsafe" categories; the last is a safe
// catch-all so the model always has somewhere neutral to land.
const CANDIDATE_LABELS = [
  'an offensive or vulgar hand gesture',
  'profane or offensive text styled as a logo or graphic',
  'graphic violence or gore',
  'a normal, safe image',
];
const UNSAFE_LABEL_COUNT = 3;

async function loadClipModel(onStatus) {
  try {
    onStatus && onStatus('Loading CLIP visual model...');
    const transformersLibUrl = chrome.runtime.getURL('transformers-lib.js');
    const { getTransformers } = await import(transformersLibUrl);
    const { pipeline } = await getTransformers();

    clipPipeline = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32');
    clipReady = true;
    onStatus && onStatus('CLIP visual model ready.');
    return true;
  } catch (err) {
    console.error('[Moderation Guard] CLIP model failed to load:', err);
    onStatus && onStatus('CLIP visual model unavailable.');
    clipReady = false;
    return false;
  }
}

// dataUrl should be a same-origin data: URI (e.g. from canvas.toDataURL()),
// not a remote image URL — avoids re-triggering the cross-origin pixel
// access problem we already solved for the NSFW model.
async function classifyImageWithClip(dataUrl) {
  if (!clipReady) return null;
  try {
    const results = await clipPipeline(dataUrl, CANDIDATE_LABELS);
    const top = results[0];
    const unsafeScore = results
      .filter(r => CANDIDATE_LABELS.indexOf(r.label) < UNSAFE_LABEL_COUNT)
      .reduce((max, r) => Math.max(max, r.score), 0);
    return { top, all: results, unsafeScore };
  } catch (err) {
    console.error('[Moderation Guard] CLIP classification failed:', err);
    return null;
  }
}

export { loadClipModel, classifyImageWithClip };