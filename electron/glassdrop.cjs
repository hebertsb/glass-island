// GlassDrop: servidor Wi-Fi local bidireccional (Laptop <-> Celular) sin apps externas ni internet
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

function getLocalLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    const low = name.toLowerCase();
    // Ignorar adaptadores virtuales (WSL, Hyper-V, Docker, VirtualBox, VMware, Loopback)
    if (/vethernet|wsl|docker|vmware|virtualbox|loopback|tailscale|zerotier|hamachi/.test(low)) {
      continue;
    }
    for (const a of addrs) {
      if (a.family !== "IPv4" || a.internal) continue;
      const priority = /wi-?fi|wlan|wireless/.test(low)
        ? 0
        : a.address.startsWith("192.168.")
          ? 1
          : a.address.startsWith("10.")
            ? 2
            : 3;
      candidates.push({ ip: a.address, priority });
    }
  }
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0]?.ip || "127.0.0.1";
}

function buildMobileHtml(token) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<title>GlassDrop · Transferencia Wi-Fi</title>
<style>
  :root {
    --bg: #070b14;
    --card: rgba(15, 23, 42, 0.72);
    --border: rgba(148, 163, 184, 0.18);
    --accent: #38bdf8;
    --accent-2: #6366f1;
    --text: #f8fafc;
    --muted: #94a3b8;
  }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  body {
    margin: 0; min-height: 100vh; color: var(--text); padding: 20px 14px 40px;
    background:
      radial-gradient(ellipse at top, rgba(56, 189, 248, 0.16) 0%, transparent 55%),
      radial-gradient(ellipse at bottom right, rgba(99, 102, 241, 0.14) 0%, transparent 55%),
      var(--bg);
  }
  .wrap { max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 2px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-icon {
    width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
    background: linear-gradient(135deg, #38bdf8, #6366f1); color: #fff; font-weight: 800; font-size: 16px;
    box-shadow: 0 6px 18px rgba(56, 189, 248, 0.3);
  }
  .brand h1 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
  .brand p { margin: 1px 0 0; font-size: 11px; color: var(--muted); }
  .pill {
    font-size: 11px; padding: 5px 10px; border-radius: 999px; font-weight: 600;
    background: rgba(16, 185, 129, 0.14); border: 1px solid rgba(16, 185, 129, 0.38); color: #6ee7b7;
  }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 18px; padding: 16px; backdrop-filter: blur(20px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.32);
  }
  .section-title {
    margin: 0 0 12px; font-size: 11.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--muted); display: flex; align-items: center; justify-content: space-between;
  }
  .dropzone {
    border: 1.5px dashed rgba(56, 189, 248, 0.45); border-radius: 14px;
    background: rgba(56, 189, 248, 0.06); padding: 16px 12px; text-align: center;
    transition: background 0.18s ease, border-color 0.18s ease, transform 0.15s ease;
  }
  .dropzone.over {
    background: rgba(56, 189, 248, 0.2); border-color: #38bdf8; transform: scale(1.01);
  }
  .drop-hint { font-size: 12.5px; color: #cbd5e1; margin-bottom: 12px; line-height: 1.4; }
  .btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .action-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 12px 10px; border-radius: 12px; font-size: 13px; font-weight: 700;
    cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.14); transition: transform 0.12s ease, opacity 0.15s;
    text-decoration: none;
  }
  .action-btn:active { transform: scale(0.97); }
  .action-btn--primary {
    background: linear-gradient(135deg, #38bdf8, #3b82f6); color: #041222; border: none;
  }
  .action-btn--secondary {
    background: rgba(255, 255, 255, 0.08); color: #f8fafc;
  }
  .prog-wrap {
    margin-top: 10px; height: 6px; border-radius: 999px; background: rgba(255,255,255,0.08);
    overflow: hidden; display: none;
  }
  .prog-bar { height: 100%; width: 0%; background: linear-gradient(90deg, #38bdf8, #818cf8); transition: width 0.12s linear; }
  .status { margin-top: 8px; font-size: 12px; color: #7dd3fc; min-height: 16px; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    background: rgba(2, 6, 23, 0.55); border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 12px; padding: 10px 12px;
  }
  .row-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .ext-badge {
    width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; flex-shrink: 0;
    background: rgba(56, 189, 248, 0.14); border: 1px solid rgba(56, 189, 248, 0.3);
    font-size: 10px; font-weight: 800; color: #7dd3fc; letter-spacing: 0.04em;
  }
  .fname { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fsize { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .dl-btn {
    text-decoration: none; background: #f8fafc; color: #0f172a; font-weight: 700;
    font-size: 12px; padding: 8px 13px; border-radius: 10px; flex-shrink: 0;
  }
  .clip-row { display: flex; gap: 8px; }
  .clip-input {
    flex: 1; background: rgba(2, 6, 23, 0.65); border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 11px; padding: 10px 12px; color: #fff; font-size: 13px; outline: none;
  }
  .clip-input:focus { border-color: var(--accent); }
  .clip-btn {
    background: linear-gradient(135deg, #38bdf8, #3b82f6); color: #041222; border: none;
    border-radius: 11px; padding: 0 16px; font-weight: 700; font-size: 13px; cursor: pointer;
  }
  .empty { font-size: 12.5px; color: var(--muted); text-align: center; padding: 14px 4px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="topbar">
    <div class="brand">
      <div class="brand-icon">G</div>
      <div>
        <h1>GlassDrop</h1>
        <p>Transferencia local segura · GlassIsland</p>
      </div>
    </div>
    <span class="pill">● Red local</span>
  </header>

  <section class="card">
    <div class="section-title">
      <span>Enviar a tu Laptop</span>
      <span style="font-size:10.5px;font-weight:500;text-transform:none">Sin pérdida de calidad</span>
    </div>
    <div id="dropzone" class="dropzone">
      <div class="drop-hint">
        Arrastra y suelta fotos o archivos aquí (pantalla dividida), o elige directamente desde tu galería o carpetas:
      </div>
      <div class="btn-grid">
        <label class="action-btn action-btn--primary">
          <span>🖼️ Galería / Fotos</span>
          <input id="galleryInput" type="file" accept="image/*,video/*" multiple style="display:none" />
        </label>
        <label class="action-btn action-btn--secondary">
          <span>📁 Archivos</span>
          <input id="fileInput" type="file" multiple style="display:none" />
        </label>
      </div>
    </div>
    <div id="progWrap" class="prog-wrap"><div id="progBar" class="prog-bar"></div></div>
    <div id="upStatus" class="status"></div>
  </section>

  <section class="card">
    <div class="section-title">
      <span>Estante de tu Laptop</span>
      <span id="fileCount" style="color:#7dd3fc">0</span>
    </div>
    <div id="fileList" class="list"><div class="empty">Cargando archivos…</div></div>
  </section>

  <section class="card">
    <div class="section-title"><span>Portapapeles instantáneo (Ctrl+V)</span></div>
    <div class="clip-row">
      <input id="clipInput" class="clip-input" placeholder="Pega un enlace o texto para enviarlo a tu PC…" />
      <button id="clipBtn" class="clip-btn" type="button">Enviar</button>
    </div>
    <div id="clipStatus" class="status"></div>
  </section>
</div>
<script>
const TOKEN = ${JSON.stringify(token)};
const dropzone = document.getElementById("dropzone");
const galleryInput = document.getElementById("galleryInput");
const fileInput = document.getElementById("fileInput");
const progWrap = document.getElementById("progWrap");
const progBar = document.getElementById("progBar");
const upStatus = document.getElementById("upStatus");
const fileList = document.getElementById("fileList");
const fileCount = document.getElementById("fileCount");
const clipInput = document.getElementById("clipInput");
const clipBtn = document.getElementById("clipBtn");
const clipStatus = document.getElementById("clipStatus");

function fmtSize(b) {
  if (!b) return "0 B";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}

function extLabel(name) {
  const m = String(name || "").match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : "FILE";
}

async function loadFiles() {
  try {
    const res = await fetch("/api/files?t=" + encodeURIComponent(TOKEN));
    const data = await res.json();
    const files = Array.isArray(data.files) ? data.files : [];
    fileCount.textContent = String(files.length);
    if (files.length === 0) {
      fileList.innerHTML = '<div class="empty">Arrastra archivos al Estante en GlassIsland y aparecerán aquí al instante.</div>';
      return;
    }
    fileList.innerHTML = files.map((f, i) =>
      '<div class="row"><div class="row-left"><div class="ext-badge">' + extLabel(f.name) +
      '</div><div style="min-width:0"><div class="fname">' + f.name.replace(/</g, "&lt;") +
      '</div><div class="fsize">' + fmtSize(f.size_bytes) +
      '</div></div></div><a class="dl-btn" href="/api/download?idx=' + i + '&t=' + encodeURIComponent(TOKEN) + '">Descargar</a></div>'
    ).join("");
  } catch {
    fileList.innerHTML = '<div class="empty">Reconectando con tu laptop…</div>';
  }
}

function uploadSingle(file, idx, total) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload?t=" + encodeURIComponent(TOKEN) + "&name=" + encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round(((idx + ev.loaded / ev.total) / total) * 100);
        progBar.style.width = pct + "%";
        upStatus.textContent = "Enviando (" + (idx + 1) + "/" + total + ") · " + pct + "% — " + file.name;
      }
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

async function handleFiles(fileListObj) {
  const files = Array.from(fileListObj || []);
  if (!files.length) return;
  progWrap.style.display = "block";
  progBar.style.width = "4%";
  let okCount = 0;
  for (let i = 0; i < files.length; i++) {
    const ok = await uploadSingle(files[i], i, files.length);
    if (ok) okCount++;
  }
  progBar.style.width = "100%";
  upStatus.textContent = "✓ " + okCount + " archivo(s) enviados a tu Laptop (Descargas/GlassDrop).";
  setTimeout(() => { progWrap.style.display = "none"; progBar.style.width = "0%"; }, 1800);
  galleryInput.value = "";
  fileInput.value = "";
  loadFiles();
}

galleryInput.addEventListener("change", () => handleFiles(galleryInput.files));
fileInput.addEventListener("change", () => handleFiles(fileInput.files));

["dragenter", "dragover"].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add("over"); });
});
["dragleave", "drop"].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove("over"); });
});
dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    handleFiles(e.dataTransfer.files);
  }
});

