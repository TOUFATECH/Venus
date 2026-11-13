// Route /photos — page « Photos ».
// Le contenu est rendu par le composant Media (dossier web/components).
import { Photos as P } from '../../components/pages/Media';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <P />; }
