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
<title>GlassDrop · GlassIsland</title>
<style>
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body {
    margin: 0; min-height: 100vh; color: #f8fafc; padding: 18px 14px 36px;
    background: radial-gradient(circle at top, #1e293b 0%, #090d16 70%);
  }
  .wrap { max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  .header { display: flex; align-items: center; justify-content: space-between; }
  .badge { font-size: 11px; padding: 4px 10px; border-radius: 999px; background: rgba(56,189,248,0.18); border: 1px solid rgba(56,189,248,0.4); color: #7dd3fc; font-weight: 600; }
  .card {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.13);
    border-radius: 18px; padding: 15px; backdrop-filter: blur(18px);
  }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.02em; }
  h2 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; }
  .upload-btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 15px; border-radius: 14px; border: 1.5px dashed rgba(56,189,248,0.55);
    background: rgba(56,189,248,0.14); color: #fff; font-size: 15px; font-weight: 700; cursor: pointer;
  }
  .upload-btn:active { transform: scale(0.98); }
  .status { margin-top: 8px; font-size: 12.5px; color: #7dd3fc; min-height: 18px; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    background: rgba(15,23,42,0.55); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px; padding: 10px 12px;
  }
  .fname { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fsize { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .dl-btn {
    text-decoration: none; background: #fff; color: #0f172a; font-weight: 700;
    font-size: 12px; padding: 7px 12px; border-radius: 999px; flex-shrink: 0;
  }
  .clip-row { display: flex; gap: 8px; }
  .clip-input {
    flex: 1; background: rgba(15,23,42,0.7); border: 1px solid rgba(255,255,255,0.18);
    border-radius: 12px; padding: 10px 12px; color: #fff; font-size: 13.5px; outline: none;
  }
  .clip-btn {
    background: #38bdf8; color: #082f49; border: none; border-radius: 12px;
    padding: 0 14px; font-weight: 700; font-size: 13px; cursor: pointer;
  }
  .empty { font-size: 13px; color: #94a3b8; text-align: center; padding: 12px 0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>🏝️ GlassDrop</h1>
    <span class="badge">● Wi-Fi Directo</span>
  </div>

  <div class="card">
    <h2>📤 Enviar a mi Laptop</h2>
    <label class="upload-btn">
      <span>Seleccionar fotos, videos o archivos</span>
      <input id="fileInput" type="file" multiple style="display:none" />
    </label>
    <div id="upStatus" class="status"></div>
  </div>

  <div class="card">
    <h2>📥 Archivos en el Estante de tu Laptop</h2>
    <div id="fileList" class="list"><div class="empty">Cargando…</div></div>
  </div>

  <div class="card">
    <h2>📋 Enviar texto / link al portapapeles</h2>
    <div class="clip-row">
      <input id="clipInput" class="clip-input" placeholder="Pega un enlace o texto…" />
      <button id="clipBtn" class="clip-btn" type="button">Enviar</button>
    </div>
    <div id="clipStatus" class="status"></div>
  </div>
</div>
<script>
const TOKEN = ${JSON.stringify(token)};
const fileInput = document.getElementById("fileInput");
const upStatus = document.getElementById("upStatus");
const fileList = document.getElementById("fileList");
const clipInput = document.getElementById("clipInput");
const clipBtn = document.getElementById("clipBtn");
const clipStatus = document.getElementById("clipStatus");

function fmtSize(b) {
  if (!b) return "0 B";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}

async function loadFiles() {
  try {
    const res = await fetch("/api/files?t=" + encodeURIComponent(TOKEN));
    const data = await res.json();
    const files = Array.isArray(data.files) ? data.files : [];
    if (files.length === 0) {
      fileList.innerHTML = '<div class="empty">Arrastra archivos al Estante en tu laptop y aparecerán aquí al instante.</div>';
      return;
    }
    fileList.innerHTML = files.map((f, i) =>
      '<div class="row"><div style="min-width:0"><div class="fname">📄 ' +
      f.name.replace(/</g, "&lt;") +
      '</div><div class="fsize">' + fmtSize(f.size_bytes) +
      '</div></div><a class="dl-btn" href="/api/download?idx=' + i + '&t=' + encodeURIComponent(TOKEN) + '">Descargar</a></div>'
    ).join("");
  } catch {
    fileList.innerHTML = '<div class="empty">Reconectando con tu laptop…</div>';
  }
}

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;
  let okCount = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    upStatus.textContent = "Enviando (" + (i + 1) + "/" + files.length + "): " + f.name + "…";
    try {
      const res = await fetch("/api/upload?t=" + encodeURIComponent(TOKEN) + "&name=" + encodeURIComponent(f.name), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: f,
      });
      if (res.ok) okCount++;
    } catch {}
  }
  upStatus.textContent = "✓ " + okCount + " archivo(s) enviados a tu Laptop (Descargas/GlassDrop).";
  fileInput.value = "";
  loadFiles();
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

function createGlassDropServer({ getShelfFiles, onFileReceived, onClipReceived }) {
  let server = null;
  let token = "";
  let port = 8765;
  let ip = "127.0.0.1";
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

  function start() {
    if (server) {
      const url = `http://${ip}:${port}/?t=${token}`;
      return Promise.resolve({ running: true, url, ip, port, token });
    }
    ip = getLocalLanIp();
    token = crypto.randomBytes(3).toString("hex");
    const html = buildMobileHtml(token);

    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        try {
          const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
          const reqToken = parsed.searchParams.get("t") || "";
          if (reqToken !== token) {
            res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Escanea el codigo QR en GlassIsland para conectarte.");
            return;
          }

          if (req.method === "GET" && parsed.pathname === "/") {
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
            fs.mkdirSync(downloadDir, { recursive: true });
            let dest = path.join(downloadDir, safeBase);
            if (fs.existsSync(dest)) {
              const ext = path.extname(safeBase);
              const stem = path.basename(safeBase, ext);
              dest = path.join(downloadDir, `${stem}_${Date.now().toString().slice(-4)}${ext}`);
            }
            const ws = fs.createWriteStream(dest);
            let totalBytes = 0;
            req.on("data", (chunk) => {
              totalBytes += chunk.length;
            });
            req.pipe(ws);
            ws.on("finish", () => {
              const finalName = path.basename(dest);
              onFileReceived?.({ path: dest, name: finalName, size_bytes: totalBytes });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, name: finalName, size_bytes: totalBytes }));
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
          const url = `http://${ip}:${port}/?t=${token}`;
          resolve({ running: true, url, ip, port, token });
        });
      };
      listenOn(8765);
    });
  }

  return { start, stop };
}

module.exports = { createGlassDropServer };
