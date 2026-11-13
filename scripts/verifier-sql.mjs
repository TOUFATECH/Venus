// Vérifie tout le SQL de Venus contre PostgreSQL (sans rien exécuter) : chaque requête écrite dans le code est
// traduite (sql-pg.js) puis préparée par PostgreSQL, qui signale fonctions inconnues, types, GROUP BY, etc.
// node scripts/verifier-sql.mjs   (VENUS_DATABASE_URL vers une base où Venus a déjà démarré une fois)
import fs from 'node:fs';
import path from 'node:path';
import { Pg } from '../server/pg.js';
import { translate } from '../server/sql-pg.js';

const url = new URL(process.env.VENUS_DATABASE_URL);
const pg = await Pg.connect({ host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) });
// Les tables (pour INSERT OR REPLACE, RETURNING)
const schema = new Map();
for (const r of (await pg.query(`SELECT c.table_name, c.column_name, c.is_identity, (SELECT array_to_string(array_agg(k.column_name::text ORDER BY k.ordinal_position), ',') FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name WHERE tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY') FROM information_schema.columns c WHERE c.table_schema = current_schema()`)).rows) {
  const s = schema.get(r[0]) || { pk: r[3] ? r[3].split(',') : [], identity: null, cols: [] }; s.cols.push(r[1]); if (r[2] === 'YES') s.identity = r[1]; schema.set(r[0], s);
}
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'server');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !['sql-pg.js', 'pg.js', 'db-worker.js'].includes(f));
let n = 0, bad = 0, dyn = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of src.matchAll(/(['"`])((?:SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE)\b(?:\\.|(?!\1)[\s\S])*?)\1/g)) {
    let sql = m[2];
    if (!/\b(FROM|INTO|SET|VALUES)\b/i.test(sql)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const isDyn = /\$\{/.test(sql);
    sql = sql.replace(/\$\{[^}]*\}/g, 'NULL').replace(/\\'/g, "'").replace(/\\n/g, ' ');
    const t = translate(sql, schema); if (t.kind !== 'sql' || !t.sql) continue;
    n++;
    try { await pg.simple('BEGIN'); await pg.query(`PREPARE venus_chk AS ${t.sql}`); }
    catch (e) {
      if (isDyn) dyn++; else bad++;
      if (!isDyn || process.env.TOUT) console.log(`${isDyn ? '~' : '✗'} ${f}:${line} [${e.code}] ${e.message}\n    ${t.sql.replace(/\s+/g, ' ').slice(0, 300)}`);
    } finally { await pg.simple('ROLLBACK').catch(() => {}); await pg.simple('DEALLOCATE ALL').catch(() => {}); }
  }
}
console.log(`\n${n} requêtes vérifiées · ${bad} en erreur · ${dyn} dynamiques en erreur (à vérifier en vrai)`);
await pg.close();
process.exit(bad ? 1 : 0);
