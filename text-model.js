// Real AI-based text scoring using the same Xenova/toxic-bert model your
// main demo (script.js) already uses — replaces pure keyword matching
// with actual semantic understanding of meaning, not just word presence.
//
// Design notes:
// - toxic-bert's 6 output labels don't include self-harm encouragement,
//   so that category is ALWAYS checked with the small dedicated keyword
//   list from text-score-lib.js, layered on top of the model — same
//   "keep self-harm detection rule-based/high-recall" principle your
//   main demo already follows.
// - If the model fails to load (offline, blocked, etc.) this falls back
//   automatically to the full keyword lexicon so scanning still works,
//   just less accurately.
// - PERFORMANCE: real inference is much slower than a keyword check.
//   Callers should debounce/queue calls rather than firing one per DOM
//   element instantly — see content.js's debounced batch scanning.

const CATEGORY_ORDER = ["toxicity", "severe_toxicity", "obscene", "insult", "threat", "identity_hate", "self_harm_encouragement"];

let toxicityPipeline = null;
let modelReady = false;
let lexiconFallback = null; // set on first use, imported lazily

function mapModelLabel(label) {
  const map = {
    toxic: 'toxicity',
    severe_toxic: 'severe_toxicity',
    obscene: 'obscene',
    threat: 'threat',
    insult: 'insult',
    identity_hate: 'identity_hate'
  };
  return map[label] || null;
}

function tierFor(pct) {
  if (pct < 40) return 'safe';
  if (pct < 70) return 'mild';
  if (pct < 90) return 'toxic';
  return 'critical';
}

async function loadTextModel(onStatus) {
  try {
    onStatus && onStatus('Loading text AI model...');
    const transformersLibUrl = chrome.runtime.getURL('transformers-lib.js');
    const { getTransformers } = await import(transformersLibUrl);
    const { pipeline } = await getTransformers();
    toxicityPipeline = await pipeline('text-classification', 'Xenova/toxic-bert', { quantized: true, topk: null });
    modelReady = true;
    onStatus && onStatus('Text AI model ready.');
    return true;
  } catch (err) {
    console.error('[Moderation Guard] Text model failed to load, will use keyword fallback:', err);
    modelReady = false;
    onStatus && onStatus('Text AI model unavailable — using keyword fallback.');
    return false;
  }
}

async function getSelfHarmScore(lowerText) {
  if (!lexiconFallback) {
    const textLibUrl = chrome.runtime.getURL('text-score-lib.js');
    lexiconFallback = await import(textLibUrl);
  }
  // text-score-lib.js only exposes the combined scorer, not per-category,
  // so we call it and pull out just the self_harm_encouragement figure
  // via its full breakdown (scores object it already returns).
  const result = await lexiconFallback.scoreTextForImage(lowerText);
  return result.scores.self_harm_encouragement || 0;
}

// Main entry point — same return shape as text-score-lib.js's
// scoreTextForImage() so content.js can swap scorers with no other changes.
export async function scoreTextWithAI(text) {
  const lower = text.toLowerCase();

  // self-harm: always the dedicated keyword safety net, regardless of
  // which engine (model or lexicon) handles the other 6 categories
  const selfHarmScore = await getSelfHarmScore(lower);

  let scores = {};
  let source = 'lexicon';

  if (modelReady) {
    try {
      source = 'model';
      const results = await toxicityPipeline(text, { topk: null });
      results.forEach(r => {
        const cat = mapModelLabel(r.label);
        if (cat) scores[cat] = r.score;
      });
    } catch (err) {
      console.error('[Moderation Guard] Live inference failed, falling back to lexicon for this item:', err);
      source = 'lexicon';
    }
  }

  if (source === 'lexicon') {
    if (!lexiconFallback) {
      const textLibUrl = chrome.runtime.getURL('text-score-lib.js');
      lexiconFallback = await import(textLibUrl);
    }
    const fallbackResult = await lexiconFallback.scoreTextForImage(text);
    scores = fallbackResult.scores;
  }

  scores.self_harm_encouragement = selfHarmScore;

  const weighted = {};
  CATEGORY_ORDER.forEach(cat => {
    const mult = (cat === 'threat' || cat === 'self_harm_encouragement') ? 1.3 : 1.0;
    weighted[cat] = Math.min(1, (scores[cat] || 0) * mult);
  });
  const finalScore = Math.max(...Object.values(weighted));
  const finalPct = Math.round(finalScore * 100);

  return { finalPct, tier: tierFor(finalPct), scores, source };
}

export { loadTextModel };
