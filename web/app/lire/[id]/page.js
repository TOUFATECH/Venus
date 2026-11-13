// Route /lire/[id] — page « Liseuse » : lecture d’un livre.
// Le contenu est rendu par le composant Media (dossier web/components).
import { Reader as P } from '../../../components/pages/Media';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <P />; }
