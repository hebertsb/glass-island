import { useEffect, useRef } from "react";

interface LiquidGlassProps {
  /** Color RGB objetivo [0-255, 0-255, 0-255] que tiñe el cristal adaptativo */
  targetRgb: [number, number, number];
  /** Si está en modo reposo (menos brillo) o activo */
  quiet?: boolean;
}

/**
 * Motor visual Adaptive Liquid Glass inspirado directamente en el algoritmo del
 * video de referencia: interpolación exponencial frame-independent (`1 - 0.94^(dt/16.7)`)
 * y gradiente radial ascendente (`h * 1.32`) simulando luz atravesando vidrio.
 */
export default function LiquidGlass({
  targetRgb,
  quiet = false,
}: LiquidGlassProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<[number, number, number]>(targetRgb);
  const quietRef = useRef<boolean>(quiet);

  targetRef.current = targetRgb;
  quietRef.current = quiet;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let lastTime = performance.now();
    let rgb: [number, number, number] = [...targetRef.current];
    let glow = quietRef.current ? 0.45 : 1.0;

    const render = (now: number) => {
      const dt = Math.min(50, Math.max(1, now - lastTime));
      lastTime = now;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      // Algoritmo exacto de suavizado adaptativo del video
      const k = 1 - Math.pow(0.94, dt / 16.7);
      const tgt = targetRef.current;
      rgb = [
        rgb[0] + (tgt[0] - rgb[0]) * k,
        rgb[1] + (tgt[1] - rgb[1]) * k,
        rgb[2] + (tgt[2] - rgb[2]) * k,
      ];
      const desiredGlow = quietRef.current ? 0.45 : 1.0;
      glow += (desiredGlow - glow) * k;

      ctx.clearRect(0, 0, w, h);

      // Base de vidrio ahumado oscuro
      ctx.fillStyle = "rgba(12, 15, 22, 0.92)";
      ctx.fillRect(0, 0, w, h);

      // Luz radial ascendente atravesando el cristal
      const cx = w * 0.5;
      const rad = Math.max(w, h) * 0.92;
      const wp = ctx.createRadialGradient(cx, h * 1.32, 0, cx, h * 1.32, rad);
      const r = Math.round(rgb[0]);
      const g = Math.round(rgb[1]);
      const b = Math.round(rgb[2]);
      wp.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(0.58 * glow).toFixed(3)})`);
      wp.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${(0.18 * glow).toFixed(3)})`);
      wp.addColorStop(1, "rgba(12, 15, 22, 0)");
      ctx.fillStyle = wp;
      ctx.fillRect(0, 0, w, h);

      // Reflejo especular superior sutil (efecto vidrio biselado)
      const spec = ctx.createLinearGradient(0, 0, 0, h * 0.42);
      spec.addColorStop(0, "rgba(255, 255, 255, 0.11)");
      spec.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = spec;
      ctx.fillRect(0, 0, w, h * 0.42);

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return <canvas ref={canvasRef} className="island-glass-canvas" aria-hidden="true" />;
}
