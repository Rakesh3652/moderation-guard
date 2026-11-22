THIS FOLDER NEEDS 4 FILES THAT AREN'T INCLUDED IN THIS ZIP
=============================================================

I (Claude) have no internet access in the environment I build files in,
so I can't download these for you. All the CODE that uses these files is
already done and included in this zip — you just need to drop these 4
files into this exact "vendor" folder, then everything should work.

IMPORTANT: all 4 files must be the SAME VERSION (4.20.0 below) or they
may not work correctly together.

Download each of these 4 URLs (open in a new browser tab; if it doesn't
auto-download, use Ctrl+S / Save As and keep the exact filename shown):

1. https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.20.0/dist/tf-core.min.js
   -> save as: tf-core.min.js

2. https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.20.0/dist/tf-converter.min.js
   -> save as: tf-converter.min.js

3. https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.20.0/dist/tf-backend-wasm.min.js
   -> save as: tf-backend-wasm.min.js

4. https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.20.0/dist/tfjs-backend-wasm.wasm
   -> save as: tfjs-backend-wasm.wasm
   (this one is a binary file, not JS — it should just download directly)

5. https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.20.0/dist/tfjs-backend-wasm-simd.wasm
   -> save as: tfjs-backend-wasm-simd.wasm

6. https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.20.0/dist/tfjs-backend-wasm-threaded-simd.wasm
   -> save as: tfjs-backend-wasm-threaded-simd.wasm

(UPDATE: originally this README only listed one .wasm file. The library
actually needs all three binary variants registered — it picks whichever
one your specific browser/CPU supports at runtime. All 6 files above are
now required.)

Once all 4 files sit directly in this "vendor" folder (not in a
subfolder), you're done with this part. Reload the extension at
chrome://extensions and test again.

WHY THESE SPECIFIC FILES (not the single tf.min.js we tried before):
TensorFlow.js's normal all-in-one bundle includes CPU/WebGL backends that
use JavaScript's eval-style code generation, which Chrome permanently
blocks inside extensions. These 4 files are the modular, WASM-only
version of the library — WASM is compiled code, not eval'd JavaScript,
so Chrome allows it. tf-core is the library itself, tf-converter adds
support for loading the graph-model format your NSFW model uses,
tf-backend-wasm registers the WASM engine, and the .wasm file is the
actual compiled engine that does the math.

STILL NOT FIXED YET (separate, known issue, not attempted in this pass):
OCR (text-in-images via tesseract.js) still loads from a CDN and will
still show a CSP error in the console. It has the same root cause as
what we just fixed, but needs its own separate self-hosting treatment.
Text scanning on the page itself and NSFW image detection should both
work once the 4 files above are in place — OCR specifically will still
be broken until we tackle it next.
