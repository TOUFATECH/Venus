// Catégories des chaînes TV : déduites du nom de la chaîne et du groupe de la liste M3U.
// L'ordre de CATEGORIES est celui des filtres de la page TV.
export const CATEGORIES = ['Outre-mer', 'Info', 'Généraliste', 'Films', 'Séries', 'Animé / Manga', 'Jeunesse', 'Documentaire', 'Histoire', 'Culture', 'Sport', 'Musique', 'Cuisine & maison', 'Japon', 'Autres'];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Du plus précis au plus général : la première règle qui correspond l'emporte
const RULES = [
  ['Outre-mer', /\b1(e|ere|re)\b|la 1ere|outre.?mer|mayotte|reunion|antenne reunion|kweli|guadeloupe|martinique|guyane|polynesie|tahiti|caledonie|wallis|saint.?pierre|antilles|kajou|telekreol|atv\b|eclair tv|zouk/],
  ['Animé / Manga', /anim(e|es|é|ation)?\b|manga|detective conan|digimon|doraemon|beyblade|inazuma|one piece|yu.?gi.?oh|naruto|pokemon|dragon ?ball|wasabi|sailor|captain tsubasa|olive (et|&) tom|saint seiya|goldorak|ladybug|miraculous|crunchyroll|\badn\b|otaku|hero ?tv|\bgong\b|game one|j.?one/],
  ['Japon', /\bnhk\b|weathernews|japon|japan|\.jp\b|tokyo|fuji ?tv|nippon|asahi|\btbs\b/],
  ['Jeunesse', /schtroumpf|bob l.eponge|barbie|tortues ninja|icarly|charlotte aux fraises|mattel|\bteen\b|kids?\b|enfant|junior|jeunesse|gulli|tiji|okoo|piwi|toon|cartoon|ludo|teletoon|baby|famille|family|disney|nick/],
  ['Sport', /\bauto\b|sport|cricket|kabaddi|foot|\bequipe\b|rugby|tennis|golf|moto|fight|combat|racing|\bf1\b|ufc|nba|nfl|olymp|athle|surf|bike|velo|cyclisme|equidia|chess|echecs|poker|wwe|catch/],
  ['Info', /\binfo|news|\bbfm\b|cnews|\blci\b|france ?24|euronews|i24|\blcp\b|public senat|journal|actu|meteo|weather|bloomberg|cnn|\bsky\b|rfi\b|tv5monde info|figaro|(?<!tout )le monde|politique|business|legislative|\d+ ?24\b|24 ?\d*$|africa ?24|francophonie/],
  ['Histoire', /histoire|history|patrimoine|guerre|\bwar\b|heritage|chasse/],
  ['Documentaire', /outdoor|docu|decouverte|discovery|nature|science|animaux|animal|wild|planete|planet|explore|geo\b|national ?geo|ushuaia|voyage|travel|sciences?|crime|enquete|investigation|survival/],
  ['Films', /film|cine|movie|cinema|western|thriller|horreur|horror|action|polar|comedie\b|comedy|hollywood|classic|blockbuster/],
  ['Séries', /sci.?fi|13 ?e(me)? rue|serie|series|sitcom|feuilleton|telenovela|novela|drama|soap/],
  ['Musique', /music|musique|hits\b|radio|\bclip|mezzo|jazz|\brap\b|rock|classique|concert|\bmtv|trace|\bmcm\b|karaoke|dance|electro|\bfm\b|\bnrj\b|\bm6 music/],
  ['Culture', /\barte\b|culture|\bart\b|theatre|opera|kto|savoir|education|educatif|science|langue|\bted\b|museum|musee|litter|livre|religion|religious|spirit|devotional|bhakti/],
  ['Cuisine & maison', /cooking|cuisine|food|chef|maison|deco|jardin|garden|home|recette|gastro|bricol|lifestyle|mode\b|fashion|beaute|shopping|qvc|teleshopping/],
  ['Généraliste', /\btf1\b|france ?[2-5]\b|\bm6\b|\bw9\b|\btmc\b|\btfx\b|\bc8\b|\bnrj ?12\b|\bcstar\b|\b6ter\b|rmc|cherie|tv5|\bt18\b|\bnovo\b|\bl'?equipe\b|\btv ?breizh|\bbfm ?tv|locale|regional|region|chaine|\btv\b|\btv ?\d+|\d+ ?tv\b|^tv|tele|bfm ?2/],
];

/** Catégorie d'une chaîne : d'après son nom d'abord, puis le groupe de sa liste. */
export function channelCat(title, group) {
  const t = norm(title), g = norm(group);
  // Le nom de la chaîne prime (« Pluto TV Naruto » dans le groupe « Divertissement » reste un animé)
  for (const [cat, re] of RULES) if (cat !== 'Généraliste' && re.test(t)) return cat;
  for (const [cat, re] of RULES) if (cat !== 'Généraliste' && re.test(g)) return cat;
  if (/\btnt\b|general|france ?tv|generaliste|entertain|divertissement|\bgeneral\b/.test(g)) return 'Généraliste';
  return RULES.find(([c]) => c === 'Généraliste')[1].test(t) ? 'Généraliste' : 'Autres';
}

/** Chaîne à ne jamais cacher, même si un test échoue : Mayotte La 1ère et les autres La 1ère ne diffusent
 *  pas tous leurs programmes en continu sur Internet (écran noir pendant certains programmes). */
export const neverHide = (title) => /\b(la )?1(è|e)re\b|mayotte/i.test(String(title || ''));