window.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.files;
  if (items && items.length) handleFiles(items);
});

clipBtn.addEventListener("click", async () => {
  const text = clipInput.value.trim();
  if (!text) return;
  try {
    const res = await fetch("/api/clip?t=" + encodeURIComponent(TOKEN), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      clipStatus.textContent = "✓ Copiado al portapapeles (Ctrl+V) de tu Laptop.";
      clipInput.value = "";
    }
  } catch {
    clipStatus.textContent = "Error al enviar.";
  }
});

loadFiles();
setInterval(loadFiles, 3000);
</script>
</body>
</html>`;
}

function getCategoryFolder(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (/^\.(jpg|jpeg|png|webp|gif|heic|heif|bmp|svg|avif|ico)$/.test(ext)) return "Imagenes";
  if (/^\.(mp4|mov|mkv|avi|webm|3gp|m4v)$/.test(ext)) return "Videos";
  if (/^\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv|rtf|odt)$/.test(ext)) return "Documentos";
  if (/^\.(mp3|wav|m4a|ogg|flac|aac|opus)$/.test(ext)) return "Audio";
  if (/^\.(zip|rar|7z|tar|gz|bz2)$/.test(ext)) return "Comprimidos";
  if (/^\.(apk|exe|msi|py|js|ts|tsx|jsx|json|html|css|java|cpp|c|cs|sql|sh|ps1)$/.test(ext)) {
    return "Apps_y_Codigo";
  }
  return "Otros";
}

function detectDeviceLabel(ua = "") {
  const s = String(ua || "");
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  const androidModel = s.match(/Android [^;]+;\s*([^)]+)\)/i);
  if (androidModel?.[1]) {
    const clean = androidModel[1].replace(/Build\/.*$/i, "").trim();
    if (clean && clean !== "K") return clean.slice(0, 28);
  }
  if (/Android/i.test(s)) return "Celular Android";
  return "Dispositivo Wi-Fi";
}

function createGlassDropServer({ getShelfFiles, onFileReceived, onClipReceived, onDeviceConnected }) {
  let server = null;
  let token = "";
  let port = 8765;
  let ip = "127.0.0.1";
  let lastDevice = "";
  const downloadDir = path.join(os.homedir(), "Downloads", "GlassDrop");

  function stop() {
    if (server) {
      try {
        server.close();
      } catch {
        // ignore
      }
      server = null;
    }
    return { running: false };
  }

  function buildPublicUrl() {
    // Usar dominio nip.io (resuelve directo a la IP local de tu Wi-Fi) para que CUALQUIER lector QR Android/iOS
    // muestre "Abrir enlace" en 1 toque en lugar de solo "Copiar"
    const host = ip !== "127.0.0.1" ? `${ip}.nip.io` : ip;
    return `http://${host}:${port}/go/${token}`;
  }

  function start() {
    if (server) {
      return Promise.resolve({ running: true, url: buildPublicUrl(), ip, port, token });
    }
    ip = getLocalLanIp();
    token = crypto.randomBytes(3).toString("hex");
    const html = buildMobileHtml(token);

    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        try {
          const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
          const pathTokenMatch = parsed.pathname.match(/^\/go\/([a-f0-9]+)$/i);
          const reqToken = parsed.searchParams.get("t") || pathTokenMatch?.[1] || "";
          if (reqToken !== token) {
            res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Escanea el codigo QR en GlassIsland para conectarte.");
            return;
          }

          if (req.method === "GET" && (parsed.pathname === "/" || Boolean(pathTokenMatch))) {
            const dev = detectDeviceLabel(req.headers["user-agent"]);
            if (dev !== lastDevice) {
              lastDevice = dev;
              onDeviceConnected?.(dev);
            }
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
            return;
          }

          if (req.method === "GET" && parsed.pathname === "/api/files") {
            const files = getShelfFiles().filter((f) => f && f.path && fs.existsSync(f.path));
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ files: files.map((f) => ({ name: f.name, size_bytes: f.size_bytes || 0 })) }));
            return;
          }

          if (req.method === "GET" && parsed.pathname === "/api/download") {
            const idx = Number(parsed.searchParams.get("idx"));
            const files = getShelfFiles().filter((f) => f && f.path && fs.existsSync(f.path));
            const target = files[idx];
            if (!target) {
              res.writeHead(404);
              res.end("Not found");
              return;
            }
            const stat = fs.statSync(target.path);
            const safeName = path.basename(target.name).replace(/["\r\n]/g, "_");
            res.writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Length": stat.size,
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
            });
            fs.createReadStream(target.path).pipe(res);
            return;
          }

          if (req.method === "POST" && parsed.pathname === "/api/upload") {
            const rawName = parsed.searchParams.get("name") || `archivo_${Date.now()}`;
            const safeBase = path
              .basename(rawName)
              .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
              .slice(0, 140) || `archivo_${Date.now()}`;
            const category = getCategoryFolder(safeBase);
            const categoryDir = path.join(downloadDir, category);
            fs.mkdirSync(categoryDir, { recursive: true });
            let dest = path.join(categoryDir, safeBase);
            if (fs.existsSync(dest)) {
              const ext = path.extname(safeBase);
              const stem = path.basename(safeBase, ext);
              dest = path.join(categoryDir, `${stem}_${Date.now().toString().slice(-4)}${ext}`);
            }
            const ws = fs.createWriteStream(dest);
            let totalBytes = 0;
            req.on("data", (chunk) => {
              totalBytes += chunk.length;
            });
            req.pipe(ws);
            ws.on("finish", () => {
              const finalName = path.basename(dest);
              onFileReceived?.({
                path: dest,
                name: finalName,
                size_bytes: totalBytes,
                category,
                folder: categoryDir,
              });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, name: finalName, size_bytes: totalBytes, category }));
            });
            ws.on("error", () => {
              res.writeHead(500);
              res.end(JSON.stringify({ ok: false }));
            });
            return;
          }

          if (req.method === "POST" && parsed.pathname === "/api/clip") {
            let body = "";
            req.setEncoding("utf8");
            req.on("data", (c) => {
              if (body.length < 200_000) body += c;
            });
            req.on("end", () => {
              try {
                const { text } = JSON.parse(body || "{}");
                if (typeof text === "string" && text.trim()) {
                  onClipReceived?.(text.trim());
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
              } catch {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false }));
              }
            });
            return;
          }

          res.writeHead(404);
          res.end("Not found");
        } catch {
          res.writeHead(500);
          res.end("Error");
        }
      });

      const listenOn = (p) => {
        srv.once("error", () => {
          if (p === 8765) listenOn(0);
          else resolve({ running: false, error: "port_busy" });
        });
        srv.listen(p, "0.0.0.0", () => {
          server = srv;
          const addr = srv.address();
          port = typeof addr === "object" && addr ? addr.port : p;
          resolve({ running: true, url: buildPublicUrl(), ip, port, token });
        });
      };
      listenOn(8765);
    });
  }

  function getDownloadDir() {
    fs.mkdirSync(downloadDir, { recursive: true });
    return downloadDir;
  }

  return { start, stop, getDownloadDir };
}

module.exports = { createGlassDropServer };
