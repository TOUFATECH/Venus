// Outils communs : chaque test échoue si la page a levé une erreur JavaScript ou écrit une erreur en console.
import fs from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { STATE, PASSWORD, PIN } from './global-setup.mjs';

export { expect, PASSWORD, PIN };
export const etat = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
/** La base PostgreSQL du Venus des tests, avec le même SQL que Venus (traduit) : await base().get(sql, …) */
export async function baseVenus() {
  const { Pg } = await import('../../server/pg.js'), { translate } = await import('../../server/sql-pg.js');
  const u = new URL(etat().pgUrl), pg = await Pg.connect({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) });
  const q = async (sql, p) => { const r = await pg.query(translate(sql).sql, p.map((v) => (v === undefined ? null : v))); return r.rows.map((row) => Object.fromEntries(r.fields.map((f, i) => [f.name, row[i] === null ? null : [20, 21, 23, 700, 701].includes(f.type) ? Number(row[i]) : row[i]]))); };
  return { all: (sql, ...p) => q(sql, p), get: async (sql, ...p) => (await q(sql, p))[0], run: (sql, ...p) => q(sql, p), close: () => pg.close() };
}

// Messages attendus, sans rapport avec une panne de l'interface
const BRUIT = [/Failed to load resource/, /net::ERR_/, /status of 40[13]/, /the server responded with a status/i, /sandboxed/i];

export const test = base.extend({
  erreurs: [async ({ page }, use) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push(`Erreur : ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !BRUIT.some((r) => r.test(m.text()))) errs.push(`Console : ${m.text().slice(0, 300)}`); });
    await use(errs);
    expect(errs, 'erreurs dans la page').toEqual([]);
  }, { auto: true }],
  // Appel direct à l'API avec la session des tests
  api: async ({ request }, use) => {
    const { token } = etat();
    await use(async (p, o = {}) => {
      const r = await request.fetch(p, { method: o.method || 'GET', data: o.body, headers: { authorization: `Bearer ${token}` } });
      expect(r.ok(), `${p} → ${r.status()}`).toBeTruthy();
      return r.json();
    });
  },
});

// Page prête : écran de démarrage masqué
export async function ouvrir(page, url) {
  await page.goto(url);
  await pret(page);
}
export async function pret(page) {
  await page.waitForFunction(() => { const b = document.querySelector('.boot'); return !b || getComputedStyle(b).display === 'none'; }, null, { timeout: 30_000 });
}
