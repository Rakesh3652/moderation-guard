// =====================================================================
// Toxicity Severity Scanner — real transformer models in the browser
// via transformers.js (https://github.com/xenova/transformers.js)
//
// Primary path:   Xenova/toxic-bert            -> 6-category toxicity scores
//                 Xenova/distilbert-...-sst2   -> sentiment (POSITIVE/NEGATIVE)
// Fallback path:  offline weighted lexicon (used only if the models can't
//                 be downloaded, e.g. no internet at demo time)
//
// Self-harm encouragement is not one of toxic-bert's 6 output labels, so it
// is always checked with a small dedicated high-recall keyword safety net,
// on top of whichever engine (model or lexicon) is active — this mirrors
// the "keep self-harm detection rule-based/high-recall" design note from
// the project report.
// =====================================================================

const CATEGORY_LABELS = {
  toxicity:"Toxic",
  severe_toxicity:"Severely Toxic",
  obscene:"Obscene",
  insult:"Insult",
  threat:"Threat",
  identity_hate:"Identity Hate",
  self_harm_encouragement:"Self-Harm Encouragement"
};
const CATEGORY_ORDER = ["toxicity","severe_toxicity","obscene","insult","threat","identity_hate","self_harm_encouragement"];

// -------------------- fallback lexicon (offline safety net) --------------------
const LEXICON = {
  toxicity: {
    "hate you":0.6,"you suck":0.55,"shut up":0.4,"get lost":0.4,"screw you":0.55,
    "damn you":0.4,"idiot":0.5,"stupid":0.45,"dumb":0.4,"pathetic":0.5,"loser":0.45,
    "moron":0.5,"jerk":0.35,"disgusting":0.45,"worthless":0.55,"trash":0.4,
    "garbage":0.4,"annoying":0.25,"ugly":0.4,"freak":0.4,"idiotic":0.45
  },
  severe_toxicity: {
    "everyone hates you":0.75,"you deserve to suffer":0.85,"subhuman":0.8,
    "waste of oxygen":0.8,"burn in hell":0.75,"i hope you die":0.9,
    "piece of garbage":0.75,"worthless piece of trash":0.85,"you are nothing":0.7
  },
  obscene: {
    "fuck":0.5,"fucking":0.5,"shit":0.4,"bullshit":0.45,"asshole":0.55,
    "bitch":0.55,"bastard":0.45,"piss off":0.4,"whore":0.6,"slut":0.6
  },
  insult: {
    "idiot":0.5,"stupid":0.45,"ugly":0.4,"pathetic":0.5,"loser":0.45,
    "moron":0.5,"dumbass":0.55,"worthless":0.55,"waste of space":0.55,
    "brainless":0.45,"clown":0.35,"joke of a person":0.4
  },
  threat: {
    "kill you":0.95,"hurt you":0.8,"beat you up":0.8,"come find you":0.75,
    "hunt you down":0.85,"you'll pay for this":0.7,"watch your back":0.65,
    "i will destroy you":0.8,"i know where you live":0.9,"you're dead":0.85,
    "gonna kill you":0.95
  },
  identity_hate: {
    "go back to your country":0.8,"go back to where you came from":0.8,
    "people like you don't belong":0.75,"your kind":0.5,
    "all of you are the same":0.5,"you people":0.35
  },
  self_harm_encouragement: {
    "kill yourself":1.0,"kys":1.0,"you should die":0.95,"end your life":0.95,
    "nobody would miss you":0.85,"the world would be better without you":0.9
  }
};
const NEGATIONS = ["not","never","n't","no","without"];
const INTENSIFIERS = ["very","extremely","really","so","totally","absolutely"];

const EXAMPLES = [
  {label:"Safe example", text:"Hey, great job on the presentation today! Really enjoyed it."},
  {label:"Mild example", text:"Stop being so annoying, you're kind of a loser."},
  {label:"Toxic example", text:"You're such a pathetic idiot, nobody even likes you."},
  {label:"Critical example", text:"I know where you live, I'm going to hurt you if you post that again."}
];

