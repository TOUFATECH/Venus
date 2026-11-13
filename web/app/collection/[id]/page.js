// Route /collection/[id] — page « Collection » : le contenu d’une collection.
// Le contenu est rendu par le composant Collections (dossier web/components).
import { Collection as P } from '../../../components/pages/Collections';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <P />; }
