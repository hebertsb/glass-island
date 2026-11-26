export type IslandShape = "notch" | "pill" | "slim" | "vertical" | "card";

export type IslandAnchor =
  | "top-center"
  | "top-left"
  | "top-right"
  | "bottom-center"
  | "left-center"
  | "right-center"
  | "free";

export type ModuleId =
  | "home"
  | "music"
  | "focus"
  | "shelf"
  | "clipboard"
  | "notes"
  | "system"
  | "launcher"
  | "customize";

export type RobotMood =
  | "idle"
  | "happy"
  | "excited"
  | "music"
  | "focus"
  | "sleepy"
  | "angry"
  | "wink";

export interface ShortcutItem {
  id: string;
  name: string;
  target: string;
  kind: "url" | "folder" | "app";
  emoji: string;
  color: string;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ShelfFile {
  path: string;
  name: string;
  size_bytes: number;
  addedAt?: number;
}

export interface TelemetryData {
  cpu_percent: number;
  ram_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  battery_percent: number;
  battery_plugged: boolean;
  battery_mins_left: number | null;
  disk_c_free_gb: number;
  disk_c_percent: number;
  net_down_kbps?: number;
  net_up_kbps?: number;
}

export interface NowPlayingData {
  title: string;
  artist: string;
  source: string;
  platform?: string;
  playing: boolean;
  pos_sec?: number;
  dur_sec?: number;
  cover?: string;
}

export type HomeWidgetId =
  | "laptop"
  | "music"
  | "focus"
  | "weather"
  | "tasks"
  | "launcher"
  | "clipboard"
  | `app:${string}`;

export interface AppWidget {
  id: string;
  name: string;
  exePath: string;
  processName: string;
  iconDataUrl: string;
  brandColor: string;
  brandRgb: [number, number, number];
  showInDock: boolean;
}

export interface InstalledAppEntry {
  name: string;
  exePath: string;
  lnkPath: string;
  processName: string;
}

export interface AppRuntimeStatus {
  running: boolean;
  ram_mb: number;
  count: number;
  window_title?: string;
  uptime_sec?: number;
}

export interface WeatherForecastDay {
  date: string;
  max_c: number;
  min_c: number;
  condition: string;
}

export interface WeatherData {
  temp_c: number;
  feels_like_c: number;
  humidity: number;
  condition: string;
  city: string;
  forecast?: WeatherForecastDay[];
}

export type ThemeStyle = "glass" | "frutiger-aero";

export type NovaToolId =
  | "play_music"
  | "open_app"
  | "close_app"
  | "open_project"
  | "create_project"
  | "web_search"
  | "add_todo"
  | "modo_programacion"
  | "modo_proyecto"
  | "modo_semana"
  | "modo_casa"
  | "modo_universidad"
  | "modo_descanso"
  | "briefing"
  | "smart_home";

export interface LearnedPattern {
  phrase: string;
  tool: NovaToolId;
  arg: string;
  hits: number;
  updatedAt: number;
}

export interface NovaKnowledgeBase {
  version: number;
  patterns: LearnedPattern[];
  aliases: Record<string, string>;
  stats: { totalCommands: number };
}

export interface IslandConfig {
  shape: IslandShape;
  anchor: IslandAnchor;
  customX: number | null;
  customY: number | null;
  pinnedOpen: boolean;
  lockedPosition: boolean;
  autoHide: boolean;
  hideInFullscreen?: boolean;
  autoStart?: boolean;
  showMouth: boolean;
  assistantName: string;
  voiceEnabled: boolean;
  alwaysListen: boolean;
  whisperOffline?: boolean;
  codingMusic?: string;
  hudSounds?: boolean;
  greetOnStart?: boolean;
  smartHomeWebhook?: string;
  voiceName: string;
  aiBrainEnabled?: boolean;
  geminiApiKey?: string;
  ollamaModel?: string;
  themeStyle: ThemeStyle;
  robotColor: string;
  homeSlots: HomeWidgetId[];
  tileCovers?: Record<string, string>;
  appWidgets: AppWidget[];
  dockOrder?: (ModuleId | `app:${string}`)[];
  enabledModules: ModuleId[];
  shortcuts: ShortcutItem[];
  todos: TodoItem[];
  notes: string;
  shelfFiles: ShelfFile[];
  focusMinutes: number;
}

export const DEFAULT_CONFIG: IslandConfig = {
  shape: "notch",
  anchor: "top-center",
  customX: null,
  customY: null,
  pinnedOpen: false,
  lockedPosition: false,
  autoHide: true,
  showMouth: false,
  assistantName: "Nova",
  voiceEnabled: true,
  alwaysListen: true,
  voiceName: "es-BO-SofiaNeural",
  aiBrainEnabled: true,
  geminiApiKey: "",
  ollamaModel: "qwen2.5:7b",
  themeStyle: "glass",
  robotColor: "#f8fafc",
  homeSlots: ["laptop", "music", "focus", "weather"],
  appWidgets: [],
  enabledModules: [
    "home",
    "music",
    "focus",
    "shelf",
    "clipboard",
    "notes",
    "system",
    "launcher",
  ],
  shortcuts: [
    {
      id: "sc-discoclaro",
      name: "DiscoClaro",
      target: "http://127.0.0.1:8347",
      kind: "url",
      emoji: "💿",
      color: "#3b82f6",
    },
    {
      id: "sc-uni",
      name: "Universidad",
      target: "D:\\UNIVERSIDAD",
      kind: "folder",
      emoji: "🎓",
      color: "#8b5cf6",
    },
    {
      id: "sc-downloads",
      name: "Descargas",
      target: "C:\\Users\\USUARIO\\Downloads",
      kind: "folder",
      emoji: "📥",
      color: "#10b981",
    },
    {
      id: "sc-github",
      name: "GitHub",
      target: "https://github.com/hebertsb",
      kind: "url",
      emoji: "🐙",
      color: "#f59e0b",
    },
  ],
  todos: [
    { id: "t1", text: "Revisar pendientes de hoy", done: false },
    { id: "t2", text: "Organizar carpetas de proyectos", done: false },
    { id: "t3", text: "Limpiar caché en DiscoClaro", done: true },
  ],
  notes: "Notas rápidas...",
  shelfFiles: [],
  focusMinutes: 25,
};

export interface GlassIslandApi {
  set_ignore_mouse: (ignore: boolean) => Promise<boolean>;
  set_position: (
    anchor: string,
    customX: number | null,
    customY: number | null,
  ) => Promise<{ ok: boolean; x: number; y: number }>;
  move_by: (dx: number, dy: number) => Promise<{ ok: boolean; x: number; y: number }>;
  snap_current_position: () => Promise<{ anchor: IslandAnchor; x: number; y: number }>;
  pick_files_for_shelf: () => Promise<ShelfFile[]>;
  pick_folder_for_shortcut: () => Promise<string>;
  pick_cover_image: () => Promise<string>;
  pick_app_widget: () => Promise<{
    name: string;
    exePath: string;
    processName: string;
    iconDataUrl: string;
  } | null>;
  list_installed_apps: () => Promise<InstalledAppEntry[]>;
  get_app_icon: (exePath: string) => Promise<string>;
  get_app_statuses: (names: string[]) => Promise<Record<string, AppRuntimeStatus>>;
  get_weather: (city?: string) => Promise<WeatherData>;
  get_telemetry: () => Promise<TelemetryData>;
  get_now_playing: () => Promise<NowPlayingData>;
  media_control: (action: string) => Promise<{ ok: boolean }>;
  get_brightness: () => Promise<number>;
  set_brightness: (level: number) => Promise<{ ok: boolean; brightness: number }>;
  get_clipboard: () => Promise<string>;
  set_clipboard: (text: string) => Promise<boolean>;
  launch: (target: string) => Promise<{ ok: boolean; error?: string }>;
  launch_and_paste: (
    target: string,
    promptText?: string,
    appLabel?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  play_media_query: (
    query: string,
    platform?: string,
  ) => Promise<{ ok: boolean; direct?: boolean; usedApp?: boolean; videoId?: string; url?: string }>;
  close_app: (name: string) => Promise<{ ok: boolean }>;
  kb_load: () => Promise<NovaKnowledgeBase>;
  kb_save: (data: NovaKnowledgeBase) => Promise<boolean>;
  system_action: (action: string) => Promise<{ ok: boolean; path?: string; message?: string }>;
  nova_llm_route: (payload: {
    utterance: string;
    assistantName: string;
    geminiApiKey?: string;
    ollamaModel?: string;
    contextSummary?: string;
    recentTurns?: { role: "user" | "assistant"; text: string }[];
  }) => Promise<{
    ok: boolean;
    provider?: "gemini" | "ollama";
    data?: {
      actions?: { tool: string; arg?: string; platform?: string; level?: number }[];
      reply?: string;
      learn?: boolean;
    };
  }>;
  open_project: (query: string) => Promise<{ ok: boolean; path?: string; folderName?: string; openedWith?: string; error?: string }>;
  find_projects: (query: string) => Promise<{ name: string; path: string; parent: string; score: number }[]>;
  list_recent_projects: () => Promise<{ name: string; path: string; parent: string; mtime: number }[]>;
  open_path_in_code: (folderPath: string) => Promise<{ ok: boolean; path?: string; folderName?: string; openedWith?: string }>;
  create_project: (
    name: string,
    locationHint?: string,
    openInCode?: boolean,
  ) => Promise<{ ok: boolean; path?: string; folderName?: string; baseName?: string; existed?: boolean; error?: string }>;
  open_project_terminal: (query: string) => Promise<{ ok: boolean; folderName?: string; path?: string }>;
  project_git_status: (query: string) => Promise<{ ok: boolean; folderName?: string; branch?: string; changes?: number }>;
  voice_speak: (
    text: string,
    voice?: string,
    geminiApiKey?: string,
  ) => Promise<{ audio?: string; voice?: string; engine?: string }>;
  clone_jarvis_ref: (
    geminiVoice?: string,
    geminiApiKey?: string,
  ) => Promise<{ ok: boolean; path?: string; voice?: string; error?: string }>;
  get_disk_summary: () => Promise<{
    ok: boolean;
    volumes: { name: string; freeGb: number; totalGb: number; usedPct: number }[];
  }>;
  smart_home: (
    webhookUrl: string,
    action: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  voice_set_listen: (enabled: boolean) => Promise<{ ok?: boolean; enabled?: boolean }>;
  voice_mute_for: (seconds: number) => Promise<{ ok?: boolean }>;
  voice_set_engine: (useWhisper: boolean) => Promise<{ ok?: boolean; whisper?: boolean }>;
  on_voice_event: (
    cb: (msg: { event: string; text?: string; active?: boolean; message?: string }) => void,
  ) => () => void;
  load_config: () => Promise<Partial<IslandConfig>>;
  save_config: (data: IslandConfig) => Promise<boolean>;
  get_auto_start: () => Promise<{ enabled: boolean }>;
  set_auto_start: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>;
  quick_control: (action: string) => Promise<{ ok: boolean; plan?: string; brightness?: number }>;
  is_fullscreen: () => Promise<{ fullscreen: boolean }>;
  get_file_path: (file: File) => string;
  glassdrop_start: (files?: ShelfFile[]) => Promise<{ running: boolean; url?: string; ip?: string; port?: number; error?: string }>;
  glassdrop_stop: () => Promise<{ running: boolean }>;
  glassdrop_sync: (files: ShelfFile[]) => Promise<boolean>;
  prune_shelf_files: (files: ShelfFile[]) => Promise<ShelfFile[]>;
  glassdrop_open_folder: (subFolder?: string) => Promise<{ ok: boolean; path?: string }>;
  on_glassdrop_event: (
    cb: (msg: {
      kind: "file" | "clip" | "connected";
      file?: ShelfFile & { category?: string; folder?: string };
      text?: string;
      device?: string;
    }) => void,
  ) => () => void;
  quit_app: () => Promise<void>;
}

declare global {
  interface Window {
    glassIsland?: GlassIslandApi;
  }
}

export function getBridge(): GlassIslandApi | null {
  return window.glassIsland ?? null;
}
