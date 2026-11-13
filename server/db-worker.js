// Fil à part qui parle à PostgreSQL : le fil principal de Venus attend sa réponse (Atomics.wait), ce qui garde
// l'usage simple de la base partout dans Venus (all / get / run), comme avant.
import { workerData } from 'node:worker_threads';
import { Pg } from './pg.js';

const { sab, port, conf } = workerData;
const flag = new Int32Array(sab);
let pg = null;
const known = new Set(), typed = new Set();
const send = (m, id) => { port.postMessage({ ...m, id }); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
async function conn() { if (!pg || pg.closed) pg = await Pg.connect({ ...conf, app: 'venus', timeoutMs: 15000 }); return pg; }
const typesOf = (params) => params.map((v) => (typeof v === 'number' ? (Number.isInteger(v) ? 20 : 701) : typeof v === 'boolean' ? 20 : typeof v === 'bigint' ? 20 : v && (Buffer.isBuffer(v) || v instanceof Uint8Array) ? 17 : 25));
const norm = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

port.on('message', async (m) => {
  const reply = (x) => send(x, m.id);
  try {
    const c = await conn();
    if (m.op === 'simple') { const r = await c.simple(m.sql); return reply({ ok: true, count: r.at(-1)?.count ?? 0 }); }
    const params = norm(m.params || []);
    let r;
    // Dans une transaction, une erreur annule tout : la première fois qu'une requête passe, on la protège
    const guard = m.tx && !known.has(m.sql);
    try { if (guard) await c.simple('SAVEPOINT venus_q'); r = await c.query(m.sql, params, typed.has(m.sql) ? typesOf(params) : []); if (guard) await c.simple('RELEASE SAVEPOINT venus_q'); known.add(m.sql); }
    catch (e) {
      if (guard) await c.simple('ROLLBACK TO SAVEPOINT venus_q');
      // Type d'un paramètre impossible à deviner (« ? IS NULL », valeur seule dans un SELECT) : on le précise
      if (e.code === '42P18' || e.code === '42804' || e.code === '42883' || e.code === '42725') { r = await c.query(m.sql, params, typesOf(params)); typed.add(m.sql); }
      // Valeur qui ne peut pas être de ce type (ex. du texte comparé à un nombre) : en lecture, aucun résultat
      else if (e.code === '22P02' && /^\s*(SELECT|WITH)\b/i.test(m.sql)) r = { fields: [], rows: [], count: 0 };
      else throw e;
    }
    reply({ ok: true, fields: r.fields.map((f) => [f.name, f.type]), rows: r.rows, count: r.count });
  } catch (e) {
    if (/fermée|ECONNRESET|EPIPE/.test(e.message)) pg = null;
    reply({ ok: false, error: { message: e.message, code: e.code || '', detail: e.detail || '' } });
  }
});
