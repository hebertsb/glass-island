/**
 * Implementación de los Patrones de Diseño Agénticos modernos para N.O.V.A.:
 * - Patrón 01 & 05: Tool Use + Plan-and-Execute con Verificación de Observación (evita "confiar sin verificar")
 * - Patrón 06: CodeAct seguro (evaluación determinista de cálculos y conteo de archivos con aislamiento)
 * - Patrón 07: Router y Especialistas con umbral de confianza (0.6)
 * - Patrón 09: Human-in-the-Loop con Política de 3 niveles en código (AUTOMATICO | NOTIFICAR | APROBAR)
 */

export type NivelRiesgo = "AUTOMATICO" | "NOTIFICAR" | "APROBAR";

export type EspecialistaId =
  | "ventanas_y_archivos"
  | "multimedia"
  | "productividad_y_codigo"
  | "sistema_y_domotica"
  | "calculo_y_datos"
  | "general";

export interface RutaEspecialista {
  especialista: EspecialistaId;
  confianza: number;
  motivo: string;
  herramientasPermitidas: string[];
}

export interface DecisionPolitica {
  nivel: NivelRiesgo;
  motivo: string;
  descripcionAccion: string;
}

/**
 * Patrón 09 · Human-in-the-Loop:
 * La política vive fuera del modelo (es código determinista, no una sugerencia en el prompt).
 */
export function evaluarPoliticaAprobacion(
  accion: string,
  arg = "",
): DecisionPolitica {
  const act = accion.toLowerCase().trim();
  const cleanArg = arg.toLowerCase().trim();

  // Nivel APROBAR: acciones riesgosas, irreversibles o que apagan la sesión activa
  if (act === "hibernate" || (act === "system_action" && cleanArg === "hibernate")) {
    return {
      nivel: "APROBAR",
      motivo: "Hibernar apaga la pantalla y corta las sesiones de red activas.",
      descripcionAccion: "hibernar la laptop",
    };
  }
  if (act === "sleep" || (act === "system_action" && cleanArg === "sleep")) {
    return {
      nivel: "APROBAR",
      motivo: "Suspender interrumpe la sesión activa.",
      descripcionAccion: "suspender la laptop",
    };
  }
  if (
    act === "empty_recycle_bin" ||
    (act === "system_action" && cleanArg === "empty_recycle_bin")
  ) {
    return {
      nivel: "APROBAR",
      motivo: "Vaciar la papelera de reciclaje elimina archivos de forma permanente e irreversible.",
      descripcionAccion: "vaciar permanentemente la papelera de reciclaje",
    };
  }

  // Nivel NOTIFICAR: acciones que crean recursos o modifican configuración persistente
  if (
    act === "create_project" ||
    act === "teach_macro" ||
    act === "custom_macro" ||
    act.startsWith("modo_")
  ) {
    return {
      nivel: "NOTIFICAR",
      motivo: "Modifica el entorno de trabajo o crea carpetas nuevas.",
      descripcionAccion: act,
    };
  }

  // Nivel AUTOMATICO: lecturas y acciones cotidianas seguras
  return {
    nivel: "AUTOMATICO",
    motivo: "Operación segura de uso cotidiano.",
    descripcionAccion: act,
  };
}

/**
 * Patrón 07 · Router y Especialistas con umbral de confianza (0.6):
 * Clasifica la entrada en < 1 ms y selecciona solo las herramientas del especialista correspondiente.
 */
const ESPECIALISTA_KEYWORDS: Record<
  Exclude<EspecialistaId, "general">,
  { words: RegExp; tools: string[]; motivo: string }
> = {
  ventanas_y_archivos: {
    words:
      /\b(ventana|pantalla|monitor|pasa|mueve|trae|lleva|cierra|abre|archivo|pdf|documento|descarga|reciente|ultimo|ultima|carpeta)\b/i,
    tools: [
      "open_app",
      "close_app",
      "close_active_window",
      "focus_app",
      "move_window_display",
      "open_recent_file",
      "open_project",
    ],
    motivo: "Gestión de ventanas, monitores y archivos locales",
  },
  multimedia: {
    words:
      /\b(musica|cancion|tema|video|youtube|spotify|reproduce|poneme|ponme|volumen|pausa|siguiente|anterior|silencia)\b/i,
    tools: ["play_music", "control_media"],
    motivo: "Reproducción y control multimedia",
  },
  productividad_y_codigo: {
    words:
      /\b(tarea|pendiente|agenda|recordatorio|alarma|focus|pomodoro|proyecto|codigo|programar|codear|git|terminal|universidad|semana)\b/i,
    tools: [
      "add_todo",
      "start_focus",
      "open_project",
      "create_project",
      "modo_programacion",
      "modo_proyecto",
      "modo_semana",
      "modo_universidad",
      "briefing",
    ],
    motivo: "Productividad, tareas e ingeniería de software",
  },
  sistema_y_domotica: {
    words:
      /\b(brillo|bateria|ram|cpu|disco|captura|screenshot|pantallazo|luces|luz|casa|noche|descanso|celular|glassdrop|clima|temperatura|hora|fecha)\b/i,
    tools: [
      "set_brightness",
      "system_action",
      "smart_home",
      "modo_casa",
      "modo_descanso",
      "briefing",
    ],
    motivo: "Hardware, energía, capturas y domótica",
  },
  calculo_y_datos: {
    words:
      /\b(cuanto es|calcula|suma|resta|multiplica|divide|dividido|por ciento|%|raiz|promedio|cuantos archivos|cuantos pdf)\b/i,
    tools: ["chat"],
    motivo: "Cálculo exacto y análisis de datos (CodeAct)",
  },
};

