// Route /liste-lecture/[id] — page « Liste de lecture » : le contenu d’une liste de lecture.
// Le contenu est rendu par le composant Collections (dossier web/components).
import { Playlist as P } from '../../../components/pages/Collections';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <P />; }
