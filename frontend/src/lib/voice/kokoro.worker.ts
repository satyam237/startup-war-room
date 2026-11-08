/// <reference lib="webworker" />
/**
 * Runs Kokoro-82M off the main thread. Loaded only when the listener chooses HD voices.
 * Protocol (see WorkerReply in hdEngine.ts):
 *   in:  { type: 'load' } | { type: 'speak', id, text, voice }
 *   out: progress, ready, load-error, audio (a WAV ArrayBuffer, transferred), speak-error
 * WebGPU is tried first where the browser offers it; any WebGPU failure falls back to WASM.
 */
import { KokoroTTS } from 'kokoro-js'
import { KOKORO_DTYPE, KOKORO_MODEL, KOKORO_MODEL_BYTES } from './cast'

declare const self: DedicatedWorkerGlobalScope

type Device = 'webgpu' | 'wasm'
type Incoming = { type: 'load' } | { type: 'speak'; id: number; text: string; voice: string }
type Progress = { status: string; file?: string; loaded?: number; total?: number }

let tts: Promise<KokoroTTS> | null = null
let queue: Promise<unknown> = Promise.resolve() // one render at a time

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!gpu && (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

function load(): Promise<KokoroTTS> {
  if (tts) return tts
  const files = new Map<string, { loaded: number; total: number }>()
  const progress_callback = (p: Progress) => {
    if (p.status !== 'progress' || !p.file) return
    // Some hosts send no content-length for the weights; the size of the file we ask for is known.
    const size = p.total || (p.file.endsWith('.onnx') ? KOKORO_MODEL_BYTES : 0)
    // Small files (config, tokenizer) finish first and would flash the bar to 100 percent; count only the weights.
    if (size < 1_000_000) return
    files.set(p.file, { loaded: Math.min(p.loaded ?? 0, size), total: size })
    let loaded = 0
    let total = 0
    for (const f of files.values()) { loaded += f.loaded; total += f.total }
    self.postMessage({ type: 'progress', loaded, total })
  }
  const open = (device: Device) => KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: KOKORO_DTYPE, device, progress_callback })
  tts = (async () => {
    let device: Device = (await hasWebGPU()) ? 'webgpu' : 'wasm'
    let model: KokoroTTS
    try {
      model = await open(device)
      if (device === 'webgpu') {
        // A WebGPU fault shows up on first use, sometimes as silent or NaN samples rather than an error.
        const probe = await model.generate('Ready.', { voice: 'af_heart' })
        if (!probe.audio.length || probe.audio.some(Number.isNaN) || !probe.audio.some((s) => Math.abs(s) > 1e-3)) {
          throw new Error('WebGPU produced no usable audio')
        }
      }
    } catch (e) {
      if (device !== 'webgpu') throw e
      device = 'wasm'
      model = await open(device) // files are cached by now, so this costs no second download
    }
    self.postMessage({ type: 'ready', device })
    return model
  })()
  tts.catch((e: unknown) => {
    tts = null
    self.postMessage({ type: 'load-error', message: e instanceof Error ? e.message : String(e) })
  })
  return tts
}

self.onmessage = (e: MessageEvent<Incoming>) => {
  const msg = e.data
  if (msg.type === 'load') { void load().catch(() => {}); return }
  if (msg.type === 'speak') {
    queue = queue.then(async () => {
      try {
        const model = await load()
        const audio = await model.generate(msg.text, { voice: msg.voice as keyof KokoroTTS['voices'] })
        const wav = audio.toWav()
        self.postMessage({ type: 'audio', id: msg.id, wav }, [wav])
      } catch (err) {
        self.postMessage({ type: 'speak-error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
      }
    })
  }
}