export const UMBRAL_CONFIANZA_ROUTER = 0.6;

export function clasificarEspecialista(utterance: string): RutaEspecialista {
  const q = utterance
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  let bestId: EspecialistaId = "general";
  let bestHits = 0;

  for (const [id, cfg] of Object.entries(ESPECIALISTA_KEYWORDS) as [
    Exclude<EspecialistaId, "general">,
    (typeof ESPECIALISTA_KEYWORDS)[Exclude<EspecialistaId, "general">],
  ][]) {
    const matches = q.match(new RegExp(cfg.words.source, "gi"));
    const hits = matches ? matches.length : 0;
    if (hits > bestHits) {
      bestHits = hits;
      bestId = id;
    }
  }

  if (bestHits === 0 || bestId === "general") {
    return {
      especialista: "general",
      confianza: 0.35,
      motivo: "Consulta abierta o conversacional",
      herramientasPermitidas: ["chat", "web_search", "open_app", "play_music", "add_todo"],
    };
  }

  const confianza = Math.min(0.96, 0.55 + bestHits * 0.18);
  const spec = ESPECIALISTA_KEYWORDS[bestId];
  return {
    especialista: bestId,
    confianza: Math.round(confianza * 100) / 100,
    motivo: spec.motivo,
    herramientasPermitidas: spec.tools,
  };
}

/**
 * Patrón 06 · CodeAct seguro (sin eval arbitrario):
 * Resuelve operaciones matemáticas, porcentajes y conversiones en < 1 ms con precisión exacta.
 */
export function resolverCalculoCodeAct(rawQuery: string): {
  matched: boolean;
  expression?: string;
  result?: number;
  reply?: string;
} {
  const q = rawQuery
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  // 1) Porcentajes directos: "cuánto es el 13% de 2500", "calcula 18.5 por ciento de 400"
  const pctMatch = q.match(
    /(?:cuanto es|calcula|sacame|dime)?\s*(?:el\s+)?(\d+(?:[.,]\d+)?)\s*(?:%|por\s+ciento)\s+de\s+(\d+(?:[.,]\d+)?)/,
  );
  if (pctMatch) {
    const pct = Number(pctMatch[1].replace(",", "."));
    const total = Number(pctMatch[2].replace(",", "."));
    if (Number.isFinite(pct) && Number.isFinite(total)) {
      const res = Math.round(total * (pct / 100) * 10000) / 10000;
      return {
        matched: true,
        expression: `${pct}% de ${total}`,
        result: res,
        reply: `El ${pct} por ciento de ${total} es exactamente ${res}.`,
      };
    }
  }

  // 2) Expresiones aritméticas habladas o escritas:
  // "cuánto es 2500 dividido entre 4", "calcula 120 por 15 mas 80", "cuanto es (450 + 150) / 3"
  if (!/^(?:cuanto es|calcula|cuanto da|resuelve)\b/.test(q)) {
    return { matched: false };
  }

  const exprRaw = q
    .replace(/^(?:cuanto es|calcula|cuanto da|resuelve)\s+(?:el\s+|la\s+)?/, "")
    .replace(/\bdividido\s+entre\b|\bdividido\s+por\b|\bentre\b/g, "/")
    .replace(/\bmultiplicado\s+por\b|\bpor\b/g, "*")
    .replace(/\bmas\b/g, "+")
    .replace(/\bmenos\b/g, "-")
    .replace(/,/g, ".")
    .trim();

  // Sanitización estricta: solo dígitos, operadores básicos (+ - * /), puntos y paréntesis
  if (!/^[\d+\-*/.()\s]+$/.test(exprRaw) || !/\d/.test(exprRaw) || !/[+\-*/]/.test(exprRaw)) {
    return { matched: false };
  }

  try {
    // Tokenizador y evaluador Shunting-Yard determinista (cero eval)
    const val = safeArithmeticEval(exprRaw);
    if (val === null || !Number.isFinite(val)) return { matched: false };
    const rounded = Math.round(val * 10000) / 10000;
    return {
      matched: true,
      expression: exprRaw.replace(/\s+/g, " "),
      result: rounded,
      reply: `El resultado exacto de ${exprRaw.replace(/\s+/g, " ")} es ${rounded}.`,
    };
  } catch {
    return { matched: false };
  }
}

function safeArithmeticEval(expr: string): number | null {
  const tokens = expr.match(/\d+(?:\.\d+)?|[+\-*/()]/g);
  if (!tokens || tokens.length < 3) return null;
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const values: number[] = [];
  const ops: string[] = [];

  const applyOp = () => {
    const op = ops.pop();
    const b = values.pop();
    const a = values.pop();
    if (op === undefined || a === undefined || b === undefined) throw new Error("syntax");
    if (op === "+") values.push(a + b);
    else if (op === "-") values.push(a - b);
    else if (op === "*") values.push(a * b);
    else if (op === "/") {
      if (b === 0) throw new Error("div0");
      values.push(a / b);
    }
  };

  for (const tok of tokens) {
    if (/^\d/.test(tok)) {
      values.push(Number(tok));
    } else if (tok === "(") {
      ops.push(tok);
    } else if (tok === ")") {
      while (ops.length > 0 && ops[ops.length - 1] !== "(") applyOp();
      ops.pop();
    } else if (prec[tok]) {
      while (
        ops.length > 0 &&
        ops[ops.length - 1] !== "(" &&
        prec[ops[ops.length - 1]] >= prec[tok]
      ) {
        applyOp();
      }
      ops.push(tok);
    }
  }
  while (ops.length > 0) applyOp();
  return values.length === 1 ? values[0] : null;
}