// -------------------- helpers --------------------
function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeRegExp(s){
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function phraseToRegex(phrase){
  const escaped = phrase.split(/\s+/).map(escapeRegExp).join('\\s+');
  return new RegExp('\\b' + escaped + '\\b', 'i');
}

function scoreCategoryLexicon(lowerText, lexicon){
  let combined = 0;
  const matches = [];
  for(const phrase in lexicon){
    const w = lexicon[phrase];
    const re = phraseToRegex(phrase);
    const m = re.exec(lowerText);
    if(!m) continue;
    const idx = m.index;
    const before = lowerText.slice(0, idx).trim().split(/\s+/).slice(-3);
    const negated = before.some(w2 => NEGATIONS.some(n => w2.includes(n)));
    const intensified = before.some(w2 => INTENSIFIERS.some(n => w2.includes(n)));
    let weight = w;
    if(negated) weight *= 0.35;
    if(intensified) weight = Math.min(1, weight * 1.2);
    combined = 1 - (1 - combined) * (1 - weight);
    if(!negated) matches.push(phrase);
  }
  const exclaim = (lowerText.match(/!/g)||[]).length;
  combined = Math.min(1, combined + Math.min(0.1, exclaim*0.02));
  return {score: combined, matches};
}

// self-harm always gets a dedicated high-recall keyword check, regardless of
// which engine (model or lexicon) produced the other 6 category scores
function selfHarmSafetyNet(lowerText){
  return scoreCategoryLexicon(lowerText, LEXICON.self_harm_encouragement);
}

function highlightText(raw, allMatches){
  if(!allMatches.length) return escapeHtml(raw) || '<em>No flagged terms found.</em>';
  const sorted = [...new Set(allMatches)].sort((a,b)=>b.length-a.length);
  let result = escapeHtml(raw);
  sorted.forEach(phrase=>{
    const escaped = phrase.split(/\s+/).map(escapeRegExp).join('\\s+');
    const re = new RegExp('\\b(' + escaped + ')\\b', 'gi');
    result = result.replace(re, '<mark>$1</mark>');
  });
  return result;
}

function tierFor(pct){
  if(pct < 40) return {name:"Safe", color:"var(--safe)", desc:"Displayed normally. No action or record."};
  if(pct < 70) return {name:"Mild", color:"var(--mild)", desc:"Blur filter + disclosure indicator; click to reveal."};
  if(pct < 90) return {name:"Toxic", color:"var(--toxic)", desc:"Hidden; logged for analytics & moderator review."};
  return {name:"Critical", color:"var(--critical)", desc:"Hidden; auto-reported with evidence; escalated to priority queue."};
}

function animateCount(el, to){
  const dur = 500;
  const start = performance.now();
  function step(now){
    const t = Math.min(1, (now-start)/dur);
    el.textContent = Math.round(to*t) + '%';
    if(t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// -------------------- model loading (transformers.js) --------------------
let toxicityPipeline = null;
let sentimentPipeline = null;
let modelsReady = false;
let modelLoadFailed = false;

async function loadModels(){
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  try{
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    env.allowLocalModels = false;

    statusText.textContent = 'Downloading AI model (first run only)...';
    toxicityPipeline = await pipeline('text-classification', 'Xenova/toxic-bert', { quantized: true, topk: null });

    statusText.textContent = 'Downloading sentiment model...';
    sentimentPipeline = await pipeline('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english', { quantized: true });

    modelsReady = true;
    statusDot.classList.add('ready');
    statusText.textContent = 'AI model ready (Xenova/toxic-bert, real transformer inference)';
  }catch(err){
    console.error('Model load failed, falling back to offline lexicon:', err);
    modelLoadFailed = true;
    statusDot.classList.add('error');
    statusText.textContent = 'Could not load AI model (offline?) — using offline keyword fallback';
  }
}

// toxic-bert output labels: toxic, severe_toxic, obscene, threat, insult, identity_hate
function mapModelLabel(label){
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

async function scoreWithModel(raw){
  const results = await toxicityPipeline(raw, { topk: null });
  // results: [{label, score}, ...] for all 6 labels
  const scores = {};
  results.forEach(r => {
    const cat = mapModelLabel(r.label);
    if(cat) scores[cat] = r.score;
  });
  return scores;
}

async function getSentiment(raw){
  const r = await sentimentPipeline(raw);
  return r[0]; // {label: 'POSITIVE'|'NEGATIVE', score}
}

// -------------------- main scan flow --------------------
function buildExamples(){
  const box = document.getElementById('examples');
  EXAMPLES.forEach(ex=>{
    const b = document.createElement('button');
    b.className='chip';
    b.textContent=ex.label;
    b.onclick=()=>{ document.getElementById('inputText').value = ex.text; scanText(); };
    box.appendChild(b);
  });
}

function scanText(){
  const raw = document.getElementById('inputText').value.trim();
  if(!raw){ return; }

  const btn = document.getElementById('scanBtn');
  btn.disabled = true;
  btn.classList.add('scanning');
  btn.innerHTML = 'Scanning<span class="dots"></span>';

  setTimeout(() => runScan(raw), 150);
}

async function runScan(raw){
  const lower = raw.toLowerCase();
  let scores = {};
  let matchesByCat = {};
  let source = 'lexicon';
  let sentiment = null;

  if(modelsReady){
    try{
      source = 'model';
      const modelScores = await scoreWithModel(raw);
      CATEGORY_ORDER.forEach(cat=>{
        if(cat === 'self_harm_encouragement') return; // handled separately below
        scores[cat] = modelScores[cat] ?? 0;
      });
      // best-effort keyword highlighting alongside real model scores
      CATEGORY_ORDER.forEach(cat=>{
        if(cat === 'self_harm_encouragement') return;
        matchesByCat[cat] = scoreCategoryLexicon(lower, LEXICON[cat]).matches;
      });
      sentiment = await getSentiment(raw);
    }catch(err){
      console.error('Live inference failed, falling back to lexicon for this scan:', err);
      source = 'lexicon';
    }
  }

  if(source === 'lexicon'){
    CATEGORY_ORDER.forEach(cat=>{
      if(cat === 'self_harm_encouragement') return;
      const r = scoreCategoryLexicon(lower, LEXICON[cat]);
      scores[cat] = r.score;
      matchesByCat[cat] = r.matches;
    });
  }

  // self-harm: always the dedicated keyword safety net
  const shResult = selfHarmSafetyNet(lower);
  scores.self_harm_encouragement = shResult.score;
  matchesByCat.self_harm_encouragement = shResult.matches;

  const allMatches = Object.values(matchesByCat).flat();

  // severity engine: weight Threat & Self-Harm x1.3, then weighted-max aggregation
  const weighted = {};
  CATEGORY_ORDER.forEach(cat=>{
    const mult = (cat === 'threat' || cat === 'self_harm_encouragement') ? 1.3 : 1.0;
    weighted[cat] = Math.min(1, (scores[cat]||0) * mult);
  });
  const finalScore = Math.max(...Object.values(weighted));
  const finalPct = Math.round(finalScore*100);
  const tier = tierFor(finalPct);

  renderResults({ raw, scores, matchesByCat, allMatches, tier, finalPct, source, sentiment });

  const btn = document.getElementById('scanBtn');
  btn.disabled = false;
  btn.classList.remove('scanning');
  btn.textContent = 'Scan Sentence';
}

function renderResults({ raw, scores, matchesByCat, allMatches, tier, finalPct, source, sentiment }){
  document.getElementById('highlightedText').innerHTML = highlightText(raw, allMatches);

  const sentRow = document.getElementById('sentimentRow');
  if(sentiment){
    sentRow.style.display = 'flex';
    const pill = document.getElementById('sentPill');
    pill.textContent = sentiment.label;
    pill.className = 'sentiment-pill ' + (sentiment.label === 'POSITIVE' ? 'positive' : 'negative');
    document.getElementById('sentConf').textContent = Math.round(sentiment.score*100) + '% confidence';
  } else {
    sentRow.style.display = 'none';
  }

  const badge = document.getElementById('tierBadge');
  badge.style.background = tier.color;
  document.getElementById('tierName').textContent = tier.name;
  document.getElementById('tierDesc').textContent = tier.desc;
  document.getElementById('tierSource').textContent =
    source === 'model' ? 'Scored by: Xenova/toxic-bert (real transformer model)' : 'Scored by: offline keyword fallback';
  animateCount(document.getElementById('tierPct'), finalPct);

  const grid = document.getElementById('catGrid');
  grid.innerHTML = '';
  CATEGORY_ORDER.forEach(cat=>{
    const pct = Math.round((scores[cat]||0)*100);
    const triggers = matchesByCat[cat] || [];
    const div = document.createElement('div');
    div.className = 'cat';
    div.innerHTML = `
      <div class="cat-top"><span class="cname">${CATEGORY_LABELS[cat]}</span><span class="cval">${pct}%</span></div>
      <div class="bar-bg"><div class="bar-fill" style="width:${pct}%; background:${tier.color};"></div></div>
      <div class="cat-triggers">${triggers.length ? '<b>Keywords found:</b> ' + triggers.join(', ') : ''}</div>
    `;
    grid.appendChild(div);
  });

  document.getElementById('results').classList.add('show');
}

// -------------------- init --------------------
document.addEventListener('DOMContentLoaded', () => {
  // Extension pages (chrome-extension://...) can't load CDN-hosted models
  // — a Manifest V3 platform restriction, not a bug. Skip entirely rather
  // than attempting a load that will only fail.
  const isExtensionPage = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id
    && location.protocol === 'chrome-extension:';
  if (isExtensionPage) return;

  buildExamples();
  loadModels();

  const input = document.getElementById('inputText');
  input.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      scanText();
    }
  });
});