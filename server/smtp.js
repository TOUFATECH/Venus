// Envoi d'e-mails sans dépendance : client SMTP minimal (TLS direct sur le port 465, ou STARTTLS sur 587/25),
// authentification PLAIN / LOGIN. Sert aux codes de connexion (double authentification) et aux alertes.
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';
import { getSetting } from './db.js';

export function smtpConf() {
  return {
    host: String(getSetting('smtp_host', '') || ''),
    port: Number(getSetting('smtp_port', 587)) || 587,
    secure: String(getSetting('smtp_secure', 'auto')), // auto | tls | starttls | none
    user: String(getSetting('smtp_user', '') || ''),
    pass: String(getSetting('smtp_pass', '') || ''),
    from: String(getSetting('smtp_from', '') || getSetting('smtp_user', '') || ''),
  };
}
export const smtpOn = () => { const c = smtpConf(); return !!(c.host && c.from); };

// En-têtes encodés (accents) et lignes de 76 caractères maximum
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const b64lines = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim(); // pas d'injection d'en-têtes

export function sendMail({ to, subject, text, html }, conf = smtpConf()) {
  return new Promise((resolve, reject) => {
    if (!conf.host) return reject(new Error('serveur d’e-mails non configuré'));
    const recipient = clean(to), from = clean(conf.from);
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(recipient) || !/^[^\s@<>]+@[^\s@<>]+$/.test(from)) return reject(new Error('adresse e-mail invalide'));
    const implicitTls = conf.secure === 'tls' || (conf.secure === 'auto' && conf.port === 465);
    const wantStartTls = conf.secure === 'starttls' || (conf.secure === 'auto' && !implicitTls);
    let sock = implicitTls ? tls.connect({ host: conf.host, port: conf.port, servername: conf.host }) : net.connect({ host: conf.host, port: conf.port });
    sock.setTimeout(20000);
    let buf = '', step = 'greet', upgraded = implicitTls, waiting = null;
    const fail = (e) => { try { sock.destroy(); } catch { /* */ } reject(e instanceof Error ? e : new Error(String(e))); };
    const send = (line) => sock.write(`${line}\r\n`);
    const expect = (code) => new Promise((res, rej) => { waiting = { code, res, rej }; });
    const onData = (d) => {
      buf += d.toString('utf8');
      // Réponse complète : dernière ligne « 250 texte » (sans tiret après le code)
      const lines = buf.split('\r\n');
      const done = lines.findIndex((l) => /^\d{3} /.test(l));
      if (done === -1) return;
      const reply = lines.slice(0, done + 1).join('\n');
      buf = lines.slice(done + 1).join('\r\n');
      const code = Number(reply.slice(0, 3));
      const w = waiting; waiting = null;
      if (!w) return;
      if (String(code)[0] === String(w.code)[0]) w.res(reply); else w.rej(new Error(`SMTP ${reply.split('\n').pop().slice(0, 160)}`));
    };
    const attach = (s) => { s.on('data', onData); s.on('error', fail); s.on('timeout', () => fail(new Error('le serveur d’e-mails ne répond pas'))); };
    attach(sock);
    const name = os.hostname().replace(/[^\w.-]/g, '') || 'venus';
    (async () => {
      await expect(2);
      send(`EHLO ${name}`);
      let ehlo = await expect(2);
      if (!upgraded && wantStartTls) {
        if (!/STARTTLS/i.test(ehlo)) { if (conf.secure === 'starttls') throw new Error('le serveur ne propose pas STARTTLS'); }
        else {
          send('STARTTLS'); await expect(2);
          sock.removeAllListeners('data');
          sock = tls.connect({ socket: sock, servername: conf.host });
          await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
          attach(sock); sock.setTimeout(20000); upgraded = true;
          send(`EHLO ${name}`); ehlo = await expect(2);
        }
      }
      if (conf.user) {
        if (!upgraded && conf.secure !== 'none') throw new Error('connexion non chiffrée : mot de passe non envoyé (choisissez TLS ou STARTTLS)');
        if (/AUTH[^\n]*PLAIN/i.test(ehlo)) {
          send(`AUTH PLAIN ${Buffer.from(`\0${conf.user}\0${conf.pass}`).toString('base64')}`); await expect(2);
        } else {
          send('AUTH LOGIN'); await expect(3);
          send(Buffer.from(conf.user).toString('base64')); await expect(3);
          send(Buffer.from(conf.pass).toString('base64')); await expect(2);
        }
      }
      send(`MAIL FROM:<${from}>`); await expect(2);
      send(`RCPT TO:<${recipient}>`); await expect(2);
      send('DATA'); await expect(3);
      const boundary = `venus-${crypto.randomBytes(8).toString('hex')}`;
      const msg = [
        `From: ${encWord(clean(getSetting('server_name', 'Venus')))} <${from}>`, `To: <${recipient}>`, `Subject: ${encWord(clean(subject))}`,
        `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${from.split('@')[1]}>`, 'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
        `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64lines(text || ''),
        html ? [`--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64lines(html)].join('\r\n') : '',
        `--${boundary}--`, '',
      ].filter((x) => x !== null).join('\r\n');
      // Un point en début de ligne est doublé (fin de message SMTP)
      sock.write(`${msg.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
      await expect(2);
      send('QUIT');
      sock.end();
      resolve(true);
    })().catch(fail);
  });
}
