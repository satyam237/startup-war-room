import type { VoiceRole } from './types'

/**
 * HD casting: Kokoro-82M voice ids, checked against kokoro-js 1.2.1's voice table (`tts.voices`).
 * Three men and three women, split across US and UK English, so neighbours in the debate never sound alike.
 */
export const KOKORO_VOICE: Record<VoiceRole, string> = {
  moderator: 'am_fenrir', // US male: the ring announcer
  vc: 'am_michael', // US male
  customer: 'af_heart', // US female
  cto: 'bf_emma', // UK female
  competitor: 'bm_fable', // UK male
  founder: 'af_bella', // US female
}

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
/** q8 loads onnx/model_quantized.onnx: 92,361,116 bytes on the Hugging Face repo (checked 2026-11-08). */
export const KOKORO_DTYPE = 'q8'
export const KOKORO_MODEL_BYTES = 92_361_116
/**
 * What the listener actually downloads the first time, measured in Chromium on 2026-11-08: the q8 weights (92.4 MB),
 * the ONNX runtime from jsDelivr (4.1 MB compressed) and about 0.5 MB per voice for six voices (3.1 MB).
 */
export const HD_DOWNLOAD_MB = 100

/** Instant casting wants these genders, so the debate keeps the same shape as the HD cast. */
export const ROLE_GENDER: Record<VoiceRole, 'm' | 'f'> = {
  moderator: 'm', vc: 'm', customer: 'f', cto: 'f', competitor: 'm', founder: 'f',
}

/**
 * Pitch and rate per role for the browser's own voices. Distinct pairs keep roles apart even when the
 * device has a single voice installed. Rate is multiplied by the listener's chosen speed.
 */
export const ROLE_TONE: Record<VoiceRole, { pitch: number; rate: number }> = {
  moderator: { pitch: 0.85, rate: 0.95 },
  vc: { pitch: 1.0, rate: 1.05 },
  customer: { pitch: 1.2, rate: 1.0 },
  cto: { pitch: 1.05, rate: 0.95 },
  competitor: { pitch: 0.75, rate: 1.1 },
  founder: { pitch: 1.12, rate: 1.05 },
}

/** Speaking order for casting: the announcer first, since it talks most. */
export const CAST_ORDER: VoiceRole[] = ['moderator', 'vc', 'customer', 'cto', 'competitor', 'founder']
