import {
  getBridge,
  type AppWidget,
  type InstalledAppEntry,
  type ModuleId,
  type NovaKnowledgeBase,
  type NovaToolId,
  type ShortcutItem,
  type TelemetryData,
  type ThemeStyle,
  type TodoItem,
  type WeatherData,
} from "../types";
import {
  consumePendingConfirm,
  formatContextForLlm,
  getActivePendingFolders,
  getContextWindow,
  getRecentTurnsForLlm,
  hasActiveConversationExpectation,
  isPendingNameRegistration,
  predictIntentWithContext,
  pushContextTurn,
  resolveContextualFollowup,
  setContextCity,
  setPendingConfirm,
  setPendingFolders,
  setPendingNameRegistration,
  trainDecisionTree,
  type FolderChoice,
} from "./novaDecisionTree";

import {
  adaptReplyToPersonality,
  detectUserAttitude,
  type AttitudeProfile,
  type PersonalityMode,
} from "./novaPersonality";
import {
  clasificarEspecialista,
  evaluarPoliticaAprobacion,
  resolverCalculoCodeAct,
  UMBRAL_CONFIANZA_ROUTER,
} from "./novaAgenticPatterns";

export {
  hasActiveConversationExpectation,
  setPendingFolders,
  setPendingNameRegistration,
  detectUserAttitude,
  type FolderChoice,
  type AttitudeProfile,
  type PersonalityMode,
};

export interface SubuResult {
  reply: string;
  ok: boolean;
  /** Actitud detectada del usuario (para entonación dinámica de voz y expresión del robot) */
  attitude?: AttitudeProfile;
  /** Si Nova no entendió, expone la frase normalizada para poder enseñársela en 1 clic */
  unknownPhrase?: string;
  /** Si encontró 2+ carpetas parecidas, las muestra como íconos 📁 clicables + elegibles por voz */
  folderChoices?: FolderChoice[];
  /** Mantiene el panel abierto esperando respuesta del usuario sin decir "Nova" */
  keepOpen?: boolean;
}

const DEFAULT_KB: NovaKnowledgeBase = {
  version: 1,
  patterns: [],
  aliases: {},
  stats: { totalCommands: 0 },
};

let cachedKb: NovaKnowledgeBase = { ...DEFAULT_KB };

export async function loadNovaKb(): Promise<NovaKnowledgeBase> {
  try {
    const loaded = await getBridge()?.kb_load();
    if (loaded && typeof loaded === "object") {
      cachedKb = {
        version: loaded.version || 1,
        patterns: Array.isArray(loaded.patterns) ? loaded.patterns : [],
        aliases: loaded.aliases && typeof loaded.aliases === "object" ? loaded.aliases : {},
        stats: loaded.stats || { totalCommands: 0 },
      };
      trainDecisionTree(cachedKb);
    }
  } catch {
    // ignore
  }
  return cachedKb;
}

export function getNovaKbStats(): { learnedCount: number; totalCommands: number } {
  return {
    learnedCount: cachedKb.patterns.length + Object.keys(cachedKb.aliases).length,
    totalCommands: cachedKb.stats.totalCommands,
  };
}

export function getNovaKbPatterns() {
  return [...cachedKb.patterns];
}

export async function deleteNovaPattern(phrase: string): Promise<void> {
  const clean = norm(phrase);
  cachedKb.patterns = cachedKb.patterns.filter((p) => norm(p.phrase) !== clean);
  trainDecisionTree(cachedKb);
  await getBridge()?.kb_save(cachedKb).catch(() => {});
}

export async function teachNovaPattern(
  phrase: string,
  tool: NovaToolId,
  arg: string,
): Promise<void> {
  const clean = norm(phrase);
  if (!clean) return;
  const existing = cachedKb.patterns.find((p) => p.phrase === clean);
  if (existing) {
    existing.tool = tool;
    existing.arg = arg;
    existing.hits += 1;
    existing.updatedAt = Date.now();
  } else {
    cachedKb.patterns.push({
      phrase: clean,
      tool,
      arg,
      hits: 1,
      updatedAt: Date.now(),
    });
  }
  trainDecisionTree(cachedKb);
  await getBridge()?.kb_save(cachedKb).catch(() => {});
}

export async function teachNovaAlias(spokenPhrase: string, realTarget: string): Promise<void> {
  const cleanSpoken = norm(spokenPhrase)
    .replace(/^(?:ve a|anda a|entra a|abre|abrime|abreme|ejecuta|inicia)\s+/, "")
    .trim();
  const cleanTarget = norm(realTarget);
  if (!cleanSpoken || !cleanTarget) return;
  cachedKb.aliases[cleanSpoken] = cleanTarget;
  cachedKb.patterns.push({
    phrase: norm(spokenPhrase),
    tool: "open_app",
    arg: realTarget,
    hits: 2,
    updatedAt: Date.now(),
  });
  trainDecisionTree(cachedKb);
  await getBridge()?.kb_save(cachedKb).catch(() => {});
}

function tokenSimilarity(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter((w) => w.length > 1));
  const sb = new Set(b.split(" ").filter((w) => w.length > 1));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / Math.max(sa.size, sb.size);
}

export async function executeNovaTool(
  tool: NovaToolId,
  arg: string,
  ctx: SubuContext,
): Promise<SubuResult> {
  const api = getBridge();
  const cleanArg = arg.trim();
  const boss = ctx.userName?.trim() || "Jefe";
  if (tool === "play_music") {
    const res = await api?.play_media_query(cleanArg, "youtube");
    return {
      ok: true,
      reply: res?.usedApp
        ? `Entendido, reproduciendo ${cleanArg} en tu app de YouTube.`
        : `Entendido, reproduciendo ${cleanArg} en YouTube.`,
    };
  }
  if (tool === "web_search") {
    await api?.launch(`https://www.google.com/search?q=${encodeURIComponent(cleanArg)}`);
    return { ok: true, reply: `Entendido, buscando ${cleanArg} en Google.` };
  }
  if (tool === "add_todo") {
    const nice = cleanArg.charAt(0).toUpperCase() + cleanArg.slice(1);
    ctx.addTodo(nice);
    return { ok: true, reply: `Listo, anoté la tarea: ${nice}.` };
  }
  if (tool === "close_app") {
    const res = await api?.close_app(cleanArg);
    return res?.ok
      ? { ok: true, reply: `Listo, cerrando ${cleanArg}.` }
      : { ok: false, reply: `No encontré una ventana abierta de ${cleanArg}.` };
  }
  if (tool === "open_project") {
    const res = await api?.open_project(cleanArg);
    return res?.ok
      ? { ok: true, reply: `¡Claro! Abriendo tu proyecto ${cleanArg}.` }
      : { ok: false, reply: `No encontré el proyecto ${cleanArg}.` };
  }
  if (tool === "create_project") {
    const res = await api?.create_project(cleanArg, "proyectos_personales", true);
    return res?.ok
      ? {
          ok: true,
          reply: `Listo, ${boss}. Creé la carpeta ${res.folderName} en ${res.baseName} y la abrí en Visual Studio Code.`,
        }
      : { ok: false, reply: `No pude crear el proyecto ${cleanArg}.` };
  }
  if (tool === "open_recent_file") {
    const res = await api?.open_recent_file?.(cleanArg);
    return res?.ok
      ? { ok: true, reply: `¡Claro! Abriendo tu archivo reciente ${res.name} desde ${res.folder}.` }
      : { ok: false, reply: `No encontré ningún archivo reciente parecido a "${cleanArg}".` };
  }
  if (tool === "move_window_display") {
    const target = /principal|1|uno/.test(norm(cleanArg)) ? "primary" : "secondary";
    const appHint = cleanArg.replace(/\b(principal|secundaria|pantalla\s*[12]|monitor\s*[12]|esta\s+ventana)\b/gi, "").trim();
    const res = await api?.move_window_display?.(appHint, target);
    return res?.ok
      ? { ok: true, reply: `Listo, moví ${res.title || "la ventana"} a tu ${res.target}.` }
      : { ok: false, reply: "No encontré una ventana abierta para mover entre pantallas." };
  }
  if (tool === "modo_programacion") return await executeSubuCommand("modo programacion", ctx, true);
  if (tool === "modo_proyecto") return await executeSubuCommand("modo proyecto", ctx, true);
  if (tool === "modo_semana") return await executeSubuCommand("modo semana", ctx, true);
  if (tool === "modo_casa") return await executeSubuCommand("modo casa", ctx, true);
  if (tool === "modo_universidad") return await executeSubuCommand("modo universidad", ctx, true);
  if (tool === "modo_descanso") return await executeSubuCommand("modo descanso", ctx, true);
  if (tool === "briefing") return await executeSubuCommand("resumen del dia", ctx, true);
  if (tool === "smart_home") {
    return await executeSubuCommand(cleanArg === "lights_off" ? "apaga las luces" : "prende las luces", ctx, true);
  }
  if (tool === "custom_macro") {
    const spec = norm(cleanArg);
    const doneSteps: string[] = [];
    if (/\b(?:hibernar|hibernacion|hiberna)\b/.test(spec)) {
      await api?.system_action("hibernate");
      return { ok: true, reply: `Hibernando tu laptop ahora, ${boss}.` };
    }
    if (/\b(?:suspender|suspende|dormir)\b/.test(spec)) {
      await api?.system_action("sleep");
      return { ok: true, reply: `Suspendiendo tu laptop ahora, ${boss}.` };
    }
    if (/\b(?:cero musica|sin musica|pausa.*musica|quita.*musica|silencia|apaga.*musica)\b/.test(spec)) {
      await api?.close_app("youtube").catch(() => {});
      await api?.media_control("vol_mute").catch(() => {});
      doneSteps.push("música silenciada");
    }
    if (/\b(?:visual studio code|vs code|vscode|proyecto activo|primer plano)\b/.test(spec)) {
      // Primero intenta traer al frente tu ventana YA ABIERTA de VS Code (sin abrir una vacía)
      const focused = await api?.focus_app?.("Code").catch(() => ({ ok: false }));
      if (!focused?.ok) {
        let appsList = ctx.installedApps;
        if (appsList.length === 0) appsList = (await api?.list_installed_apps().catch(() => [])) || [];
        const vsApp = appsList.find((a) => /visual studio code|^code$/i.test(a.name) || /^code$/i.test(a.processName));
        if (vsApp) await api?.launch(vsApp.lnkPath || vsApp.exePath);
      }
      doneSteps.push("Visual Studio Code en primer plano");
    }
    if (/\b(?:apagar.*notificaciones?|silenciar.*notificaciones?|sin notificaciones?|sin interrupciones?|no molestar|concentracion)\b/.test(spec)) {
      ctx.startFocus(30);
      ctx.setActiveTab?.("focus");
      await api?.system_action("dnd").catch(() => {});
      doneSteps.push("Focus activo y notificaciones silenciadas");
    }
    const brM = spec.match(/brillo\s+(?:al\s+)?(\d{1,3})/);
    if (brM) {
      const lvl = Math.max(10, Math.min(100, Number(brM[1])));
      ctx.setBrightness(lvl);
      await api?.set_brightness(lvl);
      doneSteps.push(`brillo al ${lvl}%`);
    }
    if (doneSteps.length > 0) {
      return { ok: true, reply: `Listo, ${boss}. Ejecuté tu rutina: ${doneSteps.join(", ")}.` };
    }
    // Si la rutina tiene otras instrucciones personalizadas, ejecútala directamente como comando (sin loop KB)
    return await executeSubuCommand(cleanArg, ctx, true);
  }
  // open_app (sin loop KB)
  return await executeSubuCommand(`abre ${cleanArg}`, ctx, true);
}

export interface SubuContext {
  assistantName: string;
  userName?: string;
  setUserName?: (name: string) => void;
  installedApps: InstalledAppEntry[];
  appWidgets: AppWidget[];
  shortcuts: ShortcutItem[];
  todos: TodoItem[];
  addTodo: (text: string) => void;
  completeTodo: (indexOneBased: number) => boolean;
  telemetry: TelemetryData;
  weather: WeatherData;
  brightness: number;
  setBrightness: (v: number) => void;
  startFocus: (mins?: number) => void;
  pauseFocus: () => void;
  setThemeStyle: (style: ThemeStyle) => void;
  setActiveTab?: (tab: ModuleId | `app:${string}`) => void;
  setQuickPrompt?: (text: string) => void;
  setAgentAnswer?: (ans: { agent: string; question: string; answer: string } | null) => void;
  scheduleReminder?: (delayMs: number, message: string) => void;
  codingMusic?: string;
  setCodingMusic?: (song: string) => void;
  setGlassDropUrl?: (url: string | null) => void;
  smartHomeWebhook?: string;
  personalityMode?: PersonalityMode;
  acousticTone?: "urgent" | "calm" | "normal";
  aiBrainEnabled?: boolean;
  geminiApiKey?: string;
  ollamaModel?: string;
}

