/**
 * Árbol de Decisiones + Ventana de Contexto en CPU (0% GPU, < 2 ms).
 *
 * Combina:
 * 1. Ventana de contexto conversacional (últimos 8 turnos + último tema/herramienta/ciudad).
 * 2. Clasificador ligero entrenado en CPU con ejemplos base (español cruceño/boliviano)
 *    + todos los patrones aprendidos en `nova_kb.json`.
 * 3. Retorna `{ intent, confidence }` para que Nova decida en < 2 ms sin despertar la GPU;
 *    solo despierta Ollama (RTX 5050, keep_alive 90s) cuando la confianza es baja.
 */

import type { NovaKnowledgeBase, NovaToolId } from "../types";

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  intent?: string;
  at: number;
}

export interface PendingConfirmation {
  kind: "launch";
  target: string;
  label: string;
  promptText?: string;
  at: number;
}

export interface FolderChoice {
  name: string;
  path: string;
  parent: string;
  /** Si es "project_mode", al elegir la carpeta también lanza música + brillo + Focus */
  mode?: "code_only" | "project_mode";
}

export interface ContextWindowState {
  turns: ConversationTurn[];
  lastIntent: string | null;
  lastEntity: string | null;
  lastCity: string;
  pendingConfirm: PendingConfirmation | null;
  pendingFolders: FolderChoice[];
  pendingFoldersUntil: number;
}

const contextState: ContextWindowState = {
  turns: [],
  lastIntent: null,
  lastEntity: null,
  lastCity: "Santa Cruz de la Sierra, Bolivia",
  pendingConfirm: null,
  pendingFolders: [],
  pendingFoldersUntil: 0,
};

export function setPendingConfirm(pending: PendingConfirmation | null): void {
  contextState.pendingConfirm = pending;
}

export function consumePendingConfirm(): PendingConfirmation | null {
  const cur = contextState.pendingConfirm;
  contextState.pendingConfirm = null;
  if (!cur || Date.now() - cur.at > 45_000) return null;
  return cur;
}

export function setPendingFolders(folders: FolderChoice[]): void {
  contextState.pendingFolders = folders;
  contextState.pendingFoldersUntil = folders.length > 0 ? Date.now() + 90_000 : 0;
}

export function getActivePendingFolders(): FolderChoice[] {
  if (contextState.pendingFolders.length === 0 || Date.now() > contextState.pendingFoldersUntil) {
    contextState.pendingFolders = [];
    return [];
  }
  return contextState.pendingFolders;
}

export function hasActiveConversationExpectation(): boolean {
  const now = Date.now();
  const hasFolders = contextState.pendingFolders.length > 0 && now <= contextState.pendingFoldersUntil;
  const hasConfirm = Boolean(contextState.pendingConfirm && now - contextState.pendingConfirm.at <= 45_000);
  return hasFolders || hasConfirm;
}

export function pushContextTurn(
  role: "user" | "assistant",
  text: string,
  intent?: string,
  entity?: string,
): void {
  contextState.turns.push({ role, text: text.slice(0, 220), intent, at: Date.now() });
  if (contextState.turns.length > 8) {
    contextState.turns.splice(0, contextState.turns.length - 8);
  }
  if (intent) contextState.lastIntent = intent;
  if (entity) contextState.lastEntity = entity;
}

export function setContextCity(city: string): void {
  if (city.trim()) contextState.lastCity = city.trim();
}

export function getContextWindow(): ContextWindowState {
  return contextState;
}

export function formatContextForLlm(): string {
  if (contextState.turns.length === 0) return "";
  return contextState.turns
    .slice(-6)
    .map((t) => `${t.role === "user" ? "Usuario" : "Nova"}: ${t.text}`)
    .join(" | ");
}

export function getRecentTurnsForLlm(): { role: "user" | "assistant"; text: string }[] {
  return contextState.turns.slice(-6).map((t) => ({ role: t.role, text: t.text }));
}

/**
 * Resolutor GENÉRICO de seguimientos conversacionales (funciona para cualquier tema:
 * música, apps, brillo, volumen, tareas, clima, etc.) usando los últimos turnos.
 */
