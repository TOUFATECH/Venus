// Où tourne Venus ? (Docker, conteneur LXC Proxmox privilégié ou non, machine classique)
// Sert à donner des conseils précis quand le GPU ou les partages réseau ne sont pas accessibles.
import fs from 'node:fs';
import os from 'node:os';

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

function detect() {
  const env1 = read('/proc/1/environ').replace(/\0/g, '\n');
  const cgroup = read('/proc/1/cgroup');
  let kind = 'machine';
  if (fs.existsSync('/.dockerenv') || /docker|containerd|kubepods/.test(cgroup)) kind = 'docker';
  else if (/container=lxc/.test(env1) || /container=lxc/.test(process.env.container ? `container=${process.env.container}` : '') || fs.existsSync('/dev/.lxc') || /\/lxc\//.test(cgroup)) kind = 'lxc';
  // Docker peut lui-même tourner dans un LXC : la table des UID trahit un conteneur non privilégié
  const uidMap = read('/proc/self/uid_map').trim().split(/\s+/).map(Number);
  const unprivileged = uidMap.length >= 3 && !(uidMap[0] === 0 && uidMap[1] === 0);
  const capEff = (/CapEff:\s*([0-9a-f]+)/i.exec(read('/proc/self/status')) || [])[1] || '0';
  // Linux : CAP_SYS_ADMIN nécessaire. macOS (mount_smbfs) et Windows (net use) : un utilisateur normal suffit
  const canMount = process.platform !== 'linux' || (BigInt(`0x${capEff}`) & (1n << 21n)) !== 0n;
  return {
    kind, unprivileged, canMount, root: process.getuid ? process.getuid() === 0 : false,
    gpuDevices: (() => { try { return fs.readdirSync('/dev/dri'); } catch { return []; } })(),
    nvidia: fs.existsSync('/dev/nvidia0'),
    hostname: os.hostname(),
  };
}

export const runtime = detect();

// Conseils affichés dans les réglages et dans les messages d'erreur
export function mountAdvice() {
  const r = runtime;
  if (r.kind === 'lxc' || r.unprivileged) {
    if (r.unprivileged) {
      return {
        title: 'Partages réseau : conteneur LXC non privilégié',
        text: 'Proxmox interdit aux conteneurs non privilégiés de monter eux-mêmes un partage réseau. Montez le partage sur l’hôte Proxmox puis transmettez-le au conteneur : le script scripts/proxmox-host.sh le fait pour vous. Le dossier apparaît ensuite dans « Dossier de ce serveur ».',
        command: 'bash scripts/proxmox-host.sh nas <ID-du-conteneur>',
      };
    }
    return {
      title: 'Partages réseau : autorisation à donner au conteneur LXC',
      text: 'Autorisez le montage réseau pour ce conteneur sur l’hôte Proxmox, puis redémarrez-le.',
      command: 'pct set <ID-du-conteneur> --features "mount=cifs;nfs" && pct reboot <ID-du-conteneur>',
    };
  }
  if (r.kind === 'docker') {
    return {
      title: 'Partages réseau : droits Docker manquants',
      text: 'Le conteneur doit avoir le droit de monter des partages : utilisez le docker-compose.yml fourni (cap_add: SYS_ADMIN), puis relancez « docker compose up -d ».',
      command: 'docker compose up -d',
    };
  }
  return { title: 'Partages réseau : droits insuffisants', text: 'Lancez Venus en tant que root (le service installé par scripts/install-native.sh le fait), ou montez le partage vous-même puis ajoutez-le comme « Dossier de ce serveur ».', command: 'sudo bash scripts/install-native.sh' };
}

export function gpuAdvice() {
  const r = runtime;
  if (r.gpuDevices.length || r.nvidia) return null;
  if (r.kind === 'lxc' || r.unprivileged) {
    return {
      title: 'Aucune carte graphique transmise au conteneur',
      text: r.kind === 'docker'
        ? 'La conversion se fait au processeur. Venus tourne dans Docker, lui-même dans un conteneur Proxmox : 1) sur l’hôte Proxmox, transmettez la puce Intel / AMD au conteneur avec la commande ci-dessous ; 2) dans le conteneur, relancez ./install.sh --docker pour la donner à Venus.'
        : 'La conversion se fait au processeur. Pour utiliser la puce Intel / AMD de votre serveur Proxmox, transmettez-la au conteneur depuis l’hôte, puis redémarrez Venus.',
      command: 'bash scripts/proxmox-host.sh gpu <ID-du-conteneur>',
    };
  }
  if (r.kind === 'docker') {
    return { title: 'Aucune carte graphique transmise au conteneur', text: 'Relancez ./install.sh --docker : il ajoute automatiquement la carte graphique détectée sur la machine. (Docker Desktop sur Windows ou Mac ne donne pas accès à la carte graphique : préférez l’installation sans Docker.)', command: './install.sh --docker' };
  }
  return null;
}
