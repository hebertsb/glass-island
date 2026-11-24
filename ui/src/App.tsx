import { useEffect, useMemo, useRef, useState } from "react";
import {
  BatteryCharging,
  Check,
  Clipboard,
  Clock,
  CloudSun,
  Cpu,
  ExternalLink,
  FileText,
  FolderOpen,
  GripHorizontal,
  Home,
  ImagePlus,
  LayoutGrid,
  Lock,
  Mic,
  MicOff,
  Music,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  Rocket,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Sun,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import RobotFace from "./components/RobotFace";
import LiquidGlass from "./engine/LiquidGlass";
import musicSunsetArt from "./assets/music-cover.png";
import focusCoverArt from "./assets/focus-cover.png";
import laptopCoverArt from "./assets/laptop-cover.png";
import { extractBrandColorFromIcon } from "./utils/extractColor";
import {
  executeNovaTool,
  executeSubuCommand,
  extractWakeCommand,
  getNovaKbStats,
  hasActiveConversationExpectation,
  loadNovaKb,
  setPendingFolders,
  speakAsSubu,
  teachNovaAlias,
  teachNovaPattern,
  VOICE_PROFILES,
  type FolderChoice,
} from "./utils/subuCommands";
import { playDoneChime, playThinkChime, playWakeChime } from "./utils/hudSounds";
import {
  DEFAULT_CONFIG,
  getBridge,
  type AppRuntimeStatus,
  type AppWidget,
  type HomeWidgetId,
  type InstalledAppEntry,
  type IslandAnchor,
  type IslandConfig,
  type IslandShape,
  type ModuleId,
  type NowPlayingData,
  type RobotMood,
  type ShortcutItem,
  type TelemetryData,
  type WeatherData,
} from "./types";

const AI_AGENT_RE =
  /\b(claude|copilot|chatgpt|openai|codex|antigravity|gemini|cursor|perplexity|kiro|opencode|windsurf|ollama|deepseek)\b/i;

function isAiAgentApp(name: string, processName: string): boolean {
  return AI_AGENT_RE.test(`${name} ${processName}`);
}

const QUICK_SEARCH_ENGINES = [
  { id: "google", label: "Google", emoji: "G", url: "https://www.google.com/search?q=" },
  { id: "youtube", label: "YouTube", emoji: "▶", url: "https://www.youtube.com/results?search_query=" },
  { id: "github", label: "GitHub", emoji: "🐙", url: "https://github.com/search?q=" },
  { id: "chatgpt", label: "ChatGPT", emoji: "✦", url: "https://chatgpt.com/?q=" },
  { id: "perplexity", label: "Perplexity", emoji: "✳", url: "https://www.perplexity.ai/search?q=" },
];

const BASE_HOME_WIDGETS: { id: HomeWidgetId; label: string }[] = [
  { id: "laptop", label: "Laptop (CPU/Bat)" },
  { id: "music", label: "Música en vivo" },
  { id: "focus", label: "Focus Pomodoro" },
  { id: "weather", label: "Clima en vivo" },
  { id: "tasks", label: "Agenda / Tareas" },
  { id: "launcher", label: "Accesos Rápidos" },
  { id: "clipboard", label: "Portapapeles" },
];

function formatMediaTime(sec?: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function PlatformBadge({ source, platform }: { source: string; platform?: string }) {
  const p = (platform || source || "").toLowerCase();
  if (p.includes("youtube-music") || p.includes("youtube music")) {
    return (
      <span className="platform-pill" style={{ borderColor: "rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.16)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#ef4444" />
          <circle cx="12" cy="12" r="6.2" fill="none" stroke="#fff" strokeWidth="1.4" />
          <polygon points="10.2,9 15.6,12 10.2,15" fill="#fff" />
        </svg>
        YouTube Music
      </span>
    );
  }
  if (p.includes("youtube")) {
    return (
      <span className="platform-pill" style={{ borderColor: "rgba(239,68,68,0.42)", background: "rgba(239,68,68,0.15)" }}>
        <svg width="13" height="10" viewBox="0 0 24 17" aria-hidden="true">
          <rect width="24" height="17" rx="4.5" fill="#ef4444" />
          <polygon points="9.8,4.6 16.4,8.5 9.8,12.4" fill="#fff" />
        </svg>
        YouTube
      </span>
    );
  }
  if (p.includes("spotify")) {
    return (
      <span className="platform-pill" style={{ borderColor: "rgba(34,197,94,0.45)", background: "rgba(34,197,94,0.16)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10.5" fill="#22c55e" />
          <path d="M7 9.8c3.2-1 7-.8 9.8.7M7.8 13c2.6-.8 5.8-.6 8.2.6M8.7 16c2-.6 4.4-.4 6.4.5" stroke="#052e16" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </svg>
        Spotify
      </span>
    );
  }
  return (
    <span className="platform-pill">
      <Music size={10} /> {source || "Windows Media"}
    </span>
  );
}

function AgentBrandLogo({
  name,
  fallbackUrl,
  size = 18,
}: {
  name: string;
  fallbackUrl?: string;
  size?: number;
}) {
  const low = name.toLowerCase();
  if (low.includes("copilot")) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id="cp-top" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>
          <linearGradient id="cp-left" x1="0.2" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="55%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#facc15" />
          </linearGradient>
          <linearGradient id="cp-bot" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
          <linearGradient id="cp-right" x1="0.6" y1="0" x2="0.3" y2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="55%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#fb923c" />
          </linearGradient>
        </defs>
        {/* Cinta trasera superior azul */}
        <path d="M12.5 5h6.5c2 0 3.3 1.4 3.8 3.3l.8 2.7H14.5l-2-6z" fill="url(#cp-top)" />
        {/* Cinta trasera inferior naranja */}
        <path d="M8.5 21h9.2l2 6h-6.6c-2 0-3.3-1.4-3.8-3.3L8.5 21z" fill="url(#cp-bot)" />
        {/* Cinta frontal izquierda (azul -> verde -> amarillo) */}
        <path d="M9.6 5h6.8c-1.4 0-2.4.9-2.8 2.3L10.3 19c-.4 1.3-1.5 2-2.9 2H5.2c-1.8 0-3-1.5-2.5-3.3L6 8.3C6.5 6.3 7.8 5 9.6 5z" fill="url(#cp-left)" />
        {/* Cinta frontal derecha (morado -> rosa -> naranja) */}
        <path d="M22.4 27h-6.8c1.4 0 2.4-.9 2.8-2.3L21.7 13c.4-1.3 1.5-2 2.9-2h2.2c1.8 0 3 1.5 2.5 3.3L26 23.7c-.5 2-1.8 3.3-3.6 3.3z" fill="url(#cp-right)" />
      </svg>
    );
  }
  if (low.includes("claude")) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
        <rect width="24" height="24" rx="6" fill="#d97757" />
        <g stroke="#fff7ed" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="4.5" x2="12" y2="19.5" />
          <line x1="4.5" y1="12" x2="19.5" y2="12" />
          <line x1="6.7" y1="6.7" x2="17.3" y2="17.3" />
          <line x1="17.3" y1="6.7" x2="6.7" y2="17.3" />
        </g>
      </svg>
    );
  }
  if (low.includes("gemini")) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id="gm-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="50%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#f472b6" />
          </linearGradient>
        </defs>
        <path d="M12 2c.7 5.3 4.7 9.3 10 10-5.3.7-9.3 4.7-10 10-.7-5.3-4.7-9.3-10-10 5.3-.7 9.3-4.7 10-10z" fill="url(#gm-g)" />
      </svg>
    );
  }
  if (fallbackUrl) {
    return <img src={fallbackUrl} alt="" width={size} height={size} style={{ borderRadius: 4, flexShrink: 0 }} />;
  }
  return <Sparkles size={Math.max(14, size - 2)} />;
}

function TileCoverBg({ src, scrim = "bottom" }: { src: string; scrim?: "bottom" | "soft" }) {
  return (
    <div className="media-art-bg" aria-hidden="true">
      <img
        src={src}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
          display: "block",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            scrim === "bottom"
              ? "linear-gradient(180deg, rgba(9,13,24,0.22) 0%, rgba(9,13,24,0.28) 45%, rgba(9,13,24,0.86) 100%)"
              : "linear-gradient(180deg, rgba(9,13,24,0.34) 0%, rgba(9,13,24,0.25) 50%, rgba(9,13,24,0.82) 100%)",
        }}
      />
    </div>
  );
}

const MODULE_META: Record<
  ModuleId,
  { label: string; rgb: [number, number, number] }
> = {
  home: { label: "Home", rgb: [56, 130, 246] },
  music: { label: "Música", rgb: [196, 42, 78] },
  focus: { label: "Focus", rgb: [139, 92, 246] },
  shelf: { label: "Estante", rgb: [14, 165, 233] },
  clipboard: { label: "Clips", rgb: [245, 158, 11] },
  notes: { label: "Tareas", rgb: [234, 179, 8] },
  system: { label: "Laptop", rgb: [16, 185, 129] },
  launcher: { label: "Accesos", rgb: [249, 115, 22] },
  customize: { label: "Personalizar", rgb: [99, 102, 241] },
};

const SHAPE_OPTIONS: { id: IslandShape; label: string }[] = [
  { id: "notch", label: "Notch" },
  { id: "pill", label: "Cápsula" },
  { id: "slim", label: "Slim" },
  { id: "vertical", label: "Lateral" },
  { id: "card", label: "Widget" },
];

const ANCHOR_OPTIONS: { id: IslandAnchor; label: string }[] = [
  { id: "top-center", label: "Arriba Centro" },
  { id: "top-left", label: "Arriba Izq" },
  { id: "top-right", label: "Arriba Der" },
  { id: "bottom-center", label: "Abajo Centro" },
  { id: "left-center", label: "Borde Izq" },
  { id: "right-center", label: "Borde Der" },
  { id: "free", label: "Libre" },
];

const ROBOT_COLORS = [
  { name: "Blanco", hex: "#f8fafc" },
  { name: "Cyan", hex: "#38bdf8" },
  { name: "Esmeralda", hex: "#6ee7b7" },
  { name: "Ámbar", hex: "#fbbf24" },
  { name: "Rosa", hex: "#fda4af" },
  { name: "Violeta", hex: "#c4b5fd" },
];