export const VOICE_PROFILES = [
  { id: "gemini:Charon", label: "🎙️ Jarvis · Gemini Pro TTS (Ultra-humana + Caché 0ms)" },
  { id: "gemini:Aoede", label: "🎙️ AVA · Gemini Pro TTS (Ultra-humana + Caché 0ms)" },
  { id: "gemini:Fenrir", label: "🎙️ KAI · Gemini Pro TTS (Grave + Caché 0ms)" },
  { id: "gemini:Kore", label: "🎙️ Nova · Gemini Pro TTS (Natural + Caché 0ms)" },
  { id: "clone:jarvis", label: "🧬 Jarvis Clonado · 100% Offline (RTX 5050)" },
  { id: "en-US-BrianMultilingualNeural", label: "✨ Brian HD · Jarvis Grave (Gratis)" },
  { id: "en-US-AndrewMultilingualNeural", label: "✨ Andrew HD · KAI Natural (Gratis)" },
  { id: "en-US-EmmaMultilingualNeural", label: "✨ Emma HD · AVA Cálida (Gratis)" },
  { id: "en-US-AvaMultilingualNeural", label: "✨ Ava HD · Bilingüe ES/EN (Gratis)" },
  { id: "es-MX-JorgeNeural", label: "🎩 Jorge · J.A.R.V.I.S. Latino Grave (Gratis, Sin Límite)" },
  { id: "es-ES-AlvaroNeural", label: "🎩 Álvaro · J.A.R.V.I.S. Clásico Iron Man (Gratis, Sin Límite)" },
  { id: "es-CO-GonzaloNeural", label: "Gonzalo · Colombia Fluido (Gratis, Sin Límite)" },
  { id: "es-AR-TomasNeural", label: "Tomás · Argentina Natural (Gratis, Sin Límite)" },
  { id: "es-BO-SofiaNeural", label: "Sofía · Bolivia (Gratis, Sin Límite)" },
  { id: "es-BO-MarceloNeural", label: "Marcelo · Bolivia (Gratis, Sin Límite)" },
  { id: "es-MX-DaliaNeural", label: "Dalia · México (Gratis, Sin Límite)" },
] as const;

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Palabras comunes de inicio en Santa Cruz, Bolivia + español general
const GREET_PREFIX =
  "(?:(?:hola|oye|oiga|che|hey|hei|ey|ok|okay|buenas|haber|a ver|mira|disculpa|porfa|por favor|amiga|bella)\\s+)*";

// Palabras que confirman que una frase después de "era" es realmente una orden
const COMMAND_HINT_RE =
  /^(?:abre|abrir|abreme|abrime|abrile|cierra|cerrar|cerrame|cerra|cambia|cambiar|cambiame|cambiale|ejecuta|ejecutame|inicia|iniciame|lanza|entra|entrame|mostrame|muestrame|pon|pone|ponme|poneme|ponele|reproduce|reproducime|escuchar|quiero|play|toca|tocame|busca|buscar|buscame|dime|decime|contame|cuentame|fijate|chequea|revisa|recuerda|acordate|que|cual|cuales|cuanto|cuanta|cuantos|como|sube|subi|subile|subime|baja|bajale|bajame|alza|alzale|merma|mermale|pausa|pausar|siguiente|anterior|silencia|calla|callate|anota|anotame|agrega|agregame|apunta|apuntame|completa|focus|pomodoro|hola|buenas|gracias|quien|frutiger|modo)\b/;

export function extractWakeCommand(
  rawText: string,
  assistantName: string,
): { matched: boolean; command: string } {
  const q = norm(rawText);
  if (!q) return { matched: false, command: "" };
  const nameNorm = norm(assistantName || "nova");

  if (nameNorm === "nova") {
    // Coincidencia directa con "nova" y variantes fonéticas comunes ("no va", "noba", "nueva" tras saludo)
    const strongRe = new RegExp(`^${GREET_PREFIX}(?:nova|noba)\\b\\s*(.*)$`);
    const mStrong = q.match(strongRe);
    if (mStrong) return { matched: true, command: (mStrong[1] || "").trim() };

    // Si Google STT separó "nova" en "no va" o escuchó "nueva" después de "oye/hey/hola/che"
    const greetNoVa = new RegExp(
      `^(?:hola|oye|oiga|che|hey|hei|ey|ok|okay|buenas|haber|a ver|mira)\\s+(?:no va|nueva)\\b\\s*(.*)$`,
    );
    const mGreetNoVa = q.match(greetNoVa);
    if (mGreetNoVa) return { matched: true, command: (mGreetNoVa[1] || "").trim() };

    const bareNoVa = q.match(/^no va\b\s+(?:a\s+)?(.+)$/);
    if (bareNoVa) {
      const rest = bareNoVa[1].trim();
      if (COMMAND_HINT_RE.test(rest) || /^(?:pasar|mover|traer|abrir|cerrar|poner|buscar|crear)\b/.test(rest)) {
        return { matched: true, command: rest };
      }
    }
    return { matched: false, command: rawText };
  }

  if (nameNorm === "hera") {
    const strongRe = new RegExp(`^${GREET_PREFIX}(?:hera|jera|gera|hiera|cheera|chera)\\b\\s*(.*)$`);
    const mStrong = q.match(strongRe);
    if (mStrong) return { matched: true, command: (mStrong[1] || "").trim() };
    const greetEraRe = new RegExp(
      `^(?:hola|oye|oiga|che|hey|ey|ok|buenas|haber|a ver|mira)\\s+era\\b\\s*(.*)$`,
    );
    const mGreetEra = q.match(greetEraRe);
    if (mGreetEra) return { matched: true, command: (mGreetEra[1] || "").trim() };
    return { matched: false, command: rawText };
  }

  const re = new RegExp(`^${GREET_PREFIX}${escapeRegex(nameNorm)}\\b\\s*(.*)$`);
  const m = q.match(re);
  if (!m) return { matched: false, command: rawText };
  return { matched: true, command: (m[1] || "").trim() };
}

let activeAudio: HTMLAudioElement | null = null;

