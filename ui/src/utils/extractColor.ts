/**
 * Extrae el color de marca dominante [r, g, b] y #hex de un dataURL PNG
 * (ícono oficial de una app .exe), priorizando tonos vivos/saturados sobre
 * fondos blancos, negros o grises.
 */
export function extractBrandColorFromIcon(
  dataUrl: string,
): Promise<{ rgb: [number, number, number]; hex: string }> {
  const fallback: { rgb: [number, number, number]; hex: string } = {
    rgb: [234, 118, 42],
    hex: "#ea762a",
  };
  if (!dataUrl) return Promise.resolve(fallback);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(fallback);
          return;
        }
        ctx.drawImage(img, 0, 0, 24, 24);
        const { data } = ctx.getImageData(0, 0, 24, 24);
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let wSum = 0;

        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 140) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (r + g + b) / 3;
          // Ignora blanco/negro puros
          if (lum < 24 || lum > 242) continue;
          const weight = 0.25 + sat * 4.5;
          rSum += r * weight;
          gSum += g * weight;
          bSum += b * weight;
          wSum += weight;
        }

        if (wSum <= 0) {
          resolve(fallback);
          return;
        }
        const r = Math.min(255, Math.max(30, Math.round(rSum / wSum)));
        const g = Math.min(255, Math.max(30, Math.round(gSum / wSum)));
        const b = Math.min(255, Math.max(30, Math.round(bSum / wSum)));
        const hex =
          "#" +
          [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
        resolve({ rgb: [r, g, b], hex });
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = dataUrl;
  });
}
