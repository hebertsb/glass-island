// Micro-sonidos HUD futuristas (Web Audio API puro, 0 archivos externos, latencia <2ms)

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(
  freqStart: number,
  freqEnd: number,
  durationSec: number,
  gainPeak: number,
  delaySec = 0,
  type: OscillatorType = "sine",
) {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, now);
  if (freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(freqEnd, now + durationSec);
  }
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

/** Pulso cristalino ascendente cuando Nova se activa o empieza a escuchar */
export function playWakeChime(enabled = true): void {
  if (!enabled) return;
  try {
    playTone(587.33, 880, 0.11, 0.055, 0, "sine");
    playTone(880, 1174.66, 0.14, 0.045, 0.065, "triangle");
  } catch {
    // ignore
  }
}

/** Pulso suave de procesamiento / pensando */
export function playThinkChime(enabled = true): void {
  if (!enabled) return;
  try {
    playTone(523.25, 659.25, 0.12, 0.035, 0, "sine");
  } catch {
    // ignore
  }
}

/** Confirmación futurista suave tipo KAI/AVA al completar una orden */
export function playDoneChime(enabled = true): void {
  if (!enabled) return;
  try {
    playTone(659.25, 659.25, 0.09, 0.045, 0, "sine");
    playTone(987.77, 1046.5, 0.16, 0.05, 0.07, "sine");
  } catch {
    // ignore
  }
}
