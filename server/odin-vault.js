// Coffre du système (SSO du poste, contrat d'Odin § 6) : le jeton de poste d'Odin, rangé par le premier programme qui
// s'est connecté sur cette machine (Pégase, le compagnon d'Odin, Venus…), sous le nom « Odin SSO <adresse d'Odin> ».
// Windows : Gestionnaire d'identification ; Mac : Trousseau ; Linux : Secret Service (secret-tool).
// Le secret passe toujours par l'entrée standard, jamais dans la ligne de commande. Sans coffre (Docker, serveur sans
// session) : pas de SSO du poste, et rien n'est écrit en clair à la place.
// La partie « coffre » est reprise telle quelle de la bibliothèque cliente d'Odin (clients/odin-sso.mjs, licence MIT),
// pour que Venus lise et écrive exactement les mêmes entrées que Pégase et le compagnon d'Odin.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const PLATEFORME = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform] ?? 'autre';

function lancer(cmd, args, entree, env) {
  return new Promise((resolve) => {
    let out = '', err = ''; let p;
    try { p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: env ?? process.env }); } catch (e) { resolve({ code: -1, out: '', err: String(e) }); return; }
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    p.on('close', (code) => resolve({ code: code ?? -1, out, err }));
    p.stdin.end(entree ?? '');
  });
}
const COMPTE = 'odin-sso';
// Windows : le Gestionnaire d'identification par l'API advapi32 (CredWriteW / CredReadW / CredDeleteW), depuis PowerShell.
// Le script passe en -EncodedCommand (sans secret) ; le secret passe par l'entrée standard.
const CS = `using System;using System.Runtime.InteropServices;using System.Text;
public static class OdinCred{[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]public struct C{public int Flags;public int Type;public string TargetName;public string Comment;public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;public int CredentialBlobSize;public IntPtr CredentialBlob;public int Persist;public int AttributeCount;public IntPtr Attributes;public string TargetAlias;public string UserName;}
[DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredWriteW(ref C c,int f);
[DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredReadW(string t,int ty,int f,out IntPtr c);
[DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredDeleteW(string t,int ty,int f);
[DllImport("advapi32.dll")]static extern void CredFree(IntPtr p);
public static void Write(string t,string u,string s){byte[] b=Encoding.Unicode.GetBytes(s);C c=new C();c.Type=1;c.TargetName=t;c.UserName=u;c.Persist=2;c.CredentialBlobSize=b.Length;c.CredentialBlob=Marshal.AllocHGlobal(b.Length);try{Marshal.Copy(b,0,c.CredentialBlob,b.Length);if(!CredWriteW(ref c,0))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}finally{Marshal.FreeHGlobal(c.CredentialBlob);}}
public static string Read(string t){IntPtr p;if(!CredReadW(t,1,0,out p))return null;try{C c=(C)Marshal.PtrToStructure(p,typeof(C));return Marshal.PtrToStringUni(c.CredentialBlob,c.CredentialBlobSize/2);}finally{CredFree(p);}}
public static bool Delete(string t){return CredDeleteW(t,1,0);}}`;
const ps1 = (corps) => `$ErrorActionPreference='Stop';Add-Type -TypeDefinition @'\n${CS}\n'@;${corps}`;
const psChaine = (x) => `'${String(x).replace(/'/g, "''")}'`;
const powershell = (script, entree) => lancer('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], entree);
// Mac : `security -i` lit ses commandes sur l'entrée standard (le secret n'apparaît pas dans la liste des processus).
const macCite = (x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Le coffre du système de l'utilisateur. `nom` : « Odin SSO <adresse d'Odin> ». */
export const coffre = {
  systeme: PLATEFORME,
  async disponible() {
    if (PLATEFORME === 'windows') return (await powershell(ps1('[void][OdinCred]::Read(\'odin-sso-essai\');exit 0'))).code === 0;
    if (PLATEFORME === 'mac') return (await lancer('security', ['help'])).code !== -1;
    if (PLATEFORME === 'linux') { const r = await lancer('secret-tool', ['lookup', 'service', COMPTE, 'adresse', 'odin-sso-essai']); return r.code === 0 || (r.code === 1 && !/dbus|autolaunch|secret service|cannot|failed/i.test(r.err)); }
    return false;
  },
  async ranger(nom, secret) {
    if (!/^[\x20-\x7e]{1,300}$/.test(nom) || !/^[\x21-\x7e]{1,4096}$/.test(secret)) throw new Error('nom ou secret invalide pour le coffre');
    let r;
    if (PLATEFORME === 'windows') r = await powershell(ps1(`$s=[Console]::In.ReadLine();[OdinCred]::Write(${psChaine(nom)},'${COMPTE}',$s)`), `${secret}\n`);
    else if (PLATEFORME === 'mac') r = await lancer('security', ['-i'], `add-generic-password -U -s ${macCite(nom)} -a ${COMPTE} -l ${macCite(nom)} -w ${macCite(secret)}\n`);
    else if (PLATEFORME === 'linux') r = await lancer('secret-tool', ['store', `--label=${nom}`, 'service', COMPTE, 'adresse', nom], secret);
    else throw new Error('pas de coffre du système sur cette plateforme');
    if (r.code !== 0) throw new Error(`le coffre du système a refusé (${(r.err || r.out).trim().slice(0, 200) || `code ${r.code}`})`);
  },
  async lire(nom) {
    let r;
    if (PLATEFORME === 'windows') { r = await powershell(ps1(`$v=[OdinCred]::Read(${psChaine(nom)});if($v -eq $null){exit 2};[Console]::Out.Write($v)`)); return r.code === 0 ? r.out : undefined; }
    if (PLATEFORME === 'mac') { r = await lancer('security', ['find-generic-password', '-s', nom, '-a', COMPTE, '-w']); return r.code === 0 ? r.out.replace(/\n$/, '') : undefined; }
    if (PLATEFORME === 'linux') { r = await lancer('secret-tool', ['lookup', 'service', COMPTE, 'adresse', nom]); return r.code === 0 && r.out ? r.out.replace(/\n$/, '') : undefined; }
    return undefined;
  },
  async effacer(nom) {
    if (PLATEFORME === 'windows') await powershell(ps1(`[void][OdinCred]::Delete(${psChaine(nom)})`));
    else if (PLATEFORME === 'mac') await lancer('security', ['delete-generic-password', '-s', nom, '-a', COMPTE]);
    else if (PLATEFORME === 'linux') await lancer('secret-tool', ['clear', 'service', COMPTE, 'adresse', nom]);
  },
};

// ---------------------------------------------------------------- Jetons

/** Vérifie un JWT ES256 avec les clés d'Odin (JWKS). Rend la charge, ou lève une erreur en français. */

// ---------------------------------------------------------------- ce dont Venus se sert
let avail = null;
/** Le coffre du système est-il utilisable ici ? (VENUS_COFFRE=0 : jamais, par ex. pour les essais) */
export async function available() {
  if (process.env.VENUS_COFFRE === '0') return false;
  if (avail === null) { try { avail = await coffre.disponible(); } catch { avail = false; } }
  return avail;
}
export async function read(nom) { if (!(await available())) return null; try { return (await coffre.lire(nom)) || null; } catch { return null; } }
export async function store(nom, secret) { if (!(await available())) return false; try { await coffre.ranger(nom, secret); return true; } catch { return false; } }
export async function clear(nom) { if (!(await available())) return false; try { await coffre.effacer(nom); return true; } catch { return false; } }
/** Identifiant de l'appareil, le même pour tous les programmes du poste (« Odin SSO appareil », créé une fois). */
export async function deviceId() {
  const nom = 'Odin SSO appareil';
  let id = await read(nom);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) { id = randomBytes(18).toString('base64url'); await store(nom, id); }
  return id;
}
