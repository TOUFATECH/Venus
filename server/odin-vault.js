// Coffre du système (SSO du poste, contrat d'Odin § 6) : le jeton de poste d'Odin, rangé par le premier programme qui
// s'est connecté sur cette machine (Pégase, le compagnon d'Odin, Venus…), sous le nom « Odin SSO <adresse d'Odin> ».
// Windows : Gestionnaire d'identification ; Mac : Trousseau ; Linux : Secret Service (secret-tool).
// Le secret passe toujours par l'entrée standard, jamais dans la ligne de commande. Sans coffre (Docker, serveur sans
// session) : pas de SSO du poste, et rien n'est écrit en clair à la place.
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';

const DEVICE = 'Odin SSO appareil';
const ACCOUNT = 'odin-sso';
const isWin = process.platform === 'win32', isMac = process.platform === 'darwin';

function run(cmd, args, input, timeout = 8000) {
  return new Promise((resolve) => {
    let out = '', errOut = '';
    let p;
    try { p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch { resolve({ code: -1, out: '' }); return; }
    const t = setTimeout(() => { try { p.kill(); } catch { /* */ } }, timeout);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { errOut += d; });
    p.on('error', () => { clearTimeout(t); resolve({ code: -1, out: '' }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err: errOut }); });
    if (input !== undefined) p.stdin.end(input); else p.stdin.end();
  });
}
const has = (cmd) => new Promise((r) => execFile(isWin ? 'where' : 'which', [cmd], (e) => r(!e)));

// Windows : CredReadW / CredWriteW par PowerShell (le secret arrive sur l'entrée standard)
const PS_CRED = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public class OdinCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string t) { IntPtr p; if (!CredReadW(t, 1, 0, out p)) return null; try { var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); return Encoding.Unicode.GetString(b); } finally { CredFree(p); } }
  public static bool Write(string t, string s) { var b = Encoding.Unicode.GetBytes(s); var c = new CREDENTIAL(); c.Type = 1; c.TargetName = t; c.UserName = "${ACCOUNT}"; c.Persist = 2; c.CredentialBlobSize = b.Length; c.CredentialBlob = Marshal.AllocHGlobal(b.Length); try { Marshal.Copy(b, 0, c.CredentialBlob, b.Length); return CredWriteW(ref c, 0); } finally { Marshal.FreeHGlobal(c.CredentialBlob); } }
  public static bool Delete(string t) { return CredDeleteW(t, 1, 0); }
}
"@
$l = [Console]::In.ReadToEnd().Split([char]10)
$op = $l[0].Trim(); $t = $l[1].Trim()
if ($op -eq 'lire') { $v = [OdinCred]::Read($t); if ($v -ne $null) { [Console]::Out.Write($v) } else { exit 3 } }
elseif ($op -eq 'ranger') { if (-not [OdinCred]::Write($t, $l[2].Trim())) { exit 4 } }
else { [void][OdinCred]::Delete($t) }
`;
const ps = (lines) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_CRED], lines.join('\n'), 15000);

let avail = null;
/** Le coffre du système est-il utilisable ici ? (Linux : secret-tool ET une session D-Bus) */
export async function available() {
  if (avail !== null) return avail;
  if (process.env.VENUS_COFFRE === '0') return (avail = false);
  if (isWin) avail = await has('powershell.exe');
  else if (isMac) avail = await has('security');
  else avail = Boolean(process.env.DBUS_SESSION_BUS_ADDRESS) && await has('secret-tool');
  return avail;
}

/** Lire un secret (null s'il n'y est pas). `adresse` : l'adresse d'Odin (attribut sous Linux). */
export async function read(name, adresse = '') {
  if (!(await available())) return null;
  let r;
  if (isWin) r = await ps(['lire', name]);
  else if (isMac) r = await run('security', ['find-generic-password', '-s', name, '-a', ACCOUNT, '-w']);
  else r = await run('secret-tool', ['lookup', 'service', ACCOUNT, 'adresse', adresse || name]);
  const v = r.code === 0 ? String(r.out || '').trim() : '';
  return v || null;
}
/** Ranger un secret. */
export async function store(name, secret, adresse = '') {
  if (!(await available())) return false;
  let r;
  if (isWin) r = await ps(['ranger', name, secret]);
  else if (isMac) r = await run('security', ['-i'], `add-generic-password -U -s "${name.replace(/"/g, '')}" -a ${ACCOUNT} -w "${String(secret).replace(/["\\]/g, '')}"\n`);
  else r = await run('secret-tool', ['store', `--label=${name}`, 'service', ACCOUNT, 'adresse', adresse || name], secret);
  return r.code === 0;
}
export async function clear(name, adresse = '') {
  if (!(await available())) return false;
  if (isWin) await ps(['effacer', name]);
  else if (isMac) await run('security', ['delete-generic-password', '-s', name, '-a', ACCOUNT]);
  else await run('secret-tool', ['clear', 'service', ACCOUNT, 'adresse', adresse || name]);
  return true;
}
/** Identifiant de l'appareil, le même pour tous les programmes du poste (créé une fois). */
export async function deviceId() {
  let id = await read(DEVICE, 'appareil');
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) { id = crypto.randomUUID(); await store(DEVICE, id, 'appareil'); }
  return id;
}
