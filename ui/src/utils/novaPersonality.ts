import type { RobotMood } from "../types";

export type UserAttitude =
  | "stressed"
  | "tired"
  | "excited"
  | "friendly"
  | "serious"
  | "neutral";

export type PersonalityMode = "adaptive" | "jarvis" | "friendly" | "executive";

export interface AttitudeProfile {
  attitude: UserAttitude;
  badge: string;
  ttsStyle: string;
  robotMood: RobotMood;
  llmHint: string;
}

function normSimple(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Detecta la actitud del usuario en < 1 ms (0% GPU) combinando:
 * 1) Expresiones humanas y modismos en español/boliviano
 * 2) Energía acústica del micrófono (urgent / calm / normal)
 * 3) Hora del día (madrugada -> tono más suave)
 */
export function detectUserAttitude(
  rawText: string,
  acousticTone: "urgent" | "calm" | "normal" = "normal",
  personalityMode: PersonalityMode = "adaptive",
): AttitudeProfile {
  const q = normSimple(rawText);
  const hr = new Date().getHours();

  // Si el usuario fijó una personalidad fija (no adaptativa), respétala
  if (personalityMode === "executive") {
    return {
      attitude: "serious",
      badge: "💼 Ejecutivo",
      ttsStyle: "sereno, formal, directo y ejecutivo",
      robotMood: "focus",
      llmHint: "Responde en tono serio, ejecutivo y ultra-conciso (máximo 1 oración).",
    };
  }
  if (personalityMode === "friendly") {
    return {
      attitude: "friendly",
      badge: "😎 Cercano",
      ttsStyle: "cálido, amigable, relajado y con buen humor",
      robotMood: "happy",
      llmHint: "Responde en tono muy amigable, cercano y con toque natural cruceño.",
    };
  }
  if (personalityMode === "jarvis") {
    return {
      attitude: "serious",
      badge: "🎩 J.A.R.V.I.S.",
      ttsStyle: "elegante, sereno, seguro y ligeramente irónico como J.A.R.V.I.S.",
      robotMood: "idle",
      llmHint: "Responde con la elegancia serena, seguridad e ingenio sutil de J.A.R.V.I.S. (Iron Man).",
    };
  }

  // Modo adaptativo: analiza texto + tono acústico + hora
  if (
    /\b(rapido|apurate|ya pues|carajo|mierda|no sirve|no funciona|otra vez|maldita|estresado|estres|urgente|ahora mismo|dale ya|fastidio)\b/.test(
      q,
    ) ||
    acousticTone === "urgent"
  ) {
    return {
      attitude: "stressed",
      badge: "⚡ Directo",
      ttsStyle: "calmado, firme, ultra-directo y resolutivo",
      robotMood: "focus",
      llmHint: "El usuario está apurado o frustrado: sé ultra-directo, calmado y resolutivo en 1 frase corta.",
    };
  }

  if (
    /\b(cansado|cansada|agotado|sueno|tengo sueno|destruido|sin energia|desvelado|descansar|me duele)\b/.test(
      q,
    ) ||
    (acousticTone === "calm" && (hr >= 23 || hr < 6))
  ) {
    return {
      attitude: "tired",
      badge: "🌙 Suave",
      ttsStyle: "suave, empático, pausado y reconfortante",
      robotMood: "sleepy",
      llmHint: "El usuario está cansado o es de madrugada: responde con tono suave, empático y tranquilo.",
    };
  }

  if (
    /\b(vamos con todo|brutal|genial|excelente|a codear|epico|buenisimo|increible|logre|lo logre|vamos|crack)\b/.test(
      q,
    )
  ) {
    return {
      attitude: "excited",
      badge: "🔥 Motivado",
      ttsStyle: "enérgico, seguro, entusiasta y motivador",
      robotMood: "excited",
      llmHint: "El usuario está motivado: responde con energía positiva y confianza tipo Jarvis.",
    };
  }

  if (
    /\b(che|belleza|joya|porfa|porfis|amigo|amiga|jaja|jeje|capo|pana|crack|de una|gracias)\b/.test(
      q,
    )
  ) {
    return {
      attitude: "friendly",
      badge: "😄 Amigable",
      ttsStyle: "cálido, amigable, cercano y natural",
      robotMood: "happy",
      llmHint: "El usuario habla relajado y amigable: responde cercano, cálido y con humor sutil.",
    };
  }

  if (
    /\b(analiza|explica|resume|investiga|por favor|necesito|requiero|informe|arquitectura|codigo|error|bug)\b/.test(
      q,
    )
  ) {
    return {
      attitude: "serious",
      badge: "🎩 J.A.R.V.I.S.",
      ttsStyle: "preciso, elegante, sereno y profesional",
      robotMood: "focus",
      llmHint: "El usuario hace una consulta técnica/seria: responde preciso, profesional y estilo J.A.R.V.I.S.",
    };
  }

  // Por defecto: Jarvis equilibrado
  return {
    attitude: "neutral",
    badge: "🎩 J.A.R.V.I.S.",
    ttsStyle: "natural, sereno, elegante y seguro como J.A.R.V.I.S.",
    robotMood: "happy",
    llmHint: "Responde como J.A.R.V.I.S.: elegante, conciso, natural y atento con el usuario.",
  };
}

/**
 * Ajusta sutilmente las frases locales del Alumno para reflejar la actitud detectada
 * sin alterar nombres de archivos, carpetas ni resultados exactos.
 */
export function adaptReplyToPersonality(
  reply: string,
  profile: AttitudeProfile,
  mode: PersonalityMode = "adaptive",
  bossName = "Jefe",
): string {
  const clean = reply.trim();
  const boss = bossName.trim() || "Jefe";
  if (!clean) return clean;
  if (profile.attitude === "stressed" || mode === "executive") {
    return clean
      .replace(/^(?:¡Claro!|¡De una!|¡Listo!|¡Belleza!|Entendido,)\s+/i, "Enseguida. ")
      .replace(/\s+¿En qué [^?]+\?$/i, "");
  }
  if (profile.attitude === "tired") {
    return clean.replace(/^(?:¡De una!|¡Claro!)\s+/i, `Tranquilo, ${boss}. `);
  }
  if (profile.attitude === "excited") {
    return clean.replace(/^Entendido,\s+/i, `¡Con todo, ${boss}! `);
  }
  if (profile.attitude === "friendly" || mode === "friendly") {
    return clean.replace(/^Entendido,\s+/i, "¡De una, jefe! ");
  }
  if (mode === "jarvis") {
    return clean.replace(/^(?:¡De una!|¡Belleza!)\s+/i, `A la orden, ${boss}. `);
  }
  return clean;
}
