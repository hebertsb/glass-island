const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen, session, shell } = require("electron");
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { createGlassDropServer } = require("./glassdrop.cjs");

const GEMINI_HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 4 });

const RESOURCES_BASE = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const DIST_INDEX = path.join(__dirname, "..", "ui", "dist", "index.html");
const BRIDGE_PS1 = app.isPackaged
  ? path.join(process.resourcesPath, "electron", "win_bridge.ps1")
  : path.join(__dirname, "win_bridge.ps1");
const VOICE_DAEMON_PY = app.isPackaged
  ? path.join(process.resourcesPath, "electron", "voice_daemon.py")
  : path.join(__dirname, "voice_daemon.py");
const VENV_PYTHON = path.join(RESOURCES_BASE, ".venv", "Scripts", "python.exe");
const ICON_PATH = path.join(RESOURCES_BASE, "assets", "glassisland.ico");
const CONFIG_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), "GlassIsland");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const KB_FILE = path.join(CONFIG_DIR, "nova_kb.json");
const VOICE_CACHE_DIR = path.join(CONFIG_DIR, "voice_cache");
const JARVIS_REF_WAV = path.join(CONFIG_DIR, "jarvis_ref.wav");
const PS_EXE = path.join(
  process.env.WINDIR || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

let win = null;

// --- Puente persistente PowerShell (GSMTC real + GIKey + Brillo WMI <15ms) ---
let bridgeProc = null;
let bridgeSeq = 1;
const bridgePending = new Map();

function ensureBridge() {
  if (bridgeProc && !bridgeProc.killed && bridgeProc.exitCode === null) return bridgeProc;
  bridgeProc = spawn(
    PS_EXE,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", BRIDGE_PS1],
    { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
  );
  const rl = readline.createInterface({ input: bridgeProc.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id && bridgePending.has(msg.id)) {
        const { resolve, timer } = bridgePending.get(msg.id);
        clearTimeout(timer);
        bridgePending.delete(msg.id);
        resolve(msg.data ?? {});
      }
    } catch {
      // ignore malformed line
    }
  });
  bridgeProc.on("exit", () => {
    for (const [, { resolve, timer }] of bridgePending) {
      clearTimeout(timer);
      resolve({});
    }
    bridgePending.clear();
    bridgeProc = null;
  });
  return bridgeProc;
}

function callBridge(payload, timeoutMs = 3500) {
  return new Promise((resolve) => {
    const proc = ensureBridge();
    if (!proc || !proc.stdin) {
      resolve({});
      return;
    }
    const id = bridgeSeq++;
    const timer = setTimeout(() => {
      bridgePending.delete(id);
      resolve({});
    }, timeoutMs);
    bridgePending.set(id, { resolve, timer });
    try {
      proc.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
    } catch {
      clearTimeout(timer);
      bridgePending.delete(id);
      resolve({});
    }
  });
}

// Debounce suave para brillo al arrastrar el slider
let pendingBrightness = null;
let brightnessTimer = null;
function setBrightnessSmooth(level) {
  const clamped = Math.max(5, Math.min(100, Math.round(Number(level) || 80)));
  pendingBrightness = clamped;
  if (!brightnessTimer) {
    brightnessTimer = setTimeout(() => {
      brightnessTimer = null;
      const val = pendingBrightness;
      if (val != null) {
        callBridge({ cmd: "brightness", level: val }, 2500).catch(() => {});
      }
    }, 30);
  }
  return { ok: true, brightness: clamped };
}

// --- Demonio persistente de voz en español (VAD continuo + Neural TTS es-BO) ---
let voiceProc = null;
let voiceSeq = 1;
const voicePending = new Map();

function ensureVoiceDaemon() {
  if (voiceProc && !voiceProc.killed && voiceProc.exitCode === null) return voiceProc;
  if (!fs.existsSync(VOICE_DAEMON_PY)) return null;
  const pyExe = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python";
  try {
    voiceProc = spawn(pyExe, ["-u", VOICE_DAEMON_PY], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
  } catch {
    voiceProc = null;
    return null;
  }
  const rl = readline.createInterface({ input: voiceProc.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id && voicePending.has(msg.id)) {
        const { resolve, timer } = voicePending.get(msg.id);
        clearTimeout(timer);
        voicePending.delete(msg.id);
        resolve(msg.data ?? {});
      } else if (msg.event && win && !win.isDestroyed()) {
        win.webContents.send("island:voice-event", msg);
      }
    } catch {
      // ignore malformed line
    }
  });
  voiceProc.on("exit", () => {
    for (const [, { resolve, timer }] of voicePending) {
      clearTimeout(timer);
      resolve({});
    }
    voicePending.clear();
    voiceProc = null;
  });
  return voiceProc;
}

function callVoice(payload, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const proc = ensureVoiceDaemon();
    if (!proc || !proc.stdin) {
      resolve({});
      return;
    }
    const id = voiceSeq++;
    const timer = setTimeout(() => {
      voicePending.delete(id);
      resolve({});
    }, timeoutMs);
    voicePending.set(id, { resolve, timer });
    try {
      proc.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
    } catch {
      clearTimeout(timer);
      voicePending.delete(id);
      resolve({});
    }
  });
}

// --- Telemetría CPU / RAM + Caché ligera de extra/media ---
let prevCpu = os.cpus();
function getCpuPercent() {
  const curr = os.cpus();
  let idleDiff = 0;
  let totalDiff = 0;
  for (let i = 0; i < curr.length; i++) {
    const a = prevCpu[i].times;
    const b = curr[i].times;
    const idle = b.idle - a.idle;
    const total =
      b.user - a.user + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + idle;
    idleDiff += idle;
    totalDiff += total;
  }
  prevCpu = curr;
  if (totalDiff <= 0) return 4;
  return Math.max(1, Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)));
}

let cachedExtra = {
  battery_percent: 80,
  battery_plugged: true,
  disk_c_free_gb: 128,
  disk_c_percent: 74,
  brightness: 80,
};
let lastExtraAt = 0;

async function getExtraFresh() {
  const now = Date.now();
  if (now - lastExtraAt >= 6000) {
    lastExtraAt = now;
    const res = await callBridge({ cmd: "extra" }, 4000);
    if (res && typeof res.battery_percent === "number") {
      cachedExtra = { ...cachedExtra, ...res };
    }
  }
  return cachedExtra;
}

// --- Ventana transparente Electron con click-through perfecto ---
const CANVAS_W = 720;
const CANVAS_H = 520;

function createWindow() {
  const { width: sw } = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    width: CANVAS_W,
    height: CANVAS_H,
    x: Math.round((sw - CANVAS_W) / 2),
    y: 0,
    title: "",
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.removeMenu();
  win.setMenuBarVisibility(false);

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(DIST_INDEX);
  ensureBridge();
  ensureVoiceDaemon();
  getExtraFresh().catch(() => {});
}

