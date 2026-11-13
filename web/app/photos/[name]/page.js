// Route /photos/[name] — page « Photos » : un album photo.
// Le contenu est rendu par le composant Media (dossier web/components).
import { PhotoAlbum as P } from '../../../components/pages/Media';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <P />; }
