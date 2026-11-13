// Client PostgreSQL de Venus (repris du client écrit pour Odin · Urðr) (protocole v3, sans bibliothèque) : connexion en clair, MD5 ou
// SCRAM-SHA-256 (vérifie aussi la signature du serveur), TLS si le serveur l'offre, requêtes simples et
// requêtes à paramètres (le texte de l'utilisateur n'est jamais collé dans le SQL : il passe en paramètre).
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
export class PgError extends Error {
    code;
    detail;
    hint;
    position;
    constructor(f) { super(f.M ?? 'erreur PostgreSQL'); this.code = f.C ?? ''; this.detail = f.D; this.hint = f.H; this.position = f.P ? Number(f.P) : undefined; }
}
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const cstr = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
const msg = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from(type), i32(body.length + 4), body]); };
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const sha = (d) => createHash('sha256').update(d).digest();
/** SCRAM-SHA-256 (RFC 5802 / 7677), étapes séparées pour être testées. */
export function scramFirst(nonce = randomBytes(18).toString('base64')) {
    const bare = `n=,r=${nonce}`;
    return { bare, first: `n,,${bare}`, nonce };
}
export function scramFinal(password, bare, serverFirst, nonce) {
    const a = Object.fromEntries(serverFirst.split(',').map((x) => [x[0], x.slice(2)]));
    if (!a.r?.startsWith(nonce))
        throw new Error('SCRAM : le serveur a renvoyé un nonce invalide');
    const iter = Number(a.i);
    if (!(iter >= 4096))
        throw new Error('SCRAM : nombre d\'itérations trop faible');
    const salted = pbkdf2Sync(password.normalize('NFKC'), Buffer.from(a.s, 'base64'), iter, 32, 'sha256');
    const clientKey = hmac(salted, 'Client Key'), stored = sha(clientKey);
    const without = `c=biws,r=${a.r}`, auth = `${bare},${serverFirst},${without}`;
    const sig = hmac(stored, auth), proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
    return { final: `${without},p=${proof.toString('base64')}`, serverSig: hmac(hmac(salted, 'Server Key'), auth) };
}
export const md5Password = (user, password, salt) => {
    const inner = createHash('md5').update(password + user).digest('hex');
    return 'md5' + createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
};
/** Une connexion. Les requêtes passent l'une après l'autre (file d'attente). */
export class Pg {
    sock;
    buf = Buffer.alloc(0);
    waiters = [];
    queue = Promise.resolve();
    closed = false;
    failure = null;
    params = {};
    o;
    constructor(o) { this.o = o; }
    static async connect(o) { const c = new Pg(o); await c.open(); return c; }
    async open() {
        const o = this.o, port = o.port ?? 5432, ms = o.timeoutMs ?? 10_000;
        let sock = await new Promise((ok, ko) => { const s = o.host.startsWith('/') ? netConnect({ path: `${o.host}/.s.PGSQL.${port}` }) : netConnect({ host: o.host, port }); const t = setTimeout(() => { s.destroy(); ko(new Error(`PostgreSQL ${o.host}:${port} ne répond pas`)); }, ms); s.once('connect', () => { clearTimeout(t); ok(s); }); s.once('error', (e) => { clearTimeout(t); ko(e); }); });
        const ssl = o.ssl ?? (/^(127\.|localhost$|::1$|\/)/.test(o.host) ? 'non' : 'si-possible');
        if (ssl !== 'non') {
            sock.write(Buffer.concat([i32(8), i32(80877103)]));
            const a = await new Promise((ok) => sock.once('data', ok));
            if (a[0] === 0x53)
                sock = tlsConnect({ socket: sock, servername: /^[\d.:]+$/.test(o.host) ? undefined : o.host, rejectUnauthorized: ssl === 'obligatoire' });
            else if (ssl === 'obligatoire') {
                sock.destroy();
                throw new Error('le serveur PostgreSQL refuse le chiffrement (TLS)');
            }
        }
        this.sock = sock;
        sock.on('data', (d) => { this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d; this.wake(); });
        sock.on('error', (e) => { this.failure = e; this.wake(); });
        sock.on('close', () => { this.closed = true; this.wake(); });
        const start = Buffer.concat([i32(196608), cstr('user'), cstr(o.user), cstr('database'), cstr(o.database), cstr('application_name'), cstr(o.app ?? 'venus'), cstr('client_encoding'), cstr('UTF8'), Buffer.from([0])]);
        sock.write(Buffer.concat([i32(start.length + 4), start]));
        await Promise.race([this.auth(), new Promise((_, ko) => setTimeout(() => ko(new Error('PostgreSQL : connexion trop longue')), ms).unref())]);
    }
    wake() { const w = this.waiters; this.waiters = []; for (const f of w)
        f(); }
    async next() {
        for (;;) {
            if (this.buf.length >= 5) {
                const len = this.buf.readInt32BE(1);
                if (this.buf.length >= len + 1) {
                    const type = String.fromCharCode(this.buf[0]), body = this.buf.subarray(5, len + 1);
                    this.buf = this.buf.subarray(len + 1);
                    return { type, body };
                }
            }
            if (this.failure)
                throw this.failure;
            if (this.closed)
                throw new Error('connexion PostgreSQL fermée');
            await new Promise((r) => this.waiters.push(r));
        }
    }
    send(b) { this.sock.write(b); }
    fields(b) { const f = {}; let i = 0; while (i < b.length && b[i]) {
        const t = String.fromCharCode(b[i]);
        const e = b.indexOf(0, i + 1);
        f[t] = b.toString('utf8', i + 1, e);
        i = e + 1;
    } return f; }
    async auth() {
        const o = this.o;
        let scram = null;
        for (;;) {
            const m = await this.next();
            if (m.type === 'E')
                throw new PgError(this.fields(m.body));
            if (m.type === 'R') {
                const code = m.body.readInt32BE(0);
                if (code === 0)
                    continue;
                if (code === 3) {
                    if (!o.password)
                        throw new Error('mot de passe PostgreSQL manquant');
                    this.send(msg('p', cstr(o.password)));
                    continue;
                }
                if (code === 5) {
                    if (!o.password)
                        throw new Error('mot de passe PostgreSQL manquant');
                    this.send(msg('p', cstr(md5Password(o.user, o.password, m.body.subarray(4, 8)))));
                    continue;
                }
                if (code === 10) {
                    const mechs = m.body.subarray(4).toString('utf8').split('\0').filter(Boolean);
                    if (!mechs.includes('SCRAM-SHA-256'))
                        throw new Error(`méthode d'authentification non prise en charge : ${mechs.join(', ')}`);
                    if (!o.password)
                        throw new Error('mot de passe PostgreSQL manquant');
                    const f = scramFirst();
                    scram = f;
                    const data = Buffer.from(f.first);
                    this.send(msg('p', cstr('SCRAM-SHA-256'), i32(data.length), data));
                    continue;
                }
                if (code === 11 && scram) {
                    const r = scramFinal(o.password, scram.bare, m.body.subarray(4).toString('utf8'), scram.nonce);
                    scram.serverSig = r.serverSig;
                    this.send(msg('p', Buffer.from(r.final)));
                    continue;
                }
                if (code === 12 && scram?.serverSig) {
                    const v = Object.fromEntries(m.body.subarray(4).toString('utf8').split(',').map((x) => [x[0], x.slice(2)])).v ?? '';
                    const got = Buffer.from(v, 'base64');
                    if (got.length !== scram.serverSig.length || !timingSafeEqual(got, scram.serverSig))
                        throw new Error('SCRAM : la signature du serveur est fausse (serveur usurpé ?)');
                    continue;
                }
                throw new Error(`méthode d'authentification PostgreSQL ${code} non prise en charge`);
            }
            if (m.type === 'S') {
                const [k, v] = m.body.toString('utf8').split('\0');
                this.params[k] = v;
                continue;
            }
            if (m.type === 'K' || m.type === 'N')
                continue;
            if (m.type === 'Z')
                return;
        }
    }
    /** Lit les réponses jusqu'à « prêt » ; rend chaque résultat. */
    async collect() {
        const out = [];
        let cur = { fields: [], rows: [], command: '', count: 0 };
        let err = null;
        for (;;) {
            const m = await this.next();
            switch (m.type) {
                case 'T': {
                    const n = m.body.readInt16BE(0);
                    let i = 2;
                    cur.fields = [];
                    for (let k = 0; k < n; k++) {
                        const e = m.body.indexOf(0, i);
                        const name = m.body.toString('utf8', i, e);
                        i = e + 1;
                        cur.fields.push({ name, table: m.body.readInt32BE(i), column: m.body.readInt16BE(i + 4), type: m.body.readInt32BE(i + 6) });
                        i += 18;
                    }
                    break;
                }
                case 'D': {
                    const n = m.body.readInt16BE(0);
                    let i = 2;
                    const row = [];
                    for (let k = 0; k < n; k++) {
                        const len = m.body.readInt32BE(i);
                        i += 4;
                        if (len < 0)
                            row.push(null);
                        else {
                            row.push(m.body.toString('utf8', i, i + len));
                            i += len;
                        }
                    }
                    cur.rows.push(row);
                    break;
                }
                case 'C': {
                    const tag = m.body.toString('utf8', 0, m.body.length - 1);
                    cur.command = tag;
                    const c = Number(tag.split(' ').pop());
                    cur.count = Number.isFinite(c) ? c : cur.rows.length;
                    out.push(cur);
                    cur = { fields: [], rows: [], command: '', count: 0 };
                    break;
                }
                case 'I':
                    out.push(cur);
                    cur = { fields: [], rows: [], command: '', count: 0 };
                    break;
                case 'E':
                    err = new PgError(this.fields(m.body));
                    break;
                case 'Z':
                    if (err)
                        throw err;
                    return out;
                default: break; // 1, 2, n, t, s, N, S
            }
        }
    }
    serial(f) { const p = this.queue.then(f, f); this.queue = p.catch(() => undefined); return p; }
    /** Requête simple (plusieurs instructions possibles) : seulement pour le SQL écrit par Odin lui-même. */
    simple(sql) { return this.serial(async () => { this.send(msg('Q', cstr(sql))); return this.collect(); }); }
    /** Une seule instruction, valeurs passées à part (jamais collées dans le SQL). */
    query(sql, params = [], types = []) {
        return this.serial(async () => {
            const vals = params.map((v) => (v === null || v === undefined ? i32(-1) : (() => { const b = Buffer.isBuffer(v) || v instanceof Uint8Array ? Buffer.from(`\\x${Buffer.from(v).toString('hex')}`) : Buffer.from(typeof v === 'boolean' ? (v ? 't' : 'f') : typeof v === 'bigint' ? v.toString() : String(v), 'utf8'); return Buffer.concat([i32(b.length), b]); })()));
            const nt = Buffer.alloc(2 + types.length * 4); nt.writeInt16BE(types.length); types.forEach((x, k) => nt.writeInt32BE(x || 0, 2 + k * 4));
            const n = Buffer.alloc(2);
            n.writeInt16BE(params.length);
            this.send(Buffer.concat([
                msg('P', cstr(''), cstr(sql), nt),
                msg('B', cstr(''), cstr(''), Buffer.from([0, 0]), n, ...vals, Buffer.from([0, 0])),
                msg('D', Buffer.from('P'), cstr('')),
                msg('E', cstr(''), i32(0)),
                msg('S'),
            ]));
            const r = await this.collect();
            return r[r.length - 1] ?? { fields: [], rows: [], command: '', count: 0 };
        });
    }
    /** Une instruction en lecture seule : la base elle-même refuse toute écriture. */
    async readOnly(sql, params = [], timeoutMs = 15_000) {
        await this.simple(`BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout = ${Math.max(100, Math.floor(timeoutMs))}`);
        try {
            return await this.query(sql, params);
        }
        finally {
            await this.simple('ROLLBACK').catch(() => undefined);
        }
    }
    async close() { if (this.closed)
        return; try {
        this.send(msg('X'));
    }
    catch { /* déjà fermé */ } this.sock.end(); this.closed = true; }
}
/** Échappe un nom (table, colonne) : "nom" avec les guillemets doublés. */
export const ident = (s) => `"${s.replace(/"/g, '""')}"`;
