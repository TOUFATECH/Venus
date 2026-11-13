// Traduction du SQL de Venus vers PostgreSQL (pur, testé). Venus garde ses requêtes telles quelles ;
// cette couche les adapte : paramètres « ? » → $1, $2…, types des colonnes, clés auto-incrémentées,
// INSERT OR IGNORE / OR REPLACE, IFNULL, MAX(a, b) à deux valeurs, LIKE sans tenir compte des majuscules, etc.

/** Découpe le SQL en morceaux : texte, chaînes '…', noms "…", commentaires. */
function chunks(sql) {
  const out = []; let i = 0, cur = '';
  const push = (kind, v) => { if (cur) { out.push({ kind: 'code', v: cur }); cur = ''; } out.push({ kind, v }); };
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") j += 2; else if (sql[j] === "'") break; else j++; } push('str', sql.slice(i, j + 1)); i = j + 1; continue; }
    if (c === '"') { const j = sql.indexOf('"', i + 1); push('ident', sql.slice(i, j < 0 ? sql.length : j + 1)); i = j < 0 ? sql.length : j + 1; continue; }
    if (c === '-' && sql[i + 1] === '-') { const j = sql.indexOf('\n', i); push('comment', sql.slice(i, j < 0 ? sql.length : j)); i = j < 0 ? sql.length : j; continue; }
    if (c === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); push('comment', sql.slice(i, j < 0 ? sql.length : j + 2)); i = j < 0 ? sql.length : j + 2; continue; }
    cur += c; i++;
  }
  if (cur) out.push({ kind: 'code', v: cur });
  return out;
}
/** Découpe en instructions sur « ; » (hors chaînes). */
export function statements(sql) {
  const out = []; let cur = '';
  for (const ch of chunks(sql)) {
    if (ch.kind !== 'code') { cur += ch.v; continue; }
    const parts = ch.v.split(';');
    for (let k = 0; k < parts.length; k++) { cur += parts[k]; if (k < parts.length - 1) { if (cur.trim()) out.push(cur.trim()); cur = ''; } }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Remplace dans le code seulement (jamais dans les chaînes). */
const onCode = (sql, f) => chunks(sql).map((c) => (c.kind === 'code' ? f(c.v) : c.kind === 'comment' ? ' ' : c.v)).join('');

/** Les arguments de premier niveau d'un appel « name( … ) » à partir de l'index de la parenthèse. */
function callArgs(s, open) {
  let depth = 0, start = open + 1; const args = [];
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { i++; while (i < s.length && !(s[i] === "'" && s[i + 1] !== "'")) { if (s[i] === "'" ) i++; i++; } continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { args.push(s.slice(start, i)); return { args, end: i }; } }
    else if (c === ',' && depth === 1) { args.push(s.slice(start, i)); start = i + 1; }
  }
  return null;
}
/** MAX(a, b) / MIN(a, b) (valeurs, pas agrégats) → GREATEST / LEAST ; ROUND(x, n) → ROUND((x)::numeric, n). */
function rewriteCalls(s) {
  const re = /\b(MAX|MIN|ROUND|SUM|DATE)\s*\(/gi; let m, out = '', last = 0;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1, c = callArgs(s, open); if (!c) continue;
    const name = m[1].toUpperCase(), inner = c.args.map((a) => rewriteCalls(a));
    let rep = null;
    if (name === 'DATE' && c.args.length === 2 && /^\s*'unixepoch'\s*$/i.test(c.args[1])) rep = `to_char(to_timestamp(${inner[0]}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    else if (name === 'SUM' && c.args.length === 1 && /(<>|!=|<=|>=|[=<>]|\bIS\b|\bIN\s*\(|\bLIKE\b|\bBETWEEN\b)/i.test(c.args[0]) && !/^\s*CASE\b/i.test(c.args[0])) rep = `SUM(CASE WHEN ${inner[0]} THEN 1 ELSE 0 END)`;
    else if ((name === 'MAX' || name === 'MIN') && c.args.length >= 2) rep = `${name === 'MAX' ? 'GREATEST' : 'LEAST'}(${inner.join(',')})`;
    else if (name === 'ROUND' && c.args.length === 2) rep = `ROUND((${inner[0]})::numeric,${inner[1]})::float8`;
    else if (name === 'ROUND' && c.args.length === 1) rep = `ROUND((${inner[0]})::numeric)::float8`;
    if (rep) { out += s.slice(last, m.index) + rep; last = c.end + 1; re.lastIndex = c.end + 1; }
  }
  return out + s.slice(last);
}

const TYPE = (t) => {
  const u = t.toUpperCase();
  if (/^INT|INTEGER|BIGINT|SMALLINT|TINYINT/.test(u)) return 'BIGINT';
  if (/REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL/.test(u)) return 'DOUBLE PRECISION';
  if (/BLOB/.test(u)) return 'BYTEA';
  if (/BOOL/.test(u)) return 'BIGINT';
  return 'TEXT';
};
/** CREATE TABLE : types, clé auto-incrémentée ; renvoie aussi la clé primaire et la colonne « identité ». */
function createTable(st, schema) {
  const m = /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?)\s*\(([\s\S]*)\)\s*(WITHOUT\s+ROWID)?\s*$/i.exec(st); if (!m) return st;
  const table = m[2].replace(/"/g, '').toLowerCase(), body = m[3];
  const parts = []; let depth = 0, cur = '';
  for (const ch of chunks(body)) {
    if (ch.kind !== 'code') { cur += ch.v; continue; }
    for (const c of ch.v) { if (c === '(') depth++; if (c === ')') depth--; if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c; }
  }
  if (cur.trim()) parts.push(cur);
  let pk = null, identity = null; const cols = [];
  const defs = parts.map((p) => {
    const d = p.trim();
    const tpk = /^PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(d); if (tpk) { pk = tpk[1].split(',').map((x) => x.trim().replace(/"/g, '').toLowerCase()); return d; }
    if (/^(UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(d)) return d;
    const cm = /^("?\w+"?)\s*([A-Za-z]+(?:\s*\([^)]*\))?)?([\s\S]*)$/.exec(d); if (!cm) return d;
    const name = cm[1].replace(/"/g, '').toLowerCase(); cols.push(name);
    let rest = cm[3] ?? '', type = cm[2] ? TYPE(cm[2]) : 'TEXT';
    if (/^\s*PRIMARY\s+KEY/i.test(rest) && /INT/i.test(cm[2] ?? '')) { identity = name; pk = [name]; rest = rest.replace(/PRIMARY\s+KEY(\s+AUTOINCREMENT)?/i, 'GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY'); }
    else if (/PRIMARY\s+KEY/i.test(rest)) pk = [name];
    rest = rest.replace(/\bAUTOINCREMENT\b/ig, '').replace(/\bCOLLATE\s+NOCASE\b/ig, '');
    return `${cm[1]} ${type}${rest}`;
  });
  schema?.set(table, { pk: pk ?? [], identity, cols });
  return `CREATE TABLE ${m[1] ?? ''}${m[2]} (${defs.join(', ')})`;
}

/**
 * Traduit une instruction. schema : Map table → { pk, identity, cols } (rempli par les CREATE TABLE).
 * Renvoie { sql, kind: 'pragma'|'skip'|'sql', returning?: nom de la clé rendue par un INSERT }.
 */
export function translate(sqlIn, schema = new Map()) {
  let sql = sqlIn.trim().replace(/;\s*$/, '');
  if (/^PRAGMA\b/i.test(sql)) {
    const ti = /^PRAGMA\s+table_info\s*\(\s*"?(\w+)"?\s*\)/i.exec(sql);
    if (ti) return { kind: 'sql', sql: `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${ti[1].toLowerCase()}' ORDER BY ordinal_position` };
    return { kind: 'skip', sql: '' };
  }
  if (/^(BEGIN|COMMIT|ROLLBACK|END)(\s+TRANSACTION)?$/i.test(sql)) return { kind: 'sql', sql: sql.replace(/^END/i, 'COMMIT') };
  if (/^VACUUM\b|^ANALYZE\b|^REINDEX\b/i.test(sql)) return { kind: 'skip', sql: '' };
  if (/^CREATE\s+TABLE/i.test(sql)) return { kind: 'sql', sql: createTable(sql, schema) };
  if (/^ALTER\s+TABLE/i.test(sql)) {
    return { kind: 'sql', sql: sql.replace(/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)("?\w+"?)\s+(\w+)/i, (_a, c, t) => {
      const tb = /^ALTER\s+TABLE\s+"?(\w+)"?/i.exec(sql)?.[1]?.toLowerCase(); const s = tb && schema.get(tb); if (s && !s.cols.includes(c.replace(/"/g, '').toLowerCase())) s.cols.push(c.replace(/"/g, '').toLowerCase());
      return `ADD COLUMN IF NOT EXISTS ${c} ${TYPE(t)}`;
    }) };
  }
  // Paramètres ? → $n (dans le code seulement)
  let n = 0; sql = onCode(sql, (c) => c.replace(/\?(\d+)?/g, (_m, k) => (k ? `$${k}` : `$${++n}`)));
  let returning = null, conflict = '';
  const ins = /^(INSERT|REPLACE)(\s+OR\s+(IGNORE|REPLACE))?\s+INTO\s+"?(\w+)"?\s*(\(([^)]*)\))?/i.exec(sql);
  if (ins) {
    const table = ins[4].toLowerCase(), s = schema.get(table), mode = ins[1].toUpperCase() === 'REPLACE' ? 'REPLACE' : (ins[3] || '').toUpperCase();
    const cols = ins[6] ? ins[6].split(',').map((x) => x.trim().replace(/"/g, '').toLowerCase()) : s?.cols ?? [];
    sql = sql.replace(/^(INSERT|REPLACE)(\s+OR\s+(IGNORE|REPLACE))?\s+INTO/i, 'INSERT INTO');
    if (mode === 'IGNORE' && !/\bON\s+CONFLICT\b/i.test(sql)) conflict = ' ON CONFLICT DO NOTHING';
    if (mode === 'REPLACE' && !/\bON\s+CONFLICT\b/i.test(sql)) {
      const pk = s?.pk?.length ? s.pk : [cols[0]], upd = cols.filter((c) => !pk.includes(c));
      conflict = ` ON CONFLICT (${pk.join(', ')}) ${upd.length ? `DO UPDATE SET ${upd.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}` : 'DO NOTHING'}`;
    }
    if (s?.identity && !/\bRETURNING\b/i.test(sql)) returning = s.identity;
  }
  sql = onCode(sql, (c) => {
    let x = c.replace(/\bIFNULL\s*\(/gi, 'COALESCE(').replace(/\bINSTR\s*\(/gi, 'STRPOS(').replace(/\bTOTAL\s*\(/gi, 'SUM(')
      .replace(/\b(NOT\s+)?LIKE\b/gi, (_m, not) => `${not ?? ''}ILIKE`).replace(/\bAS\s+INTEGER\b/gi, 'AS BIGINT').replace(/\bAS\s+REAL\b/gi, 'AS DOUBLE PRECISION')
      .replace(/(^|[^=!<>])==(?!=)/g, '$1=').replace(/\bLIMIT\s+-1\b/gi, 'LIMIT ALL').replace(/\bRANDOM\s*\(\s*\)/gi, 'random()')
      .replace(/\bCOLLATE\s+NOCASE\b/gi, '')
      // Les noms en camelCase (« AS itemId ») : PostgreSQL les mettrait en minuscules → entre guillemets
      .replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, (m, n) => (/[a-z]/.test(n) && /[A-Z]/.test(n) ? `AS "${n}"` : m))
      .replace(/\bIS\s+NOT\s+(?!NULL\b|TRUE\b|FALSE\b|DISTINCT\b)/gi, 'IS DISTINCT FROM ').replace(/\bIS\s+(?!NOT\b|NULL\b|TRUE\b|FALSE\b|DISTINCT\b)/gi, 'IS NOT DISTINCT FROM ');
    return x;
  });
  sql = rewriteCalls(sql); // sur tout le texte : les appels peuvent contenir des chaînes ('unixepoch')
  // ON CONFLICT … DO UPDATE SET col = f(col) : « col » seul est ambigu pour PostgreSQL → table.col
  if (ins && /\bDO\s+UPDATE\s+SET\b/i.test(sql)) {
    const table = ins[4].toLowerCase(), cols = schema.get(table)?.cols ?? [];
    const k = sql.search(/\bDO\s+UPDATE\s+SET\b/i), head = sql.slice(0, k), tail = sql.slice(k);
    const fixed = onCode(tail, (c) => c.replace(/(?<![.\w"$])([a-z_][a-z0-9_]*)\b(?!\s*\()(?!\s*=(?!=))/g, (w, id) => (cols.includes(id) ? `${table}.${id}` : w)));
    sql = head + fixed;
  }
  if (conflict) {
    // Avant un RETURNING éventuel
    const r = /\bRETURNING\b[\s\S]*$/i.exec(sql); sql = r ? `${sql.slice(0, r.index)}${conflict} ${r[0]}` : `${sql}${conflict}`;
  }
  if (returning) sql += ` RETURNING ${returning}`;
  return { kind: 'sql', sql, returning, params: n };
}

/** Les types PostgreSQL → valeurs JavaScript comme celles de SQLite (nombres, texte, Buffer). */
export function decode(type, v) {
  if (v === null) return null;
  switch (type) {
    case 20: case 21: case 23: case 26: { const n = Number(v); return Number.isSafeInteger(n) ? n : v; }
    case 700: case 701: case 1700: return Number(v);
    case 16: return v === 't' ? 1 : 0;
    case 17: return Buffer.from(v.slice(2), 'hex');
    default: return v;
  }
}