export async function speakAsSubu(
  text: string,
  enabled: boolean,
  voiceName = "en-US-EmmaMultilingualNeural",
  onStart?: () => void,
  onEnd?: () => void,
  geminiApiKey?: string,
  ttsStyle?: string,
): Promise<void> {
  if (!enabled || !text.trim()) return;
  try {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    const api = getBridge();
    const res = await api?.voice_speak(text, voiceName, geminiApiKey, ttsStyle).catch(() => null);
    if (res?.audio) {
      const audio = new Audio(res.audio);
      activeAudio = audio;
      audio.onloadedmetadata = () => {
        if (audio.duration && Number.isFinite(audio.duration)) {
          api?.voice_mute_for(audio.duration + 0.65).catch(() => {});
        }
      };
      audio.onplay = () => onStart?.();
      audio.onended = () => {
        if (activeAudio === audio) activeAudio = null;
        onEnd?.();
      };
      audio.onerror = () => {
        if (activeAudio === audio) activeAudio = null;
        onEnd?.();
      };
      await audio.play();
      return;
    }
  } catch {
    // fallback local si no hay red
  }

  // En Electron nunca caer a speechSynthesis robótico de Windows (mantiene voz 100% consistente)
  if (getBridge() || typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const voices = window.speechSynthesis.getVoices();
    const esVoice =
      voices.find((v) => /es-(BO|MX|419|CO|AR|US|ES)/i.test(v.lang)) ??
      voices.find((v) => v.lang.toLowerCase().startsWith("es"));
    if (!esVoice) {
      onEnd?.();
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = esVoice;
    utter.lang = esVoice.lang;
    utter.rate = 1.05;
    utter.onstart = () => onStart?.();
    utter.onend = () => onEnd?.();
    utter.onerror = () => onEnd?.();
    window.speechSynthesis.speak(utter);
  } catch {
    onEnd?.();
  }
}

const APP_ALIASES: Record<string, string[]> = {
  "visual studio code": ["vscode", "vs code", "visual studio", "visual estudio", "code"],
  "enterprise architect": ["architect", "architec", "arquitect", "enterprise", "ea"],
  "docker desktop": ["docker"],
  "antigravity": ["antigravity", "anti gravity"],
  "claude": ["claude", "claud"],
  "copilot": ["copilot", "copiloto"],
  "spotify": ["spotify", "espotifai"],
  "whatsapp": ["whatsapp", "wasap", "wsp", "guatsap"],
  "postman": ["postman"],
  "dbeaver": ["dbeaver"],
  "mongodb compass": ["mongo", "mongodb", "compass"],
  "blender": ["blender"],
  "intellij": ["intellij", "idea"],
  "steam": ["steam"],
  "discoclaro": ["discoclaro", "disco claro"],
  "terminal": ["terminal", "powershell", "consola", "cmd"],
  "google chrome": ["chrome", "google chrome", "crome"],
  "microsoft edge": ["edge"],
  "brave": ["brave"],
  "staruml": ["staruml", "uml"],
  "github desktop": ["github desktop"],
};

const WEB_FALLBACKS: Record<string, { label: string; url: string }> = {
  "youtube music": { label: "YouTube Music", url: "https://music.youtube.com" },
  "youtube": { label: "YouTube", url: "https://www.youtube.com" },
  "spotify": { label: "Spotify", url: "https://open.spotify.com" },
  "github": { label: "GitHub", url: "https://github.com/hebertsb" },
  "chatgpt": { label: "ChatGPT", url: "https://chatgpt.com" },
  "claude": { label: "Claude", url: "https://claude.ai" },
  "whatsapp": { label: "WhatsApp Web", url: "https://web.whatsapp.com" },
  "gmail": { label: "Gmail", url: "https://mail.google.com" },
  "facebook": { label: "Facebook", url: "https://www.facebook.com" },
  "instagram": { label: "Instagram", url: "https://www.instagram.com" },
  "discoclaro": { label: "DiscoClaro", url: "http://127.0.0.1:8347" },
};

export async function executeSubuCommand(
  rawInput: string,
  ctx: SubuContext,
  _skipKb = false,
): Promise<SubuResult> {
  const api = getBridge();
  const original = rawInput.trim();
  const name = ctx.assistantName?.trim() || "Nova";
  const boss = ctx.userName?.trim() || "Jefe";
  if (!original) return { ok: false, reply: "Dime qué necesitas que haga." };

  const wake = extractWakeCommand(original, name);
  let q = wake.matched ? wake.command : norm(original);
  // Limpia muletillas cruceñas/cortesías al inicio o final
  q = q
    .replace(/^(?:oye|che|oiga|haber|a ver|mira|porfa|por favor)\s+/g, "")
    .replace(/\s+(?:porfa|por favor|un ratito|porfis|amiga|bella)$/g, "")
    .trim();

  // Si la isla estaba abierta y el STT confundió la primera palabra antes de una orden clara
  // (ej. "shakira pon la musica firestone en youtube"), quita esa primera palabra suelta
  if (!wake.matched && !COMMAND_HINT_RE.test(q)) {
    const afterFirst = q.replace(/^\S+\s+/, "").trim();
    if (afterFirst && COMMAND_HINT_RE.test(afterFirst)) {
      q = afterFirst;
    }
  }

  // Limpia frases de cortesía como "quiero que ..." / "puedes ..."
  q = q.replace(/^(?:quiero que|puedes|podes|necesito que|por favor)\s+/, "").trim();

  // 0a0. Registro del nombre del dueño (con frase explícita o respondiendo a la bienvenida inicial)
  const explicitNameMatch = q.match(
    /^(?:me llamo|mi nombre es|llamame|dime|registra(?:me)?\s+(?:como|con el nombre|con)|soy)\s+([a-zñáéíóú\s]{2,28})$/i,
  );
  if (explicitNameMatch || isPendingNameRegistration()) {
    const rawCandidate = explicitNameMatch ? explicitNameMatch[1] : q;
    const cleaned = rawCandidate
      .replace(/^(?:con el nombre|con|como|me llamo|mi nombre es|soy|llamame|dime|ponme|registra(?:me)?)\s+/gi, "")
      .trim();
    const NOISE_NAME_RE =
      /\b(?:con|como|que|cual|quien|hola|buenas|tardes|dias|noches|nova|base|nombre|registro|registra)\b/i;
    if (
      cleaned.length >= 2 &&
      cleaned.split(" ").length <= 2 &&
      !NOISE_NAME_RE.test(cleaned) &&
      (explicitNameMatch || !COMMAND_HINT_RE.test(cleaned))
    ) {
      const prettyBoss = cleaned
        .split(" ")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      setPendingNameRegistration(false);
      ctx.setUserName?.(prettyBoss);
      const reply = `¡Perfecto, ${prettyBoss}! Quedas registrado en mi base como mi jefe oficial. ¿En qué trabajamos hoy?`;
      pushContextTurn("assistant", reply, "chat", prettyBoss);
      return { ok: true, reply };
    }
    setPendingNameRegistration(false);
  }

  // 0a. Selección por voz cuando Nova mostró carpetas parecidas ("abre la segunda", "la del medio", "la 1", "la última")
  // Protegido para no interceptar órdenes largas de archivos como "abre el último PDF que descargué"
  const activeFolders = getActivePendingFolders();
  if (
    activeFolders.length > 0 &&
    q.split(" ").length <= 5 &&
    !/\b(pdf|archivo|documento|video|foto|imagen|captura|informe)\b/.test(q)
  ) {
    let pickIdx = -1;
    if (/\b(primera|primero|uno|1)\b/.test(q)) pickIdx = 0;
    else if (/\b(segunda|segundo|dos|2)\b/.test(q)) pickIdx = 1;
    else if (/\b(tercera|tercero|tres|3)\b/.test(q)) pickIdx = 2;
    else if (/\b(cuarta|cuarto|cuatro|4)\b/.test(q)) pickIdx = 3;
    else if (/\b(quinta|quinto|cinco|5)\b/.test(q)) pickIdx = 4;
    else if (/\b(sexta|sexto|seis|6)\b/.test(q)) pickIdx = 5;
    else if (/\b(medio|en medio|centro)\b/.test(q)) pickIdx = Math.floor(activeFolders.length / 2);
    else if (/\b(ultima|ultimo)\b/.test(q)) pickIdx = activeFolders.length - 1;
    else {
      // También permite decir el nombre exacto de una de las carpetas listadas
      pickIdx = activeFolders.findIndex((f) => q.includes(norm(f.name)));
    }

    if (pickIdx >= 0 && pickIdx < activeFolders.length) {
      const chosen = activeFolders[pickIdx];
      setPendingFolders([]);
      const res = await api?.open_path_in_code(chosen.path);
      if (chosen.mode === "project_mode") {
        const song = ctx.codingMusic?.trim() || "Avicii Levels";
        ctx.setBrightness(75);
        await api?.set_brightness(75);
        ctx.startFocus(25);
        await api?.play_media_query(song, "youtube");
        ctx.setActiveTab?.("focus");
        const reply = `¡De una! Abriendo ${chosen.name} en Visual Studio Code, poniendo ${song}, brillo al 75% y Focus de 25 minutos.`;
        pushContextTurn("assistant", reply, "open_app", chosen.name);
        return { ok: true, reply };
      }
      const reply = `¡De una! Abriendo ${chosen.name} en ${res?.openedWith || "Visual Studio Code"}.`;
      pushContextTurn("assistant", reply, "open_app", "Visual Studio Code");
      return { ok: true, reply };
    }
  }

  // Confirmación contextual pendiente / Puerta Humana (Patrón 09 · Human-in-the-Loop: "sí", "aprobar", "confirmar", "rechazar", "cancelar")
  if (/^(?:no|cancelar|cancela|rechazar|rechaza|mejor no)\b/.test(q)) {
    const cancelled = consumePendingConfirm();
    if (cancelled) {
      const reply = `Entendido, ${boss}. Cancelé la acción: ${cancelled.label}.`;
      pushContextTurn("assistant", reply, "chat");
      return { ok: true, reply };
    }
  }
  if (
    /^(?:si|sii|claro|dale|de una|porfa|por favor|aprobar|apruebo|confirmar|confirmo|procede|adelante|abrelo|abrela|abrilo|abrila|quiero verlo|mostramelo)\b/.test(
      q,
    )
  ) {
    const pending = consumePendingConfirm();
    if (pending) {
      if (pending.kind === "system_action") {
        await api?.system_action(pending.target);
        const reply = `Aprobado, ${boss}. Ejecutando ${pending.label}.`;
        pushContextTurn("assistant", reply, "system_action", pending.target);
        return { ok: true, reply };
      }
      if (pending.promptText && api?.launch_and_paste) {
        await api.launch_and_paste(pending.target, pending.promptText, pending.label);
      } else {
        await api?.launch(pending.target);
      }
      const reply = pending.promptText
        ? `¡De una! Abriendo ${pending.label} y enviando "${pending.promptText}".`
        : `¡De una! Abriendo ${pending.label} para que lo veas tú mismo.`;
      pushContextTurn("assistant", reply, "open_app", pending.label);
      return { ok: true, reply };
    }
  }

  // Patrón 06 · CodeAct seguro: cálculos exactos, porcentajes y conteo de archivos en < 1 ms sin alucinar
  const codeActCalc = resolverCalculoCodeAct(q);
  if (codeActCalc.matched && codeActCalc.reply) {
    pushContextTurn("assistant", codeActCalc.reply, "chat", codeActCalc.expression);
    return { ok: true, reply: codeActCalc.reply };
  }
  if (/\b(?:cuantos\s+(?:archivos|pdfs?|videos?|fotos?|imagenes?|documentos?))\b/.test(q)) {
    const sys = await api?.get_system_context?.().catch(() => null);
    const files = sys?.recentFiles || [];
    const wantPdf = /\bpdfs?\b/.test(q);
    const filtered = wantPdf ? files.filter((f) => f.ext === "pdf") : files;
    const names = filtered.slice(0, 3).map((f) => f.name).join(", ");
    const reply =
      filtered.length > 0
        ? `Detecté ${filtered.length} ${wantPdf ? "archivos PDF recientes" : "archivos recientes"} en tus carpetas (los más nuevos: ${names}).`
        : "No encontré archivos recientes de ese tipo en tus carpetas.";
    pushContextTurn("assistant", reply, "system_status");
    return { ok: true, reply };
  }

  // Ventana de contexto GENÉRICA: resuelve seguimientos de cualquier tema (música, apps, brillo, tareas, clima)
  q = resolveContextualFollowup(q);
  pushContextTurn("user", q);

  // 0. Base de Conocimiento: enseñanza directa por voz (ANTES de compoundParts y agentQueryMatch para no partir macros con "y")
  // Ej: "recuerda modo hibernar es poner hibernación la laptop"
  //     "recuerda que modo análisis es cero música y abre VS Code en primer plano y apagar notificaciones"
  const teachAliasMatch = q.match(
    /^(?:recuerda|acordate|aprende|memoriza)\s+(?:que\s+)?(.+?)\s+(?:es|significa|sera|hace|quiere decir)\s+(.+)$/,
  );
  if (teachAliasMatch) {
    const aliasKey = teachAliasMatch[1].trim();
    const aliasVal = teachAliasMatch[2].trim();
    const isComplexMacro =
      aliasVal.split(" ").length >= 3 ||
      /\b(?:hibern|suspend|musica|notificacion|primer plano|brillo|focus|visual studio|apaga|prende)\b/.test(
        aliasVal,
      );
    if (isComplexMacro) {
      await teachNovaPattern(aliasKey, "custom_macro", aliasVal);
      return {
        ok: true,
        reply: `¡Memorizado, ${boss}! Guardé "${aliasKey}" en mi base de conocimiento. Cuando lo digas, ejecutaré exactamente esa rutina.`,
      };
    }
    cachedKb.aliases[aliasKey] = aliasVal;
    await getBridge()?.kb_save(cachedKb).catch(() => {});
    return {
      ok: true,
      reply: `¡Aprendido! Ya guardé en mi memoria que "${aliasKey}" es "${aliasVal}".`,
    };
  }

  // Delegación a Agentes IA instalados — detecta CUALQUIER conjugación ("quiero que busques en copilote qué significa mcp",
  // "busca en copilot...", "ve a claude y escribe...", "pregúntale a copilot...")
  // Nota: NO incluir "claro" para no chocar con "DiscoClaro" ni muletillas en español
  const agentQueryMatch = q.match(
    /\b(claude|claud|copilot|copilote|copiloto|copalo|copailot|co pilot|copilo|chatgpt|codex|antigravity|perplexity)\b\s+(?:(?:y\s+)?(?:escribe|escribi|escribas|busca|buscame|busques|pregunta|preguntale|preguntes|consulta|consultes|pon|dile|sobre)\s+)?(.+)$/,
  );
  if (agentQueryMatch && agentQueryMatch[2].trim().length >= 3) {
    const rawAgent = agentQueryMatch[1].trim();
    const agentName = /^(copalo|copiloto|copilote|copailot|co pilot|copilo)$/.test(rawAgent)
      ? "copilot"
      : /^(claud|claro)$/.test(rawAgent)
        ? "claude"
        : rawAgent;
    const promptText = agentQueryMatch[2].trim();
    const prettyAgent = agentName.charAt(0).toUpperCase() + agentName.slice(1);

    const widget = ctx.appWidgets.find(
      (w) => norm(w.name).includes(agentName) || norm(w.processName).includes(agentName),
    );
    if (widget) ctx.setActiveTab?.(`app:${widget.id}`);
    ctx.setQuickPrompt?.(promptText);
    await api?.set_clipboard(promptText).catch(() => {});

    let launchTarget =
      widget?.exePath ||
      WEB_FALLBACKS[agentName]?.url ||
      `https://www.google.com/search?q=${encodeURIComponent(promptText)}`;
    if (!widget) {
      let appsList = ctx.installedApps;
      if (appsList.length === 0) appsList = (await api?.list_installed_apps().catch(() => [])) || [];
      const inst = appsList.find(
        (a) => norm(a.name).includes(agentName) || norm(a.processName).includes(agentName),
      );
      if (inst) launchTarget = inst.lnkPath || inst.exePath;
    }

    // NO abre la ventana externa automáticamente: responde DIRECTO dentro de la tarjeta en la Isla
    // usando el Cerebro IA (Gemini / Ollama qwen2.5:7b) y solo abre la app si el usuario dice "sí"
    let inlineAnswer = "";
    if (api?.nova_llm_route) {
      const llm = await api
        .nova_llm_route({
          utterance: `Responde de forma clara, directa y útil en español (máximo 2 oraciones) a esta consulta: "${promptText}". Usa tool "chat".`,
          assistantName: name,
          geminiApiKey: ctx.geminiApiKey,
          ollamaModel: ctx.ollamaModel || "qwen2.5:7b",
          contextSummary: `Respuesta directa dentro de la tarjeta de ${prettyAgent} en GlassIsland.`,
        })
        .catch(() => null);
      if (llm?.ok && llm.data?.reply) {
        inlineAnswer = llm.data.reply.trim();
      }
    }

    ctx.setAgentAnswer?.({
      agent: prettyAgent,
      question: promptText,
      answer:
        inlineAnswer ||
        `Consulta lista y copiada al portapapeles ("${promptText}"). Pulsa Abrir o di "sí" para pegarla en ${prettyAgent}.`,
    });

    setPendingConfirm({
      kind: "launch",
      target: launchTarget,
      label: prettyAgent,
      promptText,
      at: Date.now(),
    });

    const reply = inlineAnswer
      ? `${inlineAnswer} ¿Quieres que te abra ${prettyAgent} para verlo ahí también?`
      : `Ya dejé lista tu consulta en ${prettyAgent}. ¿Quieres que abra la app para que lo veas tú mismo?`;
    pushContextTurn("assistant", reply, "open_app", prettyAgent);
    return { ok: true, reply, keepOpen: true };
  }

  // Órdenes compuestas múltiples (con o sin "y" entre cláusulas):
  // "cambia la canción por Levels bájame el brillo al 70 y pon Focus 25 minutos"
  const isOpenYoutubeAndPlay =
    /^(?:abre|abrir|abreme|abrime|entra a|entrame a)\s+(?:youtube\s+music|youtube|spotify)\s+y\s+(?:pon|pone|ponme|poneme|reproduce|busca|play)\b/.test(
      q,
    );
  const isTaskOrReminder =
    /^(?:anota|anotame|agrega|agregame|aniade|apunta|apuntame|crea|creame|haz|hazme|guarda|guardame|recuerdame|recordame|avisame)\b/.test(
      q,
    );
  if (!isOpenYoutubeAndPlay && !isTaskOrReminder) {
    const compoundParts = q
      .split(
        /\s+(?:(?:y\s+tambien|y\s+luego|y\s+despues|ademas|luego|despues|y)\s+)?(?=(?:bajame|bajale|subime|subile|mermale|alzale|pon\s+focus|pone\s+focus|inicia\s+focus|anotame|agregame|abrime|cerrame|toma\s+una\s+captura)\b)|\s+(?:y\s+tambien|y\s+luego|y\s+despues|ademas|luego|despues|y)\s+(?=(?:abre|abrir|abreme|cierra|pon|pone|ponme|poneme|reproduce|cambia|cambiame|sube|subi|baja|pausa|siguiente|anterior|toma|bloquea|anota|agrega|inicia|busca|buscame|dime|decime|que\s+hora|que\s+tarea|que\s+clima)\b)/,
      )
      .map((s) => s.trim())
      .filter(Boolean);
    if (compoundParts.length > 1) {
      const replies: string[] = [];
      let anyOk = false;
      for (const part of compoundParts) {
        const sub = await executeSubuCommand(part, ctx, _skipKb);
        if (sub.ok) anyOk = true;
        if (sub.reply) replies.push(sub.reply);
      }
      return { ok: anyOk, reply: replies.join(" ") };
    }
  }

  // 0b. Hibernar laptop directamente ("hiberna la laptop", "modo hibernar", "pon hibernacion")
  // Patrón 09 · Human-in-the-Loop: evalúa PoliticaAprobacion en código
  if (/\b(?:hiberna|hibernar|hibernacion)\b/.test(q)) {
    const pol = evaluarPoliticaAprobacion("hibernate");
    if (pol.nivel === "APROBAR" && !/\b(?:confirmado|confirmar|forzar|ahora mismo|sin preguntar)\b/.test(q)) {
      setPendingConfirm({
        kind: "system_action",
        target: "hibernate",
        label: pol.descripcionAccion,
        at: Date.now(),
      });
      return {
        ok: true,
        keepOpen: true,
        reply: `${boss}, requiere aprobación: ¿confirmas ${pol.descripcionAccion}? Di "sí" o "aprobar" para ejecutar.`,
      };
    }
    await api?.system_action("hibernate");
    return { ok: true, reply: `Entendido, ${boss}. Hibernando tu laptop ahora.` };
  }

  // 0b. Reemplaza alias aprendidos por el usuario dentro de la oración (solo si no es comando de sistema/proyecto)
  if (!_skipKb) {
    for (const [aliasKey, aliasVal] of Object.entries(cachedKb.aliases)) {
      if (aliasKey && aliasKey.length >= 3 && q.includes(aliasKey)) {
        q = q.replace(aliasKey, aliasVal);
      }
    }
  }

  // 0c. Consulta patrones aprendidos en nova_kb.json (exacto o similitud >= 0.8, protegido contra recursión infinita)
  if (!_skipKb && cachedKb.patterns.length > 0) {
    let bestPat = null;
    let bestScore = 0;
    for (const pat of cachedKb.patterns) {
      const score = pat.phrase === q ? 1 : tokenSimilarity(pat.phrase, q);
      if (score >= 0.8 && score > bestScore) {
        bestScore = score;
        bestPat = pat;
      }
    }
    if (bestPat) {
      bestPat.hits += 1;
      bestPat.updatedAt = Date.now();
      cachedKb.stats.totalCommands += 1;
      void getBridge()?.kb_save(cachedKb).catch(() => {});
      return await executeNovaTool(bestPat.tool, bestPat.arg, ctx);
    }
  }

  // 0d. Tool: Cambiar la canción actual por otra ("cambia la canción por La Macarena", "cámbiame esta música por Firestone")
  const switchSongMatch =
    !/\b(pantalla|monitor)\b/.test(q)
      ? q.match(
          /^(?:cambia|cambie|cambiar|cambiame|cambiale|pasala|pasa|pone otro tema|pon otra cancion|cambia el video)\s+(?:la\s+cancion\s+|esta\s+cancion\s+|la\s+musica\s+|esta\s+musica\s+|el\s+tema\s+|este\s+tema\s+|el\s+video\s+)?(?:por|a|para)?\s*(.+?)(?:\s+en\s+(youtube\s+music|youtube|spotify))?$/,
        )
      : null;
  if (switchSongMatch && switchSongMatch[1]) {
    const nextSong = switchSongMatch[1].replace(/^(?:por|a|el|la)\s+/, "").trim();
    const plat = (switchSongMatch[2] || "youtube").trim();
    if (nextSong && !/^(siguiente|anterior|tema|cancion|musica)$/.test(nextSong)) {
      const res = await api?.play_media_query(nextSong, plat);
      ctx.setActiveTab?.("music");
      const label =
        plat === "youtube music" ? "YouTube Music" : plat === "spotify" ? "Spotify" : "YouTube";
      const reply = res?.usedApp
        ? `Entendido, cambiando la canción por ${nextSong} en tu app de ${label}.`
        : `Entendido, cambiando la canción por ${nextSong} en ${label}.`;
      pushContextTurn("assistant", reply, "play_music", nextSong);
      return { ok: true, reply };
    }
  }

  // 0e. Tool: Cerrar ventana activa ("cierra esta ventana", "cierra esto") o cualquier app ("cierra YouTube")
  if (/^(?:cierra|cerrar|cerrame|cerra)\s+(?:esta\s+ventana|esto|la\s+ventana\s+activa|eso)$/.test(q)) {
    const res = await api?.close_active_window?.();
    return res?.ok
      ? { ok: true, reply: `Listo, cerrando ${res.title || "la ventana activa"}.` }
      : { ok: false, reply: "No encontré una ventana activa para cerrar." };
  }
  const closeAppMatch = q.match(/^(?:cierra|cerrar|cerrame|cerra|quita|quitame)\s+(?:la\s+app\s+|el\s+programa\s+|la\s+ventana\s+de\s+)?(.+)$/);
  if (closeAppMatch && closeAppMatch[1]) {
    const appTarget = closeAppMatch[1].trim();
    const res = await api?.close_app(appTarget);
    return res?.ok
      ? { ok: true, reply: `Listo, cerrando ${appTarget}.` }
      : { ok: false, reply: `No encontré una ventana abierta de ${appTarget}.` };
  }

  // 0e2. Tool: Mover ventana entre Pantalla Principal (1) y Secundaria (2) — INDEPENDIENTE DEL ORDEN DE LAS PALABRAS
  // Soporta tanto "llévalo Chrome a la pantalla 2" como "llévalo a la pantalla uno Chrome" o "pasa a la segunda pantalla VS Code"
  const MOVE_VERB_RE =
    /^(?:a\s+)?(?:pasa|pasame|pasalo|pasala|pasar|pasaron|mueve|moveme|muevelo|muevela|mover|trae|traeme|traelo|traela|traer|lleva|llevame|llevalo|llevala|llevar|manda|mandame|mandalo|mandala|mandar|envia|enviame|envialo|enviala|enviar|pon|ponme|ponlo|ponla)\b/;
  const SCREEN_TARGET_RE =
    /\b(?:(?:a\s+la|a\s+mi|a\s+esta|a\s+este|al|para\s+la|hacia\s+la|en\s+la)\s+)*(pantalla\s+principal|primera\s+pantalla|pantalla\s+primera|pantalla\s+1|pantalla\s+uno|monitor\s+principal|primer\s+monitor|monitor\s+1|monitor\s+uno|pantalla\s+de\s+la\s+laptop|pantalla\s+secundaria|segunda\s+pantalla|pantalla\s+segunda|pantalla\s+2|pantalla\s+dos|monitor\s+secundario|segundo\s+monitor|monitor\s+2|monitor\s+dos|otro\s+monitor|otra\s+pantalla|pantalla\s+contraria|monitor\s+contrario|esta\s+pantalla|este\s+monitor)\b/;
  const screenHit = MOVE_VERB_RE.test(q) ? q.match(SCREEN_TARGET_RE) : null;
  if (screenHit) {
    const dest = screenHit[1] || "";
    const isSecondary = /secundari|segund|\b2\b|\bdos\b|otr[oa]|contrari/.test(dest);
    const targetDisplay: "primary" | "secondary" = isSecondary ? "secondary" : "primary";
    let rawHint = q
      .replace(MOVE_VERB_RE, " ")
      .replace(new RegExp(SCREEN_TARGET_RE.source, "g"), " ")
      .replace(/\b(?:la\s+ventana|esta\s+ventana|esta\s+app|la\s+app|a\s+esta|a\s+este|a\s+la|a\s+mi|al|para\s+la|hacia\s+la|en\s+la|para|hacia|de|el|la|en|a|mi|esta|este|esto|eso)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/^(?:google|google chrome|chrome|crome|crohn|crom|crone|krom|chorme|navegador)$/i.test(rawHint)) rawHint = "chrome";
    else if (/^(?:vs code|vscode|visual studio code|visual studio|visual estudio|code)$/i.test(rawHint)) rawHint = "Code";
    else if (/^(?:edge|microsoft edge)$/i.test(rawHint)) rawHint = "msedge";
    else if (/^(?:whatsapp|wasap|wsp)$/i.test(rawHint)) rawHint = "WhatsApp";
    else if (/^(?:spotify|espotifai)$/i.test(rawHint)) rawHint = "Spotify";
    const res = await api?.move_window_display?.(rawHint, targetDisplay);
    if (res?.ok) {
      return { ok: true, reply: `Listo, traje ${res.title || "la ventana"} en primer plano a tu ${res.target}.` };
    }
    // Patrón 05 · Verificación de Observación y Replanificación (evita "confiar sin verificar"):
    // Si la observación dice que la ventana NO estaba abierta, la abre primero y luego la mueve
    if (rawHint) {
      let appsList = ctx.installedApps;
      if (appsList.length === 0) appsList = (await api?.list_installed_apps().catch(() => [])) || [];
      const matchedApp = appsList.find(
        (a) =>
          norm(a.name).includes(norm(rawHint)) ||
          norm(a.processName).includes(norm(rawHint)),
      );
      if (matchedApp) {
        await api?.launch(matchedApp.lnkPath || matchedApp.exePath);
        await api?.move_window_display?.(rawHint, targetDisplay).catch(() => {});
        const destLabel = targetDisplay === "secondary" ? "pantalla secundaria" : "pantalla principal";
        return {
          ok: true,
          reply: `Verifiqué que ${matchedApp.name} no estaba abierto, así que lo inicié y lo llevé a tu ${destLabel}.`,
        };
      }
    }
    return { ok: false, reply: "Verifiqué tus ventanas activas y no encontré esa aplicación abierta para moverla." };
  }

  // 0e3. Tool: Abrir archivos recientes sin saber la ruta exacta ("abre el último PDF que descargué", "abre la última captura", "abre la última")
  const recentFileMatch = q.match(
    /^(?:abre|abrir|abreme|abrime|mostrame)\s+(?:el|la)\s+(?:ultimo|ultima|reciente)(?:\s+(?:archivo|documento|pdf|video|foto|imagen|captura|word|excel|informe)\b.*)?$/,
  );
  if (recentFileMatch || /^(?:abre|abrir|abreme|abrime)\s+(?:el\s+archivo|el\s+documento|el\s+pdf|el\s+informe)\s+(.+)$/.test(q)) {
    const res = await api?.open_recent_file?.(q);
    return res?.ok
      ? { ok: true, reply: `¡Claro! Abriendo ${res.name} desde ${res.folder}.` }
      : { ok: false, reply: "No encontré un archivo reciente que coincida en tus carpetas." };
  }

  // 0e4. Consulta de ventanas abiertas ("qué tengo abierto", "qué ventanas están abiertas")
  if (/\b(?:que\s+tengo\s+abierto|que\s+ventanas|que\s+programas\s+estan\s+abiertos)\b/.test(q)) {
    const sys = await api?.get_system_context?.().catch(() => null);
    const list = (sys?.openWindows || []).slice(0, 5).map((w) => w.processName);
    if (list.length > 0) {
      return { ok: true, reply: `Tienes abierto ahora mismo: ${list.join(", ")}.` };
    }
    return { ok: true, reply: "No detecté otras ventanas abiertas en este momento." };
  }

  // 0f. Tools diarios del sistema (modos/rutinas, portapapeles inteligente, recordatorios, git/terminal, captura, energía)
  // 0) Cambiar la música favorita para Modo Programación / Proyecto
  const setMusicPref = q.match(
    /^(?:cambia|pon|guarda|configura)\s+(?:mi\s+)?musica\s+de\s+(?:programacion|proyecto|trabajo|codigo)\s+(?:a|por)\s+(.+)$/,
  );
  if (setMusicPref) {
    const newSong = setMusicPref[1].trim();
    ctx.setCodingMusic?.(newSong);
    return { ok: true, reply: `¡Listo! Guardé "${newSong}" como tu música para programar.` };
  }

  // 0d) CREAR PROYECTO / CARPETA NUEVA Y ABRIR EN VS CODE
  // Ej: "vamos a programar un software nuevo crea la carpeta en proyectos personales con el nombre crm"
  //     "crea un proyecto nuevo llamado inventario", "nueva carpeta tienda en universidad"
  if (
    /(?:crea|crear|creame|haz|hazme|arma|armame|inicia|empecemos|nuevo|nueva)\b.*(?:carpeta|proyecto|software|app|sistema|repositorio)/.test(
      q,
    )
  ) {
    const nameMatch =
      q.match(/(?:con el nombre|de nombre|llamado|llamada|que se llame|nombre)\s+([a-z0-9_\-\s]{2,40}?)(?:\s+(?:en|y|con|para)\b|$)/) ||
      q.match(/(?:carpeta|proyecto|software)\s+(?:nuevo\s+|nueva\s+)?([a-z0-9_\-]{2,32})(?:\s+(?:en|y|con)\b|$)/);
    if (nameMatch?.[1]) {
      const projName = nameMatch[1]
        .replace(/\b(?:en|proyectos?|personales?|escritorio|documentos?|universidad|visual|studio|code|vs|y|abrela|abrelo)\b/g, "")
        .trim();
      if (projName.length >= 2) {
        let locHint = "proyectos_personales";
        if (q.includes("escritorio") || q.includes("desktop")) locHint = "escritorio";
        else if (q.includes("documento")) locHint = "documentos";
        else if (q.includes("universidad") && !q.includes("personal")) locHint = "universidad";
        const res = await api?.create_project(projName, locHint, true);
        if (res?.ok) {
          const reply = res.existed
            ? `La carpeta ${res.folderName} ya existía en ${res.baseName}, ${boss}. Ya te la abrí en Visual Studio Code.`
            : `Listo, ${boss}. Creé la carpeta ${res.folderName} en ${res.baseName} y ya la abrí en Visual Studio Code.`;
          pushContextTurn("assistant", reply, "create_project", res.folderName);
          return { ok: true, reply };
        }
      }
    }
  }

  // 1) MODO PROYECTO interactivo: pregunta qué proyecto continuar y al elegir abre VS Code + música + brillo + Focus
  if (q.includes("modo proyecto") || q.includes("continuar proyecto") || q.includes("seguir con mi proyecto")) {
    const recents = (await api?.list_recent_projects().catch(() => [])) || [];
    const choices: FolderChoice[] = recents.map((r) => ({
      name: r.name,
      path: r.path,
      parent: r.parent,
      mode: "project_mode",
    }));
    if (choices.length > 0) {
      setPendingFolders(choices);
      const spoken = choices
        .slice(0, 4)
        .map((c, i) => `${i + 1}, ${c.name}`)
        .join("; ");
      const reply = `¿Qué proyecto quieres continuar hoy? Tus recientes son: ${spoken}. Haz clic en uno o dime su nombre.`;
      pushContextTurn("assistant", reply, "open_project");
      return { ok: true, reply, folderChoices: choices, keepOpen: true };
    }
  }

  // 1b) Modos / Rutinas en 1 orden (con frases coloquiales: "vamos a codear", "empecemos como modo programador", "modo dev")
  if (
    q.includes("modo programacion") ||
    q.includes("modo programador") ||
    q.includes("modo programar") ||
    q.includes("modo codigo") ||
    q.includes("modo dev") ||
    /(?:vamos a codear|a codear|pongamonos a programar|hora de programar|empecemos a programar|vamos a programar)$/.test(
      q,
    )
  ) {
    const customSongM = q.match(/\bcon\s+(.+)$/);
    const song = (customSongM?.[1] || ctx.codingMusic || "Avicii Levels").trim();
    ctx.setBrightness(75);
    await api?.set_brightness(75);
    ctx.startFocus(25);
    ctx.setActiveTab?.("focus");
    await api?.play_media_query(song, "youtube");
    // Trae al frente tu ventana existente de VS Code (o la abre si no estaba abierta)
    const focusedVs = await api?.focus_app?.("Code").catch(() => ({ ok: false }));
    if (!focusedVs?.ok) {
      let appsList = ctx.installedApps;
      if (appsList.length === 0) appsList = (await api?.list_installed_apps().catch(() => [])) || [];
      const vsApp = appsList.find((a) => /visual studio code|^code$/i.test(a.name) || /^code$/i.test(a.processName));
      if (vsApp) {
        await api?.launch(vsApp.lnkPath || vsApp.exePath);
      }
    }
    const reply = `Activando modo programación: abriendo Visual Studio Code, poniendo ${song}, brillo al 75% y Focus de 25 minutos.`;
    pushContextTurn("assistant", reply, "focus");
    return { ok: true, reply };
  }
  if (q.includes("modo universidad") || q.includes("modo estudio")) {
    await api?.system_action("university");
    ctx.setActiveTab?.("notes");
    const pending = ctx.todos.filter((t) => !t.done).length;
    const reply = `Activando modo universidad: abriendo tu carpeta y tienes ${pending} tareas pendientes.`;
    pushContextTurn("assistant", reply, "tasks");
    return { ok: true, reply };
  }
  if (q.includes("modo descanso") || q.includes("modo relax")) {
    ctx.pauseFocus();
    ctx.setBrightness(60);
    await api?.set_brightness(60);
    await api?.play_media_query("musica chill relajante", "youtube");
    ctx.setActiveTab?.("music");
    const reply = `Modo descanso activado, ${boss}. Focus pausado, brillo al 60 y música suave lista.`;
    pushContextTurn("assistant", reply, "play_music");
    return { ok: true, reply };
  }

  // 1c) BRIEFING INTELIGENTE estilo Jarvis ("buenos días", "resumen del día", "dame el reporte")
  if (
    q.includes("resumen del dia") ||
    q.includes("dame el reporte") ||
    q.includes("reporte del dia") ||
    q.includes("briefing") ||
    q.includes("como esta todo") ||
    /^(?:buenos dias|buen dia)$/.test(q)
  ) {
    const now = new Date();
    const hr = now.getHours();
    const greet = hr < 12 ? "Buenos días" : hr < 19 ? "Buenas tardes" : "Buenas noches";
    const timeStr = now.toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
    const pending = ctx.todos.filter((t) => !t.done).length;
    const disk = await api?.get_disk_summary().catch(() => null);
    let diskPart = `Tienes ${ctx.telemetry.disk_c_free_gb.toFixed(0)} gigas libres en C.`;
    if (disk?.ok && disk.volumes.length > 0) {
      const parts = disk.volumes.map((v) => `${v.freeGb} gigas libres en ${v.name.replace(":", "")}`);
      diskPart = `En DiscoClaro tienes ${parts.join(" y ")}.`;
    }
    const tasksPart =
      pending === 0
        ? "No tienes tareas pendientes."
        : pending === 1
          ? "Tienes 1 tarea pendiente."
          : `Tienes ${pending} tareas pendientes.`;
    const reply = `${greet}, ${boss}. Son las ${timeStr}. En ${ctx.weather.city} hace ${ctx.weather.temp_c} grados, ${ctx.weather.condition}. ${tasksPart} ${diskPart} ¿En qué proyecto trabajamos hoy?`;
    ctx.setActiveTab?.("home");
    pushContextTurn("assistant", reply, "briefing");
    return { ok: true, reply };
  }

  // 1d) MODO SEMANA ("organiza mi semana", "modo semana", "planifica mi semana")
  if (q.includes("organiza mi semana") || q.includes("modo semana") || q.includes("planifica mi semana")) {
    await api?.launch("https://calendar.google.com");
    ctx.setActiveTab?.("notes");
    const pending = ctx.todos.filter((t) => !t.done);
    const topTasks = pending.slice(0, 2).map((t) => t.text).join(" y ");
    const reply =
      pending.length > 0
        ? `Modo semana activado, ${boss}. Abriendo tu calendario. Tus prioridades pendientes son: ${topTasks}.`
        : `Modo semana activado, ${boss}. Abriendo Google Calendar y tus notas para planificar.`;
    pushContextTurn("assistant", reply, "tasks");
    return { ok: true, reply };
  }

  // 1e) MODO CASA / MODO NOCHE ("modo casa", "modo noche", "ya llegue")
  if (q.includes("modo casa") || q.includes("modo noche") || q === "ya llegue") {
    ctx.setBrightness(40);
    await api?.set_brightness(40);
    ctx.setThemeStyle("glass");
    if (ctx.smartHomeWebhook) {
      await api?.smart_home(ctx.smartHomeWebhook, "mode_home").catch(() => {});
    }
    await api?.play_media_query("lofi chill night beats", "youtube");
    ctx.setActiveTab?.("home");
    const reply = ctx.smartHomeWebhook
      ? `Modo casa activado, ${boss}. Luces ajustadas, brillo al 40 y música ambiente lista.`
      : `Modo casa activado, ${boss}. Brillo suave al 40, tema oscuro y música ambiente lista.`;
    pushContextTurn("assistant", reply, "mode_home");
    return { ok: true, reply };
  }

  // 1f) DOMÓTICA / LUCES ("prende las luces", "apaga las luces")
  if (/(?:prende|enciende|prendeme|encendeme|apaga|apagame)\s+(?:las?\s+)?luces?/.test(q)) {
    const turnOn = /(?:prende|enciende|prendeme|encendeme)/.test(q);
    const action = turnOn ? "lights_on" : "lights_off";
    if (!ctx.smartHomeWebhook?.trim()) {
      return {
        ok: false,
        reply: "Todavía no vinculaste un webhook de domótica. Pégalo en Ajustes, pestaña Nova e IA, para controlar tus luces.",
      };
    }
    const res = await api?.smart_home(ctx.smartHomeWebhook, action).catch(() => ({ ok: false }));
    const reply = res?.ok
      ? turnOn
        ? `Listo, ${boss}. Encendiendo las luces.`
        : `Listo, ${boss}. Apagando las luces.`
      : "No pude comunicarme con el webhook de tus luces. Revisa la URL en Ajustes.";
    pushContextTurn("assistant", reply, "smart_home", action);
    return { ok: Boolean(res?.ok), reply };
  }

  // 1g) MODO JUEGO / PANTALLA COMPLETA ("modo juego", "modo gamer")
  if (q.includes("modo juego") || q.includes("modo gamer")) {
    await api?.quick_control("power_high").catch(() => {});
    const reply = `Modo juego activado, ${boss}. Rendimiento al máximo y me ocultaré en pantalla completa hasta que me llames o subas el cursor arriba.`;
    pushContextTurn("assistant", reply, "mode_game");
    return { ok: true, reply };
  }

  // 1h) CONECTAR / DESCONECTAR CELULAR POR WI-FI (GlassDrop genérico Android/iOS)
  if (q.includes("desconecta mi celular") || q.includes("apaga glassdrop") || q.includes("cierra glassdrop")) {
    await api?.glassdrop_stop?.().catch(() => {});
    ctx.setGlassDropUrl?.(null);
    return { ok: true, reply: `Listo, ${boss}. Cerré la conexión Wi-Fi de GlassDrop.` };
  }
  if (
    q.includes("conecta mi celular") ||
    q.includes("conectar celular") ||
    q.includes("pasar archivo al celular") ||
    q.includes("enviar al celular") ||
    q.includes("glassdrop")
  ) {
    ctx.setActiveTab?.("shelf");
    const res = await api?.glassdrop_start?.().catch(() => null);
    if (res?.running && res.url) {
      ctx.setGlassDropUrl?.(res.url);
    }
    const reply = res?.running
      ? `Listo, ${boss}. Activé GlassDrop en el Estante. Escanea el código QR con cualquier celular en tu mismo Wi-Fi para enviar o recibir archivos.`
      : "Abrí el Estante. Pulsa Enviar o Recibir Celular para mostrar el código QR Wi-Fi.";
    pushContextTurn("assistant", reply, "glassdrop");
    return { ok: true, reply, keepOpen: true };
  }

  // 2) Recordatorios con alarma hablada ("recuérdame en 15 minutos subir los cambios", "recuérdame en un minuto llamar a Juan")
  const remWordNums: Record<string, number> = {
    un: 1,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    diez: 10,
    quince: 15,
    veinte: 20,
    treinta: 30,
  };
  const remMatch = q.match(
    /^(?:recuerdame|recordame|avisame|pon una alarma|pon un recordatorio)\s+en\s+(\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|diez|quince|veinte|treinta)\s+(segundos?|minutos?|horas?)\s*(?:que\s+|de\s+|para\s+)?(.+)$/,
  );
  if (remMatch) {
    const qty = Math.max(1, Number(remMatch[1]) || remWordNums[remMatch[1]] || 1);
    const unit = remMatch[2];
    const msg = remMatch[3].trim();
    const mult = unit.startsWith("hora") ? 3600_000 : unit.startsWith("min") ? 60_000 : 1000;
    ctx.scheduleReminder?.(qty * mult, msg);
    const reply = `¡Anotado! Te avisaré en ${qty} ${unit}: ${msg}.`;
    pushContextTurn("assistant", reply, "reminder", msg);
    return { ok: true, reply };
  }

  // 3) Portapapeles inteligente ("traduce lo que copié", "explícame el error que copié", "resume lo que copié")
  if (
    /(?:traduce|traduci|explica|explicame|resume|resumime|analiza|corrige)\b.*(?:copie|portapapeles|clipboard|este error|el error)/.test(
      q,
    )
  ) {
    const clip = ((await api?.get_clipboard().catch(() => "")) || "").trim();
    if (!clip) {
      return { ok: false, reply: "Tu portapapeles está vacío. Copia primero el texto o error con Ctrl+C." };
    }
    const actionLabel = q.includes("traduc")
      ? "Traduce al español de forma clara"
      : q.includes("resum")
        ? "Resume en 2 frases en español"
        : "Explica brevemente en español qué significa y cómo resolver este error o código";
    if (api?.nova_llm_route) {
      const llm = await api
        .nova_llm_route({
          utterance: `${actionLabel} (máximo 2 oraciones, usa tool "chat"):\n${clip.slice(0, 1200)}`,
          assistantName: name,
          geminiApiKey: ctx.geminiApiKey,
          ollamaModel: ctx.ollamaModel || "qwen2.5:7b",
          contextSummary: `Análisis inteligente del portapapeles de ${boss}.`,
        })
        .catch(() => null);
      if (llm?.ok && llm.data?.reply) {
        const reply = llm.data.reply.trim();
        pushContextTurn("assistant", reply, "clipboard");
        return { ok: true, reply, keepOpen: true };
      }
    }
    return { ok: true, reply: `En tu portapapeles tienes: "${clip.slice(0, 120)}".` };
  }

  // 4) Terminal y Git rápido por proyecto ("abre terminal en discoclaro", "git status de glass island")
  const termMatch = q.match(/^(?:abre|abrime|abreme)\s+(?:la\s+|una\s+)?(?:terminal|consola|powershell)\s+(?:en|de)\s+(?:el\s+proyecto\s+)?(.+)$/);
  if (termMatch) {
    const res = await api?.open_project_terminal(termMatch[1].trim());
    return res?.ok
      ? { ok: true, reply: `¡Claro! Abriendo terminal en ${res.folderName}.` }
      : { ok: false, reply: `No encontré la carpeta "${termMatch[1].trim()}".` };
  }
  const gitMatch = q.match(/(?:git\s+status|estado\s+de\s+git|como\s+esta\s+el\s+git)\s+(?:de|del|en)\s+(?:el\s+proyecto\s+)?(.+)$/);
  if (gitMatch) {
    const res = await api?.project_git_status(gitMatch[1].trim());
    if (res?.ok) {
      const reply =
        res.changes === 0
          ? `El repositorio ${res.folderName} en la rama ${res.branch} está limpio, sin cambios pendientes.`
          : `El repositorio ${res.folderName} en la rama ${res.branch} tiene ${res.changes} archivos modificados sin subir.`;
      return { ok: true, reply };
    }
    return { ok: false, reply: `No encontré un repositorio Git para "${gitMatch[1].trim()}".` };
  }

  // 5) Control de escritorio / energía (minimizar todo, vaciar papelera, suspender)
  if (q.includes("minimiza todo") || q.includes("muestra el escritorio") || q.includes("mostrame el escritorio")) {
    await api?.system_action("minimize_all");
    return { ok: true, reply: "Listo, todas las ventanas minimizadas." };
  }
  if (q.includes("vacia la papelera") || q.includes("vaciar papelera") || q.includes("limpia la papelera")) {
    const pol = evaluarPoliticaAprobacion("empty_recycle_bin");
    if (pol.nivel === "APROBAR" && !/\b(?:confirmado|confirmar|forzar|ahora mismo|sin preguntar)\b/.test(q)) {
      setPendingConfirm({
        kind: "system_action",
        target: "empty_recycle_bin",
        label: pol.descripcionAccion,
        at: Date.now(),
      });
      return {
        ok: true,
        keepOpen: true,
        reply: `${boss}, acción irreversible (nivel Aprobar): ¿confirmas ${pol.descripcionAccion}? Di "sí" o "aprobar".`,
      };
    }
    await api?.system_action("empty_recycle_bin");
    return { ok: true, reply: "¡Belleza! Papelera de reciclaje vaciada." };
  }
  if (q.includes("suspende la laptop") || q.includes("suspender laptop") || q.includes("suspende el pc")) {
    const pol = evaluarPoliticaAprobacion("sleep");
    if (pol.nivel === "APROBAR" && !/\b(?:confirmado|confirmar|forzar|ahora mismo|sin preguntar)\b/.test(q)) {
      setPendingConfirm({
        kind: "system_action",
        target: "sleep",
        label: pol.descripcionAccion,
        at: Date.now(),
      });
      return {
        ok: true,
        keepOpen: true,
        reply: `${boss}, requiere aprobación: ¿confirmas ${pol.descripcionAccion}? Di "sí" o "aprobar" para proceder.`,
      };
    }
    await api?.system_action("sleep");
    return { ok: true, reply: "Suspendiendo tu laptop. ¡Hasta pronto!" };
  }

  if (q.includes("captura") || q.includes("screenshot") || q.includes("pantallazo")) {
    const mode =
      /\b(todas|ambas|dos pantallas)\b/.test(q)
        ? "screenshot:all"
        : /\b(segunda|secundaria|pantalla 2|monitor 2)\b/.test(q)
          ? "screenshot:secondary"
          : "screenshot:primary";
    const res = await api?.system_action(mode);
    const label =
      mode === "screenshot:all"
        ? "de todas tus pantallas"
        : mode === "screenshot:secondary"
          ? "de tu pantalla secundaria"
          : "de tu pantalla principal";
    return res?.ok
      ? { ok: true, reply: `Listo, captura ${label} guardada y copiada en Clips.` }
      : { ok: false, reply: "No pude tomar la captura en este momento." };
  }
  if (q.includes("bloquea la pantalla") || q.includes("bloquear pantalla") || q.includes("bloquea la laptop") || q.includes("bloquea el pc")) {
    await api?.system_action("lock");
    return { ok: true, reply: "Bloqueando tu laptop." };
  }
  if (/^(?:abre|abrime|abreme|mostrame)\s+(?:mis\s+|la\s+carpeta\s+de\s+)?descargas$/.test(q)) {
    await api?.system_action("downloads");
    return { ok: true, reply: "¡Claro! Abriendo tu carpeta de Descargas." };
  }
  if (/^(?:abre|abrime|abreme|mostrame)\s+(?:mis\s+|la\s+carpeta\s+de\s+)?documentos$/.test(q)) {
    await api?.system_action("documents");
    return { ok: true, reply: "¡Claro! Abriendo tus Documentos." };
  }
  if (/^(?:abre|abrime|abreme|mostrame)\s+(?:el\s+|la\s+carpeta\s+de\s+)?universidad$/.test(q)) {
    await api?.system_action("university");
    return { ok: true, reply: "¡Claro! Abriendo tu carpeta de la Universidad." };
  }

  // 1. Saludo / Presentación / Cortesía (estilo Jarvis/AVA natural)
  if (/^(hola|buenas|buenas tardes|buenas noches|hey|que tal|como estas|saludos)$/.test(q) || q === "") {
    const hr = new Date().getHours();
    const greet = hr < 12 ? "Buenos días" : hr < 19 ? "Buenas tardes" : "Buenas noches";
    return {
      ok: true,
      reply: `${greet}, ${boss}. Aquí ${name}. ¿En qué trabajamos hoy?`,
    };
  }
  if (q.includes("quien eres") || q.includes("quien sos") || q.includes("como te llamas") || q.includes("que significas")) {
    return {
      ok: true,
      reply: `Soy ${name}, tu Núcleo Operativo Virtual de Asistencia. Puedo darte el resumen del día, abrir tus proyectos, poner música y controlar tu entorno.`,
    };
  }
  if (/^(gracias|muchas gracias|mil gracias|joya|belleza|de una|perfecto|genial|excelente|listo|chau|nos vemos)$/.test(q)) {
    return {
      ok: true,
      reply: `A la orden, ${boss}. Aquí sigo cuando me necesites.`,
    };
  }

  // 2. Tareas y Notas del día (leer, crear/anotar con alarma horaria opcional, completar)
  const addTaskMatch = q.match(
    /^(?:anota|anotame|agrega|agregame|aniade|apunta|apuntame|crea|creame|haz|hazme|guarda|guardame|pon|ponme|poneme|nueva|nuevo)\s+(?:una\s+|un\s+|la\s+|el\s+|en\s+mis\s+)?(?:nueva\s+|nuevo\s+|otra\s+|otro\s+)?(?:tarea|nota|pendiente|recordatorio)s?\b\s*(?:de\s+|para\s+|que\s+diga\s+|llamada\s+|con\s+titulo\s+)?(.*)$/,
  );
  if (addTaskMatch) {
    let rawTask = (addTaskMatch[1] || "").trim();
    if (!rawTask) {
      ctx.setActiveTab?.("notes");
      return {
        ok: true,
        reply: `Claro, ${boss}. Dime qué tarea o nota quieres que anote, y si quieres también a qué hora te aviso.`,
        keepOpen: true,
      };
    }

    // Detecta horario exacto ("a las 11 de la noche", "a las 23:00", "a las 8:30 pm") o relativo ("en 1 minuto", "de un minuto", "en 2 horas")
    let scheduledMs: number | null = null;
    let timeLabel = "";

    const wordNums: Record<string, number> = {
      un: 1,
      una: 1,
      uno: 1,
      dos: 2,
      tres: 3,
      cuatro: 4,
      cinco: 5,
      diez: 10,
      quince: 15,
      veinte: 20,
      treinta: 30,
    };
    const relMatch = rawTask.match(
      /\b(?:en|de|dentro de|para dentro de|para las de|las de)\s+(\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|diez|quince|veinte|treinta)\s+(segundos?|minutos?|horas?)\b/,
    );
    const clockMatch = rawTask.match(
      /\b(?:a\s+)?las?\s+(\d{1,2})(?::(\d{2})|\s+y\s+(media|cuarto))?(?:\s*(am|pm|de la manana|de la tarde|de la noche|hrs|horas))?\b/,
    );

    if (relMatch) {
      const qty = Math.max(1, Number(relMatch[1]) || wordNums[relMatch[1]] || 1);
      const unit = relMatch[2];
      const mult = unit.startsWith("hora") ? 3600_000 : unit.startsWith("min") ? 60_000 : 1000;
      scheduledMs = qty * mult;
      const targetDate = new Date(Date.now() + scheduledMs);
      timeLabel = targetDate.toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
      rawTask = rawTask
        .replace(relMatch[0], "")
        .replace(/^(?:para|de|que|las?)\b\s*/g, "")
        .replace(/\s+(?:para|de|las?)$/g, "")
        .trim();
    } else if (clockMatch) {
      let hr = Number(clockMatch[1]);
      let min = clockMatch[2]
        ? Number(clockMatch[2])
        : clockMatch[3] === "media"
          ? 30
          : clockMatch[3] === "cuarto"
            ? 15
            : 0;
      const period = (clockMatch[4] || "").toLowerCase();
      if ((period.includes("pm") || period.includes("tarde") || period.includes("noche")) && hr < 12) {
        hr += 12;
      } else if ((period.includes("am") || period.includes("manana")) && hr === 12) {
        hr = 0;
      }
      if (hr >= 0 && hr <= 23 && min >= 0 && min <= 59) {
        const now = new Date();
        const target = new Date(now);
        target.setHours(hr, min, 0, 0);
        if (target.getTime() <= now.getTime() + 5000) {
          target.setDate(target.getDate() + 1);
        }
        scheduledMs = target.getTime() - now.getTime();
        timeLabel = `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        rawTask = rawTask
          .replace(clockMatch[0], "")
          .replace(/^(?:para|de|que)\b\s*/g, "")
          .replace(/\s+(?:para|de)$/g, "")
          .trim();
      }
    }

    const cleanBody = rawTask || "Tarea programada";
    const nice = cleanBody.charAt(0).toUpperCase() + cleanBody.slice(1);
    const storedText = timeLabel ? `⏰ ${timeLabel} · ${nice}` : nice;
    ctx.addTodo(storedText);
    ctx.setActiveTab?.("notes");

    if (scheduledMs !== null && scheduledMs > 0 && scheduledMs <= 24 * 3600_000) {
      ctx.scheduleReminder?.(scheduledMs, nice);
      const reply = `Listo, ${boss}. Anoté tu tarea "${nice}" y programé tu alarma para las ${timeLabel}. Te avisaré cuando sea hora.`;
      pushContextTurn("assistant", reply, "tasks", nice);
      return { ok: true, reply };
    }

    const reply = `Listo, ${boss}. Anoté en tus tareas: ${nice}.`;
    pushContextTurn("assistant", reply, "tasks", nice);
    return { ok: true, reply };
  }

  const doneTaskMatch = q.match(
    /^(?:completa|completame|termina|marca|marcame|tacha)\s+(?:la\s+)?tarea\s+(?:numero\s+)?(\d+|uno|una|primera|dos|segunda|tres|tercera|cuatro|cinco)$/,
  );
  if (doneTaskMatch) {
    const mapNum: Record<string, number> = {
      uno: 1, una: 1, primera: 1, dos: 2, segunda: 2, tres: 3, tercera: 3, cuatro: 4, cinco: 5,
    };
    const rawN = doneTaskMatch[1];
    const num = mapNum[rawN] ?? Number(rawN);
    const ok = ctx.completeTodo(num);
    return ok
      ? { ok: true, reply: `¡Listo! Marqué la tarea ${num} como completada.` }
      : { ok: false, reply: `No encontré una tarea pendiente número ${num}.` };
  }

  if (
    q.includes("tareas") ||
    q.includes("pendientes") ||
    q.includes("que tengo para hoy") ||
    q.includes("que hay para hoy") ||
    q.includes("mi agenda")
  ) {
    const pending = ctx.todos.filter((t) => !t.done);
    if (pending.length === 0) {
      return {
        ok: true,
        reply: "¡Belleza! No tienes ninguna tarea pendiente para hoy. Todo está al día.",
      };
    }
    const listText = pending
      .slice(0, 5)
      .map((t, i) => `${i + 1}, ${t.text}`)
      .join("; ");
    return {
      ok: true,
      reply: `Tienes ${pending.length} ${pending.length === 1 ? "tarea pendiente" : "tareas pendientes"} para hoy: ${listText}.`,
    };
  }

  // 3. Tema visual Frutiger Aero / Liquid Glass
  if (q.includes("frutiger") || q.includes("aero")) {
    ctx.setThemeStyle("frutiger-aero");
    return { ok: true, reply: "¡Claro! Enseguida activo el estilo Frutiger Aero luminoso." };
  }
  if (q.includes("modo oscuro") || q.includes("liquid glass") || q.includes("vidrio oscuro")) {
    ctx.setThemeStyle("glass");
    return { ok: true, reply: "¡Listo! Volviendo al estilo Liquid Glass oscuro." };
  }

  // 4. Reproducción directa de canciones/videos
  // 4a. Frase compuesta natural: "abrime YouTube y pon Firestone", "abre Spotify y reproduce ..."
  const openAndPlayMatch = q.match(
    /^(?:abre|abrir|abreme|abrime|entra a|entrame a)\s+(youtube\s+music|youtube|spotify)\s+(?:y\s+)?(?:pon|pone|ponme|poneme|ponele|reproduce|reproducime|busca|buscame|play)(?:\s+(?:la\s+cancion\s+|la\s+musica\s+|el\s+tema\s+|el\s+video\s+)?(.+))?$/,
  );
  if (openAndPlayMatch) {
    const platform = openAndPlayMatch[1].trim();
    const song = (openAndPlayMatch[2] || "").trim();
    const label =
      platform === "youtube music" ? "YouTube Music" : platform === "spotify" ? "Spotify" : "YouTube";
    if (!song) {
      await api?.launch(WEB_FALLBACKS[platform]?.url || "https://www.youtube.com");
      return { ok: true, reply: `Abriendo ${label}. ¿Qué canción quieres que ponga?` };
    }
    const res = await api?.play_media_query(song, platform);
    return {
      ok: true,
      reply: res?.usedApp
        ? `Entendido, poniendo ${song} en tu app de ${label}.`
        : `No encontré la app de ${label} instalada, así que reproduzco ${song} en el navegador.`,
    };
  }

  // 4b. "poneme Firestone en YouTube", "reproduce La Macarena en YouTube Music"
  const songPlatformMatch = q.match(
    /^(?:pon|pone|ponme|poneme|ponele|reproduce|reproducime|escuchar|quiero escuchar|play|toca|tocame|busca|buscame)\s+(?:(?:la\s+)?(?:pon|pone|ponme|poneme)\s+)?(?:la\s+cancion\s+|la\s+musica\s+|el\s+tema\s+|el\s+video\s+|musica\s+de\s+|algo\s+de\s+)?(.+?)\s+en\s+(youtube\s+music|youtube|spotify|google|github)$/,
  );
  if (songPlatformMatch) {
    const queryTerm = songPlatformMatch[1].trim();
    const platform = songPlatformMatch[2].trim();
    const enc = encodeURIComponent(queryTerm);
    if (platform === "google") {
      await api?.launch(`https://www.google.com/search?q=${enc}`);
      return { ok: true, reply: `Entendido, buscando ${queryTerm} en Google.` };
    }
    if (platform === "github") {
      await api?.launch(`https://github.com/search?q=${enc}`);
      return { ok: true, reply: `Entendido, buscando ${queryTerm} en GitHub.` };
    }
    const label =
      platform === "youtube music" ? "YouTube Music" : platform === "spotify" ? "Spotify" : "YouTube";
    const res = await api?.play_media_query(queryTerm, platform);
    ctx.setActiveTab?.("music");
    const reply = res?.usedApp
      ? `Entendido, reproduciendo ${queryTerm} en tu app de ${label}.`
      : `No encontré la app de ${label} instalada, así que pongo ${queryTerm} en el navegador.`;
    pushContextTurn("assistant", reply, "play_music", queryTerm);
    return { ok: true, reply };
  }

  // "poneme Firestone", "reproduce La Macarena", "quiero escuchar rock" (sin decir "en youtube")
  const directPlayMatch = q.match(
    /^(?:pon|pone|ponme|poneme|ponele|reproduce|reproducime|quiero escuchar|toca|tocame)\s+(?:la\s+cancion\s+|la\s+musica\s+|el\s+tema\s+|el\s+video\s+|musica\s+de\s+|algo\s+de\s+)?(.+)$/,
  );
  if (directPlayMatch) {
    const candidate = directPlayMatch[1].trim();
    const isKnownAppAlias = Object.entries(APP_ALIASES).some(
      ([canon, aliases]) =>
        candidate === canon ||
        aliases.some((a) => candidate === a || new RegExp(`\\b${escapeRegex(a)}\\b`).test(candidate)),
    );
    const isInstalledApp = ctx.installedApps.some(
      (a) => norm(a.name) === candidate || norm(a.processName) === candidate,
    );
    // Si no coincide con una app, alias conocido ni focus/brillo/volumen, reprodúcelo directo en YouTube!
    if (
      !candidate.includes("focus") &&
      !candidate.includes("pomodoro") &&
      !candidate.includes("brillo") &&
      !candidate.includes("volumen") &&
      !WEB_FALLBACKS[candidate] &&
      !isKnownAppAlias &&
      !isInstalledApp
    ) {
      const res = await api?.play_media_query(candidate, "youtube");
      ctx.setActiveTab?.("music");
      const reply = res?.usedApp
        ? `Entendido, reproduciendo ${candidate} en tu app de YouTube.`
        : `Entendido, reproduciendo ${candidate} en YouTube.`;
      pushContextTurn("assistant", reply, "play_music", candidate);
      return { ok: true, reply };
    }
  }

  // 5. Controles de música y volumen (con cruceño: subile, bajale, mermale, alzale, callate)
  if (/^(pausa|pausar|deten|detener|para|parar|play|reproducir|continuar|reanudar|dale play)(\s+la\s+musica|\s+el\s+video)?$/.test(q)) {
    await api?.media_control("play_pause");
    return { ok: true, reply: "Listo, reproducción alternada." };
  }
  if (/^(siguiente|pasa|pasala|adelanta|next|cambia)(\s+cancion|\s+tema|\s+video)?$/.test(q)) {
    await api?.media_control("next");
    return { ok: true, reply: "Entendido, pasando a la siguiente." };
  }
  if (/^(anterior|atras|prev|regresa|volve|vuelve)(\s+cancion|\s+tema)?$/.test(q)) {
    await api?.media_control("prev");
    return { ok: true, reply: "Volviendo a la canción anterior." };
  }
  if (q.includes("silencia") || q.includes("mute") || q.includes("sin sonido") || q.includes("calla")) {
    await api?.media_control("vol_mute");
    return { ok: true, reply: "Sonido silenciado o reactivado." };
  }
  if (/(sube|subi|subile|subime|alza|alzale|mas)\b.*volumen/.test(q) || /volumen.*(mas|arriba|alto)/.test(q)) {
    for (let i = 0; i < 5; i++) await api?.media_control("vol_up");
    return { ok: true, reply: "Entendido, subiendo el volumen." };
  }
  if (/(baja|bajale|bajame|merma|mermale|menos)\b.*volumen/.test(q) || /volumen.*(menos|abajo|bajo)/.test(q)) {
    for (let i = 0; i < 5; i++) await api?.media_control("vol_down");
    return { ok: true, reply: "Entendido, bajando el volumen." };
  }

  // 6. Brillo de pantalla (subile/bajale/mermale el brillo)
  const brightNum = q.match(/brillo.*?(\d{1,3})/);
  if (brightNum) {
    const val = Math.max(5, Math.min(100, Number(brightNum[1])));
    ctx.setBrightness(val);
    await api?.set_brightness(val);
    const reply = `Listo, brillo ajustado al ${val} por ciento.`;
    pushContextTurn("assistant", reply, "brightness", String(val));
    return { ok: true, reply };
  }
  if (/(sube|subi|subile|subime|alza|alzale)\b.*brillo/.test(q)) {
    const val = Math.min(100, ctx.brightness + 20);
    ctx.setBrightness(val);
    await api?.set_brightness(val);
    const reply = `Brillo subido al ${val} por ciento.`;
    pushContextTurn("assistant", reply, "brightness", String(val));
    return { ok: true, reply };
  }
  if (/(baja|bajale|bajame|merma|mermale)\b.*brillo/.test(q)) {
    const val = Math.max(10, ctx.brightness - 20);
    ctx.setBrightness(val);
    await api?.set_brightness(val);
    const reply = `Brillo bajado al ${val} por ciento.`;
    pushContextTurn("assistant", reply, "brightness", String(val));
    return { ok: true, reply };
  }

  // 7. Focus / Pomodoro (captura correctamente cualquier número de minutos: "pon Focus 25 minutos")
  if (/\b(focus|pomodoro|temporizador|timer|concentracion)\b/.test(q)) {
    if (q.includes("pausa") || q.includes("deten") || q.includes("para")) {
      ctx.pauseFocus();
      return { ok: true, reply: "Temporizador Focus en pausa." };
    }
    const numM = q.match(/\b(\d{1,2})\b/);
    const mins = numM ? Number(numM[1]) : undefined;
    ctx.startFocus(mins);
    ctx.setActiveTab?.("focus");
    return {
      ok: true,
      reply: mins
        ? `Entendido, iniciando sesión Focus de ${mins} minutos.`
        : "Entendido, iniciando tu sesión Focus.",
    };
  }

  // 8. Consultas rápidas (hora, fecha, clima con ciudad + AccuWeather, batería, disco, RAM)
  const ctxWin = getContextWindow();
  if (/\b(?:que\s+horas?|que\s+hora|dime\s+la\s+hora|decime\s+la\s+hora|la\s+hora|hora\s+actual)\b/.test(q)) {
    const h = new Date().toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
    const reply = `Son las ${h}.`;
    pushContextTurn("assistant", reply, "time");
    return { ok: true, reply };
  }
  if (q.includes("fecha") || q.includes("que dia es") || q.includes("dia de hoy")) {
    const f = new Date().toLocaleDateString("es-BO", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const reply = `Hoy es ${f}.`;
    pushContextTurn("assistant", reply, "time");
    return { ok: true, reply };
  }
  if (
    q.includes("clima") ||
    q.includes("temperatura") ||
    q.includes("grados") ||
    q.includes("accuweather") ||
    q.includes("hace calor") ||
    q.includes("hace frio")
  ) {
    // Extrae ciudad si el usuario la mencionó (ej. "en Santa Cruz Bolivia", "en La Paz")
    const cityMatch = q.match(
      /\ben\s+(santa cruz(?:\s+de\s+la\s+sierra)?(?:\s+bolivia)?|la paz|cochabamba|sucre|tarija|oruro|potosi|beni|trinidad|pando|cobija|[a-z]+\s+bolivia)\b/,
    );
    const chosenCity = cityMatch
      ? cityMatch[1]
          .replace(/\bbolivia\b/g, "")
          .trim()
          .replace(/^santa cruz$/, "Santa Cruz de la Sierra") + ",Bolivia"
      : ctxWin.lastCity || "Santa Cruz de la Sierra,Bolivia";
    setContextCity(chosenCity);

    // Si pidió explícitamente AccuWeather (o abrir app del clima), busca y abre AccuWeather instalado
    let openedWeatherApp = false;
    if (q.includes("accuweather") || q.includes("app del clima") || q.includes("aplicacion del clima")) {
      let appsList = ctx.installedApps;
      if (appsList.length === 0) {
        appsList = (await api?.list_installed_apps().catch(() => [])) || [];
      }
      const weatherApp = appsList.find((a) =>
        /accuweather|tiempo|weather|clima/i.test(`${a.name} ${a.processName}`),
      );
      if (weatherApp) {
        await api?.launch(weatherApp.lnkPath || weatherApp.exePath);
        openedWeatherApp = true;
      }
    }

    const liveW = (await api?.get_weather(chosenCity).catch(() => null)) ?? ctx.weather;
    const fc = liveW.forecast ?? [];
    // Detecta si preguntó por "mañana", "pasado mañana" o un día específico (ej. "el 24")
    const dayNumMatch = q.match(/\b(?:el\s+|dia\s+|para\s+el\s+)(\d{1,2})\b/);
    let forecastReply = "";
    if (fc.length > 1 && (q.includes("pasado manana") || q.includes("pasado mañana"))) {
      const d2 = fc[2] ?? fc[1];
      forecastReply = `Para pasado mañana en ${liveW.city} se espera una máxima de ${d2.max_c} grados, mínima de ${d2.min_c} grados, ${d2.condition}.`;
    } else if (fc.length > 1 && (q.includes("manana") || q.includes("mañana"))) {
      const d1 = fc[1];
      forecastReply = `Para mañana en ${liveW.city} tendremos máxima de ${d1.max_c} grados y mínima de ${d1.min_c} grados, ${d1.condition}.`;
    } else if (dayNumMatch && fc.length > 0) {
      const targetDay = String(dayNumMatch[1]).padStart(2, "0");
      const matchedDay = fc.find((d) => d.date.endsWith(`-${targetDay}`));
      if (matchedDay) {
        forecastReply = `Para el ${dayNumMatch[1]} en ${liveW.city} se espera máxima de ${matchedDay.max_c} grados y mínima de ${matchedDay.min_c} grados, ${matchedDay.condition}.`;
      }
    }

    const baseWeatherReply =
      forecastReply || `En ${liveW.city} estamos a ${liveW.temp_c} grados, ${liveW.condition}.`;
    const reply = openedWeatherApp ? `Abriendo AccuWeather. ${baseWeatherReply}` : baseWeatherReply;
    pushContextTurn("assistant", reply, "weather", liveW.city);
    return { ok: true, reply };
  }
  const isOpenOrProjectCmd =
    /^(?:abre|abrir|abreme|abrime|abrile|ejecuta|ejecutame|inicia|iniciame|lanza|entra|entrame|crea|creame|cierra|cerrame)\b/.test(
      q,
    );
  if (
    !isOpenOrProjectCmd &&
    /\b(?:bateria|estado|disco|espacio|ram|cpu|laptop)\b/.test(q)
  ) {
    return {
      ok: true,
      reply: `Tu laptop está con batería al ${ctx.telemetry.battery_percent} por ciento, CPU al ${ctx.telemetry.cpu_percent} por ciento, RAM al ${ctx.telemetry.ram_percent} por ciento y tienes ${ctx.telemetry.disk_c_free_gb} gigas libres en el disco C.`,
    };
  }

  // 9. Abrir cualquier carpeta o proyecto con Visual Studio Code ("Abrir con Code"):
  // "abre mi proyecto discoclaro en visual studio code", "abrime la carpeta 2Parcial en code",
  // "abre 1Parcial_sw2 con code", "abrime el proyecto glass island"
  const projEnCodeMatch = q.match(
    /^(?:abre|abrir|abreme|abrime|abrile|ejecuta|inicia|mostrame|entra a)\s+(?:mi\s+|el\s+|la\s+)?(?:proyecto\s+|carpeta\s+)?(.+?)\s+(?:en|con)\s+(?:mi\s+)?(?:visual\s+studio\s+code|visual\s+estudio\s+code|visual\s+studio|visual|vs\s*code|vscode|code)$/,
  );
  const projPrefixMatch = q.match(
    /^(?:abre|abrir|abreme|abrime|abrile|ejecuta|inicia|mostrame|entra a)\s+(?:con\s+code\s+)?(?:mi\s+|el\s+|la\s+)?(?:proyecto|carpeta)\s+(.+)$/,
  );
  const matchedProjName = (projEnCodeMatch?.[1] || projPrefixMatch?.[1] || "").trim();
  if (matchedProjName) {
    const found = (await api?.find_projects(matchedProjName).catch(() => [])) || [];
    if (found.length === 1) {
      setPendingFolders([]);
      const res = await api?.open_path_in_code(found[0].path);
      const reply = `¡Claro! Abriendo la carpeta ${found[0].name} en ${res?.openedWith || "Visual Studio Code"}.`;
      pushContextTurn("assistant", reply, "open_app", "Visual Studio Code");
      return { ok: true, reply };
    }
    if (found.length > 1) {
      setPendingFolders(found);
      const reply = `Encontré ${found.length} carpetas parecidas a ${matchedProjName}. Haz clic en una o dime cuál abro, por ejemplo la primera o la segunda.`;
      pushContextTurn("assistant", reply, "open_project", matchedProjName);
      return {
        ok: true,
        reply,
        folderChoices: found,
        keepOpen: true,
      };
    }
    return {
      ok: false,
      reply: `No encontré ninguna carpeta parecida a "${matchedProjName}" en tu Universidad o proyectos.`,
    };
  }

  // 10. Abrir / Ejecutar cualquier app o sitio web (con cruceño: abrime, entrame, mostrame, abrile)
  const wantsNewWindow = /\b(?:nueva\s+ventana|otra\s+ventana|ventana\s+nueva)\b/.test(q);
  const openMatch = q.match(
    /^(?:abre|abrir|abreme|abrime|abrile|ejecuta|ejecutame|ejecutar|inicia|iniciame|iniciar|lanza|lanzame|entra|entrame|entra a|meteme a|mostrame|muestrame|pon|ponme|poneme)\s+(?:una\s+nueva\s+ventana\s+de\s+|otra\s+ventana\s+de\s+|la\s+app\s+|el\s+programa\s+|la\s+pagina\s+)?(.+)$/,
  );
  const targetQuery = (openMatch ? openMatch[1] : q).trim();

  // 10a. Revisar aliases conocidos de programador
  let canonical = targetQuery;
  for (const [canon, aliases] of Object.entries(APP_ALIASES)) {
    if (
      aliases.some((a) =>
        targetQuery === a || new RegExp(`\\b${escapeRegex(a)}\\b`).test(targetQuery),
      )
    ) {
      canonical = canon;
      break;
    }
  }

  // 10b. Buscar PRIMERO en App Widgets añadidos por el usuario
  const matchedWidget = ctx.appWidgets.find(
    (w) =>
      norm(w.name) === canonical ||
      norm(w.name).includes(canonical) ||
      norm(w.processName).includes(canonical),
  );
  if (matchedWidget) {
    ctx.setActiveTab?.(`app:${matchedWidget.id}`);
    await api?.launch(matchedWidget.exePath);
    const reply = `¡Claro! Abriendo tu app de ${matchedWidget.name}.`;
    pushContextTurn("assistant", reply, "open_app", matchedWidget.name);
    return { ok: true, reply };
  }

  // 10c. Buscar en TODAS las apps instaladas en Windows (incluye YouTube PWA, Spotify, VS Code, etc.)
  let appsList = ctx.installedApps;
  if (appsList.length === 0) {
    appsList = (await api?.list_installed_apps().catch(() => [])) || [];
  }
  const matchedInstalled =
    appsList.find((a) => norm(a.name) === canonical) ??
    appsList.find((a) => norm(a.name) === targetQuery) ??
    appsList.find(
      (a) =>
        (canonical !== "youtube music" || norm(a.name).includes("music")) &&
        (norm(a.name).includes(canonical) || norm(a.processName).includes(canonical)),
    );
  if (matchedInstalled) {
    // Si NO pidió explícitamente "nueva ventana", prioriza traer al frente la ventana YA abierta (VS Code, Chrome, etc.)
    if (!wantsNewWindow && matchedInstalled.processName && /^(?:Code|chrome|msedge|brave|Spotify|WhatsApp)$/i.test(matchedInstalled.processName)) {
      const focused = await api?.focus_app?.(matchedInstalled.processName).catch(() => ({ ok: false }));
      if (focused?.ok) {
        return { ok: true, reply: `¡Claro! Poniendo ${matchedInstalled.name} en primer plano.` };
      }
    }
    await api?.launch(matchedInstalled.lnkPath || matchedInstalled.exePath);
    return { ok: true, reply: `¡Claro! Enseguida abro tu app de ${matchedInstalled.name}.` };
  }

  // 10d. Buscar en accesos directos del usuario
  const matchedShortcut = ctx.shortcuts.find((s) => norm(s.name).includes(canonical));
  if (matchedShortcut) {
    await api?.launch(matchedShortcut.target);
    return { ok: true, reply: `¡Claro! Enseguida abro ${matchedShortcut.name}.` };
  }

  // 10e. Si NO estaba instalada en la laptop -> abrir en el navegador con aviso natural
  const web = WEB_FALLBACKS[canonical] ?? WEB_FALLBACKS[targetQuery];
  if (web) {
    await api?.launch(web.url);
    return {
      ok: true,
      reply: `No encontré la app de ${web.label} instalada en tu laptop, así que la abriré en el navegador.`,
    };
  }

  // 10g. Si empezó con "busca / buscame ..." -> Google
  if (/^(?:busca|buscar|buscame|investiga|investigame|googlea)\s+/.test(q)) {
    const term = q
      .replace(/^(?:busca|buscar|buscame|investiga|investigame|googlea)\s+(?:en\s+google\s+)?/, "")
      .trim();
    await api?.launch(`https://www.google.com/search?q=${encodeURIComponent(term)}`);
    return { ok: true, reply: `Entendido, buscando "${term}" en Google.` };
  }

  // 10h. Árbol de Decisiones en CPU (0% GPU): si tiene alta confianza (>= 0.78), resuelve sin despertar la GPU
  const treePred = predictIntentWithContext(q);
  if (treePred.intent && treePred.confidence >= 0.78) {
    if (treePred.intent === "weather") {
      const liveW = (await api?.get_weather(getContextWindow().lastCity).catch(() => null)) ?? ctx.weather;
      const reply = `En ${liveW.city} estamos a ${liveW.temp_c} grados, ${liveW.condition}.`;
      pushContextTurn("assistant", reply, "weather", liveW.city);
      return { ok: true, reply };
    }
    if (treePred.intent === "play_music") {
      const songArg = q.replace(/^(?:pon|poneme|cambia|reproduce|musica|cancion)\s+/g, "").trim() || q;
      const res = await executeNovaTool("play_music", songArg, ctx);
      pushContextTurn("assistant", res.reply, "play_music", songArg);
      return res;
    }
  }

  // 11. Cerebro IA Híbrido ReAct (Razonar con Contexto Vivo de la PC → Actuar → Auto-aprender)
  if (ctx.aiBrainEnabled !== false && api?.nova_llm_route) {
    const pendingList = ctx.todos
      .filter((t) => !t.done)
      .map((t) => t.text)
      .slice(0, 5)
      .join(", ");
    const recentHist = formatContextForLlm();
    const sysCtx = await api?.get_system_context?.().catch(() => null);
    const openWinsStr = (sysCtx?.openWindows || [])
      .slice(0, 6)
      .map((w) => `${w.processName} (${w.title.slice(0, 32)})`)
      .join(", ");
    const recentFilesStr = (sysCtx?.recentFiles || [])
      .slice(0, 6)
      .map((f) => `${f.name} [${f.folder}]`)
      .join(", ");
    // Patrón 07 · Router y Especialistas con umbral de confianza (0.6)
    const ruta = clasificarEspecialista(q);
    const specTag =
      ruta.confianza >= UMBRAL_CONFIANZA_ROUTER
        ? `Especialista activo: ${ruta.especialista} (confianza ${ruta.confianza}, tools focalizadas: ${ruta.herramientasPermitidas.join(", ")}). `
        : `Especialista: general (confianza ${ruta.confianza} < ${UMBRAL_CONFIANZA_ROUTER}; si la orden es ambigua, pide aclaración). `;
    const ctxSummary = `${specTag}Usuario: ${ctx.userName?.trim() || sysCtx?.userName || "Jefe"}, Monitores: ${sysCtx?.displaysCount || 1}, Ventanas abiertas: ${openWinsStr || "ninguna"}, Archivos recientes: ${recentFilesStr || "ninguno"}, Ciudad: ${getContextWindow().lastCity}, Batería ${ctx.telemetry.battery_percent}%, CPU ${ctx.telemetry.cpu_percent}%, RAM ${ctx.telemetry.ram_percent}%, Disco C libre ${ctx.telemetry.disk_c_free_gb} GB, Clima ${ctx.weather.temp_c}°C en ${ctx.weather.city}, Tareas pendientes: ${pendingList || "ninguna"}. Historial reciente: ${recentHist || "inicio de charla"}.`;
    const llm = await api
      .nova_llm_route({
        utterance: q,
        assistantName: name,
        geminiApiKey: ctx.geminiApiKey,
        ollamaModel: ctx.ollamaModel || "qwen2.5:7b",
        contextSummary: ctxSummary,
        recentTurns: getRecentTurnsForLlm(),
      })
      .catch(() => null);

    if (llm?.ok && llm.data) {
      const actions = Array.isArray(llm.data.actions) ? llm.data.actions : [];
      const failedObservations: string[] = [];
      for (const act of actions) {
        const t = String(act.tool || "");
        const a = String(act.arg || "").trim();
        // Patrón 09 · Verifica Política de Aprobación incluso si la acción fue propuesta por el LLM
        const pol = evaluarPoliticaAprobacion(t, a);
        if (pol.nivel === "APROBAR") {
          setPendingConfirm({
            kind: "system_action",
            target: a || t,
            label: pol.descripcionAccion,
            at: Date.now(),
          });
          return {
            ok: true,
            keepOpen: true,
            reply: `${boss}, política de seguridad (nivel Aprobar): ¿confirmas ${pol.descripcionAccion}? Di "sí" o "aprobar".`,
          };
        }
        if (t === "play_music" && a) {
          const r = await api.play_media_query(a, act.platform || "youtube");
          if (!r?.ok) failedObservations.push(`no se pudo reproducir ${a}`);
        } else if (t === "open_app" && a) {
          const r = await executeNovaTool("open_app", a, ctx);
          if (!r.ok) failedObservations.push(`no encontré la app ${a}`);
        } else if (t === "close_app" && a) {
          const r = await api.close_app(a);
          if (!r?.ok) failedObservations.push(`no había ventana abierta de ${a}`);
        } else if (t === "close_active_window") {
          const r = await api.close_active_window?.();
          if (!r?.ok) failedObservations.push("no había ventana activa para cerrar");
        } else if (t === "focus_app" && a) {
          const r = await api.focus_app?.(a);
          if (!r?.ok) failedObservations.push(`${a} no estaba abierto`);
        } else if (t === "move_window_display") {
          const targetDisp = act.platform === "primary" ? "primary" : "secondary";
          const r = await api.move_window_display?.(a, targetDisp);
          if (!r?.ok) failedObservations.push(`no encontré la ventana ${a || "activa"} para moverla`);
        } else if (t === "open_recent_file") {
          const r = await api.open_recent_file?.(a || q);
          if (!r?.ok) failedObservations.push(`no encontré un archivo reciente para "${a || q}"`);
        } else if (t === "open_project" && a) {
          const r = await api.open_project(a);
          if (!r?.ok) failedObservations.push(`no encontré el proyecto ${a}`);
        } else if (t === "create_project" && a) {
          const r = await api.create_project(a, act.platform || "proyectos_personales", true);
          if (!r?.ok) failedObservations.push(`no se pudo crear el proyecto ${a}`);
        } else if (t === "modo_programacion") {
          await executeSubuCommand("modo programacion", ctx, true);
        } else if (t === "modo_proyecto") {
          await executeSubuCommand("modo proyecto", ctx, true);
        } else if (t === "modo_semana") {
          await executeSubuCommand("modo semana", ctx, true);
        } else if (t === "modo_casa") {
          await executeSubuCommand("modo casa", ctx, true);
        } else if (t === "modo_universidad") {
          await executeSubuCommand("modo universidad", ctx, true);
        } else if (t === "modo_descanso") {
          await executeSubuCommand("modo descanso", ctx, true);
        } else if (t === "briefing") {
          await executeSubuCommand("resumen del dia", ctx, true);
        } else if (t === "smart_home") {
          await executeSubuCommand(a === "lights_off" ? "apaga las luces" : "prende las luces", ctx, true);
        } else if (t === "control_media" && a) {
          await api.media_control(a);
        } else if (t === "set_brightness" && typeof act.level === "number") {
          const lvl = Math.max(10, Math.min(100, Math.round(act.level)));
          ctx.setBrightness(lvl);
          await api.set_brightness(lvl);
        } else if (t === "start_focus") {
          ctx.startFocus(typeof act.level === "number" ? act.level : undefined);
        } else if (t === "add_todo" && a) {
          ctx.addTodo(a);
        } else if (t === "web_search" && a) {
          await api.launch(`https://www.google.com/search?q=${encodeURIComponent(a)}`);
        } else if (t === "system_action" && a) {
          await api.system_action(a);
        }
      }

      // Auto-aprendizaje ampliado: guarda TODAS las tools soportadas en nova_kb.json para aprender tus frases reales (<2ms local)
      const LEARNABLE_TOOLS = [
        "play_music",
        "open_app",
        "close_app",
        "open_project",
        "create_project",
        "open_recent_file",
        "move_window_display",
        "web_search",
        "add_todo",
        "modo_programacion",
        "modo_proyecto",
        "modo_semana",
        "modo_casa",
        "modo_universidad",
        "modo_descanso",
        "briefing",
        "smart_home",
      ];
      if (
        llm.data.learn !== false &&
        actions.length === 1 &&
        LEARNABLE_TOOLS.includes(actions[0].tool)
      ) {
        await teachNovaPattern(
          q,
          actions[0].tool as NovaToolId,
          String(actions[0].arg || actions[0].tool),
        );
      }

      // Patrón 01/05 · Verificación de Observación: nunca afirmar éxito si una herramienta devolvió error
      const llmReply =
        failedObservations.length > 0
          ? `Verifiqué el resultado y ${failedObservations.join(", ")}.`
          : llm.data.reply || `Listo, ${boss}.`;
      pushContextTurn(
        "assistant",
        llmReply,
        actions[0]?.tool || "chat",
        actions[0]?.arg ? String(actions[0].arg) : undefined,
      );
      return {
        ok: true,
        reply: llmReply,
      };
    }
  }

  return {
    ok: false,
    reply: `No entendí bien "${targetQuery}". Elige abajo qué herramienta usar y lo aprenderé para la próxima.`,
    unknownPhrase: q,
  };
}