export function resolveContextualFollowup(q: string): string {
  const { lastIntent, lastEntity } = contextState;
  if (!lastIntent) return q;

  // 1. "ciérrala" / "ciérralo" / "cerrala" -> cierra la última app o YouTube que abriste
  if (/^(?:cierrala|cierralo|cerrala|cerralo|cierrame eso|quita eso)$/.test(q)) {
    if (lastIntent === "play_music") return "cierra youtube";
    if (lastIntent === "open_app" && lastEntity) return `cierra ${lastEntity}`;
  }

  // 2. Seguimiento de brillo ("al 60", "subelo mas", "bajalo un poco")
  if (lastIntent === "brightness") {
    const pct = q.match(/^(?:al\s+|a\s+|ponlo\s+al\s+)?(\d{1,3})(?:\s*(?:%|por ciento))?$/);
    if (pct) return `brillo al ${pct[1]}`;
    if (/^(?:sube|subelo|subele|mas|mas alto)(\s+un poco|\s+mas)?$/.test(q)) return "sube el brillo";
    if (/^(?:baja|bajalo|bajale|menos|mermale)(\s+un poco|\s+mas)?$/.test(q)) return "baja el brillo";
  }

  // 3. Seguimiento de música / volumen ("subelo", "bajalo", "pausala", "otra: X", "mejor X")
  if (lastIntent === "play_music" || lastIntent === "media_control") {
    if (/^(?:sube|subelo|subele|mas fuerte|alza|alzale)(\s+un poco|\s+mas)?$/.test(q)) {
      return "sube el volumen";
    }
    if (/^(?:baja|bajalo|bajale|mas bajo|merma|mermale)(\s+un poco|\s+mas)?$/.test(q)) {
      return "baja el volumen";
    }
    if (/^(?:pausala|pausalo|detenla|parala|ponle pausa)$/.test(q)) {
      return "pausa la musica";
    }
    const swapM = q.match(/^(?:mejor\s+pon|mejor|pon\s+otra|otra|cambia\s+a|cambiala\s+por|cambialo\s+por)\s+(.+)$/);
    if (swapM) return `cambia la cancion por ${swapM[1].trim()}`;
  }

  // 4. Seguimiento de tareas ("agrega otra: X", "y tambien X")
  if (lastIntent === "tasks") {
    const moreTask = q.match(/^(?:agrega otra|anota otra|otra|y tambien|tambien)\s+(.+)$/);
    if (moreTask) return `anota una tarea ${moreTask[1].trim()}`;
  }

  // 5. Seguimiento de clima ("y mañana", "y el 24", "en La Paz", "en AccuWeather")
  if (lastIntent === "weather") {
    if (
      /^(?:y\s+)?(?:manana|mañana|pasado|el\s+\d{1,2}|para\s+el\s+\d{1,2}|no\s+en\s+|en\s+)/.test(q) ||
      q.includes("accuweather") ||
      q.includes("santa cruz")
    ) {
      return `clima ${q}`;
    }
  }

  return q;
}

// --- Clasificador ligero (Árbol de Decisión por ganancia de tokens en CPU) ---
export type TreeIntent =
  | NovaToolId
  | "weather"
  | "time"
  | "tasks_list"
  | "media_control"
  | "system_status";

interface TrainingSample {
  text: string;
  intent: TreeIntent;
}

const SEED_SAMPLES: TrainingSample[] = [
  // Música
  { text: "poneme firestone en youtube", intent: "play_music" },
  { text: "cambia la cancion por la macarena", intent: "play_music" },
  { text: "reproduce musica en youtube music", intent: "play_music" },
  { text: "quiero escuchar otro tema", intent: "play_music" },
  { text: "ponme algo de electronica avicii", intent: "play_music" },
  { text: "toca una cancion en youtube", intent: "play_music" },
  // Clima
  { text: "a cuantos grados estamos hoy", intent: "weather" },
  { text: "como esta el clima en santa cruz bolivia", intent: "weather" },
  { text: "temperatura en accuweather", intent: "weather" },
  { text: "hace calor hoy va a llover", intent: "weather" },
  // Apps
  { text: "abrime visual studio code", intent: "open_app" },
  { text: "ejecuta enterprise architect", intent: "open_app" },
  { text: "entra a accuweather", intent: "open_app" },
  { text: "abre whatsapp spotify chrome", intent: "open_app" },
  { text: "cierra youtube", intent: "close_app" },
  { text: "cerrame spotify", intent: "close_app" },
  { text: "quita esta ventana", intent: "close_app" },
  // Proyectos existentes y creación de proyectos nuevos
  { text: "abrime el proyecto discoclaro", intent: "open_project" },
  { text: "abre la carpeta synexoria en visual studio code", intent: "open_project" },
  { text: "abre 2parcial en code", intent: "open_project" },
  { text: "vamos a programar un software nuevo crea la carpeta crm", intent: "create_project" },
  { text: "crea un proyecto nuevo en proyectos personales llamado crm", intent: "create_project" },
  { text: "crea una carpeta nueva con el nombre tienda y abrela en vs code", intent: "create_project" },
  { text: "nuevo proyecto en escritorio llamado api", intent: "create_project" },
  { text: "empecemos un proyecto nuevo llamado inventario", intent: "create_project" },
  // Modos y rutinas (con frases coloquiales variadas)
  { text: "modo programacion", intent: "modo_programacion" },
  { text: "empecemos como modo programador", intent: "modo_programacion" },
  { text: "vamos a codear", intent: "modo_programacion" },
  { text: "pongamonos a programar", intent: "modo_programacion" },
  { text: "hora de programar arranca modo dev", intent: "modo_programacion" },
  { text: "modo codigo con musica", intent: "modo_programacion" },
  { text: "modo proyecto continuar proyecto", intent: "modo_proyecto" },
  { text: "en que proyecto seguimos trabajando", intent: "modo_proyecto" },
  { text: "organiza mi semana", intent: "modo_semana" },
  { text: "modo semana planifica mi agenda", intent: "modo_semana" },
  { text: "modo casa modo noche ya llegue", intent: "modo_casa" },
  { text: "activar modo noche ambiente", intent: "modo_casa" },
  { text: "modo universidad modo estudio", intent: "modo_universidad" },
  { text: "vamos a estudiar tareas de la u", intent: "modo_universidad" },
  { text: "modo descanso modo relax", intent: "modo_descanso" },
  { text: "quiero descansar un rato", intent: "modo_descanso" },
  // Briefing estilo Jarvis
  { text: "buenos dias resumen del dia", intent: "briefing" },
  { text: "dame el reporte como esta todo", intent: "briefing" },
  { text: "dame el parte del dia", intent: "briefing" },
  { text: "como amanecimos hoy", intent: "briefing" },
  // Domótica
  { text: "prende las luces enciende la luz", intent: "smart_home" },
  { text: "apaga las luces del cuarto", intent: "smart_home" },
  // Tareas, hora, sistema, media y búsquedas
  { text: "que tareas tengo para hoy", intent: "tasks_list" },
  { text: "decime mis pendientes", intent: "tasks_list" },
  { text: "anotame una tarea estudiar", intent: "add_todo" },
  { text: "apunta pendiente terminar informe", intent: "add_todo" },
  { text: "que horas son", intent: "time" },
  { text: "como esta la bateria y ram de la laptop", intent: "system_status" },
  { text: "subile el volumen pausa siguiente", intent: "media_control" },
  { text: "buscame en google react", intent: "web_search" },
];

