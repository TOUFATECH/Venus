// Route /livres/auteur/[name] — page « Livres » : un auteur et sa bibliographie.
// Le contenu est rendu par le composant MediaMore (dossier web/components).
import { Author as P } from '../../../../components/pages/MediaMore';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <P />; }
