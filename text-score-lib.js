// Minimal reusable version of your lexicon scoring logic from script.js,
// exported as a plain function that returns data (no DOM rendering).
// Use this for OCR'd image text. Swap in your real toxic-bert pipeline
// here later if you want OCR text scored by the transformer model too.

// NOTE ON COMPLETENESS: this is a keyword/phrase list, not a trained
// model — it can only ever catch what's explicitly listed here. It will
// always miss misspellings, leetspeak (e.g. "f4g"), new slang, and
// anything context-dependent. This is exactly why the project roadmap's
// next phase is a trained RoBERTa model instead of keyword matching.
// Treat this list as a reasonable stopgap, not a complete solution —
// expand it further as gaps are found, but expect gaps to keep appearing.
const LEXICON = {
  toxicity: {
    "hate you":0.6,"you suck":0.55,"shut up":0.4,"get lost":0.4,"screw you":0.55,
    "damn you":0.4,"idiot":0.5,"stupid":0.45,"dumb":0.4,"pathetic":0.5,"loser":0.45,
    "moron":0.5,"jerk":0.35,"disgusting":0.45,"worthless":0.55,"trash":0.4,
    "garbage":0.4,"annoying":0.25,"ugly":0.4,"freak":0.4,"idiotic":0.45,
    "scum":0.5,"vile":0.45,"repulsive":0.45,"hideous":0.4,"despicable":0.5,
    "pig":0.35,"cow":0.3,"psycho":0.4,"lunatic":0.35
  },
  severe_toxicity: {
    "everyone hates you":0.75,"you deserve to suffer":0.85,"subhuman":0.8,
    "waste of oxygen":0.8,"burn in hell":0.75,"i hope you die":0.9,
    "piece of garbage":0.75,"worthless piece of trash":0.85,"you are nothing":0.7,
    "you are a disgrace":0.65,"rot in hell":0.75,
    "molest":0.8,"molester":0.85,"molesting":0.8,"pedophile":0.85,"paedophile":0.85,
    "rape":0.75,"rapist":0.8,"raping":0.75
  },
  obscene: {
    "fuck":0.5,"fucking":0.5,"fucker":0.55,"motherfucker":0.6,"shit":0.4,
    "bullshit":0.45,"asshole":0.55,"ass hole":0.55,"bitch":0.55,"bastard":0.45,
    "piss off":0.4,"whore":0.6,"slut":0.6,"dick":0.45,"dickhead":0.5,
    "prick":0.45,"cunt":0.65,"twat":0.5,"wanker":0.45,"douchebag":0.45,"douche":0.4
  },
  insult: {
    "idiot":0.5,"stupid":0.45,"ugly":0.4,"pathetic":0.5,"loser":0.45,
    "moron":0.5,"dumbass":0.55,"worthless":0.55,"waste of space":0.55,
    "brainless":0.45,"clown":0.35,"joke of a person":0.4,"imbecile":0.5,
    "dimwit":0.45,"half-wit":0.45,"halfwit":0.45,"buffoon":0.35,"nitwit":0.4
  },
  threat: {
    "kill you":0.95,"hurt you":0.8,"beat you up":0.8,"come find you":0.75,
    "hunt you down":0.85,"you'll pay for this":0.7,"watch your back":0.65,
    "i will destroy you":0.8,"i know where you live":0.9,"you're dead":0.85,
    "gonna kill you":0.95,"i'll end you":0.8,"you won't see it coming":0.75,
    "i'll hurt you":0.8,"i'll kill you":0.95
  },
  identity_hate: {
    "go back to your country":0.8,"go back to where you came from":0.8,
    "people like you don't belong":0.75,"your kind":0.5,
    "all of you are the same":0.5,"you people":0.35
  },
  self_harm_encouragement: {
    "kill yourself":1.0,"kys":1.0,"you should die":0.95,"end your life":0.95,
    "nobody would miss you":0.85,"the world would be better without you":0.9,
    "go die":0.9,"just die already":0.9,"nobody wants you here":0.7
  }
};

function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function phraseToRegex(phrase){
  const escaped = phrase.split(/\s+/).map(escapeRegExp).join('\\s+');
  return new RegExp('\\b' + escaped + '\\b', 'i');
}
function scoreCategoryLexicon(lowerText, lexicon){
  let combined = 0;
  for (const phrase in lexicon){
    if (phraseToRegex(phrase).test(lowerText)) {
      combined = 1 - (1 - combined) * (1 - lexicon[phrase]);
    }
  }
  return combined;
}

function tierFor(pct){
  if (pct < 40) return 'safe';
  if (pct < 70) return 'mild';
  if (pct < 90) return 'toxic';
  return 'critical';
}

// Async to match the calling convention used by moderateImage(); does no
// awaiting today but keeps the door open for swapping in a real model call.
export async function scoreTextForImage(text){
  const lower = text.toLowerCase();
  const scores = {};
  for (const cat in LEXICON) scores[cat] = scoreCategoryLexicon(lower, LEXICON[cat]);

  const weighted = {};
  for (const cat in scores){
    const mult = (cat === 'threat' || cat === 'self_harm_encouragement') ? 1.3 : 1.0;
    weighted[cat] = Math.min(1, scores[cat] * mult);
  }
  const finalScore = Math.max(...Object.values(weighted));
  const finalPct = Math.round(finalScore * 100);
  return { finalPct, tier: tierFor(finalPct), scores };
}