// Árbol / pesos TF-IDF entrenados en memoria (0% GPU)
let intentTokenWeights: Map<TreeIntent, Map<string, number>> = new Map();
let totalTrainingExamples = SEED_SAMPLES.length;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

export function trainDecisionTree(kb?: NovaKnowledgeBase): { examples: number } {
  const samples: TrainingSample[] = [...SEED_SAMPLES];
  if (kb?.patterns) {
    for (const p of kb.patterns) {
      // Da mayor peso a frases reales enseñadas por el usuario
      const repeats = Math.min(4, Math.max(1, p.hits));
      for (let i = 0; i < repeats; i++) {
        samples.push({ text: p.phrase, intent: p.tool });
      }
    }
  }

  const docFreq = new Map<string, number>();
  const classCounts = new Map<TreeIntent, Map<string, number>>();
  const classTotals = new Map<TreeIntent, number>();

  for (const s of samples) {
    const toks = tokenize(s.text);
    const uniq = new Set(toks);
    for (const t of uniq) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    if (!classCounts.has(s.intent)) classCounts.set(s.intent, new Map());
    const cmap = classCounts.get(s.intent)!;
    for (const t of toks) {
      cmap.set(t, (cmap.get(t) ?? 0) + 1);
      classTotals.set(s.intent, (classTotals.get(s.intent) ?? 0) + 1);
    }
  }

  const nDocs = samples.length;
  const weights = new Map<TreeIntent, Map<string, number>>();
  for (const [intent, cmap] of classCounts.entries()) {
    const wmap = new Map<string, number>();
    const total = classTotals.get(intent) || 1;
    for (const [tok, count] of cmap.entries()) {
      const idf = Math.log(1 + nDocs / ((docFreq.get(tok) ?? 1) + 0.5));
      wmap.set(tok, (count / total) * idf);
    }
    weights.set(intent, wmap);
  }

  intentTokenWeights = weights;
  totalTrainingExamples = samples.length;
  return { examples: totalTrainingExamples };
}

export function getTreeStats(): { examples: number } {
  return { examples: totalTrainingExamples };
}

export function predictIntentWithContext(text: string): {
  intent: TreeIntent | null;
  confidence: number;
} {
  if (intentTokenWeights.size === 0) trainDecisionTree();
  const toks = tokenize(text);
  if (toks.length === 0) return { intent: null, confidence: 0 };

  let bestIntent: TreeIntent | null = null;
  let bestScore = 0;
  let secondScore = 0;

  for (const [intent, wmap] of intentTokenWeights.entries()) {
    let score = 0;
    for (const t of toks) {
      score += wmap.get(t) ?? 0;
    }
    // Bono suave de contexto si la frase es un seguimiento corto (ej. "en Santa Cruz", "en AccuWeather")
    if (toks.length <= 4 && contextState.lastIntent === intent) {
      score *= 1.25;
    }
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestIntent = intent;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (bestScore <= 0.05) return { intent: null, confidence: 0 };
  const margin = bestScore / (bestScore + secondScore + 0.001);
  return { intent: bestIntent, confidence: Math.min(0.99, Math.round(margin * 100) / 100) };
}

// Entrenamiento inicial en CPU al cargar
trainDecisionTree();
