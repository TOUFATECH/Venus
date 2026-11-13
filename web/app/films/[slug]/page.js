// Route /films/[slug] — page « Films » : fiche d’un titre.
// Le contenu est rendu par le composant TitleRoute (dossier web/components).
import TitleRoute from '../../../components/pages/TitleRoute';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <TitleRoute />; }
