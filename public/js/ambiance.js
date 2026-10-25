// Mode Ambiance : la lumière du film déborde autour de l'image, et l'interface prend la couleur de chaque titre.
const cache = new Map();

// Couleur dominante (vive) d'une image, calculée sur une miniature 24×24
export function dominantColor(src) {
  if (!src) return Promise.resolve(null);
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 24; c.height = 24;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(im, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
          const sat = max ? (max - min) / max : 0;
          const light = max / 255;
          const weight = 0.15 + sat * 2 * (light > 0.12 ? 1 : 0.2); // privilégie les couleurs vives
          r += d[i] * weight; g += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
        }
        resolve(w ? [r / w, g / w, b / w].map(Math.round) : null);
      } catch { resolve(null); }
    };
    im.onerror = () => resolve(null);
    im.src = src;
  });
  cache.set(src, p);
  return p;
}

// Teinte globale de l'interface (fond, halos) — transition douce gérée en CSS
export async function tintFrom(src) {
  const rgb = await dominantColor(src);
  if (!rgb) return;
  // On ramène la couleur à une luminosité utilisable sur fond nuit
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b, 1);
  const k = Math.min(1.6, 200 / max);
  document.documentElement.style.setProperty('--tint', `rgb(${Math.round(r * k)} ${Math.round(g * k)} ${Math.round(b * k)})`);
}
export function clearTint() { document.documentElement.style.removeProperty('--tint'); }

// Halo lumineux autour de la vidéo (façon Ambilight) : 32×18 pixels, agrandis et floutés en CSS
export function ambilight(video, canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = 32; canvas.height = 18;
  let raf = 0, last = 0, stopped = false;
  const loop = (t) => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (t - last < 120 || video.paused && last) return; // ~8 images/s suffisent, et rien en pause
    last = t;
    if (video.readyState >= 2) { try { ctx.drawImage(video, 0, 0, 32, 18); } catch { /* image indisponible */ } }
  };
  raf = requestAnimationFrame(loop);
  return () => { stopped = true; cancelAnimationFrame(raf); ctx.clearRect(0, 0, 32, 18); };
}

export const ambianceOn = {
  get() { try { return localStorage.getItem('vn_ambiance') !== '0'; } catch { return true; } },
  set(v) { try { localStorage.setItem('vn_ambiance', v ? '1' : '0'); } catch { /* */ } },
};