app.whenReady().then(() => {
  // Permite usar el micrófono para comandos de voz de Subu sin bloqueos
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === "media" || permission === "audioCapture") {
      callback(true);
    } else {
      callback(false);
    }
  });

  createWindow();

  ipcMain.handle("island:set-ignore-mouse", (_e, ignore) => {
    if (!win) return false;
    if (ignore) {
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
    }
    return true;
  });

  ipcMain.handle("island:set-position", (_e, anchor, customX, customY) => {
    if (!win) return { ok: false };
    const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
    const [w, h] = win.getSize();
    let x = Math.round((sw - w) / 2);
    let y = 0;
    if (anchor === "free" && customX != null && customY != null) {
      x = Math.max(0, Math.min(Math.round(customX), sw - w));
      y = Math.max(0, Math.min(Math.round(customY), sh - h));
    } else if (anchor === "top-left") {
      x = 12;
      y = 0;
    } else if (anchor === "top-right") {
      x = sw - w - 12;
      y = 0;
    } else if (anchor === "bottom-center") {
      x = Math.round((sw - w) / 2);
      y = sh - h - 48;
    } else if (anchor === "left-center") {
      x = 8;
      y = Math.round((sh - h) / 2);
    } else if (anchor === "right-center") {
      x = sw - w - 8;
      y = Math.round((sh - h) / 2);
    }
    win.setPosition(x, y);
    return { ok: true, x, y };
  });

  ipcMain.handle("island:move-by", (_e, dx, dy) => {
    if (!win) return { ok: false };
    const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
    const [cx, cy] = win.getPosition();
    const [w] = win.getSize();
    const nx = Math.max(-180, Math.min(cx + Math.round(dx), sw - w + 180));
    const ny = Math.max(0, Math.min(cy + Math.round(dy), sh - 80));
    win.setPosition(nx, ny);
    return { ok: true, x: nx, y: ny };
  });

  ipcMain.handle("island:snap-position", () => {
    if (!win) return { anchor: "top-center", x: 0, y: 0 };
    const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
    const [x, y] = win.getPosition();
    const [w] = win.getSize();
    const midX = x + w / 2;
    let anchor = "free";
    if (y < 70) {
      if (midX < sw * 0.3) anchor = "top-left";
      else if (midX > sw * 0.7) anchor = "top-right";
      else anchor = "top-center";
    } else if (y > sh - 360) {
      anchor = "bottom-center";
    }
    return { anchor, x, y };
  });

  // Velocidad de red en vivo (↓ KB/s, ↑ KB/s) usando netstat -e sin bloquear
  let lastNetStats = null;
  let cachedNetSpeed = { net_down_kbps: 0, net_up_kbps: 0 };
  let netPollBusy = false;
  function refreshNetSpeedAsync() {
    if (netPollBusy) return;
    netPollBusy = true;
    execFile("netstat.exe", ["-e"], { windowsHide: true, timeout: 1500 }, (err, stdout) => {
      netPollBusy = false;
      if (err || !stdout) return;
      const m = String(stdout).match(/Bytes\s+(\d+)\s+(\d+)/i);
      if (!m) return;
      const rx = Number(m[1]);
      const tx = Number(m[2]);
      const now = Date.now();
      if (lastNetStats && now > lastNetStats.at) {
        const dt = (now - lastNetStats.at) / 1000;
        const down = Math.max(0, (rx - lastNetStats.rx) / 1024 / dt);
        const up = Math.max(0, (tx - lastNetStats.tx) / 1024 / dt);
        cachedNetSpeed = {
          net_down_kbps: Math.round(down * 10) / 10,
          net_up_kbps: Math.round(up * 10) / 10,
        };
      }
      lastNetStats = { rx, tx, at: now };
    });
  }

  ipcMain.handle("island:get-telemetry", async () => {
    refreshNetSpeedAsync();
    const extra = await getExtraFresh();
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      cpu_percent: getCpuPercent(),
      ram_percent: Math.round((used / total) * 1000) / 10,
      ram_used_gb: Math.round((used / 1024 ** 3) * 10) / 10,
      ram_total_gb: Math.round((total / 1024 ** 3) * 10) / 10,
      battery_percent: extra.battery_percent,
      battery_plugged: extra.battery_plugged,
      battery_mins_left: null,
      disk_c_free_gb: extra.disk_c_free_gb,
      disk_c_percent: extra.disk_c_percent,
      net_down_kbps: cachedNetSpeed.net_down_kbps,
      net_up_kbps: cachedNetSpeed.net_up_kbps,
    };
  });

  ipcMain.handle("island:is-fullscreen", async () => {
    const res = await callBridge({ cmd: "fullscreen" }, 1500);
    return { fullscreen: Boolean(res?.fullscreen) };
  });

  ipcMain.handle("island:quick-control", async (_e, action) => {
    const act = String(action || "").toLowerCase();
    try {
      if (act === "wifi") {
        await shell.openExternal("ms-settings:network-wifi");
        return { ok: true };
      }
      if (act === "bluetooth") {
        await shell.openExternal("ms-settings:bluetooth");
        return { ok: true };
      }
      if (act === "nightlight") {
        await shell.openExternal("ms-settings:nightlight");
        return { ok: true };
      }
      if (act === "sound") {
        await shell.openExternal("ms-settings:sound");
        return { ok: true };
      }
      const plans = {
        power_saver: { guid: "a1841308-3541-4fab-bc81-f71556f20b4a", brightness: 45 },
        power_balanced: { guid: "381b4222-f694-41f0-9685-ff5bb260df2e", brightness: 75 },
        power_high: { guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", brightness: 95 },
      };
      if (plans[act]) {
        const cfg = plans[act];
        await new Promise((resolve) => {
          execFile("powercfg.exe", ["/setactive", cfg.guid], { windowsHide: true, timeout: 3000 }, () =>
            resolve(),
          );
        });
        // Espera 150ms a que Windows aplique el perfil y luego fija el brillo real por WMI para que Windows no lo sobreescriba
        await new Promise((r) => setTimeout(r, 150));
        await callBridge({ cmd: "brightness", level: cfg.brightness }, 2500).catch(() => {});
        return { ok: true, plan: act, brightness: cfg.brightness };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("island:get-now-playing", async () => {
    const res = await callBridge({ cmd: "media_info" }, 3000);
    if (res && res.title) return res;
    return {
      title: "Sin reproducción activa",
      artist: "Abre YouTube, Facebook o Spotify",
      source: "",
      playing: false,
    };
  });

  ipcMain.handle("island:media-control", async (_e, action) => {
    return await callBridge({ cmd: "media", action }, 3000);
  });

  ipcMain.handle("island:get-brightness", async () => {
    const extra = await getExtraFresh();
    return extra.brightness ?? 80;
  });

  ipcMain.handle("island:set-brightness", (_e, level) => setBrightnessSmooth(level));

  ipcMain.handle("island:get-clipboard", () => {
    try {
      const txt = clipboard.readText();
      return typeof txt === "string" ? txt.slice(0, 1500) : "";
    } catch {
      return "";
    }
  });

  ipcMain.handle("island:set-clipboard", (_e, text) => {
    clipboard.writeText(String(text || ""));
    return true;
  });

  ipcMain.handle("island:launch", async (_e, target) => {
    const t = String(target || "").trim();
    if (!t) return { ok: false };
    try {
      if (t.startsWith("shell:AppsFolder\\")) {
        spawn("explorer.exe", [t], { detached: true, stdio: "ignore" }).unref();
      } else if (/^(https?|mailto|steam|spotify):/i.test(t)) {
        await shell.openExternal(t);
      } else {
        await shell.openPath(t);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Detecta si existe una app de escritorio / PWA instalada para YouTube, YouTube Music o Spotify
  function findInstalledMediaApp(plat) {
    const lnkRoots = [
      path.join(os.homedir(), "Desktop"),
      path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
      path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    ].filter((d) => d && fs.existsSync(d));

    const matchName =
      plat === "youtube music"
        ? /^youtube\s*music\.lnk$/i
        : plat === "spotify"
          ? /^spotify\.lnk$/i
          : /^youtube\.lnk$/i;

    const searchLnk = (dir, depth = 0) => {
      if (depth > 3) return null;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const hit = searchLnk(full, depth + 1);
          if (hit) return hit;
        } else if (e.isFile() && matchName.test(e.name)) {
          return full;
        }
      }
      return null;
    };

    if (plat === "spotify") {
      const spotifyExe = path.join(process.env.APPDATA || "", "Spotify", "Spotify.exe");
      if (fs.existsSync(spotifyExe)) return { kind: "spotify", exe: spotifyExe };
    }

    for (const r of lnkRoots) {
      const lnkPath = searchLnk(r, 0);
      if (!lnkPath) continue;
      try {
        const info = shell.readShortcutLink(lnkPath);
        const target = info?.target || "";
        const args = info?.args || "";
        // PWA de Chrome o Edge (chrome_proxy.exe / msedge_proxy.exe)
        if (/(chrome|msedge)_proxy\.exe$/i.test(target)) {
          const browserExe = target.replace(/_proxy\.exe$/i, ".exe");
          const profMatch = args.match(/--profile-directory=(?:"([^"]+)"|(\S+))/i);
          const profileDir = profMatch ? profMatch[1] || profMatch[2] : "";
          if (fs.existsSync(browserExe)) {
            return { kind: "pwa", browserExe, profileDir, lnkPath };
          }
        }
        return { kind: "lnk", lnkPath };
      } catch {
        return { kind: "lnk", lnkPath };
      }
    }
    return null;
  }

  // Reproduce directamente el primer video oficial en YouTube / YouTube Music (priorizando app instalada)
  ipcMain.handle("island:play-media-query", async (_e, query, platform) => {
    const q = String(query || "").trim();
    const plat = String(platform || "youtube").toLowerCase();
    if (!q) return { ok: false };
    const enc = encodeURIComponent(q);
    const installedApp = findInstalledMediaApp(plat);

    if (plat === "spotify") {
      try {
        if (installedApp) {
          await shell.openExternal(`spotify:search:${enc}`);
          return { ok: true, direct: false, usedApp: true, platform: "Spotify" };
        }
        await shell.openExternal(`https://open.spotify.com/search/${enc}`);
        return { ok: true, direct: false, usedApp: false, platform: "Spotify" };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }

    // Busca el primer video real (videoRenderer salta Shorts/memes) y corta apenas encuentra match
    const videoId = await new Promise((resolve) => {
      let settled = false;
      let fallbackId = "";
      const done = (val) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };
      const req = https.get(
        `https://www.youtube.com/results?search_query=${enc}`,
        {
          timeout: 6500,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Accept-Language": "es-BO,es;q=0.9",
          },
        },
        (res) => {
          let tail = "";
          res.on("data", (chunk) => {
            if (settled) return;
            const text = tail + chunk.toString("utf8");
            const vr = text.match(/"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"/);
            if (vr) {
              req.destroy();
              done(vr[1]);
              return;
            }
            if (!fallbackId) {
              const anyM = text.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
              if (anyM) fallbackId = anyM[1];
            }
            tail = text.slice(-96);
          });
          res.on("end", () => done(fallbackId));
        },
      );
      req.on("error", () => done(fallbackId));
      req.on("timeout", () => {
        req.destroy();
        done(fallbackId);
      });
    });

    let url = "";
    if (videoId) {
      url =
        plat === "youtube music"
          ? `https://music.youtube.com/watch?v=${videoId}`
          : `https://www.youtube.com/watch?v=${videoId}`;
    } else {
      url =
        plat === "youtube music"
          ? `https://music.youtube.com/search?q=${enc}`
          : `https://www.youtube.com/results?search_query=${enc}`;
    }
    try {
      // Si tiene la app de escritorio PWA instalada (ej. YouTube de Chrome):
      // cierra la ventana anterior dedicada de YouTube (sin tocar el navegador normal)
      // para reemplazar la canción en una sola ventana y que nunca suenen dos a la vez.
      if (installedApp && installedApp.kind === "pwa") {
        await new Promise((resolve) => {
          const titleSuffix = plat === "youtube music" ? "YouTube Music" : "YouTube";
          const psClose =
            `Get-Process -Name chrome,msedge -ErrorAction SilentlyContinue | ` +
            `Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match ' - ${titleSuffix}$' } | ` +
            `ForEach-Object { $_.CloseMainWindow() | Out-Null }`;
          execFile(
            PS_EXE,
            ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psClose],
            { windowsHide: true, timeout: 1500 },
            () => resolve(),
          );
        });
        const launchArgs = [];
        if (installedApp.profileDir) {
          launchArgs.push(`--profile-directory=${installedApp.profileDir}`);
        }
        launchArgs.push(`--app=${url}`);
        spawn(installedApp.browserExe, launchArgs, { detached: true, stdio: "ignore" }).unref();
        return { ok: true, direct: Boolean(videoId), usedApp: true, videoId, url };
      }
      await shell.openExternal(url);
      return { ok: true, direct: Boolean(videoId), usedApp: false, videoId, url };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("island:close-app", async (_e, nameQuery) => {
    const safe = String(nameQuery || "")
      .replace(/[^a-zA-Z0-9 _.-]/g, "")
      .trim();
    if (!safe) return { ok: false };
    return await new Promise((resolve) => {
      const script =
        `$p = Get-Process -ErrorAction SilentlyContinue | Where-Object { ` +
        `  ($_.ProcessName -like '*${safe}*' -or $_.MainWindowTitle -like '*${safe}*') -and $_.MainWindowHandle -ne 0 ` +
        `}; ` +
        `if ($p) { $p | ForEach-Object { $_.CloseMainWindow() | Out-Null }; 'OK' } else { 'NONE' }`;
      execFile(
        PS_EXE,
        ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
        { windowsHide: true, timeout: 2500 },
        (_err, stdout) => {
          resolve({ ok: (stdout || "").trim() === "OK" });
        },
      );
    });
  });

  ipcMain.handle("island:kb-load", () => {
    try {
      if (fs.existsSync(KB_FILE)) {
        return JSON.parse(fs.readFileSync(KB_FILE, "utf8"));
      }
    } catch {
      // ignore
    }
    return { version: 1, patterns: [], aliases: {}, stats: { totalCommands: 0 } };
  });

  ipcMain.handle("island:kb-save", (_e, data) => {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(KB_FILE, JSON.stringify(data, null, 2), "utf8");
      return true;
    } catch {
      return false;
    }
  });

  // Tools diarios del sistema operativo para Nova (captura, bloqueo, carpetas)
  ipcMain.handle("island:system-action", async (_e, action) => {
    const act = String(action || "").toLowerCase();
    try {
      if (act === "lock") {
        spawn("rundll32.exe", ["user32.dll,LockWorkStation"], { detached: true, stdio: "ignore" }).unref();
        return { ok: true, message: "Pantalla bloqueada." };
      }
      if (act === "minimize_all") {
        const psMin = `(New-Object -ComObject Shell.Application).MinimizeAll()`;
        execFile(PS_EXE, ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psMin], { windowsHide: true, timeout: 3000 }, () => {});
        return { ok: true, message: "Todas las ventanas minimizadas." };
      }
      if (act === "empty_recycle_bin") {
        const psBin = `Clear-RecycleBin -Force -ErrorAction SilentlyContinue`;
        execFile(PS_EXE, ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psBin], { windowsHide: true, timeout: 5000 }, () => {});
        return { ok: true, message: "Papelera de reciclaje vaciada." };
      }
      if (act === "sleep") {
        spawn("rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"], { detached: true, stdio: "ignore" }).unref();
        return { ok: true, message: "Suspendiendo tu laptop." };
      }
      if (act === "hibernate") {
        spawn("shutdown.exe", ["/h"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        return { ok: true, message: "Hibernando tu laptop." };
      }
      if (act === "dnd") {
        await shell.openExternal("ms-settings:quiethours");
        return { ok: true, message: "Abriendo No Molestar para silenciar notificaciones." };
      }
      if (act === "downloads") {
        await shell.openPath(path.join(os.homedir(), "Downloads"));
        return { ok: true, message: "Abriendo Descargas." };
      }
      if (act === "documents") {
        await shell.openPath(path.join(os.homedir(), "Documents"));
        return { ok: true, message: "Abriendo Documentos." };
      }
      if (act === "desktop") {
        await shell.openPath(path.join(os.homedir(), "Desktop"));
        return { ok: true, message: "Abriendo Escritorio." };
      }
      if (act === "university") {
        const uni = fs.existsSync("D:\\UNIVERSIDAD") ? "D:\\UNIVERSIDAD" : os.homedir();
        await shell.openPath(uni);
        return { ok: true, message: "Abriendo tu carpeta de Universidad." };
      }
      if (act === "screenshot") {
        const shotsDir = path.join(os.homedir(), "Pictures", "Screenshots");
        fs.mkdirSync(shotsDir, { recursive: true });
        const filePath = path.join(shotsDir, `Nova_${Date.now()}.png`);
        const safePath = filePath.replace(/'/g, "''");
        await new Promise((resolve) => {
          const psShot =
            `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
            `$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
            `$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); ` +
            `$g=[System.Drawing.Graphics]::FromImage($bmp); ` +
            `$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); ` +
            `$bmp.Save('${safePath}',[System.Drawing.Imaging.ImageFormat]::Png); ` +
            `$g.Dispose(); $bmp.Dispose()`;
          execFile(
            PS_EXE,
            ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psShot],
            { windowsHide: true, timeout: 4000 },
            () => resolve(),
          );
        });
        return { ok: true, path: filePath, message: "Captura guardada en Imágenes." };
      }
      return { ok: false };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Cerebro IA Híbrido (Opción B): Gemini API (si hay key) o Ollama local (100% offline)
  ipcMain.handle("island:nova-llm-route", async (_e, payload) => {
    const utterance = String(payload?.utterance || "").trim();
    const assistantName = String(payload?.assistantName || "Nova");
    const geminiApiKey = String(payload?.geminiApiKey || "").trim();
    const ollamaModel = String(payload?.ollamaModel || "qwen2.5:7b").trim();
    const contextSummary = String(payload?.contextSummary || "");
    const recentTurns = Array.isArray(payload?.recentTurns) ? payload.recentTurns.slice(-8) : [];
    if (!utterance) return { ok: false };

    const systemPrompt =
      `Eres ${assistantName}, un asistente personal inteligente estilo Jarvis en la laptop de Hebert (ingeniero/programador de software en Santa Cruz, Bolivia). ` +
      `Cuando Hebert pregunte por siglas o conceptos técnicos (como MCP, BaaS, API, Docker, REST, JWT, etc.), responde SIEMPRE en contexto de ingeniería de software y tecnología actual (por ejemplo: MCP = Model Context Protocol de Anthropic, BaaS = Backend as a Service). ` +
      `Responde SIEMPRE SOLO con un JSON válido (sin markdown ni texto fuera del JSON) con este formato:\n` +
      `{"actions":[{"tool":"<tool>","arg":"<valor>","platform":"youtube|youtube music|spotify","level":50}],"reply":"<respuesta corta, cálida y natural en español latino>","learn":true}\n` +
      `Tools disponibles:\n` +
      `- play_music (arg: nombre canción/artista, platform: youtube|youtube music|spotify)\n` +
      `- open_app (arg: nombre de la app)\n` +
      `- close_app (arg: nombre de la app)\n` +
      `- open_project (arg: nombre del proyecto existente)\n` +
      `- create_project (arg: nombre de la carpeta/proyecto nuevo a crear y abrir en VS Code; si el usuario menciona "escritorio", "universidad" o "documentos", ponlo en platform, si no deja "proyectos_personales")\n` +
      `- modo_programacion (activar entorno de programación: VS Code + música + brillo + Focus; úsalo también si dice "vamos a codear", "empecemos a programar", "modo dev", "modo programador")\n` +
      `- modo_proyecto (listar proyectos recientes para elegir cuál continuar)\n` +
      `- modo_semana (organizar la semana: Google Calendar + tareas)\n` +
      `- modo_casa (modo noche/casa: brillo 40%, tema oscuro, luces y música lo-fi)\n` +
      `- modo_universidad (abrir carpeta Universidad y leer tareas)\n` +
      `- modo_descanso (pausar Focus, brillo 60% y música chill)\n` +
      `- briefing (resumen del día: hora, clima, tareas y espacio libre en DiscoClaro)\n` +
      `- smart_home (arg: lights_on|lights_off)\n` +
      `- control_media (arg: play_pause|next|prev|vol_up|vol_down|vol_mute)\n` +
      `- set_brightness (level: 10..100)\n` +
      `- start_focus (level: minutos 5..60)\n` +
      `- add_todo (arg: texto de la tarea)\n` +
      `- web_search (arg: búsqueda en Google)\n` +
      `- system_action (arg: screenshot|lock|downloads|documents|desktop|university)\n` +
      `- chat (si solo es una pregunta conversacional o duda general; no requiere ejecutar tool, solo responder en reply).\n` +
      `Contexto actual de la laptop: ${contextSummary}`;

    const parseJsonLoose = (rawText) => {
      const cleaned = String(rawText || "")
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace < 0 || lastBrace <= firstBrace) return null;
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    };

    // 1. Intentar Gemini API si el usuario configuró su API Key gratuita (con historial multi-turno real)
    if (geminiApiKey) {
      const gemRes = await new Promise((resolve) => {
        const gemHistory = recentTurns.map((t) => ({
          role: t.role === "assistant" ? "model" : "user",
          parts: [{ text: String(t.text || "") }],
        }));
        const body = JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            ...gemHistory,
            { role: "user", parts: [{ text: utterance }] },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        });
        const req = https.request(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
          {
            method: "POST",
            timeout: 8000,
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
          },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              try {
                const j = JSON.parse(data);
                const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
                const parsed = parseJsonLoose(text);
                resolve(parsed ? { ok: true, provider: "gemini", data: parsed } : { ok: false });
              } catch {
                resolve({ ok: false });
              }
            });
          },
        );
        req.on("error", () => resolve({ ok: false }));
        req.on("timeout", () => {
          req.destroy();
          resolve({ ok: false });
        });
        req.write(body);
        req.end();
      });
      if (gemRes.ok) return gemRes;
    }

    // 2. Fallback automático a Ollama local (http://127.0.0.1:11434) con keep_alive=90s
    // para liberar automáticamente el 100% de la VRAM de tu RTX 5050 cuando no le hablas
    const http = require("http");
    const ollamaRes = await new Promise((resolve) => {
      const ollamaHistory = recentTurns.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: String(t.text || ""),
      }));
      const body = JSON.stringify({
        model: ollamaModel,
        stream: false,
        format: "json",
        keep_alive: "90s",
        options: {
          num_ctx: 2048,
          temperature: 0.2,
        },
        messages: [
          { role: "system", content: systemPrompt },
          ...ollamaHistory,
          { role: "user", content: utterance },
        ],
      });
      const req = http.request(
        "http://127.0.0.1:11434/api/chat",
        {
          method: "POST",
          timeout: 18000,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              const j = JSON.parse(data);
              const text = j?.message?.content || "";
              const parsed = parseJsonLoose(text);
              resolve(parsed ? { ok: true, provider: "ollama", data: parsed } : { ok: false });
            } catch {
              resolve({ ok: false });
            }
          });
        },
      );
      req.on("error", () => resolve({ ok: false }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false });
      });
      req.write(body);
      req.end();
    });
    return ollamaRes;
  });

  // Abre una app (ej. Claude/Copilot), suelta foco de GlassIsland, enfoca la ventana real,
  // hace clic en el área de texto y envía Ctrl+V + Enter a nivel Win32
  ipcMain.handle("island:launch-and-paste", async (_e, target, promptText, appLabel) => {
    const t = String(target || "").trim();
    const txt = String(promptText || "").trim();
    const label = String(appLabel || "").replace(/[^a-zA-Z0-9 _.-]/g, "").trim();
    if (!t) return { ok: false };
    try {
      if (txt) clipboard.writeText(txt);
      // Suelta el foco de GlassIsland para que Windows permita enfocar Copilot/Claude
      if (win && !win.isDestroyed()) {
        try {
          win.blur();
        } catch {
          // ignore
        }
      }
      if (t.startsWith("shell:AppsFolder\\")) {
        spawn("explorer.exe", [t], { detached: true, stdio: "ignore" }).unref();
      } else if (/^(https?|mailto|steam|spotify):/i.test(t)) {
        await shell.openExternal(t);
      } else {
        await shell.openPath(t);
      }
      if (txt) {
        const safeLabel = label || "Copilot";
        const psPaste =
          `Add-Type -TypeDefinition '` +
          `using System; using System.Runtime.InteropServices; ` +
          `public class GIPaste { ` +
          `  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; } ` +
          `  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); ` +
          `  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect); ` +
          `  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); ` +
          `  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo); ` +
          `  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); ` +
          `  public static void FocusAndSend(IntPtr hWnd) { ` +
          `    SetForegroundWindow(hWnd); System.Threading.Thread.Sleep(450); ` +
          `    keybd_event(0x11,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(40); ` +
          `    keybd_event(0x4E,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(40); ` +
          `    keybd_event(0x4E,0,2,UIntPtr.Zero); System.Threading.Thread.Sleep(40); ` +
          `    keybd_event(0x11,0,2,UIntPtr.Zero); System.Threading.Thread.Sleep(700); ` +
          `    RECT r; if (GetWindowRect(hWnd, out r)) { ` +
          `      int cx = r.Left + (int)((r.Right - r.Left) * 0.56); ` +
          `      int cy = r.Top + (int)((r.Bottom - r.Top) * 0.53); ` +
          `      SetCursorPos(cx, cy); System.Threading.Thread.Sleep(80); ` +
          `      mouse_event(0x02, 0, 0, 0, UIntPtr.Zero); mouse_event(0x04, 0, 0, 0, UIntPtr.Zero); ` +
          `      System.Threading.Thread.Sleep(240); ` +
          `    } ` +
          `    keybd_event(0x11,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(45); ` +
          `    keybd_event(0x56,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(45); ` +
          `    keybd_event(0x56,0,2,UIntPtr.Zero); System.Threading.Thread.Sleep(45); ` +
          `    keybd_event(0x11,0,2,UIntPtr.Zero); System.Threading.Thread.Sleep(350); ` +
          `    keybd_event(0x0D,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(45); ` +
          `    keybd_event(0x0D,0,2,UIntPtr.Zero); ` +
          `  } ` +
          `}'; ` +
          `$hwnd = [IntPtr]::Zero; ` +
          `for ($i = 0; $i -lt 16; $i++) { ` +
          `  Start-Sleep -Milliseconds 350; ` +
          `  $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*${safeLabel}*' } | Select-Object -First 1; ` +
          `  if ($p) { $hwnd = $p.MainWindowHandle; break } ` +
          `}; ` +
          `if ($hwnd -ne [IntPtr]::Zero) { Start-Sleep -Milliseconds 900; [GIPaste]::FocusAndSend($hwnd) }`;
        execFile(
          PS_EXE,
          ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psPaste],
          { windowsHide: true, timeout: 12000 },
          () => {},
        );
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  function launchFolderInCode(folderPath) {
    const codeCandidates = [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
      "C:\\Program Files\\Microsoft VS Code\\Code.exe",
    ];
    const codeExe = codeCandidates.find((p) => fs.existsSync(p));
    if (codeExe) {
      spawn(codeExe, [folderPath], { detached: true, stdio: "ignore" }).unref();
      return { ok: true, path: folderPath, folderName: path.basename(folderPath), openedWith: "Visual Studio Code" };
    }
    shell.openPath(folderPath).catch(() => {});
    return { ok: true, path: folderPath, folderName: path.basename(folderPath), openedWith: "Explorador" };
  }

  ipcMain.handle("island:open-path-in-code", async (_e, folderPath) => {
    const fp = String(folderPath || "").trim();
    if (!fp || !fs.existsSync(fp)) return { ok: false, error: "not_found" };
    return launchFolderInCode(fp);
  });

  // Crea una carpeta de proyecto nuevo (por defecto en proyectos_Personales) y la abre directo en VS Code
  ipcMain.handle("island:create-project", async (_e, rawName, locationHint, openInCode = true) => {
    const cleanName = String(rawName || "")
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    if (!cleanName) return { ok: false, error: "invalid_name" };

    const loc = String(locationHint || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    let baseDir = "D:\\UNIVERSIDAD\\proyectos_Personales";
    if (loc.includes("escritorio") || loc.includes("desktop")) {
      baseDir = path.join(os.homedir(), "Desktop");
    } else if (loc.includes("documento") || loc.includes("document")) {
      baseDir = path.join(os.homedir(), "Documents");
    } else if ((loc.includes("universidad") || loc.includes("uni")) && !loc.includes("personal")) {
      baseDir = "D:\\UNIVERSIDAD";
    }
    if (!fs.existsSync(baseDir)) {
      baseDir = path.join(os.homedir(), "Desktop");
    }
    const targetPath = path.join(baseDir, cleanName);
    const existed = fs.existsSync(targetPath);
    try {
      fs.mkdirSync(targetPath, { recursive: true });
      let opened = null;
      if (openInCode !== false) {
        opened = launchFolderInCode(targetPath);
      }
      return {
        ok: true,
        path: targetPath,
        folderName: cleanName,
        baseName: path.basename(baseDir),
        existed,
        openedWith: opened?.openedWith || "VS Code",
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Lista los proyectos más recientes del usuario (ordenados por última modificación) para "Modo Proyecto"
  ipcMain.handle("island:list-recent-projects", async () => {
    const roots = [
      "D:\\UNIVERSIDAD\\proyectos_Personales",
      path.join(os.homedir(), "Desktop"),
      "D:\\UNIVERSIDAD",
    ].filter((d) => fs.existsSync(d));
    const skip = new Set(["node_modules", ".git", ".venv", "dist", "build", "__macosx", ".vscode"]);
    const seen = new Set();
    const list = [];
    for (const root of roots) {
      let entries = [];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory() || skip.has(e.name.toLowerCase())) continue;
        const full = path.join(root, e.name);
        const low = full.toLowerCase();
        if (seen.has(low)) continue;
        seen.add(low);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          mtime = 0;
        }
        list.push({
          name: e.name,
          path: full,
          parent: path.basename(root),
          mtime,
        });
      }
    }
    list.sort((a, b) => b.mtime - a.mtime);
    return list.slice(0, 6);
  });

  ipcMain.handle("island:open-project-terminal", async (_e, query) => {
    const list = await ipcMain._events?.["island:find-projects"] ? [] : [];
    void list;
    const normFolder = (s) =>
      String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    const qNorm = normFolder(query);
    if (!qNorm) return { ok: false };
    const roots = ["D:\\UNIVERSIDAD\\proyectos_Personales", "D:\\UNIVERSIDAD", path.join(os.homedir(), "Desktop")].filter((d) => fs.existsSync(d));
    const skip = new Set(["node_modules", ".git", ".venv", "dist", "build", "__macosx"]);
    let foundPath = "";
    const walk = (dir, depth = 0) => {
      if (depth > 3 || foundPath) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory() || skip.has(e.name.toLowerCase())) continue;
        const full = path.join(dir, e.name);
        const n = normFolder(e.name);
        if (n === qNorm || n.includes(qNorm)) { foundPath = full; return; }
        walk(full, depth + 1);
      }
    };
    for (const r of roots) walk(r, 0);
    if (!foundPath) return { ok: false };
    spawn("wt.exe", ["-d", foundPath], { detached: true, stdio: "ignore" }).on("error", () => {
      spawn("cmd.exe", ["/c", "start", "powershell.exe", "-NoExit", "-Command", `Set-Location '${foundPath}'`], { detached: true, stdio: "ignore" }).unref();
    }).unref();
    return { ok: true, folderName: path.basename(foundPath), path: foundPath };
  });

  ipcMain.handle("island:project-git-status", async (_e, query) => {
    const normFolder = (s) =>
      String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    const qNorm = normFolder(query);
    if (!qNorm) return { ok: false };
    const roots = ["D:\\UNIVERSIDAD\\proyectos_Personales", "D:\\UNIVERSIDAD"].filter((d) => fs.existsSync(d));
    const skip = new Set(["node_modules", ".git", ".venv", "dist", "build", "__macosx"]);
    let foundPath = "";
    const walk = (dir, depth = 0) => {
      if (depth > 3 || foundPath) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory() || skip.has(e.name.toLowerCase())) continue;
        const full = path.join(dir, e.name);
        const n = normFolder(e.name);
        if (n === qNorm || n.includes(qNorm)) { foundPath = full; return; }
        walk(full, depth + 1);
      }
    };
    for (const r of roots) walk(r, 0);
    if (!foundPath || !fs.existsSync(path.join(foundPath, ".git"))) {
      return { ok: false, error: "no_git" };
    }
    return await new Promise((resolve) => {
      execFile(
        "git",
        ["-C", foundPath, "status", "--short", "--branch"],
        { windowsHide: true, timeout: 4000 },
        (_err, stdout) => {
          const lines = (stdout || "").trim().split(/\r?\n/).filter(Boolean);
          const branchLine = (lines[0] || "").replace(/^##\s*/, "");
          const changes = Math.max(0, lines.length - 1);
          resolve({
            ok: true,
            folderName: path.basename(foundPath),
            branch: branchLine.split("...")[0] || "main",
            changes,
          });
        },
      );
    });
  });

  ipcMain.handle("island:find-projects", async (_e, query) => {
    const normFolder = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\bprimero?\b/g, "1")
        .replace(/\bsegundo?\b/g, "2")
        .replace(/\btercero?\b/g, "3")
        .replace(/[^a-z0-9]/g, "");
    const qNorm = normFolder(query);
    if (!qNorm) return [];

    const searchRoots = [
      "D:\\UNIVERSIDAD\\proyectos_Personales",
      "D:\\UNIVERSIDAD",
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "Documents"),
      path.join(os.homedir(), "Projects"),
    ].filter((d) => fs.existsSync(d));

    const skipDirs = new Set([
      "node_modules", ".git", ".venv", "venv", "dist", "build", "bin", "obj", "__pycache__", "__macosx", ".next", ".idea", ".vscode",
    ]);

    const seen = new Set();
    const matches = [];

    const walkDirs = (dir, depth = 0) => {
      if (depth > 3) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (skipDirs.has(entry.name.toLowerCase())) continue;
        const full = path.join(dir, entry.name);
        const lowFull = full.toLowerCase();
        if (seen.has(lowFull)) continue;
        seen.add(lowFull);

        const n = normFolder(entry.name);
        if (n && (n === qNorm || n.includes(qNorm) || qNorm.includes(n))) {
          const score =
            n === qNorm
              ? 1.0
              : Math.min(n.length, qNorm.length) / Math.max(n.length, qNorm.length);
          matches.push({
            name: entry.name,
            path: full,
            parent: path.basename(path.dirname(full)),
            score,
          });
        }
        walkDirs(full, depth + 1);
      }
    };

    for (const root of searchRoots) walkDirs(root, 0);
    matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return matches.slice(0, 6);
  });

  ipcMain.handle("island:open-project", async (_e, query) => {
    const normFolder = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\bprimero?\b/g, "1")
        .replace(/\bsegundo?\b/g, "2")
        .replace(/\btercero?\b/g, "3")
        .replace(/[^a-z0-9]/g, "");
    const qNorm = normFolder(query);
    if (!qNorm) return { ok: false, error: "empty" };

    const searchRoots = [
      "D:\\UNIVERSIDAD\\proyectos_Personales",
      "D:\\UNIVERSIDAD",
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "Documents"),
      path.join(os.homedir(), "Projects"),
    ].filter((d) => fs.existsSync(d));

    const skipDirs = new Set([
      "node_modules", ".git", ".venv", "venv", "dist", "build", "bin", "obj", "__pycache__", "__macosx", ".next", ".idea", ".vscode",
    ]);

    const seen = new Set();
    const matches = [];
    const walkDirs = (dir, depth = 0) => {
      if (depth > 3) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (skipDirs.has(entry.name.toLowerCase())) continue;
        const full = path.join(dir, entry.name);
        const lowFull = full.toLowerCase();
        if (seen.has(lowFull)) continue;
        seen.add(lowFull);
        const n = normFolder(entry.name);
        if (n && (n === qNorm || n.includes(qNorm) || qNorm.includes(n))) {
          const score =
            n === qNorm
              ? 1.0
              : Math.min(n.length, qNorm.length) / Math.max(n.length, qNorm.length);
          matches.push({ name: entry.name, path: full, parent: path.basename(path.dirname(full)), score });
        }
        walkDirs(full, depth + 1);
      }
    };
    for (const root of searchRoots) walkDirs(root, 0);
    if (matches.length === 0) return { ok: false, error: "not_found" };
    matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return launchFolderInCode(matches[0].path);
  });

  ipcMain.handle("island:pick-files", async () => {
    if (!win) return [];
    const res = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"] });
    if (res.canceled) return [];
    return res.filePaths.map((p) => {
      let sz = 0;
      try {
        sz = fs.statSync(p).size;
      } catch {
        // ignore
      }
      return { path: p, name: path.basename(p), size_bytes: sz };
    });
  });

  ipcMain.handle("island:pick-folder", async () => {
    if (!win) return "";
    const res = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return res.canceled || !res.filePaths[0] ? "" : res.filePaths[0];
  });

  // Selector nativo de imagen de portada para cualquier tarjeta del Home (optimizada <= 640px)
  ipcMain.handle("island:pick-cover-image", async () => {
    if (!win) return "";
    const res = await dialog.showOpenDialog(win, {
      title: "Elige una imagen de portada para esta tarjeta",
      properties: ["openFile"],
      filters: [{ name: "Imágenes", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (res.canceled || !res.filePaths[0]) return "";
    try {
      let img = nativeImage.createFromPath(res.filePaths[0]);
      if (img.isEmpty()) return "";
      const sz = img.getSize();
      if (sz.width > 640) {
        img = img.resize({ width: 640, quality: "good" });
      }
      const jpg = img.toJPEG(84);
      return `data:image/jpeg;base64,${jpg.toString("base64")}`;
    } catch {
      return "";
    }
  });

  let cachedInstalledApps = null;

  ipcMain.handle("island:list-installed-apps", async () => {
    if (cachedInstalledApps) return cachedInstalledApps;
    const roots = [
      path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
      path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
      path.join(os.homedir(), "Desktop"),
      path.join("C:\\Users\\Public", "Desktop"),
    ].filter((d) => d && fs.existsSync(d));

    const found = new Map();
    const skipRe = /\b(uninstall|desinstalar|unins\d+|readme|license|help|ayuda|manual|website|update|updater|setup|install)\b/i;

    const walk = (dir, depth = 0) => {
      if (depth > 3) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".lnk")) {
          const displayName = entry.name.replace(/\.lnk$/i, "").trim();
          if (!displayName || skipRe.test(displayName)) continue;
          try {
            const lnk = shell.readShortcutLink(full);
            const target = lnk?.target || "";
            if (!target || !target.toLowerCase().endsWith(".exe")) continue;
            if (!fs.existsSync(target)) continue;
            const procBase = path.basename(target, path.extname(target));
            if (skipRe.test(procBase)) continue;
            const key = displayName.toLowerCase();
            if (!found.has(key)) {
              found.set(key, {
                name: displayName,
                exePath: target,
                lnkPath: full,
                processName: procBase,
              });
            }
          } catch {
            // ignore broken shortcut
          }
        }
      }
    };

    for (const r of roots) walk(r, 0);

    // También incluye TODAS las apps del Menú Inicio de Windows (UWP / Microsoft Store / MSIX)
    await new Promise((resolve) => {
      execFile(
        PS_EXE,
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress",
        ],
        { windowsHide: true, timeout: 4500, maxBuffer: 2 * 1024 * 1024 },
        (_err, stdout) => {
          try {
            const parsed = JSON.parse((stdout || "").trim());
            const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
            for (const item of arr) {
              const name = String(item?.Name || "").trim();
              const appId = String(item?.AppID || "").trim();
              if (!name || !appId || skipRe.test(name)) continue;
              const key = name.toLowerCase();
              if (!found.has(key)) {
                const isExePath = appId.toLowerCase().endsWith(".exe") && fs.existsSync(appId);
                found.set(key, {
                  name,
                  exePath: isExePath ? appId : `shell:AppsFolder\\${appId}`,
                  lnkPath: isExePath ? appId : `shell:AppsFolder\\${appId}`,
                  processName: isExePath
                    ? path.basename(appId, ".exe")
                    : name.replace(/[^a-zA-Z0-9]/g, ""),
                });
              }
            }
          } catch {
            // ignore
          }
          resolve();
        },
      );
    });

    cachedInstalledApps = Array.from(found.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "es"),
    );
    return cachedInstalledApps;
  });

  ipcMain.handle("island:get-app-icon", async (_e, exePath) => {
    const p = String(exePath || "");
    if (!p) return "";
    // Si es un acceso directo .lnk con IconLocation personalizado (ej. DiscoClaro Dashboard.lnk),
    // prioriza ese .ico oficial antes que el ícono genérico de pythonw.exe.
    if (p.toLowerCase().endsWith(".lnk") && fs.existsSync(p)) {
      try {
        const lnk = shell.readShortcutLink(p);
        if (lnk && lnk.icon && fs.existsSync(lnk.icon)) {
          const ni = nativeImage.createFromPath(lnk.icon);
          if (!ni.isEmpty()) return ni.toDataURL();
          const fi = await app.getFileIcon(lnk.icon, { size: "large" });
          if (!fi.isEmpty()) return fi.toDataURL();
        }
        const lnkIcon = await app.getFileIcon(p, { size: "large" });
        if (!lnkIcon.isEmpty()) return lnkIcon.toDataURL();
      } catch {
        // fallback al .exe
      }
    }
    if (!p.startsWith("shell:") && fs.existsSync(p)) {
      try {
        const img = await app.getFileIcon(p, { size: "large" });
        return img.toDataURL();
      } catch {
        return "";
      }
    }
    if (p.startsWith("shell:AppsFolder\\")) {
      const appId = p.slice("shell:AppsFolder\\".length);
      const pfn = appId.split("!")[0].replace(/[^a-zA-Z0-9._-]/g, "");
      if (!pfn) return "";
      return await new Promise((resolve) => {
        const script =
          `$pkg = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq '${pfn}' } | Select-Object -First 1; ` +
          `if ($pkg -and $pkg.InstallLocation) { ` +
          `  $imgs = Get-ChildItem -Path $pkg.InstallLocation -Recurse -Include *Logo*.png,*icon*.png,*.png -ErrorAction SilentlyContinue | ` +
          `    Where-Object { $_.Name -notmatch 'Splash|Wide|Badge|contrast' -and $_.Length -gt 800 } | ` +
          `    Sort-Object { if($_.Name -match 'Square150|Square44|StoreLogo|AppIcon|icon'){0}else{1} }, Length -Descending | Select-Object -First 1; ` +
          `  if ($imgs) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($imgs.FullName)) } ` +
          `}`;
        execFile(
          PS_EXE,
          ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
          { windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
          (_err, stdout) => {
            const b64 = (stdout || "").trim();
            resolve(b64 ? `data:image/png;base64,${b64}` : "");
          },
        );
      });
    }
    return "";
  });

  ipcMain.handle("island:pick-app", async () => {
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: "Selecciona un programa oficial (.exe o acceso directo .lnk)",
      properties: ["openFile"],
      filters: [{ name: "Aplicaciones de Windows", extensions: ["exe", "lnk"] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    let targetPath = res.filePaths[0];
    if (targetPath.toLowerCase().endsWith(".lnk")) {
      try {
        const resolved = shell.readShortcutLink(targetPath);
        if (resolved && resolved.target && fs.existsSync(resolved.target)) {
          targetPath = resolved.target;
        }
      } catch {
        // conservar .lnk
      }
    }
    let iconDataUrl = "";
    try {
      const iconImg = await app.getFileIcon(targetPath, { size: "large" });
      iconDataUrl = iconImg.toDataURL();
    } catch {
      iconDataUrl = "";
    }
    const base = path.basename(targetPath, path.extname(targetPath));
    const prettyName = base.charAt(0).toUpperCase() + base.slice(1);
    return {
      name: prettyName,
      exePath: targetPath,
      processName: base,
      iconDataUrl,
    };
  });

  ipcMain.handle("island:get-app-statuses", (_e, processNames) => {
    return new Promise((resolve) => {
      if (!Array.isArray(processNames) || processNames.length === 0) {
        resolve({});
        return;
      }
      const safe = processNames
        .map((n) => String(n || "").replace(/[^a-zA-Z0-9 _.-]/g, ""))
        .filter(Boolean);
      if (safe.length === 0) {
        resolve({});
        return;
      }
      const listLiteral = safe.map((n) => `'${n}'`).join(",");
      const script =
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ` +
        `$out=@{}; foreach($n in @(${listLiteral})){ ` +
        `$ps=Get-Process -Name $n -ErrorAction SilentlyContinue; ` +
        `if($ps){ ` +
        `  $mb=[math]::Round((($ps|Measure-Object WorkingSet64 -Sum).Sum)/1MB,0); ` +
        `  $title=($ps | Where-Object { $_.MainWindowTitle } | Select-Object -First 1 -ExpandProperty MainWindowTitle); ` +
        `  $start=($ps | Where-Object { $_.StartTime } | Sort-Object StartTime | Select-Object -First 1 -ExpandProperty StartTime); ` +
        `  $up=if($start){[int]((Get-Date)-$start).TotalSeconds}else{0}; ` +
        `  $out[$n]=@{running=$true;ram_mb=$mb;count=$ps.Count;window_title=[string]$title;uptime_sec=$up} ` +
        `} else { $out[$n]=@{running=$false;ram_mb=0;count=0;window_title='';uptime_sec=0} } }; ` +
        `$out | ConvertTo-Json -Compress`;
      execFile(
        PS_EXE,
        ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
        { windowsHide: true, timeout: 3000 },
        (_err, stdout) => {
          try {
            const parsed = JSON.parse((stdout || "").trim());
            resolve(parsed && typeof parsed === "object" ? parsed : {});
          } catch {
            resolve({});
          }
        },
      );
    });
  });

  const weatherCacheByCity = new Map();
  const WEATHER_ES_MAP = [
    [/thundery outbreaks/i, "posibles tormentas eléctricas"],
    [/partly cloudy/i, "parcialmente nublado"],
    [/mostly cloudy/i, "mayormente nublado"],
    [/overcast/i, "nublado"],
    [/clear/i, "despejado"],
    [/sunny/i, "soleado"],
    [/light rain|patchy rain/i, "lluvia ligera"],
    [/moderate rain/i, "lluvia moderada"],
    [/heavy rain/i, "lluvia fuerte"],
    [/mist|fog/i, "neblina"],
  ];

  function translateWeatherCondition(raw) {
    const s = String(raw || "").trim();
    if (!s) return "despejado";
    for (const [re, es] of WEATHER_ES_MAP) {
      if (re.test(s)) return es;
    }
    return s;
  }

  ipcMain.handle("island:get-weather", (_e, cityArg) => {
    const requestedCity = String(cityArg || "Santa Cruz de la Sierra,Bolivia").trim();
    const cacheKey = requestedCity.toLowerCase();
    const now = Date.now();
    const hit = weatherCacheByCity.get(cacheKey);
    if (hit && now - hit.at < 10 * 60 * 1000) {
      return Promise.resolve(hit.data);
    }
    return new Promise((resolve) => {
      const url = `https://wttr.in/${encodeURIComponent(requestedCity)}?format=j1&lang=es`;
      const req = https.get(
        url,
        { timeout: 5500, headers: { "User-Agent": "GlassIsland/1.0", "Accept-Language": "es-BO,es;q=0.9" } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const j = JSON.parse(body);
              const cur = j.current_condition?.[0];
              const area = j.nearest_area?.[0];
              const rawCond = cur?.lang_es?.[0]?.value || cur?.weatherDesc?.[0]?.value || "despejado";
              const forecast = Array.isArray(j.weather)
                ? j.weather.slice(0, 3).map((d) => {
                    const midday = d?.hourly?.[4] || d?.hourly?.[0];
                    const dCond =
                      midday?.lang_es?.[0]?.value || midday?.weatherDesc?.[0]?.value || "despejado";
                    return {
                      date: String(d?.date || ""),
                      max_c: Number(d?.maxtempC ?? 30),
                      min_c: Number(d?.mintempC ?? 22),
                      condition: translateWeatherCondition(dCond),
                    };
                  })
                : [];
              const data = {
                temp_c: cur ? Number(cur.temp_C) : 28,
                feels_like_c: cur ? Number(cur.FeelsLikeC) : 28,
                humidity: cur ? Number(cur.humidity) : 60,
                condition: translateWeatherCondition(rawCond),
                city:
                  requestedCity.split(",")[0].trim() ||
                  area?.areaName?.[0]?.value ||
                  "Santa Cruz de la Sierra",
                forecast,
              };
              weatherCacheByCity.set(cacheKey, { data, at: Date.now() });
              resolve(data);
            } catch {
              resolve(
                hit?.data || {
                  temp_c: 28,
                  feels_like_c: 28,
                  humidity: 60,
                  condition: "despejado",
                  city: requestedCity.split(",")[0].trim() || "Santa Cruz de la Sierra",
                },
              );
            }
          });
        },
      );
      req.on("error", () =>
        resolve(
          hit?.data || {
            temp_c: 28,
            feels_like_c: 28,
            humidity: 60,
            condition: "sin conexión",
            city: requestedCity.split(",")[0].trim() || "Santa Cruz de la Sierra",
          },
        ),
      );
      req.on("timeout", () => {
        req.destroy();
        resolve(
          hit?.data || {
            temp_c: 28,
            feels_like_c: 28,
            humidity: 60,
            condition: "despejado",
            city: requestedCity.split(",")[0].trim() || "Santa Cruz de la Sierra",
          },
        );
      });
    });
  });

  ipcMain.handle("island:load-config", () => {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      }
    } catch {
      // ignore
    }
    return {};
  });

  ipcMain.handle("island:save-config", (_e, data) => {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf8");
      return true;
    } catch {
      return false;
    }
  });

  function pcm24kToWavBuffer(pcmBuf) {
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcmBuf.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcmBuf.length, 40);
    return Buffer.concat([header, pcmBuf]);
  }

  function synthesizeGeminiTts(text, geminiVoice, apiKey, ttsStyle) {
    return new Promise((resolve) => {
      if (!apiKey || !text) {
        resolve(null);
        return;
      }
      const styleCue = String(ttsStyle || "natural, sereno y seguro").trim();
      const body = JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Lee exactamente en voz alta en español latino con tono ${styleCue} (no agregues ni cambies palabras): "${text}"`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: geminiVoice || "Charon" },
            },
          },
        },
      });
      const req = https.request(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          agent: GEMINI_HTTPS_AGENT,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 18000,
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            raw += chunk;
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(raw);
              const part = parsed?.candidates?.[0]?.content?.parts?.find(
                (p) => p?.inlineData?.data,
              );
              const b64 = part?.inlineData?.data;
              const mime = String(part?.inlineData?.mimeType || "");
              if (!b64) {
                resolve(null);
                return;
              }
              if (mime.includes("wav")) {
                const wavBuf = Buffer.from(b64, "base64");
                resolve({ dataUrl: `data:audio/wav;base64,${b64}`, wavBuf });
                return;
              }
              if (mime.includes("mpeg") || mime.includes("mp3")) {
                resolve({ dataUrl: `data:${mime};base64,${b64}`, wavBuf: null });
                return;
              }
              const pcmBuf = Buffer.from(b64, "base64");
              const wavBuf = pcm24kToWavBuffer(pcmBuf);
              resolve({
                dataUrl: "data:audio/wav;base64," + wavBuf.toString("base64"),
                wavBuf,
              });
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.write(body);
      req.end();
    });
  }

  function resolveGeminiKey(providedKey) {
    let key = String(providedKey || "").trim();
    if (!key) {
      try {
        if (fs.existsSync(CONFIG_FILE)) {
          const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
          key = String(cfg?.geminiApiKey || "").trim();
        }
      } catch {
        // ignore
      }
    }
    return key;
  }

  function readVoiceCache(voice, text) {
    try {
      const hash = crypto
        .createHash("sha1")
        .update(`${voice}|${text.toLowerCase().trim()}`)
        .digest("hex");
      const wavPath = path.join(VOICE_CACHE_DIR, `${hash}.wav`);
      if (fs.existsSync(wavPath)) {
        const buf = fs.readFileSync(wavPath);
        if (buf.length > 44) {
          return "data:audio/wav;base64," + buf.toString("base64");
        }
      }
    } catch {
      // ignore
    }
    return "";
  }

  function writeVoiceCache(voice, text, wavBuf) {
    if (!wavBuf || wavBuf.length <= 44) return;
    try {
      fs.mkdirSync(VOICE_CACHE_DIR, { recursive: true });
      const hash = crypto
        .createHash("sha1")
        .update(`${voice}|${text.toLowerCase().trim()}`)
        .digest("hex");
      fs.writeFileSync(path.join(VOICE_CACHE_DIR, `${hash}.wav`), wavBuf);
    } catch {
      // ignore
    }
  }

  ipcMain.handle("island:clone-jarvis-ref", async (_e, geminiVoice, geminiApiKey) => {
    const gVoice = String(geminiVoice || "Charon").replace(/^gemini:/, "").trim() || "Charon";
    const key = resolveGeminiKey(geminiApiKey);
    if (!key) {
      return { ok: false, error: "Pega primero tu Gemini API Key en Ajustes." };
    }
    const sampleText =
      "Buenas noches, Hebert. Soy tu asistente personal operativo. Todos los sistemas están en línea, la temperatura es agradable y tus proyectos están listos para continuar cuando tú indiques.";
    const res = await synthesizeGeminiTts(sampleText, gVoice, key);
    if (!res?.wavBuf) {
      return { ok: false, error: "No se pudo generar el clip de referencia con Gemini TTS." };
    }
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(JARVIS_REF_WAV, res.wavBuf);
      return { ok: true, path: JARVIS_REF_WAV, voice: gVoice, bytes: res.wavBuf.length };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("island:voice-speak", async (_e, text, voice, geminiApiKey, ttsStyle) => {
    const cleanText = String(text || "").trim();
    const requestedVoice = String(voice || "en-US-EmmaMultilingualNeural");
    if (!cleanText) return { audio: "", voice: requestedVoice };

    // 1) Caché instantánea en disco (0 ms, 0 cuota API, 0% GPU)
    const cachedUrl = readVoiceCache(requestedVoice, cleanText);
    if (cachedUrl) {
      callVoice({ cmd: "mute_for", seconds: Math.max(2.0, cleanText.length * 0.07) }, 1200).catch(
        () => {},
      );
      return { audio: cachedUrl, voice: requestedVoice, engine: "cache-0ms" };
    }

    // 2) Voz clonada 100% offline en GPU local (usando jarvis_ref.wav)
    if (requestedVoice === "clone:jarvis") {
      if (fs.existsSync(JARVIS_REF_WAV)) {
        const cloned = await callVoice(
          { cmd: "speak_clone", text: cleanText, ref_wav: JARVIS_REF_WAV },
          25000,
        );
        if (cloned?.audio) {
          try {
            const b64 = String(cloned.audio).replace(/^data:audio\/wav;base64,/, "");
            writeVoiceCache(requestedVoice, cleanText, Buffer.from(b64, "base64"));
          } catch {
            // ignore
          }
          return { audio: cloned.audio, voice: requestedVoice, engine: "clone-offline" };
        }
      }
      // Si aún no está el clonador local o ref_wav, usa voz latina grave como fallback instantáneo
      return await callVoice(
        { cmd: "speak", text: cleanText, voice: "es-MX-JorgeNeural" },
        12000,
      );
    }

    // 3) Gemini 2.5 Flash Pro TTS con TLS Keep-Alive + entonación dinámica según actitud + caché 0ms
    if (requestedVoice.startsWith("gemini:")) {
      const gVoice = requestedVoice.slice("gemini:".length).trim() || "Charon";
      const key = resolveGeminiKey(geminiApiKey);
      if (key) {
        callVoice({ cmd: "mute_for", seconds: Math.max(2.5, cleanText.length * 0.08) }, 1500).catch(
          () => {},
        );
        let result = await synthesizeGeminiTts(cleanText, gVoice, key, ttsStyle);
        if (!result?.dataUrl) {
          await new Promise((r) => setTimeout(r, 450));
          result = await synthesizeGeminiTts(cleanText, gVoice, key, ttsStyle);
        }
        if (result?.dataUrl) {
          if (result.wavBuf) {
            writeVoiceCache(requestedVoice, cleanText, result.wavBuf);
            // Si aún no existe un clip de referencia de Jarvis, guarda el primero automáticamente
            if (!fs.existsSync(JARVIS_REF_WAV) && gVoice === "Charon" && result.wavBuf.length > 48000) {
              try {
                fs.writeFileSync(JARVIS_REF_WAV, result.wavBuf);
              } catch {
                // ignore
              }
            }
          }
          return { audio: result.dataUrl, voice: requestedVoice, engine: "gemini-tts" };
        }
      }
      // Si el clonador local ya está cargado en GPU, úsalo (auto_load=false para no bloquear nunca con descargas)
      if (fs.existsSync(JARVIS_REF_WAV) && /charon|fenrir/i.test(gVoice)) {
        const cloned = await callVoice(
          { cmd: "speak_clone", text: cleanText, ref_wav: JARVIS_REF_WAV, auto_load: false },
          6000,
        );
        if (cloned?.audio) {
          try {
            const b64 = String(cloned.audio).replace(/^data:audio\/wav;base64,/, "");
            writeVoiceCache(requestedVoice, cleanText, Buffer.from(b64, "base64"));
          } catch {
            // ignore
          }
          return { audio: cloned.audio, voice: requestedVoice, engine: "clone-fallback" };
        }
      }
      // Respaldo instantáneo (300 ms) 100% en español latino puro (evita voces Multilingual que cambian a portugués)
      const isMale = /charon|fenrir|puck|orus/i.test(gVoice);
      const fallbackVoice = isMale ? "es-MX-JorgeNeural" : "es-BO-SofiaNeural";
      return await callVoice({ cmd: "speak", text: cleanText, voice: fallbackVoice }, 12000);
    }

    return await callVoice(
      { cmd: "speak", text: cleanText, voice: requestedVoice },
      12000,
    );
  });

  ipcMain.handle("island:get-disk-summary", () => {
    return new Promise((resolve) => {
      const http = require("http");
      const req = http.get("http://127.0.0.1:8347/summary", { timeout: 1800 }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            const vols = Array.isArray(parsed?.volumes)
              ? parsed.volumes.map((v) => ({
                  name: v?.volume?.name || "C:",
                  freeGb: Math.round(((v?.volume?.free_bytes || 0) / 1e9) * 10) / 10,
                  totalGb: Math.round(((v?.volume?.total_bytes || 0) / 1e9) * 10) / 10,
                  usedPct: v?.volume?.total_bytes
                    ? Math.round(((v.volume.used_bytes || 0) / v.volume.total_bytes) * 100)
                    : 0,
                }))
              : [];
            resolve({ ok: vols.length > 0, volumes: vols });
          } catch {
            resolve({ ok: false, volumes: [] });
          }
        });
      });
      req.on("error", () => resolve({ ok: false, volumes: [] }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, volumes: [] });
      });
    });
  });

  ipcMain.handle("island:smart-home", (_e, webhookUrl, action) => {
    return new Promise((resolve) => {
      const target = String(webhookUrl || "").trim();
      if (!target || !/^https?:\/\//i.test(target)) {
        resolve({ ok: false, reason: "no_webhook" });
        return;
      }
      try {
        const parsedUrl = new URL(target);
        const mod = parsedUrl.protocol === "https:" ? https : require("http");
        const body = JSON.stringify({
          action: String(action || "toggle"),
          source: "glass-island-nova",
          timestamp: new Date().toISOString(),
        });
        const req = mod.request(
          parsedUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
            timeout: 4500,
          },
          (res) => {
            res.resume();
            resolve({ ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 400 });
          },
        );
        req.on("error", () => resolve({ ok: false, reason: "network" }));
        req.on("timeout", () => {
          req.destroy();
          resolve({ ok: false, reason: "timeout" });
        });
        req.write(body);
        req.end();
      } catch {
        resolve({ ok: false, reason: "invalid_url" });
      }
    });
  });

  ipcMain.handle("island:voice-set-listen", async (_e, enabled) => {
    return await callVoice({ cmd: "set_listen", enabled: Boolean(enabled) }, 3000);
  });

  ipcMain.handle("island:voice-mute-for", async (_e, seconds) => {
    return await callVoice({ cmd: "mute_for", seconds: Number(seconds) || 3 }, 2000);
  });

  ipcMain.handle("island:voice-set-engine", async (_e, useWhisper) => {
    return await callVoice({ cmd: "set_engine", whisper: Boolean(useWhisper) }, 5000);
  });

  ipcMain.handle("island:get-auto-start", () => {
    try {
      const settings = app.getLoginItemSettings();
      return { enabled: Boolean(settings.openAtLogin) };
    } catch {
      return { enabled: false };
    }
  });

  ipcMain.handle("island:set-auto-start", (_e, enabled) => {
    try {
      const openAtLogin = Boolean(enabled);
      if (app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin });
      } else {
        app.setLoginItemSettings({
          openAtLogin,
          path: process.execPath,
          args: [path.resolve(path.join(__dirname, ".."))],
        });
      }
      return { ok: true, enabled: openAtLogin };
    } catch (err) {
      return { ok: false, enabled: false, error: String(err) };
    }
  });

  // --- GlassDrop: transferencia Wi-Fi bidireccional Laptop <-> Celular (sin apps externas) ---
  let shelfFilesCache = [];
  const glassDrop = createGlassDropServer({
    getShelfFiles: () => shelfFilesCache,
    onDeviceConnected: (device) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("island:glassdrop-event", { kind: "connected", device });
      }
    },
    onFileReceived: (fileItem) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("island:glassdrop-event", { kind: "file", file: fileItem });
      }
    },
    onClipReceived: (text) => {
      try {
        clipboard.writeText(text);
      } catch {
        // ignore
      }
      if (win && !win.isDestroyed()) {
        win.webContents.send("island:glassdrop-event", { kind: "clip", text });
      }
    },
  });

  ipcMain.handle("island:glassdrop-open-folder", async (_e, subFolder) => {
    try {
      const target =
        subFolder && fs.existsSync(String(subFolder))
          ? String(subFolder)
          : glassDrop.getDownloadDir();
      await shell.openPath(target);
      return { ok: true, path: target };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("island:glassdrop-sync", (_e, files) => {
    shelfFilesCache = Array.isArray(files) ? files : [];
    return true;
  });

  // Filtra automáticamente de la lista del Estante los archivos que ya fueron movidos, renombrados, borrados o caducaron (>24h)
  ipcMain.handle("island:prune-shelf-files", (_e, files) => {
    const arr = Array.isArray(files) ? files : [];
    const maxAgeMs = 24 * 3600 * 1000;
    const now = Date.now();
    return arr
      .filter((f) => {
        if (!f || !f.path) return false;
        if (typeof f.addedAt === "number" && now - f.addedAt > maxAgeMs) return false;
        try {
          return fs.existsSync(f.path);
        } catch {
          return false;
        }
      })
      .slice(0, 15);
  });

  ipcMain.handle("island:glassdrop-start", async (_e, files) => {
    if (Array.isArray(files)) shelfFilesCache = files;
    return await glassDrop.start();
  });

  ipcMain.handle("island:glassdrop-stop", () => {
    return glassDrop.stop();
  });

  ipcMain.handle("island:quit", () => {
    glassDrop.stop();
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (bridgeProc) {
    try {
      bridgeProc.kill();
    } catch {
      // ignore
    }
  }
  if (voiceProc) {
    try {
      voiceProc.kill();
    } catch {
      // ignore
    }
  }
  app.quit();
});
