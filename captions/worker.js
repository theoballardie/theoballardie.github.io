// Speech recognition runs here, off the main thread, so the page stays responsive.
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";

const MODELS = {
  tiny: "onnx-community/whisper-tiny.en_timestamped",
  base: "onnx-community/whisper-base_timestamped",
  small: "onnx-community/whisper-small.en_timestamped",
};

let asr = null;
let loaded = "";

async function hasWebGPU() {
  try {
    return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load(size) {
  if (asr && loaded === size) return;
  const progress_callback = (p) => postMessage({ type: "progress", ...p });
  const gpu = await hasWebGPU();
  const options = gpu
    ? { device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } }
    : { device: "wasm", dtype: { encoder_model: "q8", decoder_model_merged: "q8" } };
  try {
    asr = await pipeline("automatic-speech-recognition", MODELS[size], { ...options, progress_callback });
  } catch (err) {
    if (!gpu) throw err;
    options.device = "wasm";
    options.dtype = { encoder_model: "q8", decoder_model_merged: "q8" };
    asr = await pipeline("automatic-speech-recognition", MODELS[size], { ...options, progress_callback });
  }
  loaded = size;
  postMessage({ type: "ready", device: options.device });
}

self.onmessage = async ({ data }) => {
  try {
    await load(data.size);
    postMessage({ type: "status", text: "Listening to the audio" });
    const settings = { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 };
    if (data.size === "base") Object.assign(settings, { language: "english", task: "transcribe" });
    const out = await asr(data.audio, settings);
    const words = (out.chunks || [])
      .map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] }))
      .filter((w) => w.text);
    postMessage({ type: "done", words });
  } catch (err) {
    postMessage({ type: "error", text: String(err && err.message ? err.message : err) });
  }
};
