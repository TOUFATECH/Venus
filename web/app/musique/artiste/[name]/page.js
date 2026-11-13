// Route /musique/artiste/[name] — page « Musique » : un artiste.
// Le contenu est rendu par le composant Media (dossier web/components).
import { Artist as P } from '../../../../components/pages/Media';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <P />; }
