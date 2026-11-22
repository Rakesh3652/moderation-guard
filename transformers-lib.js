// Shared loader for @xenova/transformers, used by both text-model.js
// (toxic-bert) and clip-model.js (CLIP visual classification), so the
// library and its WASM runtime only get initialized once per page, not
// twice.
//
// Self-hosted for the same reason as everything else so far: Chrome
// extensions cannot load executable code from a remote CDN. HONEST
// CONFIDENCE NOTE: this is expected to be the hardest of everything
// we've self-hosted, because it depends on a SECOND WASM runtime
// (onnxruntime-web, different from TensorFlow's) with its own separate
// binaries — likely multiple variants, same as TensorFlow needed 3.

let transformersLib = null;

async function getTransformers() {
  if (!transformersLib) {
    const url = chrome.runtime.getURL('vendor/transformers.esm.js');
    const mod = await import(url);
    mod.env.allowLocalModels = false;

    // Point onnxruntime-web (the WASM engine transformers.js runs on) at
    // locally self-hosted binaries instead of its own default CDN fetch —
    // same reasoning as TensorFlow.js's setWasmPaths earlier. The exact
    // filenames onnxruntime-web asks for are a best guess until we see
    // what it actually requests — same discovery approach that worked
    // for OCR's worker/core filenames.
    if (mod.env.backends && mod.env.backends.onnx && mod.env.backends.onnx.wasm) {
      mod.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/');
    }

    transformersLib = mod;
  }
  return transformersLib;
}

export { getTransformers };