function formatBytesShort(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getDimensions(
  shape: IslandShape,
  expanded: boolean,
  autoHide: boolean,
): { w: number; h: number; margin: number; radius: number; notchTop: boolean } {
  const isNotch = shape === "notch";
  if (!expanded) {
    if (autoHide && (shape === "notch" || shape === "slim")) {
      // Micro-pestaña elegante pegada al borde superior con ojitos bien visibles
      return { w: 122, h: 24, margin: 0, radius: 14, notchTop: true };
    }
    switch (shape) {
      case "slim":
        return { w: 148, h: 26, margin: 4, radius: 13, notchTop: false };
      case "vertical":
        return { w: 38, h: 102, margin: 6, radius: 19, notchTop: false };
      case "card":
        return { w: 136, h: 48, margin: 12, radius: 16, notchTop: false };
      case "pill":
        return { w: 124, h: 28, margin: 6, radius: 14, notchTop: false };
      default:
        return { w: 124, h: 26, margin: 0, radius: 14, notchTop: true };
    }
  }
  switch (shape) {
    case "vertical":
      return { w: 336, h: 480, margin: 8, radius: 22, notchTop: false };
    case "card":
      return { w: 380, h: 320, margin: 12, radius: 20, notchTop: false };
    case "slim":
      return { w: 600, h: 248, margin: 6, radius: 18, notchTop: false };
    case "pill":
      return { w: 684, h: 270, margin: 8, radius: 24, notchTop: false };
    default: // notch expandido (cómodo para 3, 4 o 5 tarjetas)
      return { w: 684, h: 270, margin: 0, radius: 24, notchTop: isNotch };
  }
}

function ModuleIcon({ id, size = 14 }: { id: ModuleId; size?: number }) {
  switch (id) {
    case "home":
      return <Home size={size} />;
    case "music":
      return <Music size={size} />;
    case "focus":
      return <Clock size={size} />;
    case "shelf":
      return <FolderOpen size={size} />;
    case "clipboard":
      return <Clipboard size={size} />;
    case "notes":
      return <FileText size={size} />;
    case "system":
      return <Cpu size={size} />;
    case "launcher":
      return <Rocket size={size} />;
    case "customize":
      return <Sliders size={size} />;
  }
}

export default function App() {
  const [config, setConfig] = useState<IslandConfig>(() => {
    try {
      const raw = localStorage.getItem("glassisland.config.v2");
      if (raw) {
        const parsed = JSON.parse(raw);
        // Migra nombres previos de prueba -> Nova automáticamente (sigue 100% editable en +)
        if (parsed.assistantName === "Subu" || parsed.assistantName === "Hera") {
          parsed.assistantName = "Nova";
        }
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {
      // ignore
    }
    return DEFAULT_CONFIG;
  });

  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ModuleId | `app:${string}`>("home");
  const [settingsSection, setSettingsSection] = useState<
    "nova" | "design" | "apps" | "home" | "shortcuts" | "dock"
  >("nova");
  const [clock, setClock] = useState(() => new Date());
  const [weather, setWeather] = useState<WeatherData>({
    temp_c: 22,
    feels_like_c: 22,
    humidity: 50,
    condition: "Despejado",
    city: "Local",
  });
  const [appStatuses, setAppStatuses] = useState<Record<string, AppRuntimeStatus>>({});
  const [installedApps, setInstalledApps] = useState<InstalledAppEntry[]>([]);
  const [appSearch, setAppSearch] = useState("");
  const [addingAppPath, setAddingAppPath] = useState<string | null>(null);
  const [quickPrompt, setQuickPrompt] = useState("");
  const [promptToast, setPromptToast] = useState<string | null>(null);
  const [agentAnswer, setAgentAnswer] = useState<{
    agent: string;
    question: string;
    answer: string;
  } | null>(null);
  const [webQuery, setWebQuery] = useState("");
  const [activeSearchEngine, setActiveSearchEngine] = useState("google");
  // Asistente de voz Nova (escucha continua real + voz neural es-BO + Base de conocimiento)
  const [subuOpen, setSubuOpen] = useState(false);
  const [subuInput, setSubuInput] = useState("");
  const [subuReply, setSubuReply] = useState<string | null>(null);
  const [unknownPhrase, setUnknownPhrase] = useState<string | null>(null);
  const [folderChoices, setFolderChoices] = useState<FolderChoice[]>([]);
  const [kbLearnedCount, setKbLearnedCount] = useState(0);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const hoveringRef = useRef(false);
  const expandedRef = useRef(false);
  const clearVoiceTimerRef = useRef<number | null>(null);
  const runSubuOrderRef = useRef<(text: string, autoTriggered?: boolean) => Promise<void>>(
    async () => {},
  );
  const configRef = useRef(config);
  // Long-press Drag & Drop directo en el Home (intercambio en vivo con window pointer events)
  const [dragHomeIdx, setDragHomeIdx] = useState<number | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const didDragRef = useRef(false);

  useEffect(() => {
    const onWinMove = (e: PointerEvent) => {
      const fromIdx = dragIdxRef.current;
      if (fromIdx === null) return;
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-slot-idx]") as HTMLElement | null;
      if (!el) return;
      const overIdx = Number(el.dataset.slotIdx);
      if (Number.isNaN(overIdx) || overIdx === fromIdx) return;
      // Intercambia en tiempo real mientras arrastras (estilo iOS/Android)
      dragIdxRef.current = overIdx;
      setDragHomeIdx(overIdx);
      setConfig((prev) => {
        const copy = [...prev.homeSlots];
        if (fromIdx < 0 || fromIdx >= copy.length || overIdx < 0 || overIdx >= copy.length) {
          return prev;
        }
        const [moved] = copy.splice(fromIdx, 1);
        copy.splice(overIdx, 0, moved);
        return { ...prev, homeSlots: copy };
      });
    };

    const onWinUp = () => {
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (dragIdxRef.current !== null) {
        dragIdxRef.current = null;
        setDragHomeIdx(null);
        triggerBurst("happy", 900);
      }
    };

    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
    return () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinUp);
    };
  }, []);
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    cpu_percent: 8,
    ram_percent: 52,
    ram_used_gb: 8.2,
    ram_total_gb: 15.7,
    battery_percent: 80,
    battery_plugged: true,
    battery_mins_left: null,
    disk_c_free_gb: 129,
    disk_c_percent: 74,
  });
  const [nowPlaying, setNowPlaying] = useState<NowPlayingData>(() => {
    try {
      const saved = localStorage.getItem("glassisland.lastTrack.v1");
      if (saved) return { ...JSON.parse(saved), playing: false };
    } catch {
      // ignore
    }
    return {
      title: "Sin reproducción activa",
      artist: "Abre Spotify o YouTube",
      source: "",
      playing: false,
    };
  });
  const [brightness, setBrightness] = useState(80);
  const [clipHistory, setClipHistory] = useState<string[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const [manualMood, setManualMood] = useState<RobotMood | null>(null);
  const [burstMood, setBurstMood] = useState<RobotMood | null>(null);
  const [greenGlow, setGreenGlow] = useState(false);

  const [focusRunning, setFocusRunning] = useState(false);
  const [focusSecondsLeft, setFocusSecondsLeft] = useState(config.focusMinutes * 60);

  // Formulario de acceso directo + nueva tarea
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newKind, setNewKind] = useState<"url" | "folder" | "app">("url");
  const [newEmoji, setNewEmoji] = useState("⚡");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [newTodoText, setNewTodoText] = useState("");

  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  const collapseTimerRef = useRef<number | null>(null);
  const expandTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const loadFromBridge = () => {
      const api = getBridge();
      if (!api) return;
      api
        .load_config()
        .then((saved) => {
          if (saved && Object.keys(saved).length > 0) {
            if (saved.assistantName === "Subu" || saved.assistantName === "Hera") {
              saved.assistantName = "Nova";
            }
            setConfig((prev) => ({ ...prev, ...saved }));
          }
        })
        .catch(() => {});
      api
        .get_brightness()
        .then((b) => setBrightness(b))
        .catch(() => {});
      api
        .get_weather()
        .then((w) => setWeather(w))
        .catch(() => {});
    };
    loadFromBridge();
    window.addEventListener("pywebviewready", loadFromBridge);
    return () => window.removeEventListener("pywebviewready", loadFromBridge);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("glassisland.config.v2", JSON.stringify(config));
    } catch {
      // ignore
    }
    getBridge()?.save_config(config).catch(() => {});
  }, [config]);

  useEffect(() => {
    const api = getBridge();
    if (!api) return;
    api.set_position(config.anchor, config.customX, config.customY).catch(() => {});
  }, [config.anchor, config.customX, config.customY]);

  useEffect(() => {
    const clockId = window.setInterval(() => setClock(new Date()), 1000);
    const poll = () => {
      const api = getBridge();
      if (!api) return;
      api.get_telemetry().then(setTelemetry).catch(() => {});
      api
        .get_now_playing()
        .then((np) => {
          if (np && np.title && !/sin reproducci/i.test(np.title)) {
            setNowPlaying(np);
            try {
              localStorage.setItem("glassisland.lastTrack.v1", JSON.stringify(np));
            } catch {
              // ignore
            }
          } else {
            // Conserva la última canción reproducida en pausa para poder darle Play directo
            setNowPlaying((prev) => ({ ...prev, playing: false }));
          }
        })
        .catch(() => {});
      api
        .get_clipboard()
        .then((txt) => {
          const clean = txt.trim();
          if (!clean) return;
          setClipHistory((prev) => {
            if (prev[0] === clean) return prev;
            return [clean, ...prev.filter((x) => x !== clean)].slice(0, 12);
          });
        })
        .catch(() => {});
      const procs = (config.appWidgets ?? []).map((a) => a.processName).filter(Boolean);
      if (procs.length > 0) {
        api.get_app_statuses(procs).then(setAppStatuses).catch(() => {});
      }
    };
    poll();
    const pollId = window.setInterval(poll, 3500);
    return () => {
      window.clearInterval(clockId);
      window.clearInterval(pollId);
    };
  }, [config.appWidgets]);

  // Avanza el reloj de reproducción 1s en vivo para que la barra y el tiempo transcurrido fluyan suave
  useEffect(() => {
    if (!nowPlaying.playing || !nowPlaying.dur_sec) return;
    const id = window.setInterval(() => {
      setNowPlaying((prev) => {
        if (!prev.playing || !prev.dur_sec) return prev;
        const nextPos = Math.min(prev.dur_sec, (prev.pos_sec || 0) + 1);
        return { ...prev, pos_sec: nextPos };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [nowPlaying.playing, nowPlaying.dur_sec]);

  useEffect(() => {
    if (!focusRunning) return;
    const id = window.setInterval(() => {
      setFocusSecondsLeft((prev) => {
        if (prev <= 1) {
          setFocusRunning(false);
          triggerBurst("excited", 3500);
          setGreenGlow(true);
          window.setTimeout(() => setGreenGlow(false), 4500);
          return config.focusMinutes * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [focusRunning, config.focusMinutes]);

  function triggerBurst(mood: RobotMood, durationMs = 1300) {
    setBurstMood(mood);
    window.setTimeout(() => {
      setBurstMood((cur) => (cur === mood ? null : cur));
    }, durationMs);
  }

  const effectiveMood: RobotMood = useMemo(() => {
    if (speaking) return "excited";
    if (listening) return "focus";
    if (burstMood) return burstMood;
    if (manualMood) return manualMood;
    if (focusRunning) return "focus";
    if (nowPlaying.playing) return "music";
    if (telemetry.battery_percent <= 20 && !telemetry.battery_plugged) return "sleepy";
    return "idle";
  }, [speaking, listening, burstMood, manualMood, focusRunning, nowPlaying.playing, telemetry]);

  const activeAppWidget: AppWidget | null = useMemo(() => {
    if (!activeTab.startsWith("app:")) return null;
    const id = activeTab.slice(4);
    return (config.appWidgets ?? []).find((a) => a.id === id) ?? null;
  }, [activeTab, config.appWidgets]);

  const glassRgb: [number, number, number] = useMemo(() => {
    if (greenGlow) return [16, 185, 129];
    if (effectiveMood === "angry") return [225, 29, 72];
    if (activeAppWidget) return activeAppWidget.brandRgb;
    if (activeTab === "home") {
      if (focusRunning) return [139, 92, 246];
      if (nowPlaying.playing) return [196, 42, 78];
      return [56, 130, 246];
    }
    return MODULE_META[activeTab as ModuleId]?.rgb ?? [56, 130, 246];
  }, [greenGlow, effectiveMood, activeAppWidget, activeTab, focusRunning, nowPlaying.playing]);

  function openIslandWithGesture() {
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (!expanded) {
      triggerBurst("happy", 1200);
      setExpanded(true);
    }
  }

  function handleMouseEnter() {
    hoveringRef.current = true;
    getBridge()?.set_ignore_mouse(false).catch(() => {});
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (!expanded) {
      expandTimerRef.current = window.setTimeout(() => {
        openIslandWithGesture();
      }, 90);
    }
  }

  function handleMouseLeave() {
    hoveringRef.current = false;
    if (expandTimerRef.current) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    if (dragRef.current.active) return;
    if (config.pinnedOpen) {
      getBridge()?.set_ignore_mouse(true).catch(() => {});
      return;
    }
    collapseTimerRef.current = window.setTimeout(() => {
      setExpanded(false);
      getBridge()?.set_ignore_mouse(true).catch(() => {});
    }, 340);
  }

  function handleHeaderPointerDown(e: React.PointerEvent) {
    if (config.lockedPosition) return;
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = { active: true, lastX: e.screenX, lastY: e.screenY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleHeaderPointerMove(e: React.PointerEvent) {
    if (!dragRef.current.active) return;
    const dx = e.screenX - dragRef.current.lastX;
    const dy = e.screenY - dragRef.current.lastY;
    if (dx === 0 && dy === 0) return;
    dragRef.current.lastX = e.screenX;
    dragRef.current.lastY = e.screenY;
    getBridge()?.move_by(dx, dy).catch(() => {});
  }

  async function handleHeaderPointerUp(e: React.PointerEvent) {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const api = getBridge();
    if (!api) return;
    const snapped = await api.snap_current_position().catch(() => null);
    if (snapped) {
      setConfig((prev) => ({
        ...prev,
        anchor: snapped.anchor,
        customX: snapped.anchor === "free" ? snapped.x : null,
        customY: snapped.anchor === "free" ? snapped.y : null,
      }));
    }
  }

  function handleRobotPoke() {
    const reactions: RobotMood[] = ["happy", "wink", "excited", "angry"];
    const next = reactions[Math.floor(Math.random() * reactions.length)];
    triggerBurst(next, 1500);
  }

  function toggleFocusTimer() {
    if (focusRunning) {
      setFocusRunning(false);
    } else {
      if (focusSecondsLeft <= 0) setFocusSecondsLeft(config.focusMinutes * 60);
      setFocusRunning(true);
      triggerBurst("focus", 1200);
    }
  }

  function selectFocusMinutes(mins: number) {
    const clamped = Math.max(1, Math.min(60, Math.round(mins)));
    setFocusRunning(false);
    setConfig((prev) => ({ ...prev, focusMinutes: clamped }));
    setFocusSecondsLeft(clamped * 60);
  }

  async function handleMedia(action: string) {
    await getBridge()?.media_control(action).catch(() => {});
    triggerBurst("music", 900);
  }

  async function handleLaunch(target: string) {
    await getBridge()?.launch(target).catch(() => {});
    triggerBurst("happy", 1200);
    setGreenGlow(true);
    window.setTimeout(() => setGreenGlow(false), 1200);
  }

  async function handleAddShelfFiles() {
    const picked = await getBridge()?.pick_files_for_shelf().catch(() => []);
    if (!picked || picked.length === 0) return;
    setConfig((prev) => {
      const existing = new Set(prev.shelfFiles.map((f) => f.path));
      const merged = [...picked.filter((f) => !existing.has(f.path)), ...prev.shelfFiles];
      return { ...prev, shelfFiles: merged.slice(0, 20) };
    });
    triggerBurst("happy", 1200);
  }

  async function handlePickFolderForNewShortcut() {
    const folder = await getBridge()?.pick_folder_for_shortcut().catch(() => "");
    if (folder) {
      setNewTarget(folder);
      setNewKind("folder");
      if (!newName.trim()) {
        const parts = folder.split(/[\\/]/).filter(Boolean);
        setNewName(parts[parts.length - 1] ?? "Carpeta");
      }
    }
  }

  async function handlePickTileCover(slotId: string) {
    const dataUrl = await getBridge()?.pick_cover_image().catch(() => "");
    if (!dataUrl) return;
    setConfig((prev) => ({
      ...prev,
      tileCovers: { ...(prev.tileCovers ?? {}), [slotId]: dataUrl },
    }));
    triggerBurst("happy", 1000);
  }

  function handleResetTileCover(slotId: string) {
    setConfig((prev) => {
      const copy = { ...(prev.tileCovers ?? {}) };
      delete copy[slotId];
      return { ...prev, tileCovers: copy };
    });
  }

  function handleAddShortcut(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newTarget.trim()) return;
    const item: ShortcutItem = {
      id: `sc-${Date.now()}`,
      name: newName.trim(),
      target: newTarget.trim(),
      kind: newKind,
      emoji: newEmoji.trim() || "⚡",
      color: newColor,
    };
    setConfig((prev) => ({ ...prev, shortcuts: [...prev.shortcuts, item] }));
    setNewName("");
    setNewTarget("");
    triggerBurst("happy", 1200);
  }

  // Auto-recupera íconos oficiales reales de apps Appx/MSIX (ej. Claude, Copilot) si faltaban
  useEffect(() => {
    const missing = (config.appWidgets ?? []).filter((a) => !a.iconDataUrl && a.exePath);
    if (missing.length === 0) return;
    const api = getBridge();
    if (!api) return;
    (async () => {
      for (const aw of missing) {
        const iconUrl = await api.get_app_icon(aw.exePath).catch(() => "");
        if (!iconUrl) continue;
        const { rgb, hex } = await extractBrandColorFromIcon(iconUrl);
        setConfig((prev) => ({
          ...prev,
          appWidgets: (prev.appWidgets ?? []).map((x) =>
            x.id === aw.id ? { ...x, iconDataUrl: iconUrl, brandColor: hex, brandRgb: rgb } : x,
          ),
        }));
      }
    })();
  }, [config.appWidgets]);

  // Orden unificado del dock (permite mover Claude, Copilot, etc. justo al lado de Home!)
  const resolvedDockOrder: (ModuleId | `app:${string}`)[] = useMemo(() => {
    const appKeys: `app:${string}`[] = (config.appWidgets ?? [])
      .filter((a) => a.showInDock)
      .map((a) => `app:${a.id}` as `app:${string}`);
    const validSet = new Set<string>([...config.enabledModules, ...appKeys]);
    const base = (config.dockOrder ?? [...config.enabledModules, ...appKeys]).filter((k) =>
      validSet.has(k),
    );
    for (const k of [...config.enabledModules, ...appKeys]) {
      if (!base.includes(k)) base.push(k);
    }
    return base;
  }, [config.dockOrder, config.enabledModules, config.appWidgets]);

  function moveDockItem(key: ModuleId | `app:${string}`, dir: -1 | 1) {
    const order = [...resolvedDockOrder];
    const idx = order.indexOf(key);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= order.length) return;
    [order[idx], order[target]] = [order[target], order[idx]];
    setConfig((prev) => ({ ...prev, dockOrder: order }));
  }

  async function runSubuOrder(orderText: string, autoTriggered = false) {
    const clean = orderText.trim();
    if (!clean) return;
    if (clearVoiceTimerRef.current) {
      window.clearTimeout(clearVoiceTimerRef.current);
      clearVoiceTimerRef.current = null;
    }
    const name = config.assistantName?.trim() || "Nova";
    const res = await executeSubuCommand(clean, {
      assistantName: name,
      installedApps,
      appWidgets: config.appWidgets ?? [],
      shortcuts: config.shortcuts,
      todos: config.todos,
      addTodo: (text) =>
        setConfig((p) => ({
          ...p,
          todos: [...p.todos, { id: `t-${Date.now()}`, text, done: false }],
        })),
      completeTodo: (indexOneBased) => {
        const pending = config.todos.filter((t) => !t.done);
        const target = pending[indexOneBased - 1];
        if (!target) return false;
        setConfig((p) => ({
          ...p,
          todos: p.todos.map((t) => (t.id === target.id ? { ...t, done: true } : t)),
        }));
        return true;
      },
      telemetry,
      weather,
      brightness,
      setBrightness: (v) => setBrightness(v),
      startFocus: (mins) => {
        if (mins) {
          const clamped = Math.max(5, Math.min(60, mins));
          setConfig((p) => ({ ...p, focusMinutes: clamped }));
          setFocusSecondsLeft(clamped * 60);
        }
        setFocusRunning(true);
      },
      pauseFocus: () => setFocusRunning(false),
      setThemeStyle: (style) => setConfig((p) => ({ ...p, themeStyle: style })),
      setActiveTab: (tab) => setActiveTab(tab),
      setQuickPrompt: (txt) => setQuickPrompt(txt),
      setAgentAnswer: (ans) => setAgentAnswer(ans),
      scheduleReminder: (delayMs, message) => {
        window.setTimeout(() => {
          setExpanded(true);
          setSubuOpen(true);
          getBridge()?.set_ignore_mouse(false).catch(() => {});
          const alertMsg = `¡Hebert! Recordatorio: ${message}.`;
          setSubuReply(alertMsg);
          triggerBurst("excited", 3000);
          setGreenGlow(true);
          window.setTimeout(() => setGreenGlow(false), 3500);
          void speakAsSubu(
            alertMsg,
            configRef.current.voiceEnabled !== false,
            configRef.current.voiceName || "en-US-EmmaMultilingualNeural",
            () => setSpeaking(true),
            () => setSpeaking(false),
            configRef.current.geminiApiKey || "",
          );
        }, delayMs);
      },
      codingMusic: config.codingMusic || "Avicii Levels",
      setCodingMusic: (song) => setConfig((p) => ({ ...p, codingMusic: song })),
      smartHomeWebhook: config.smartHomeWebhook || "",
      aiBrainEnabled: config.aiBrainEnabled !== false,
      geminiApiKey: config.geminiApiKey || "",
      ollamaModel: config.ollamaModel || "qwen2.5:7b",
    });
    setSubuReply(res.reply);
    setUnknownPhrase(res.unknownPhrase ?? null);
    setFolderChoices(res.folderChoices ?? []);
    setKbLearnedCount(getNovaKbStats().learnedCount);
    if (res.ok) {
      playDoneChime(config.hudSounds !== false);
      triggerBurst("happy", 1400);
      setGreenGlow(true);
      window.setTimeout(() => setGreenGlow(false), 1600);
    }

    const scheduleCleanReset = () => {
      // Si está esperando que el usuario elija carpeta, confirme o enseñe una frase,
      // mantiene el contexto abierto 28 segundos para responder directo SIN decir "Nova"
      if (res.unknownPhrase) return;
      if (res.keepOpen || (res.folderChoices && res.folderChoices.length > 0)) {
        if (clearVoiceTimerRef.current) window.clearTimeout(clearVoiceTimerRef.current);
        clearVoiceTimerRef.current = window.setTimeout(() => {
          setFolderChoices([]);
          setPendingFolders([]);
          setSubuInput("");
          setSubuReply(null);
        }, 28000);
        return;
      }
      if (clearVoiceTimerRef.current) window.clearTimeout(clearVoiceTimerRef.current);
      clearVoiceTimerRef.current = window.setTimeout(() => {
        setSubuInput("");
        setSubuReply(null);
        setUnknownPhrase(null);
        setFolderChoices([]);
        if (autoTriggered && !hoveringRef.current) {
          setSubuOpen(false);
          if (!configRef.current.pinnedOpen) {
            setExpanded(false);
            getBridge()?.set_ignore_mouse(true).catch(() => {});
          }
        }
      }, 2800);
    };

    if (config.voiceEnabled !== false) {
      void speakAsSubu(
        res.reply,
        true,
        config.voiceName || "en-US-EmmaMultilingualNeural",
        () => setSpeaking(true),
        () => {
          setSpeaking(false);
          scheduleCleanReset();
        },
        config.geminiApiKey || "",
      );
    } else {
      scheduleCleanReset();
    }
  }

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    configRef.current = config;
    getBridge()?.voice_set_listen(config.alwaysListen !== false).catch(() => {});
    getBridge()?.voice_set_engine(Boolean(config.whisperOffline)).catch(() => {});
  }, [config]);

  useEffect(() => {
    runSubuOrderRef.current = runSubuOrder;
  });

  // Carga la Base de Conocimiento local de Nova al iniciar + saludo proactivo estilo Jarvis
  const greetedRef = useRef(false);
  useEffect(() => {
    loadNovaKb().then(() => setKbLearnedCount(getNovaKbStats().learnedCount));
    const timer = window.setTimeout(() => {
      if (greetedRef.current) return;
      greetedRef.current = true;
      const cfg = configRef.current;
      if (cfg.greetOnStart === false || cfg.voiceEnabled === false) return;
      const hr = new Date().getHours();
      const greet = hr < 12 ? "Buenos días" : hr < 19 ? "Buenas tardes" : "Buenas noches";
      const line = `${greet}, Hebert. Aquí ${cfg.assistantName || "Nova"}. ¿En qué trabajamos hoy?`;
      playWakeChime(cfg.hudSounds !== false);
      setSubuReply(line);
      void speakAsSubu(
        line,
        true,
        cfg.voiceName || "en-US-EmmaMultilingualNeural",
        () => setSpeaking(true),
        () => {
          setSpeaking(false);
          window.setTimeout(() => setSubuReply(null), 2600);
        },
        cfg.geminiApiKey || "",
      );
    }, 2600);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleTeachNova(tool: "play_music" | "open_app" | "web_search" | "add_todo") {
    if (!unknownPhrase) return;
    const phrase = unknownPhrase;
    setUnknownPhrase(null);
    await teachNovaPattern(phrase, tool, phrase);
    setKbLearnedCount(getNovaKbStats().learnedCount);
    const res = await executeNovaTool(tool, phrase, {
      assistantName: config.assistantName?.trim() || "Nova",
      installedApps,
      appWidgets: config.appWidgets ?? [],
      shortcuts: config.shortcuts,
      todos: config.todos,
      addTodo: (text) =>
        setConfig((p) => ({
          ...p,
          todos: [...p.todos, { id: `t-${Date.now()}`, text, done: false }],
        })),
      completeTodo: () => false,
      telemetry,
      weather,
      brightness,
      setBrightness: (v) => setBrightness(v),
      startFocus: () => setFocusRunning(true),
      pauseFocus: () => setFocusRunning(false),
      setThemeStyle: (style) => setConfig((p) => ({ ...p, themeStyle: style })),
      setActiveTab: (tab) => setActiveTab(tab),
      setQuickPrompt: (txt) => setQuickPrompt(txt),
      setAgentAnswer: (ans) => setAgentAnswer(ans),
      scheduleReminder: (delayMs, message) => {
        window.setTimeout(() => {
          setExpanded(true);
          setSubuOpen(true);
          getBridge()?.set_ignore_mouse(false).catch(() => {});
          const alertMsg = `¡Hebert! Recordatorio: ${message}.`;
          setSubuReply(alertMsg);
          triggerBurst("excited", 3000);
          setGreenGlow(true);
          window.setTimeout(() => setGreenGlow(false), 3500);
          void speakAsSubu(
            alertMsg,
            configRef.current.voiceEnabled !== false,
            configRef.current.voiceName || "es-BO-SofiaNeural",
            () => setSpeaking(true),
            () => setSpeaking(false),
          );
        }, delayMs);
      },
      codingMusic: config.codingMusic || "Avicii Levels",
      setCodingMusic: (song) => setConfig((p) => ({ ...p, codingMusic: song })),
      aiBrainEnabled: config.aiBrainEnabled !== false,
      geminiApiKey: config.geminiApiKey || "",
      ollamaModel: config.ollamaModel || "llama3.2",
    });
    const learnedReply = `¡Aprendido! ${res.reply}`;
    setSubuReply(learnedReply);
    setSubuInput("");
    void speakAsSubu(
      learnedReply,
      config.voiceEnabled !== false,
      config.voiceName || "es-BO-SofiaNeural",
      () => setSpeaking(true),
      () => {
        setSpeaking(false);
        clearVoiceTimerRef.current = window.setTimeout(() => setSubuReply(null), 2200);
      },
    );
  }

  // Escucha automática tipo Alexa/Siri en tiempo real desde voice_daemon.py
  useEffect(() => {
    const api = getBridge();
    if (!api?.on_voice_event) return;
    api.voice_set_listen(configRef.current.alwaysListen !== false).catch(() => {});
    const unsub = api.on_voice_event((msg) => {
      if (msg.event === "ready") {
        setMicReady(true);
      } else if (msg.event === "vad") {
        setListening(Boolean(msg.active));
      } else if (msg.event === "heard" && msg.text) {
        const heardText = msg.text.trim();
        if (!heardText) return;
        const curCfg = configRef.current;
        if (curCfg.alwaysListen === false) return;
        const assistantName = curCfg.assistantName?.trim() || "Hera";
        const wake = extractWakeCommand(heardText, assistantName);

        // Si la isla está abierta O Nova está esperando tu respuesta (carpeta / confirmación),
        // escucha directo SIN tener que repetir "Nova"!
        const awaitingFollowup = hasActiveConversationExpectation();
        if (expandedRef.current || wake.matched || awaitingFollowup) {
          const wasCollapsed = !expandedRef.current;
          if (wasCollapsed) {
            setExpanded(true);
            api.set_ignore_mouse(false).catch(() => {});
            if (collapseTimerRef.current) {
              window.clearTimeout(collapseTimerRef.current);
              collapseTimerRef.current = null;
            }
          }
          playWakeChime(curCfg.hudSounds !== false);
          playThinkChime(curCfg.hudSounds !== false);
          setSubuOpen(true);
          setSubuInput(heardText);
          void runSubuOrderRef.current(
            wake.matched ? wake.command || "hola" : heardText,
            wasCollapsed && !awaitingFollowup,
          );
        }
      }
    });
    return () => unsub();
  }, []);

  function toggleVoiceListen() {
    const next = config.alwaysListen === false;
    setConfig((p) => ({ ...p, alwaysListen: next }));
    getBridge()?.voice_set_listen(next).catch(() => {});
    setSubuOpen(true);
    setSubuReply(
      next
        ? `Escucha automática activa: habla directo o di "${config.assistantName || "Nova"}, poneme Firestone".`
        : "Micrófono pausado. Puedes escribir tu orden o volver a activarlo.",
    );
  }

  async function handleQuickPromptSubmit(e: React.FormEvent, aw: AppWidget) {
    e.preventDefault();
    const txt = quickPrompt.trim();
    if (!txt) {
      await handleLaunch(aw.exePath);
      return;
    }
    await getBridge()?.set_clipboard(txt).catch(() => {});
    navigator.clipboard?.writeText(txt).catch(() => {});
    setQuickPrompt("");
    setAgentAnswer({ agent: aw.name, question: txt, answer: "Buscando respuesta..." });
    const llm = await getBridge()
      ?.nova_llm_route({
        utterance: `Responde de forma clara y directa en español (máximo 2 oraciones) a: "${txt}". Usa tool "chat".`,
        assistantName: config.assistantName || "Nova",
        geminiApiKey: config.geminiApiKey || "",
        ollamaModel: config.ollamaModel || "qwen2.5:7b",
        contextSummary: `Consulta inline en ${aw.name}.`,
      })
      .catch(() => null);
    if (llm?.ok && llm.data?.reply) {
      setAgentAnswer({ agent: aw.name, question: txt, answer: llm.data.reply.trim() });
    } else {
      setPromptToast(`✓ Copiado al portapapeles · Pulsa Abrir para pegarlo en ${aw.name}`);
      window.setTimeout(() => setPromptToast(null), 3200);
      setAgentAnswer(null);
    }
  }

  useEffect(() => {
    if (activeTab !== "customize" || installedApps.length > 0) return;
    getBridge()
      ?.list_installed_apps()
      .then((list) => {
        if (Array.isArray(list)) setInstalledApps(list);
      })
      .catch(() => {});
  }, [activeTab, installedApps.length]);

  async function handleAddInstalledApp(entry: InstalledAppEntry) {
    setAddingAppPath(entry.exePath);
    try {
      const iconSource = entry.lnkPath || entry.exePath;
      const iconDataUrl =
        (await getBridge()?.get_app_icon(iconSource).catch(() => "")) || "";
      const { rgb, hex } = await extractBrandColorFromIcon(iconDataUrl);
      const widget: AppWidget = {
        id: `app-${Date.now()}`,
        name: entry.name,
        exePath: entry.lnkPath || entry.exePath,
        processName: entry.processName,
        iconDataUrl,
        brandColor: hex,
        brandRgb: rgb,
        showInDock: true,
      };
      const slotKey: HomeWidgetId = `app:${widget.id}`;
      setConfig((prev) => {
        const nextSlots =
          prev.homeSlots.length < 5 ? [...prev.homeSlots, slotKey] : prev.homeSlots;
        return {
          ...prev,
          appWidgets: [...(prev.appWidgets ?? []), widget],
          homeSlots: nextSlots,
        };
      });
      setActiveTab(slotKey);
      triggerBurst("happy", 1400);
    } finally {
      setAddingAppPath(null);
    }
  }

  async function handleAddOfficialAppWidget() {
    const picked = await getBridge()?.pick_app_widget().catch(() => null);
    if (!picked) return;
    const { rgb, hex } = await extractBrandColorFromIcon(picked.iconDataUrl);
    const widget: AppWidget = {
      id: `app-${Date.now()}`,
      name: picked.name,
      exePath: picked.exePath,
      processName: picked.processName,
      iconDataUrl: picked.iconDataUrl,
      brandColor: hex,
      brandRgb: rgb,
      showInDock: true,
    };
    const slotKey: HomeWidgetId = `app:${widget.id}`;
    setConfig((prev) => {
      const nextSlots =
        prev.homeSlots.length < 5 ? [...prev.homeSlots, slotKey] : prev.homeSlots;
      return {
        ...prev,
        appWidgets: [...(prev.appWidgets ?? []), widget],
        homeSlots: nextSlots,
      };
    });
    setActiveTab(slotKey);
    triggerBurst("happy", 1400);
  }

  function startTileHold(idx: number) {
    didDragRef.current = false;
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      didDragRef.current = true;
      dragIdxRef.current = idx;
      setDragHomeIdx(idx);
    }, 180);
  }

  function handleAddTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!newTodoText.trim()) return;
    setConfig((prev) => ({
      ...prev,
      todos: [
        ...prev.todos,
        { id: `t-${Date.now()}`, text: newTodoText.trim(), done: false },
      ],
    }));
    setNewTodoText("");
  }

  function toggleModuleEnabled(id: ModuleId) {
    if (id === "home") return;
    setConfig((prev) => {
      const exists = prev.enabledModules.includes(id);
      const next = exists
        ? prev.enabledModules.filter((m) => m !== id)
        : [...prev.enabledModules, id];
      return { ...prev, enabledModules: next };
    });
  }

  function moveModuleOrder(id: ModuleId, dir: -1 | 1) {
    setConfig((prev) => {
      const idx = prev.enabledModules.indexOf(id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.enabledModules.length) return prev;
      const copy = [...prev.enabledModules];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return { ...prev, enabledModules: copy };
    });
  }

  const timeStr = clock.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const dateStr = clock
    .toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "short" })
    .toUpperCase();
  const focusMin = String(Math.floor(focusSecondsLeft / 60)).padStart(2, "0");
  const focusSec = String(focusSecondsLeft % 60).padStart(2, "0");
  const doneAt = new Date(clock.getTime() + focusSecondsLeft * 1000).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const doneTodos = config.todos.filter((t) => t.done).length;
  const isCompactLayout = config.shape === "vertical" || config.shape === "card";

  const dims = getDimensions(config.shape, expanded, config.autoHide);
  const stageClass =
    config.anchor === "bottom-center"
      ? "island-stage island-stage--bottom"
      : config.anchor === "left-center"
        ? "island-stage island-stage--left"
        : config.anchor === "right-center"
          ? "island-stage island-stage--right"
          : "island-stage";

  return (
    <div className={stageClass}>
      <div
        className={`island-shell island-shell--${config.shape}${config.themeStyle === "frutiger-aero" ? " island-shell--aero" : ""}${expanded ? " island-shell--expanded" : " island-shell--collapsed"}`}
        style={{ width: dims.w, height: dims.h }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
      <LiquidGlass targetRgb={glassRgb} quiet={!expanded && !nowPlaying.playing && !focusRunning} />

      <div className="island-content">
        {!expanded ? (
          /* ================= ESTADO COLAPSADO ULTRA-SUTIL (SOLO OJITOS) ================= */
          <div
            className={`island-collapsed${config.shape === "vertical" ? " island-collapsed--vertical" : ""}`}
            style={{ justifyContent: "center", padding: "0 8px" }}
            onClick={openIslandWithGesture}
            title="Acércate o haz clic para extender GlassIsland"
          >
            <RobotFace
              mood={effectiveMood}
              color={config.robotColor}
              size="sm"
              showMouth={config.showMouth}
            />
          </div>
        ) : (
          /* ================= ESTADO EXPANDIDO ================= */
          <>
            <header
              className="island-header"
              onPointerDown={handleHeaderPointerDown}
              onPointerMove={handleHeaderPointerMove}
              onPointerUp={handleHeaderPointerUp}
              title={
                config.lockedPosition
                  ? "Posición bloqueada"
                  : "Arrastra desde aquí para mover la isla"
              }
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <RobotFace
                  mood={effectiveMood}
                  color={config.robotColor}
                  size="sm"
                  showMouth={config.showMouth}
                  onClick={handleRobotPoke}
                  title="Tócame para cambiar gesto"
                />
                {activeAppWidget ? (
                  <span style={{ fontWeight: 700, color: activeAppWidget.brandColor }}>
                    {activeAppWidget.name}
                  </span>
                ) : (
                  <span>
                    {dateStr} / {weather.temp_c}°
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.72 }}>
                <GripHorizontal size={13} />
                {nowPlaying.playing && (
                  <span style={{ color: "#fb7185", fontWeight: 700, letterSpacing: 1 }}>||||</span>
                )}
              </div>

              <div className="island-header__actions">
                <button
                  type="button"
                  className={`icon-chip${listening ? " icon-chip--listening" : config.alwaysListen !== false ? " icon-chip--active" : ""}`}
                  onClick={() => setSubuOpen((v) => !v)}
                  title={
                    config.alwaysListen !== false
                      ? `${config.assistantName || "Nova"} está escuchando en español automáticamente (clic para abrir/ocultar panel)`
                      : `Abrir panel de ${config.assistantName || "Nova"}`
                  }
                >
                  {config.alwaysListen === false ? <MicOff size={11} /> : <Mic size={11} />}
                  <span>
                    {listening
                      ? "Oyendo…"
                      : config.assistantName || "Nova"}
                  </span>
                </button>
                <span>{timeStr}</span>
                <button
                  type="button"
                  className={`icon-chip${config.pinnedOpen ? " icon-chip--active" : ""}`}
                  onClick={() =>
                    setConfig((p) => ({ ...p, pinnedOpen: !p.pinnedOpen }))
                  }
                  title={config.pinnedOpen ? "Desfijar (se esconderá al quitar el cursor)" : "Fijar abierta"}
                >
                  {config.pinnedOpen ? <Pin size={11} /> : <PinOff size={11} />}
                </button>
                <button
                  type="button"
                  className={`icon-chip${config.lockedPosition ? " icon-chip--active" : ""}`}
                  onClick={() =>
                    setConfig((p) => ({ ...p, lockedPosition: !p.lockedPosition }))
                  }
                  title={config.lockedPosition ? "Posición bloqueada" : "Bloquear posición"}
                >
                  {config.lockedPosition ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
                <button
                  type="button"
                  className="icon-chip"
                  onClick={() => {
                    setConfig((p) => ({ ...p, pinnedOpen: false }));
                    setExpanded(false);
                  }}
                  title="Esconder"
                >
                  <X size={11} />
                </button>
              </div>
            </header>

            <main className="island-body">
              {subuOpen && (
                <div
                  className="glass-card-row"
                  style={{
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 6,
                    marginBottom: 7,
                    background: "rgba(15, 23, 42, 0.72)",
                    borderColor: listening ? "#fb7185" : "rgba(56, 189, 248, 0.45)",
                  }}
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void runSubuOrder(subuInput);
                      setSubuInput("");
                    }}
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <button
                      type="button"
                      className={`icon-chip${listening ? " icon-chip--listening" : config.alwaysListen !== false ? " icon-chip--active" : ""}`}
                      onClick={toggleVoiceListen}
                      title={
                        config.alwaysListen !== false
                          ? "Escucha automática activa (clic para pausar micrófono)"
                          : "Activar escucha automática de micrófono"
                      }
                    >
                      {config.alwaysListen === false ? <MicOff size={12} /> : <Mic size={12} />}
                    </button>
                    <input
                      className="glass-input"
                      placeholder={`Dile a ${config.assistantName || "Nova"}: "abre VS Code", "pon Firestone en YouTube", "abre el proyecto discoclaro"…`}
                      value={subuInput}
                      onChange={(e) => setSubuInput(e.target.value)}
                    />
                    <button type="submit" className="glass-btn glass-btn--white" style={{ flexShrink: 0 }}>
                      Ir
                    </button>
                    <button
                      type="button"
                      className="icon-chip"
                      onClick={() => setSubuOpen(false)}
                      title="Cerrar panel de voz"
                    >
                      <X size={11} />
                    </button>
                  </form>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                    {[
                      "poneme Firestone en YouTube",
                      "qué tareas tengo para hoy",
                      "abrime VS Code",
                      "abrime el proyecto discoclaro",
                      "qué horas son",
                    ].map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        className="icon-chip"
                        style={{ fontSize: 10 }}
                        onClick={() => void runSubuOrder(sample)}
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                  {subuReply && (
                    <div style={{ fontSize: 11.5, color: "#7dd3fc" }}>
                      <strong>{config.assistantName || "Nova"}:</strong> {subuReply}
                      {kbLearnedCount > 0 && (
                        <span style={{ opacity: 0.65, fontSize: 10, marginLeft: 8 }}>
                          · 🧠 {kbLearnedCount} aprendidos
                        </span>
                      )}
                    </div>
                  )}
                  {folderChoices.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                        gap: 5,
                        marginTop: 2,
                      }}
                    >
                      {folderChoices.map((fc, idx) => (
                        <button
                          key={fc.path}
                          type="button"
                          className="glass-card-row"
                          style={{
                            cursor: "pointer",
                            padding: "6px 9px",
                            justifyContent: "flex-start",
                            gap: 8,
                            borderColor: "rgba(255, 255, 255, 0.14)",
                            background: "rgba(255, 255, 255, 0.06)",
                          }}
                          onClick={async () => {
                            setFolderChoices([]);
                            setPendingFolders([]);
                            const res = await getBridge()?.open_path_in_code(fc.path);
                            let msg = `¡De una! Abriendo ${fc.name} en ${res?.openedWith || "Visual Studio Code"}.`;
                            if (fc.mode === "project_mode") {
                              const song = config.codingMusic?.trim() || "Avicii Levels";
                              setBrightness(75);
                              await getBridge()?.set_brightness(75).catch(() => {});
                              setConfig((p) => ({ ...p, focusMinutes: 25 }));
                              setFocusSecondsLeft(25 * 60);
                              setFocusRunning(true);
                              await getBridge()?.play_media_query(song, "youtube").catch(() => {});
                              setActiveTab("focus");
                              msg = `¡De una! Abriendo ${fc.name} en VS Code, poniendo ${song}, brillo al 75% y Focus 25 min.`;
                            }
                            setSubuReply(msg);
                            setSubuInput("");
                            void speakAsSubu(
                              msg,
                              config.voiceEnabled !== false,
                              config.voiceName || "es-BO-SofiaNeural",
                              () => setSpeaking(true),
                              () => {
                                setSpeaking(false);
                                clearVoiceTimerRef.current = window.setTimeout(() => setSubuReply(null), 2400);
                              },
                            );
                          }}
                          title={fc.path}
                        >
                          <span
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 7,
                              background: "rgba(56, 189, 248, 0.14)",
                              border: "1px solid rgba(56, 189, 248, 0.28)",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              color: "#7dd3fc",
                            }}
                          >
                            <FolderOpen size={13} />
                          </span>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 108 }}>
                              {idx + 1}. {fc.name}
                            </span>
                            <span style={{ fontSize: 9.5, color: "rgba(226, 232, 240, 0.68)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 108 }}>
                              en {fc.parent}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {unknownPhrase && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 10.5, opacity: 0.78 }}>Enseñar a Nova:</span>
                      <select
                        className="glass-input"
                        style={{ width: 128, padding: "2px 6px", fontSize: 10, height: 22 }}
                        defaultValue=""
                        onChange={async (e) => {
                          const appName = e.target.value;
                          if (!appName || !unknownPhrase) return;
                          const phrase = unknownPhrase;
                          setUnknownPhrase(null);
                          await teachNovaAlias(phrase, appName);
                          setKbLearnedCount(getNovaKbStats().learnedCount);
                          void runSubuOrder(`abre ${appName}`);
                        }}
                        title="Aprender que te referías a una de tus apps (ej. claro -> Claude)"
                      >
                        <option value="" style={{ background: "#0f172a" }}>
                          📱 Elegir app…
                        </option>
                        {(config.appWidgets ?? []).map((aw) => (
                          <option key={aw.id} value={aw.name} style={{ background: "#0f172a" }}>
                            {aw.name}
                          </option>
                        ))}
                        {["Claude", "Copilot", "Visual Studio Code", "YouTube", "Spotify", "Chrome", "AccuWeather", "DiscoClaro"]
                          .filter((n) => !(config.appWidgets ?? []).some((w) => w.name.toLowerCase() === n.toLowerCase()))
                          .map((n) => (
                            <option key={n} value={n} style={{ background: "#0f172a" }}>
                              {n}
                            </option>
                          ))}
                      </select>
                      <button type="button" className="icon-chip icon-chip--active" style={{ fontSize: 10 }} onClick={() => void handleTeachNova("play_music")}>
                        🎵 Música
                      </button>
                      <button type="button" className="icon-chip" style={{ fontSize: 10 }} onClick={() => void handleTeachNova("web_search")}>
                        🔍 Google
                      </button>
                      <button type="button" className="icon-chip" style={{ fontSize: 10 }} onClick={() => void handleTeachNova("add_todo")}>
                        📝 Tarea
                      </button>
                      <button
                        type="button"
                        className="icon-chip"
                        style={{ fontSize: 10, opacity: 0.78 }}
                        onClick={() => {
                          setUnknownPhrase(null);
                          setSubuReply(null);
                          setSubuInput("");
                        }}
                        title="Descartar sin guardar en la memoria"
                      >
                        ✕ Ignorar
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div key={activeTab} className="tab-stage">
              {activeTab === "home" && (
                <div
                  className={`home-bento${isCompactLayout ? " home-bento--compact" : ""}`}
                  style={{
                    gridTemplateColumns: (config.homeSlots ?? ["laptop", "music", "focus"])
                      .map((id) => (id === "music" ? "1.65fr" : "1fr"))
                      .join(" "),
                  }}
                >
                  {(config.homeSlots ?? ["laptop", "music", "focus"]).map((slotId, slotIdx) => {
                    const isDragging = dragHomeIdx === slotIdx;
                    const dragCls = `${dragHomeIdx !== null ? " bento-tile--reordering" : ""}${isDragging ? " bento-tile--dragging" : ""}`;
                    const dragHandlers = {
                      "data-slot-idx": slotIdx,
                      onPointerDown: (e: React.PointerEvent) => {
                        if (e.button !== 0) return;
                        if ((e.target as HTMLElement).closest("button")) return;
                        startTileHold(slotIdx);
                      },
                    };
                    const safeClick = (fn: () => void) => () => {
                      if (didDragRef.current) {
                        didDragRef.current = false;
                        return;
                      }
                      fn();
                    };

                    if (slotId.startsWith("app:")) {
                      const appId = slotId.slice(4);
                      const aw = (config.appWidgets ?? []).find((a) => a.id === appId);
                      if (!aw) return null;
                      const st = appStatuses[aw.processName];
                      const [r, g, b] = aw.brandRgb;
                      return (
                        <div
                          key={`slot-${slotIdx}-${slotId}`}
                          className={`bento-tile${dragCls}`}
                          style={{
                            background: `linear-gradient(160deg, rgba(${r},${g},${b},0.72), rgba(${Math.round(r * 0.25)},${Math.round(g * 0.25)},${Math.round(b * 0.25)},0.92))`,
                          }}
                          {...dragHandlers}
                          onClick={safeClick(() => setActiveTab(slotId as `app:${string}`))}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="tile-kicker" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {aw.name}
                            </span>
                            {aw.iconDataUrl && (
                              <img
                                src={aw.iconDataUrl}
                                alt=""
                                width={22}
                                height={22}
                                style={{ borderRadius: 6 }}
                              />
                            )}
                          </div>
                          <div>
                            <div className="tile-big" style={{ fontSize: 18 }}>
                              {st?.running ? "Activa" : "Lista"}
                            </div>
                            <div className="tile-sub">
                              {st?.running ? `${st.ram_mb} MB RAM` : "Clic para abrir"}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (slotId === "weather") {
                      return (
                        <div
                          key={`slot-${slotIdx}-weather`}
                          className={`bento-tile bento-tile--sky${dragCls}`}
                          {...dragHandlers}
                          onClick={safeClick(() => {
                            getBridge()?.get_weather().then(setWeather).catch(() => {});
                            triggerBurst("happy", 900);
                          })}
                          title="Clic para actualizar clima · Mantén clic para mover"
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="tile-kicker">CLIMA</span>
                            <CloudSun size={15} opacity={0.9} />
                          </div>
                          <div>
                            <div className="tile-big">{weather.temp_c}°C</div>
                            <div className="tile-sub">
                              {weather.condition} · {weather.city}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (slotId === "music") {
                      const customCover = config.tileCovers?.music;
                      return (
                        <div
                          key={`slot-${slotIdx}-music`}
                          className={`bento-tile bento-tile--media${dragCls}`}
                          {...dragHandlers}
                          onClick={safeClick(() => setActiveTab("music"))}
                        >
                          <TileCoverBg src={customCover || musicSunsetArt} scrim="bottom" />
                          <button
                            type="button"
                            className="tile-cover-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePickTileCover("music");
                            }}
                            title="Cambiar imagen de portada de Música"
                          >
                            <ImagePlus size={11} />
                          </button>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="tile-kicker">
                              {nowPlaying.source || "MULTIMEDIA"}
                            </span>
                            <Music size={14} opacity={0.9} />
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-end",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 16,
                                  fontWeight: 800,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  textShadow: "0 2px 10px rgba(0,0,0,0.45)",
                                }}
                              >
                                {nowPlaying.title}
                              </div>
                              <div className="tile-sub">{nowPlaying.artist}</div>
                            </div>
                            <button
                              type="button"
                              className="play-fab"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMedia("play_pause");
                              }}
                              title="Play / Pausa"
                            >
                              {nowPlaying.playing ? <Pause size={15} /> : <Play size={15} />}
                            </button>
                          </div>
                        </div>
                      );
                    }
                    if (slotId === "focus") {
                      const customCover = config.tileCovers?.focus;
                      return (
                        <div
                          key={`slot-${slotIdx}-focus`}
                          className={`bento-tile bento-tile--violet${dragCls}`}
                          {...dragHandlers}
                          onClick={safeClick(() => setActiveTab("focus"))}
                        >
                          <TileCoverBg src={customCover || focusCoverArt} scrim="bottom" />
                          <button
                            type="button"
                            className="tile-cover-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePickTileCover("focus");
                            }}
                            title="Cambiar imagen de portada de Focus"
                          >
                            <ImagePlus size={11} />
                          </button>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="tile-kicker" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.65)" }}>FOCUS</span>
                            <button
                              type="button"
                              className="play-fab"
                              style={{ width: 26, height: 26 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFocusTimer();
                              }}
                              title="Iniciar / Pausar Focus desde Home"
                            >
                              {focusRunning ? <Pause size={12} /> : <Play size={12} />}
                            </button>
                          </div>
                          <div>
                            <div className="tile-big" style={{ fontSize: 21, textShadow: "0 2px 10px rgba(0,0,0,0.65)" }}>
                              {focusMin}:{focusSec}
                            </div>
                            <div className="tile-sub" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.75)" }}>
                              {focusRunning ? `Fin ${doneAt}` : "Listo"}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (slotId === "tasks") {
                      return (
                        <div
                          key={`slot-${slotIdx}-tasks`}
                          className={`bento-tile bento-tile--emerald${dragCls}`}
                          {...dragHandlers}
                          onClick={safeClick(() => setActiveTab("notes"))}
                        >
                          <span className="tile-kicker">AGENDA</span>
                          <div>
                            <div className="tile-big">
                              {doneTodos}/{config.todos.length}
                            </div>
                            <div className="tile-sub">
                              {config.todos.find((t) => !t.done)?.text ?? "Todo listo"}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (slotId === "launcher") {
                      return (
                        <div
                          key={`slot-${slotIdx}-launcher`}
                          className={`bento-tile bento-tile--sky${dragCls}`}
                          {...dragHandlers}
                          onClick={safeClick(() => setActiveTab("launcher"))}
                        >
                          <span className="tile-kicker">ACCESOS</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {config.shortcuts.slice(0, 3).map((sc) => (
                              <button
                                key={sc.id}
                                type="button"
                                className="icon-chip"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleLaunch(sc.target);
                                }}
                              >
                                {sc.emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    if (slotId === "clipboard") {
                      return (
                        <div
                          key={`slot-${slotIdx}-clipboard`}
                          className={`bento-tile bento-tile--amber${dragCls}`}
                          {...dragHandlers}
                          onClick={safeClick(() => setActiveTab("clipboard"))}
                        >
                          <span className="tile-kicker">CLIPS ({clipHistory.length})</span>
                          <div className="tile-sub" style={{ whiteSpace: "normal", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                            {clipHistory[0] || "Ctrl+C"}
                          </div>
                        </div>
                      );
                    }
                    const customLaptopCover = config.tileCovers?.laptop;
                    return (
                      <div
                        key={`slot-${slotIdx}-laptop`}
                        className={`bento-tile bento-tile--amber${dragCls}`}
                        {...dragHandlers}
                        onClick={safeClick(() => setActiveTab("system"))}
                      >
                        <TileCoverBg src={customLaptopCover || laptopCoverArt} scrim="bottom" />
                        <button
                          type="button"
                          className="tile-cover-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handlePickTileCover("laptop");
                          }}
                          title="Cambiar imagen de portada de Laptop"
                        >
                          <ImagePlus size={11} />
                        </button>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                          <span className="tile-kicker" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>LAPTOP</span>
                          <span className="hud-battery-pill" title={telemetry.battery_plugged ? "Cargando" : "Con batería"}>
                            <span>{telemetry.battery_percent}%</span>
                            <span className="hud-bat-icon">
                              <span
                                className="hud-bat-fill"
                                style={{
                                  width: `${Math.max(15, telemetry.battery_percent)}%`,
                                  background: telemetry.battery_percent <= 20 ? "#f87171" : "#4ade80",
                                }}
                              />
                              {telemetry.battery_plugged && <span className="hud-bat-bolt">⚡</span>}
                            </span>
                          </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 6 }}>
                          <div style={{ minWidth: 0 }}>
                            <div className="tile-big" style={{ fontSize: 22, textShadow: "0 2px 10px rgba(0,0,0,0.75)" }}>
                              {telemetry.cpu_percent}%
                            </div>
                            <div className="tile-sub" style={{ fontSize: 10.5, textShadow: "0 1px 6px rgba(0,0,0,0.85)" }}>
                              RAM {telemetry.ram_percent}% · C:{telemetry.disk_c_free_gb}G
                            </div>
                          </div>

                          {/* HUD tecnológico clicable (CPU, RAM, Disco C:, Panel Sistema) */}
                          <div className="laptop-hud-dock" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="hud-mini-btn"
                              onClick={() => handleLaunch("taskmgr.exe")}
                              title={`CPU ${telemetry.cpu_percent}% · Clic para abrir Administrador de Tareas`}
                            >
                              <Cpu size={12} />
                              <span className="hud-mini-bar">
                                <span style={{ width: `${Math.min(100, Math.max(18, telemetry.cpu_percent))}%` }} />
                              </span>
                            </button>
                            <button
                              type="button"
                              className="hud-mini-btn"
                              onClick={() => handleLaunch("resmon.exe")}
                              title={`RAM ${telemetry.ram_percent}% (${telemetry.ram_used_gb}/${telemetry.ram_total_gb} GB) · Clic para Monitor de Recursos`}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="7" width="18" height="10" rx="2" />
                                <path d="M7 11v2M11 11v2M15 11v2M17 17v3M7 17v3M12 17v3" />
                              </svg>
                              <span className="hud-mini-bar">
                                <span style={{ width: `${Math.min(100, Math.max(18, telemetry.ram_percent))}%` }} />
                              </span>
                            </button>
                            <button
                              type="button"
                              className="hud-mini-btn"
                              onClick={() => handleLaunch("C:\\")}
                              title={`Disco C: ${telemetry.disk_c_free_gb} GB libres · Clic para abrir Disco C:`}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="4" y="3" width="16" height="18" rx="2" />
                                <circle cx="12" cy="10" r="3" />
                                <path d="M8 17h8" />
                              </svg>
                              <span className="hud-mini-bar">
                                <span style={{ width: `${Math.min(100, Math.max(18, telemetry.disk_c_percent))}%` }} />
                              </span>
                            </button>
                            <button
                              type="button"
                              className="hud-mini-btn"
                              onClick={() => setActiveTab("system")}
                              title={`Brillo ${brightness}% y estado completo · Clic para abrir panel Laptop`}
                            >
                              <Sun size={12} />
                              <span className="hud-mini-bar">
                                <span style={{ width: `${Math.min(100, Math.max(15, brightness))}%` }} />
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeAppWidget && (() => {
                const st = appStatuses[activeAppWidget.processName];
                const upSec = st?.uptime_sec ?? 0;
                const upStr =
                  upSec >= 3600
                    ? `${Math.floor(upSec / 3600)}h ${Math.floor((upSec % 3600) / 60)}m`
                    : `${Math.floor(upSec / 60)}:${String(upSec % 60).padStart(2, "0")}`;
                return (
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: 14,
                            background: `${activeAppWidget.brandColor}33`,
                            border: `1.5px solid ${activeAppWidget.brandColor}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <AgentBrandLogo
                            name={activeAppWidget.name}
                            fallbackUrl={activeAppWidget.iconDataUrl}
                            size={34}
                          />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="tile-kicker" style={{ color: activeAppWidget.brandColor }}>
                            {st?.running ? `● ACTIVA · ${st.ram_mb} MB RAM` : "○ EN REPOSO"}
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 800, display: "flex", alignItems: "baseline", gap: 10 }}>
                            <span>{activeAppWidget.name}</span>
                            {st?.running && (
                              <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", opacity: 0.78 }}>
                                {upStr}
                              </span>
                            )}
                          </div>
                          <div className="tile-sub">
                            {st?.window_title
                              ? `Sesión actual: ${st.window_title}`
                              : st?.running
                                ? `${st.count} proceso(s) activos`
                                : "Lista para iniciar nuevo chat o abrir"}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="glass-btn glass-btn--white"
                        onClick={() => {
                          const pendingPrompt =
                            quickPrompt.trim() ||
                            (agentAnswer &&
                            agentAnswer.agent.toLowerCase().includes(activeAppWidget.name.toLowerCase())
                              ? agentAnswer.question
                              : "");
                          if (pendingPrompt && isAiAgentApp(activeAppWidget.name, activeAppWidget.processName)) {
                            void getBridge()
                              ?.launch_and_paste(
                                activeAppWidget.exePath,
                                pendingPrompt,
                                activeAppWidget.name,
                              )
                              .catch(() => {});
                          } else {
                            void handleLaunch(activeAppWidget.exePath);
                          }
                        }}
                      >
                        <ExternalLink size={12} /> Abrir
                      </button>
                    </div>

                    {/* Solo las apps de IA / Agente muestran la caja de nuevo chat / prompt rápido */}
                    {isAiAgentApp(activeAppWidget.name, activeAppWidget.processName) ? (
                      <>
                        <form
                          onSubmit={(e) => handleQuickPromptSubmit(e, activeAppWidget)}
                          style={{ display: "flex", gap: 6, alignItems: "center" }}
                        >
                          <input
                            className="glass-input"
                            placeholder={`Pregúntale directo a ${activeAppWidget.name} aquí (Enter)…`}
                            value={quickPrompt}
                            onChange={(e) => setQuickPrompt(e.target.value)}
                          />
                          <button type="submit" className="glass-btn" style={{ borderColor: activeAppWidget.brandColor, flexShrink: 0 }}>
                            Preguntar ↗
                          </button>
                        </form>
                        {agentAnswer && (
                          <div
                            className="glass-card-row"
                            style={{
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 3,
                              background: "rgba(15, 23, 42, 0.58)",
                              borderColor: "rgba(56, 189, 248, 0.35)",
                            }}
                          >
                            <div style={{ fontSize: 10, opacity: 0.72 }}>
                              Consulta: <strong>{agentAnswer.question}</strong>
                            </div>
                            <div style={{ fontSize: 11.5, color: "#e0f2fe", lineHeight: 1.38 }}>
                              {agentAnswer.answer}
                            </div>
                          </div>
                        )}
                      </>
                    ) : activeAppWidget.name.toLowerCase().includes("discoclaro") ? (
                      <div className="glass-card-row" style={{ justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12 }}>
                          💾 Disco C: <strong>{telemetry.disk_c_free_gb} GB libres</strong> ({telemetry.disk_c_percent}% usado)
                        </span>
                        <button
                          type="button"
                          className="icon-chip icon-chip--active"
                          onClick={() => handleLaunch("http://127.0.0.1:8347")}
                        >
                          Abrir Web ↗
                        </button>
                      </div>
                    ) : null}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button
                          type="button"
                          className="icon-chip"
                          onClick={() => {
                            const key: HomeWidgetId = `app:${activeAppWidget.id}`;
                            setConfig((p) => {
                              const has = p.homeSlots.includes(key);
                              if (has) {
                                return {
                                  ...p,
                                  homeSlots: p.homeSlots.length > 2 ? p.homeSlots.filter((x) => x !== key) : p.homeSlots,
                                };
                              }
                              if (p.homeSlots.length >= 5) return p;
                              return { ...p, homeSlots: [...p.homeSlots, key] };
                            });
                          }}
                        >
                          {config.homeSlots.includes(`app:${activeAppWidget.id}`)
                            ? "✓ En Home"
                            : "+ Poner en Home"}
                        </button>
                        {promptToast && (
                          <span style={{ fontSize: 10.5, color: "#6ee7b7" }}>{promptToast}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="icon-chip"
                        style={{ color: "#fca5a5" }}
                        onClick={() => {
                          const key: HomeWidgetId = `app:${activeAppWidget.id}`;
                          setConfig((p) => ({
                            ...p,
                            appWidgets: (p.appWidgets ?? []).filter((a) => a.id !== activeAppWidget.id),
                            homeSlots: p.homeSlots.filter((x) => x !== key),
                            dockOrder: (p.dockOrder ?? []).filter((x) => x !== key),
                          }));
                          setActiveTab("home");
                        }}
                      >
                        <Trash2 size={10} /> Quitar
                      </button>
                    </div>
                  </div>
                );
              })()}

              {activeTab === "music" && (() => {
                const dur = nowPlaying.dur_sec || 0;
                const pos = nowPlaying.pos_sec || 0;
                const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : nowPlaying.playing ? 38 : 0;
                return (
                  <div className="music-stage">
                    {/* Izquierda: carátula real del video/canción o tu portada de Música */}
                    <div className="music-stage__cover">
                      <img
                        src={nowPlaying.cover || config.tileCovers?.music || musicSunsetArt}
                        alt={nowPlaying.title}
                      />
                    </div>

                    {/* Derecha: vidrio translúcido + plataforma oficial + título + progreso + controles */}
                    <div className="music-stage__info">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <PlatformBadge source={nowPlaying.source} platform={nowPlaying.platform} />
                        {nowPlaying.playing ? (
                          <span className="eq-bars" title="Reproduciendo">
                            <span />
                            <span />
                            <span />
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, opacity: 0.55 }}>En pausa · Listo para Play</span>
                        )}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 800,
                            lineHeight: 1.2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {nowPlaying.title}
                        </div>
                        <div className="tile-sub" style={{ marginTop: 2, opacity: 0.78 }}>
                          {nowPlaying.artist}
                        </div>
                      </div>

                      <div className="music-timeline">
                        <span>{dur > 0 ? formatMediaTime(pos) : nowPlaying.playing ? "LIVE" : "0:00"}</span>
                        <div className="music-timeline__track">
                          <div className="music-timeline__fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span>{dur > 0 ? formatMediaTime(dur) : "--:--"}</span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button type="button" className="icon-chip" onClick={() => handleMedia("vol_down")} title="Bajar volumen">
                            −
                          </button>
                          <button type="button" className="icon-chip" onClick={() => handleMedia("vol_mute")} title="Silenciar">
                            <VolumeX size={11} />
                          </button>
                          <button type="button" className="icon-chip" onClick={() => handleMedia("vol_up")} title="Subir volumen">
                            +
                          </button>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button type="button" className="icon-chip" style={{ padding: "5px 8px" }} onClick={() => handleMedia("prev")} title="Anterior">
                            <SkipBack size={13} />
                          </button>
                          <button
                            type="button"
                            className="play-fab"
                            style={{ width: 34, height: 34 }}
                            onClick={() => handleMedia("play_pause")}
                            title={nowPlaying.playing ? "Pausar" : "Reproducir"}
                          >
                            {nowPlaying.playing ? <Pause size={15} /> : <Play size={15} />}
                          </button>
                          <button type="button" className="icon-chip" style={{ padding: "5px 8px" }} onClick={() => handleMedia("next")} title="Siguiente">
                            <SkipForward size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {activeTab === "focus" && (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                        {focusMin}:{focusSec}
                      </div>
                      <div className="tile-sub" style={{ marginTop: 4 }}>
                        {focusRunning ? `Termina a las ${doneAt}` : `Duración: ${config.focusMinutes} min`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="glass-btn glass-btn--white" onClick={toggleFocusTimer}>
                        {focusRunning ? "Pausar" : "Iniciar"}
                      </button>
                      <button
                        type="button"
                        className="glass-btn"
                        onClick={() => setFocusSecondsLeft((s) => s + 300)}
                      >
                        +5 min
                      </button>
                      <button
                        type="button"
                        className="glass-btn"
                        onClick={() => {
                          setFocusRunning(false);
                          setFocusSecondsLeft(config.focusMinutes * 60);
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div>
                    <div
                      className="focus-ruler"
                      style={{ position: "relative", cursor: "ew-resize" }}
                      title="Arrastra izquierda o derecha para elegir cualquier minuto (1 a 60 min)"
                    >
                      {Array.from({ length: 25 }).map((_, idx) => {
                        const mins = Math.round(1 + (idx * 59) / 24);
                        const isNear = Math.abs(config.focusMinutes - mins) <= 1;
                        return (
                          <div
                            key={idx}
                            className={`focus-tick ${isNear ? "focus-tick--active" : idx % 4 === 0 ? "focus-tick--major" : "focus-tick--minor"}`}
                            style={{ pointerEvents: "none" }}
                          />
                        );
                      })}
                      {/* Aguja luminosa que sigue exactamente el minuto elegido al arrastrar */}
                      <div
                        style={{
                          position: "absolute",
                          top: 2,
                          bottom: 2,
                          left: `${((config.focusMinutes - 1) / 59) * 100}%`,
                          width: 3,
                          borderRadius: 99,
                          background: "#ffffff",
                          boxShadow: "0 0 12px rgba(255, 255, 255, 0.95)",
                          transform: "translateX(-50%)",
                          pointerEvents: "none",
                          transition: "left 0.06s linear",
                        }}
                      />
                      <input
                        type="range"
                        min={1}
                        max={60}
                        step={1}
                        value={config.focusMinutes}
                        onChange={(e) => selectFocusMinutes(Number(e.target.value))}
                        aria-label="Seleccionar minutos de Focus"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          opacity: 0,
                          cursor: "ew-resize",
                          margin: 0,
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "var(--font-mono)", opacity: 0.65, marginTop: 2 }}>
                      <span>1m</span>
                      <span>15m</span>
                      <span>30m</span>
                      <span>45m</span>
                      <span>60m</span>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "shelf" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="tile-kicker">ESTANTE DE ARCHIVOS ({config.shelfFiles.length})</span>
                    <button type="button" className="glass-btn glass-btn--white" onClick={handleAddShelfFiles}>
                      <Plus size={12} /> Añadir archivos
                    </button>
                  </div>
                  {config.shelfFiles.length === 0 ? (
                    <div className="tile-sub" style={{ padding: "14px 0", textAlign: "center" }}>
                      Guarda aquí PDFs, imágenes o documentos frecuentes para abrirlos en 1 clic.
                    </div>
                  ) : (
                    config.shelfFiles.map((f) => (
                      <div key={f.path} className="glass-card-row">
                        <div style={{ minWidth: 0, cursor: "pointer" }} onClick={() => handleLaunch(f.path)}>
                          <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            📄 {f.name}
                          </div>
                          <div style={{ fontSize: 10, opacity: 0.65 }}>{formatBytesShort(f.size_bytes)}</div>
                        </div>
                        <button
                          type="button"
                          className="icon-chip"
                          onClick={() =>
                            setConfig((p) => ({
                              ...p,
                              shelfFiles: p.shelfFiles.filter((x) => x.path !== f.path),
                            }))
                          }
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "clipboard" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="tile-kicker">PORTAPAPELES ({clipHistory.length})</span>
                    {clipHistory.length > 0 && (
                      <button type="button" className="icon-chip" onClick={() => setClipHistory([])}>
                        Limpiar
                      </button>
                    )}
                  </div>
                  {clipHistory.length === 0 ? (
                    <div className="tile-sub" style={{ padding: "14px 0", textAlign: "center" }}>
                      Copia cualquier texto (`Ctrl + C`) y aparecerá aquí al instante.
                    </div>
                  ) : (
                    clipHistory.map((item, idx) => (
                      <div
                        key={`${idx}-${item.slice(0, 12)}`}
                        className="glass-card-row"
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          getBridge()?.set_clipboard(item).catch(() => {});
                          navigator.clipboard?.writeText(item).catch(() => {});
                          setCopiedIdx(idx);
                          window.setTimeout(() => setCopiedIdx(null), 1200);
                        }}
                      >
                        <span style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item}
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.8, flexShrink: 0 }}>
                          {copiedIdx === idx ? "✓ Copiado" : "Copiar"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "notes" && (
                <div style={{ display: "grid", gridTemplateColumns: "0.75fr 1.6fr", gap: 10, height: "100%" }}>
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div>
                      <span className="tile-kicker">HOY</span>
                      <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.05, marginTop: 4 }}>
                        {doneTodos}
                        <span style={{ opacity: 0.45 }}>/{config.todos.length}</span>
                      </div>
                    </div>
                    <form onSubmit={handleAddTodo} style={{ display: "flex", gap: 4 }}>
                      <input
                        className="glass-input"
                        style={{ padding: "5px 8px", fontSize: 11 }}
                        placeholder="Nueva tarea..."
                        value={newTodoText}
                        onChange={(e) => setNewTodoText(e.target.value)}
                      />
                      <button type="submit" className="icon-chip" title="Añadir">
                        <Plus size={12} />
                      </button>
                    </form>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, overflowY: "auto" }}>
                    {config.todos.map((t) => (
                      <div key={t.id} className="glass-card-row" style={{ padding: "6px 9px" }}>
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", minWidth: 0, flex: 1 }}
                          onClick={() => {
                            const nextDone = !t.done;
                            setConfig((p) => ({
                              ...p,
                              todos: p.todos.map((x) =>
                                x.id === t.id ? { ...x, done: nextDone } : x,
                              ),
                            }));
                            if (nextDone) {
                              triggerBurst("happy", 1000);
                              setGreenGlow(true);
                              window.setTimeout(() => setGreenGlow(false), 1100);
                            }
                          }}
                        >
                          <span
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 99,
                              border: "1.5px solid rgba(255,255,255,0.45)",
                              background: t.done ? "#10b981" : "transparent",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {t.done && <Check size={10} color="#0f172a" strokeWidth={3} />}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              textDecoration: t.done ? "line-through" : "none",
                              opacity: t.done ? 0.55 : 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t.text}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="icon-chip"
                          onClick={() =>
                            setConfig((p) => ({
                              ...p,
                              todos: p.todos.filter((x) => x.id !== t.id),
                            }))
                          }
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "system" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                    <div className="glass-card-row" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                      <span className="tile-kicker">CPU</span>
                      <strong style={{ fontSize: 15 }}>{telemetry.cpu_percent}%</strong>
                    </div>
                    <div className="glass-card-row" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                      <span className="tile-kicker">RAM</span>
                      <strong style={{ fontSize: 15 }}>{telemetry.ram_used_gb}/{telemetry.ram_total_gb} GB</strong>
                    </div>
                    <div className="glass-card-row" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                      <span className="tile-kicker">
                        <BatteryCharging size={11} /> BATERÍA
                      </span>
                      <strong style={{ fontSize: 15 }}>{telemetry.battery_percent}%</strong>
                    </div>
                  </div>

                  {/* Slider de Brillo fluido (worker persistente <15ms) */}
                  <div className="glass-card-row">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, minWidth: 88 }}>
                      <Sun size={13} /> Brillo <strong>{brightness}%</strong>
                    </span>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={brightness}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setBrightness(v);
                        getBridge()?.set_brightness(v).catch(() => {});
                      }}
                      style={{ flex: 1, accentColor: "#38bdf8", cursor: "pointer" }}
                    />
                  </div>

                  {/* Expresiones de los ojitos */}
                  <div className="glass-card-row" style={{ flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, opacity: 0.8 }}>Expresión:</span>
                    {(
                      [
                        ["idle", "Normal"],
                        ["happy", "Feliz ◠ ◠"],
                        ["wink", "Guiño"],
                        ["angry", "Enojado"],
                        ["sleepy", "Sueño"],
                      ] as [RobotMood, string][]
                    ).map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        className={`icon-chip${manualMood === m ? " icon-chip--active" : ""}`}
                        onClick={() => setManualMood((cur) => (cur === m ? null : m))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "launcher" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {/* Buscador rápido estilo Quick Bookmarks (Google, YouTube, GitHub, ChatGPT, Perplexity) */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const eng =
                        QUICK_SEARCH_ENGINES.find((x) => x.id === activeSearchEngine) ??
                        QUICK_SEARCH_ENGINES[0];
                      const q = webQuery.trim();
                      const url = q
                        ? `${eng.url}${encodeURIComponent(q)}`
                        : eng.url.split("/search")[0].split("/results")[0].split("/?")[0];
                      handleLaunch(url);
                      setWebQuery("");
                    }}
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <input
                      className="glass-input"
                      placeholder={`Buscar en ${QUICK_SEARCH_ENGINES.find((x) => x.id === activeSearchEngine)?.label ?? "Google"}…`}
                      value={webQuery}
                      onChange={(e) => setWebQuery(e.target.value)}
                    />
                    <button type="submit" className="glass-btn glass-btn--white" style={{ flexShrink: 0 }}>
                      Buscar ↗
                    </button>
                  </form>

                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    {QUICK_SEARCH_ENGINES.map((eng) => (
                      <button
                        key={eng.id}
                        type="button"
                        className={`icon-chip${activeSearchEngine === eng.id ? " icon-chip--active" : ""}`}
                        onClick={() => setActiveSearchEngine(eng.id)}
                      >
                        <span>{eng.emoji}</span> {eng.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="icon-chip"
                      style={{ marginLeft: "auto" }}
                      onClick={() => setActiveTab("customize")}
                    >
                      <Plus size={11} /> Añadir enlace
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(125px, 1fr))", gap: 6 }}>
                    {config.shortcuts.map((sc) => (
                      <div
                        key={sc.id}
                        className="glass-card-row"
                        style={{
                          cursor: "pointer",
                          borderLeft: `3px solid ${sc.color}`,
                        }}
                        onClick={() => handleLaunch(sc.target)}
                        title={sc.target}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {sc.emoji} {sc.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "customize" && (
                <div className="settings-shell">
                  {/* Barra horizontal de secciones: 1 clic sin scrollear hasta abajo */}
                  <div className="settings-tabs" role="tablist">
                    {(
                      [
                        ["nova", "🎙️ Nova & IA"],
                        ["design", "🎨 Diseño"],
                        ["apps", `📱 Apps (${installedApps.length || "…"})`],
                        ["home", "🏠 Home"],
                        ["shortcuts", "⚡ Accesos"],
                        ["dock", "🧭 Dock"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={settingsSection === id}
                        className={`settings-tab${settingsSection === id ? " settings-tab--active" : ""}`}
                        onClick={() => setSettingsSection(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* SECCIÓN 1: NOVA, VOZ & CEREBRO IA HÍBRIDO */}
                  {settingsSection === "nova" && (
                    <div className="settings-panel">
                      <div className="switch-grid">
                        <div
                          className="switch-row"
                          onClick={() =>
                            setConfig((p) => ({ ...p, alwaysListen: p.alwaysListen === false }))
                          }
                          title={micReady ? "Micrófono activo en tiempo real" : "Iniciando micrófono..."}
                        >
                          <span>🎙️ Escucha auto</span>
                          <button
                            type="button"
                            className={`glass-switch${config.alwaysListen !== false ? " glass-switch--on" : ""}`}
                            aria-checked={config.alwaysListen !== false}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                        <div
                          className="switch-row"
                          onClick={() =>
                            setConfig((p) => ({ ...p, voiceEnabled: p.voiceEnabled === false }))
                          }
                        >
                          <span>🔊 Voz hablada</span>
                          <button
                            type="button"
                            className={`glass-switch${config.voiceEnabled !== false ? " glass-switch--on" : ""}`}
                            aria-checked={config.voiceEnabled !== false}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                        <div
                          className="switch-row"
                          onClick={() =>
                            setConfig((p) => ({ ...p, aiBrainEnabled: p.aiBrainEnabled === false }))
                          }
                        >
                          <span>🧠 IA Híbrida {kbLearnedCount > 0 ? `(${kbLearnedCount})` : ""}</span>
                          <button
                            type="button"
                            className={`glass-switch${config.aiBrainEnabled !== false ? " glass-switch--on" : ""}`}
                            aria-checked={config.aiBrainEnabled !== false}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                        <div
                          className="switch-row"
                          onClick={() =>
                            setConfig((p) => ({ ...p, whisperOffline: !p.whisperOffline }))
                          }
                          title="Activa faster-whisper (large-v3-turbo en RTX 5050) 100% offline con tildes y ¿?"
                        >
                          <span>⚡ Whisper Offline</span>
                          <button
                            type="button"
                            className={`glass-switch${config.whisperOffline ? " glass-switch--on" : ""}`}
                            aria-checked={Boolean(config.whisperOffline)}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                        <div
                          className="switch-row"
                          onClick={() =>
                            setConfig((p) => ({ ...p, hudSounds: p.hudSounds === false }))
                          }
                          title="Micro-sonidos HUD futuristas al despertar y completar órdenes"
                        >
                          <span>🔔 Sonidos HUD</span>
                          <button
                            type="button"
                            className={`glass-switch${config.hudSounds !== false ? " glass-switch--on" : ""}`}
                            aria-checked={config.hudSounds !== false}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                        <div
                          className="switch-row"
                          onClick={() =>
                            setConfig((p) => ({ ...p, greetOnStart: p.greetOnStart === false }))
                          }
                          title="Saludo proactivo estilo Jarvis al abrir GlassIsland"
                        >
                          <span>👋 Saludo inicio</span>
                          <button
                            type="button"
                            className={`glass-switch${config.greetOnStart !== false ? " glass-switch--on" : ""}`}
                            aria-checked={config.greetOnStart !== false}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                      </div>

                      <div className="glass-card-row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <input
                          className="glass-input"
                          style={{ width: 82, padding: "5px 8px", fontSize: 11.5 }}
                          value={config.assistantName ?? "Nova"}
                          onChange={(e) =>
                            setConfig((p) => ({ ...p, assistantName: e.target.value }))
                          }
                          placeholder="Nombre"
                          title="Nombre editable de tu asistente"
                        />
                        <select
                          className="glass-input"
                          style={{ flex: 1, minWidth: 165, padding: "5px 7px", fontSize: 11 }}
                          value={config.voiceName || "en-US-EmmaMultilingualNeural"}
                          onChange={(e) =>
                            setConfig((p) => ({ ...p, voiceName: e.target.value }))
                          }
                        >
                          {VOICE_PROFILES.map((vp) => (
                            <option key={vp.id} value={vp.id} style={{ background: "#0f172a" }}>
                              {vp.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="icon-chip icon-chip--active"
                          onClick={() => {
                            playWakeChime(config.hudSounds !== false);
                            void speakAsSubu(
                              `Buenas noches, Hebert. Aquí ${config.assistantName || "Nova"}. Todo listo, ¿en qué trabajamos hoy?`,
                              true,
                              config.voiceName || "en-US-EmmaMultilingualNeural",
                              () => setSpeaking(true),
                              () => setSpeaking(false),
                              config.geminiApiKey || "",
                            );
                          }}
                        >
                          ▶ Probar voz
                        </button>
                      </div>

                      <div className="glass-card-row" style={{ gap: 6 }}>
                        <input
                          type="password"
                          className="glass-input"
                          style={{ flex: 1, padding: "5px 8px", fontSize: 11 }}
                          value={config.geminiApiKey ?? ""}
                          onChange={(e) =>
                            setConfig((p) => ({ ...p, geminiApiKey: e.target.value }))
                          }
                          placeholder="Gemini API Key (para IA + Voz Gemini Pro TTS)"
                        />
                        <input
                          className="glass-input"
                          style={{ width: 92, padding: "5px 7px", fontSize: 11 }}
                          value={config.ollamaModel ?? "qwen2.5:7b"}
                          onChange={(e) =>
                            setConfig((p) => ({ ...p, ollamaModel: e.target.value }))
                          }
                          placeholder="Ollama"
                          title="Modelo local Ollama (127.0.0.1:11434)"
                        />
                        <input
                          className="glass-input"
                          style={{ width: 105, padding: "5px 7px", fontSize: 11 }}
                          value={config.codingMusic ?? "Avicii Levels"}
                          onChange={(e) =>
                            setConfig((p) => ({ ...p, codingMusic: e.target.value }))
                          }
                          placeholder="Música"
                          title="Canción o género para Modo Programación / Modo Proyecto"
                        />
                        <input
                          className="glass-input"
                          style={{ width: 115, padding: "5px 7px", fontSize: 11 }}
                          value={config.smartHomeWebhook ?? ""}
                          onChange={(e) =>
                            setConfig((p) => ({ ...p, smartHomeWebhook: e.target.value }))
                          }
                          placeholder="Webhook luces"
                          title="URL webhook opcional para Home Assistant / IFTTT / Tuya"
                        />
                      </div>
                    </div>
                  )}

                  {/* SECCIÓN 2: DISEÑO, FORMA, POSICIÓN Y OJITOS */}
                  {settingsSection === "design" && (
                    <div className="settings-panel">
                      <div className="switch-grid">
                        <div
                          className="switch-row"
                          onClick={() =>
                            setConfig((p) => ({
                              ...p,
                              themeStyle: p.themeStyle === "frutiger-aero" ? "glass" : "frutiger-aero",
                            }))
                          }
                        >
                          <span>💧 Frutiger Aero</span>
                          <button
                            type="button"
                            className={`glass-switch${config.themeStyle === "frutiger-aero" ? " glass-switch--on" : ""}`}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                        <div
                          className="switch-row"
                          onClick={() => setConfig((p) => ({ ...p, autoHide: !p.autoHide }))}
                        >
                          <span>✨ Auto-ocultar</span>
                          <button
                            type="button"
                            className={`glass-switch${config.autoHide ? " glass-switch--on" : ""}`}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                        <div
                          className="switch-row"
                          onClick={() => setConfig((p) => ({ ...p, showMouth: !p.showMouth }))}
                        >
                          <span>🙂 Boquita</span>
                          <button
                            type="button"
                            className={`glass-switch${config.showMouth ? " glass-switch--on" : ""}`}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                        <div
                          className="switch-row"
                          onClick={() => {
                            const next = !config.autoStart;
                            setConfig((p) => ({ ...p, autoStart: next }));
                            getBridge()?.set_auto_start?.(next).catch(() => {});
                          }}
                          title="Iniciar GlassIsland automáticamente al encender Windows"
                        >
                          <span>🚀 Inicio Windows</span>
                          <button
                            type="button"
                            className={`glass-switch${config.autoStart ? " glass-switch--on" : ""}`}
                          >
                            <span className="glass-switch__thumb" />
                          </button>
                        </div>
                      </div>

                      <div className="glass-card-row" style={{ gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1 }}>
                          <span className="tile-kicker">FORMA</span>
                          <select
                            className="glass-input"
                            style={{ padding: "4px 6px", fontSize: 11 }}
                            value={config.shape}
                            onChange={(e) =>
                              setConfig((p) => ({ ...p, shape: e.target.value as IslandShape }))
                            }
                          >
                            {SHAPE_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id} style={{ background: "#0f172a" }}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1 }}>
                          <span className="tile-kicker">IMÁN</span>
                          <select
                            className="glass-input"
                            style={{ padding: "4px 6px", fontSize: 11 }}
                            value={config.anchor}
                            onChange={(e) =>
                              setConfig((p) => ({ ...p, anchor: e.target.value as IslandAnchor }))
                            }
                          >
                            {ANCHOR_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id} style={{ background: "#0f172a" }}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="glass-card-row" style={{ flexWrap: "wrap", gap: 5 }}>
                        <span className="tile-kicker">
                          <Sparkles size={11} /> OJITOS:
                        </span>
                        {ROBOT_COLORS.map((c) => (
                          <button
                            key={c.hex}
                            type="button"
                            className={`icon-chip${config.robotColor === c.hex ? " icon-chip--active" : ""}`}
                            onClick={() => {
                              setConfig((p) => ({ ...p, robotColor: c.hex }));
                              triggerBurst("happy", 1000);
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 99,
                                background: c.hex,
                                display: "inline-block",
                              }}
                            />
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SECCIÓN 3: BUSCADOR DE APPS INSTALADAS */}
                  {settingsSection === "apps" && (
                    <div className="settings-panel">
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          className="glass-input"
                          style={{ padding: "5px 9px", fontSize: 11.5 }}
                          placeholder={`🔍 Buscar entre ${installedApps.length} apps instaladas (VS Code, Claude, Spotify, DiscoClaro...)`}
                          value={appSearch}
                          onChange={(e) => setAppSearch(e.target.value)}
                        />
                        <button
                          type="button"
                          className="icon-chip"
                          style={{ flexShrink: 0 }}
                          onClick={handleAddOfficialAppWidget}
                        >
                          <FolderOpen size={11} /> Elegir .exe
                        </button>
                      </div>
                      {installedApps.length > 0 && (() => {
                        const q = appSearch.trim().toLowerCase();
                        const matches = installedApps.filter((a) =>
                          q
                            ? a.name.toLowerCase().includes(q) ||
                              a.processName.toLowerCase().includes(q)
                            : true,
                        );
                        return matches.length === 0 ? (
                          <div style={{ fontSize: 11, opacity: 0.72, padding: "4px 2px" }}>
                            No se encontró «{appSearch}». Usa «Elegir .exe» o añádela en ⚡ Accesos.
                          </div>
                        ) : (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))",
                              gap: 4,
                              maxHeight: 82,
                              overflowY: "auto",
                            }}
                          >
                            {matches.slice(0, 30).map((entry) => {
                              const already = (config.appWidgets ?? []).some(
                                (w) => w.name.toLowerCase() === entry.name.toLowerCase(),
                              );
                              return (
                                <button
                                  key={`${entry.name}-${entry.exePath}`}
                                  type="button"
                                  className={`icon-chip${already ? " icon-chip--active" : ""}`}
                                  style={{
                                    height: 25,
                                    justifyContent: "space-between",
                                    padding: "0 8px",
                                    borderRadius: 8,
                                  }}
                                  disabled={already || addingAppPath === entry.exePath}
                                  onClick={() => handleAddInstalledApp(entry)}
                                >
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {entry.name}
                                  </span>
                                  <span style={{ opacity: 0.85, flexShrink: 0 }}>
                                    {addingAppPath === entry.exePath ? "…" : already ? "✓" : "+"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {(config.appWidgets ?? []).length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {(config.appWidgets ?? []).map((aw) => (
                            <span
                              key={aw.id}
                              className="icon-chip"
                              style={{ borderColor: aw.brandColor, background: `${aw.brandColor}28`, fontSize: 10.5 }}
                            >
                              {aw.iconDataUrl && <img src={aw.iconDataUrl} alt="" width={12} height={12} />}
                              {aw.name}
                              <X
                                size={10}
                                onClick={() => {
                                  const key: HomeWidgetId = `app:${aw.id}`;
                                  setConfig((p) => ({
                                    ...p,
                                    appWidgets: (p.appWidgets ?? []).filter((x) => x.id !== aw.id),
                                    homeSlots: p.homeSlots.filter((x) => x !== key),
                                  }));
                                }}
                              />
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* SECCIÓN 4: TARJETAS DEL HOME */}
                  {settingsSection === "home" && (
                    <div className="settings-panel">
                      <div className="glass-card-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span className="tile-kicker">
                            TARJETAS ACTIVAS ({(config.homeSlots ?? []).length}/5 · mantén clic en Home para mover)
                          </span>
                          {(config.homeSlots ?? []).length < 5 && (
                            <button
                              type="button"
                              className="icon-chip icon-chip--active"
                              onClick={() =>
                                setConfig((p) => ({ ...p, homeSlots: [...p.homeSlots, "weather"] }))
                              }
                            >
                              <Plus size={11} /> Añadir tarjeta
                            </button>
                          )}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6 }}>
                          {(config.homeSlots ?? ["laptop", "music", "focus"]).map((slotVal, idx) => (
                            <div key={`cfg-slot-${idx}`} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, opacity: 0.85 }}>
                                <span>Tarjeta #{idx + 1}</span>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <button
                                    type="button"
                                    className="icon-chip"
                                    style={{ padding: "1px 5px", fontSize: 9.5 }}
                                    onClick={() => void handlePickTileCover(slotVal)}
                                    title="Subir imagen de portada personalizada para esta tarjeta"
                                  >
                                    <ImagePlus size={10} />
                                  </button>
                                  {config.tileCovers?.[slotVal] && (
                                    <button
                                      type="button"
                                      className="icon-chip"
                                      style={{ padding: "1px 5px", fontSize: 9.5 }}
                                      onClick={() => handleResetTileCover(slotVal)}
                                      title="Volver a la portada por defecto"
                                    >
                                      ↺
                                    </button>
                                  )}
                                  {(config.homeSlots ?? []).length > 2 && (
                                    <X
                                      size={11}
                                      style={{ cursor: "pointer" }}
                                      onClick={() =>
                                        setConfig((p) => ({
                                          ...p,
                                          homeSlots: p.homeSlots.filter((_, i) => i !== idx),
                                        }))
                                      }
                                    />
                                  )}
                                </div>
                              </div>
                              <select
                                className="glass-input"
                                style={{ padding: "5px 6px", fontSize: 11 }}
                                value={slotVal}
                                onChange={(e) => {
                                  const next = [...config.homeSlots];
                                  next[idx] = e.target.value as HomeWidgetId;
                                  setConfig((p) => ({ ...p, homeSlots: next }));
                                }}
                              >
                                {BASE_HOME_WIDGETS.map((opt) => (
                                  <option key={opt.id} value={opt.id} style={{ background: "#0f172a" }}>
                                    {opt.label}
                                  </option>
                                ))}
                                {(config.appWidgets ?? []).map((aw) => (
                                  <option key={aw.id} value={`app:${aw.id}`} style={{ background: "#0f172a" }}>
                                    App: {aw.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SECCIÓN 5: ACCESOS DIRECTOS PROPIOS */}
                  {settingsSection === "shortcuts" && (
                    <form onSubmit={handleAddShortcut} className="settings-panel">
                      <div style={{ display: "flex", gap: 5 }}>
                        <input
                          className="glass-input"
                          style={{ width: 42, textAlign: "center", padding: "5px" }}
                          value={newEmoji}
                          onChange={(e) => setNewEmoji(e.target.value)}
                          title="Emoji"
                        />
                        <input
                          className="glass-input"
                          style={{ flex: 1, padding: "5px 8px", fontSize: 11.5 }}
                          placeholder="Nombre (ej. ChatGPT, Mi Carpeta)"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                        />
                        <input
                          type="color"
                          value={newColor}
                          onChange={(e) => setNewColor(e.target.value)}
                          style={{ width: 28, height: 28, border: "none", background: "transparent", cursor: "pointer" }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 5 }}>
                        <input
                          className="glass-input"
                          style={{ padding: "5px 8px", fontSize: 11.5 }}
                          placeholder="URL (https://...) o ruta (D:\...)"
                          value={newTarget}
                          onChange={(e) => setNewTarget(e.target.value)}
                        />
                        <button
                          type="button"
                          className="glass-btn"
                          onClick={handlePickFolderForNewShortcut}
                          title="Elegir carpeta"
                        >
                          <FolderOpen size={12} />
                        </button>
                        <button type="submit" className="glass-btn glass-btn--white">
                          Guardar
                        </button>
                      </div>
                      {config.shortcuts.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {config.shortcuts.map((sc) => (
                            <span key={sc.id} className="icon-chip" style={{ fontSize: 10.5 }}>
                              {sc.emoji} {sc.name}
                              <X
                                size={10}
                                onClick={() =>
                                  setConfig((p) => ({
                                    ...p,
                                    shortcuts: p.shortcuts.filter((x) => x.id !== sc.id),
                                  }))
                                }
                              />
                            </span>
                          ))}
                        </div>
                      )}
                    </form>
                  )}

                  {/* SECCIÓN 6: ORGANIZAR DOCK + SWITCHES DE MÓDULOS + SALIR */}
                  {settingsSection === "dock" && (
                    <div className="settings-panel">
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: 5,
                          maxHeight: 96,
                          overflowY: "auto",
                        }}
                      >
                        {resolvedDockOrder.map((key) => {
                          const isApp = key.startsWith("app:");
                          const aw = isApp
                            ? (config.appWidgets ?? []).find((a) => `app:${a.id}` === key)
                            : null;
                          const label = isApp
                            ? aw?.name ?? "App"
                            : MODULE_META[key as ModuleId]?.label ?? key;
                          return (
                            <div key={key} className="switch-row" style={{ padding: "4px 8px", cursor: "default" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {aw?.iconDataUrl && (
                                  <img src={aw.iconDataUrl} alt="" width={12} height={12} style={{ borderRadius: 3 }} />
                                )}
                                {label}
                              </span>
                              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                <button type="button" className="icon-chip" style={{ padding: "1px 5px" }} onClick={() => moveDockItem(key, -1)}>
                                  ←
                                </button>
                                <button type="button" className="icon-chip" style={{ padding: "1px 5px" }} onClick={() => moveDockItem(key, 1)}>
                                  →
                                </button>
                                {!isApp && key !== "home" && (
                                  <button
                                    type="button"
                                    className="glass-switch glass-switch--on"
                                    onClick={() => toggleModuleEnabled(key as ModuleId)}
                                    title="Desactivar módulo del dock"
                                  >
                                    <span className="glass-switch__thumb" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {(
                          ["music", "focus", "shelf", "clipboard", "notes", "system", "launcher"] as ModuleId[]
                        )
                          .filter((id) => !config.enabledModules.includes(id))
                          .map((id) => (
                            <div
                              key={id}
                              className="switch-row"
                              style={{ padding: "4px 8px", opacity: 0.65 }}
                              onClick={() => toggleModuleEnabled(id)}
                            >
                              <span>{MODULE_META[id].label}</span>
                              <button type="button" className="glass-switch" title="Activar módulo en el dock">
                                <span className="glass-switch__thumb" />
                              </button>
                            </div>
                          ))}
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="glass-btn"
                          style={{ color: "#fca5a5", padding: "4px 10px", fontSize: 11 }}
                          onClick={() => getBridge()?.quit_app().catch(() => {})}
                        >
                          Cerrar GlassIsland
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>
            </main>

            <footer className="island-dock">
              <button
                type="button"
                className={`dock-btn${activeTab === "customize" ? " dock-btn--active" : ""}`}
                onClick={() => setActiveTab("customize")}
                title="Personalizar forma, accesos y widgets"
              >
                <Plus size={14} />
              </button>

              <nav className="dock-scroll" aria-label="Módulos de la isla">
                {resolvedDockOrder.map((key) => {
                  if (key.startsWith("app:")) {
                    const aw = (config.appWidgets ?? []).find((a) => `app:${a.id}` === key);
                    if (!aw) return null;
                    const isActive = activeTab === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`dock-btn${isActive ? " dock-btn--active" : ""}`}
                        style={
                          isActive
                            ? {
                                background: `${aw.brandColor}44`,
                                borderColor: aw.brandColor,
                                color: "#ffffff",
                              }
                            : undefined
                        }
                        onClick={() => setActiveTab(key)}
                        title={aw.name}
                      >
                        <AgentBrandLogo
                          name={aw.name}
                          fallbackUrl={aw.iconDataUrl}
                          size={19}
                        />
                        {isActive && <span>{aw.name}</span>}
                      </button>
                    );
                  }
                  const id = key as ModuleId;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`dock-btn${activeTab === id ? " dock-btn--active" : ""}`}
                      onClick={() => setActiveTab(id)}
                      title={MODULE_META[id].label}
                    >
                      <ModuleIcon id={id} size={13} />
                      {activeTab === id && <span>{MODULE_META[id].label}</span>}
                    </button>
                  );
                })}
              </nav>

              <button
                type="button"
                className="dock-btn"
                onClick={() => handleMedia("vol_mute")}
                title="Silenciar / Activar sonido"
              >
                <Volume2 size={14} />
              </button>
            </footer>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
