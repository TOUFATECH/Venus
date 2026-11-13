// Journal du serveur visible dans le tableau de bord : les 2 000 dernières lignes de la console,
// avec leur niveau. Les jetons et mots de passe éventuels sont masqués.
const lines = [];
const MAX = 2000;
// Masque les mots de passe et jetons dans les lignes du journal
const mask = (s) => String(s)
  .replace(/([?&](?:token|password|pass|apikey|api_key|key)=)[^&\s"]+/gi, '$1•••')
  .replace(/(Bearer\s+)[\w.-]{16,}/gi, '$1•••')
  .replace(/("(?:password|pass|token|smtp_pass|apiKey)"\s*:\s*")[^"]*"/gi, '$1•••"');
// Ajoute une ligne au journal en mémoire
function push(level, args) {
  const text = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack || ''}` : typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch { return String(a); } })() : String(a))).join(' ');
  lines.push({ at: Date.now(), level, text: mask(text).slice(0, 4000) });
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}
let installed = false;
// Copie la console dans le journal visible du tableau de bord
export function installLogBuffer() {
  if (installed) return;
  installed = true;
  for (const [m, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
    const orig = console[m].bind(console);
    console[m] = (...args) => { push(level, args); orig(...args); };
  }
}
// Lignes du journal filtrées par niveau et par texte
export function logLines({ level = 'all', q = '', limit = 500 } = {}) {
  const needle = String(q || '').toLowerCase();
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const l = lines[i];
    if (level === 'warn' && l.level === 'info') continue;
    if (level === 'error' && l.level !== 'error') continue;
    if (needle && !l.text.toLowerCase().includes(needle)) continue;
    out.push(l);
  }
  return out;
}
// Journal complet en texte (téléchargement)
export const logText = () => lines.map((l) => `${new Date(l.at).toISOString()} [${l.level}] ${l.text}`).join('\n');

installLogBuffer(); // dès le chargement : les premières lignes du démarrage sont gardées aussi
