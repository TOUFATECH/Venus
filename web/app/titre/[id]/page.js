// Route /titre/[id] — page « Fiche d’un titre » : redirige vers l’adresse lisible du titre.
// Le contenu est rendu par le composant TitleRoute (dossier web/components).
import TitleRoute from '../../../components/pages/TitleRoute';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <TitleRoute param="id" />; }
