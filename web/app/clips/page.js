// Route /clips — page « Clips ».
// Le contenu est rendu par le composant Browse (dossier web/components).
import Browse from '../../components/Browse';

// Composant de la page, affiché par Next.js pour cette adresse
export default function Page() { return <Browse kind="clip" />; }
