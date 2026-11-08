'use client';
// Mes statistiques : l'année en un coup d'œil (heures, calendrier jour par jour), puis le détail
// (mois, jours de la semaine, heures de la journée, films / séries / animés, genres, titres préférés).
import { shared } from '../../lib/shared';
import { useApi, useTitle, go, img } from '../../lib/hooks';
import { useVenus } from '../Venus';
import { PageError, PageLoading } from '../PageState';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const DAYS_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const KIND = { movie: 'Films', show: 'Séries', anime: 'Animés', clip: 'Clips' };
const nf = (n) => String(n).replace('.', ',');
const fh = (x) => (!x ? '0 h' : x < 1 ? `${Math.max(1, Math.round(x * 60))} min` : `${nf(x >= 100 ? Math.round(x) : Math.round(x * 10) / 10)} h`);
const fm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`);

export default function Stats() {
  const { search } = useVenus();
  const year = Number(search && search.get('annee')) || new Date().getFullYear();
  const { data: d, error } = useApi(`/api/stats?year=${year}`);
  useTitle('Mes statistiques');
  const name = shared().app.state.profile.name;
  if (error) return <PageError error={error} />;
  if (!d) return <PageLoading />;
  const years = d.years.length ? d.years : [year];
  const head = (
    <div className="page-head">
      <div className="head-left"><h1>Mes statistiques</h1><p className="count">{name}</p></div>
      <button className="btn btn-small f" onClick={() => go(`/retrospective?annee=${year}`)}>{`Ma rétrospective ${year}`}</button>
      {years.length > 1 ? (
        <div className="seg" role="radiogroup" aria-label="Année">
          {years.slice(0, 5).map((y) => <button key={y} className={`seg-b f${y === year ? ' on' : ''}`} role="radio" aria-checked={String(y === year)} onClick={() => go(`/stats?annee=${y}`, { replace: true })}>{y}</button>)}
        </div>
      ) : null}
    </div>
  );
  if (!d.totalHours && !d.movies && !d.episodes) {
    return <main className="with-nav page-in"><div className="page stats">{head}<div className="empty"><h2>{`Rien de regardé en ${year} pour l’instant`}</h2><p>Lancez un film ou un épisode : vos statistiques se rempliront toutes seules.</p></div></div></main>;
  }
  const days = Math.floor(d.totalHours / 24);
  const showSub = (x) => [x.eps ? `${x.eps} ép.` : null, fh(x.hours)].filter(Boolean).join(' · ');
  return (
    <main className="with-nav page-in">
      <div className="page stats">
        {head}
        <section className="st-hero">
          <div className="st-big"><b>{fh(d.totalHours)}</b><span>{`regardées en ${year}${days >= 1 ? ` · plus de ${days} jour${days > 1 ? 's' : ''} entier${days > 1 ? 's' : ''}` : ''}`}</span></div>
          <p className="st-story">
            {d.genres[0] ? <>Genre préféré : <strong>{d.genres[0].name}</strong>. </> : null}
            {d.topShows[0] && d.topShows[0].eps ? <>Série la plus suivie : <strong>{d.topShows[0].title}</strong>. </> : null}
            {d.topAnime && d.topAnime[0] && d.topAnime[0].eps ? <>Animé le plus suivi : <strong>{d.topAnime[0].title}</strong>. </> : null}
            {d.bestMonth && d.bestMonth.hours ? <>Plus gros mois : <strong>{MONTHS_LONG[d.bestMonth.m]}</strong>. </> : null}
            {d.person ? <>Vous avez beaucoup vu <strong>{d.person}</strong>.</> : null}
          </p>
          <div className="st-kpis">
            <Kpi v={String(d.movies)} label={d.movies > 1 ? 'films vus' : 'film vu'} />
            <Kpi v={String(d.episodes)} label={d.episodes > 1 ? 'épisodes vus' : 'épisode vu'} />
            <Kpi v={String(d.days)} label="jours avec une lecture" />
            <Kpi v={`${d.streak} j`} label="plus longue série de jours" />
            <Kpi v={fh(d.allTimeHours)} label="depuis le début" />
          </div>
        </section>
        <Calendar year={year} data={d.calendar || {}} />
        <div className="st-grid two">
          <Box title="Mois par mois"><Columns items={d.months.map((m) => ({ label: MONTHS[m.m].slice(0, 3), value: m.hours, tip: `${MONTHS_LONG[m.m]} : ${fh(m.hours)}` }))} /></Box>
          <Box title="Films, séries, animés"><Bars items={(d.byKind || []).filter((k) => k.hours).map((k) => ({ label: KIND[k.kind], value: k.hours }))} /></Box>
          <Box title="Jours de la semaine"><Columns items={(d.weekdays || []).map((w) => ({ label: DAYS[w.w], value: w.hours, tip: `${DAYS_LONG[w.w]} : ${fh(w.hours)}` }))} /></Box>
          <Box title="Heures de la journée"><Columns thin items={(d.hoursOfDay || []).map((x) => ({ label: x.h % 6 === 0 ? `${x.h} h` : '', value: x.hours, tip: `${x.h} h – ${x.h + 1} h : ${fh(x.hours)}` }))} /></Box>
        </div>
        <div className="st-grid">
          <Box title="Genres">{d.genres.length ? <Bars items={d.genres.map((g) => ({ label: g.name, value: g.hours }))} /> : <p className="muted">Pas encore assez de données.</p>}</Box>
          <Top title="Séries les plus regardées" list={d.topShows} sub={showSub} />
          <Top title="Animés les plus regardés" list={d.topAnime} sub={showSub} />
          <Top title="Derniers films vus" list={d.lastMovies} sub={(x) => new Date(x.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} />
        </div>
      </div>
    </main>
  );
}

const Kpi = ({ v, label }) => <div className="st-kpi"><b>{v}</b><span>{label}</span></div>;
const Box = ({ title, children }) => <section className="dash-box st-box"><div className="dash-title"><h2>{title}</h2></div>{children}</section>;

function Top({ title, list, sub }) {
  return (
    <Box title={title}>
      {list && list.length ? (
        <div className="st-top">
          {list.map((x) => (
            <button key={`${x.id}-${x.at || ''}`} className="st-top-row f" onClick={() => go(`/titre/${x.id}`)}>
              {x.poster ? <img src={img(x.poster)} alt="" loading="lazy" /> : <span className="st-ph" />}
              <b>{x.title}</b><span>{sub(x)}</span>
            </button>
          ))}
        </div>
      ) : <p className="muted">Rien pour l’instant.</p>}
    </Box>
  );
}

// Barres verticales, valeur au survol (et en clair sur la plus haute)
function Columns({ items, thin = false }) {
  const max = Math.max(0.0001, ...items.map((x) => x.value));
  const peak = items.reduce((a, b) => (b.value > a.value ? b : a), items[0] || { value: 0 });
  return (
    <div className={`st-cols${thin ? ' thin' : ''}`} role="img" aria-label={items.map((x) => x.tip).join(', ')}>
      {items.map((x, i) => (
        <div key={i} className="st-col" title={x.tip}>
          <span className="st-val">{x === peak && x.value ? fh(x.value) : ''}</span>
          <i className={x.value ? '' : 'zero'} style={{ height: `${x.value ? Math.max(4, Math.round((x.value / max) * 100)) : 2}%` }} />
          <small>{x.label}</small>
        </div>
      ))}
    </div>
  );
}

// Barres horizontales : libellé, barre, valeur
function Bars({ items }) {
  const max = Math.max(0.0001, ...items.map((x) => x.value));
  return (
    <div className="st-bars">
      {items.map((x) => (
        <div key={x.label} className="st-bar" title={`${x.label} : ${fh(x.value)}`}>
          <span>{x.label}</span><div className="meter"><i style={{ width: `${Math.max(2, (x.value / max) * 100)}%` }} /></div><b>{fh(x.value)}</b>
        </div>
      ))}
    </div>
  );
}

// Calendrier façon « contributions » : 7 lignes (lundi → dimanche), une colonne par semaine
function Calendar({ year, data }) {
  const end = new Date(year, 11, 31);
  const first = new Date(year, 0, 1); first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const vals = Object.values(data).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 1);
  const steps = [q(0.25), q(0.5), q(0.75)];
  const level = (v) => (!v ? 0 : v <= steps[0] ? 1 : v <= steps[1] ? 2 : v <= steps[2] ? 3 : 4);
  const cells = [], labels = [];
  const today = new Date();
  for (let w = 0, dte = new Date(first); dte <= end; w++) {
    for (let k = 0; k < 7; k++, dte.setDate(dte.getDate() + 1)) {
      const key = `${dte.getFullYear()}-${String(dte.getMonth() + 1).padStart(2, '0')}-${String(dte.getDate()).padStart(2, '0')}`;
      const inYear = dte.getFullYear() === year, future = dte > today;
      const v = data[key] || 0;
      cells.push(<i key={key} className={`cal-c l${inYear && !future ? level(v) : 'x'}`} style={{ gridColumn: w + 1, gridRow: k + 1 }}
        title={inYear ? `${dte.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} : ${v ? fm(v) : 'rien'}` : ''} />);
      if (inYear && dte.getDate() === 1) labels.push(<small key={`m${dte.getMonth()}`} style={{ gridColumn: w + 1 }}>{MONTHS[dte.getMonth()].slice(0, 4)}</small>);
    }
  }
  const active = vals.length;
  return (
    <section className="dash-box st-cal-box">
      <div className="dash-title"><h2>Jour par jour</h2><span className="muted">{`${active} jour${active > 1 ? 's' : ''} avec une lecture`}</span></div>
      <div className="st-cal-scroll">
        <div className="st-cal-months">{labels}</div>
        <div className="st-cal" role="img" aria-label={`Calendrier ${year} : ${active} jours avec une lecture`}>{cells}</div>
      </div>
      <div className="st-cal-legend"><small>Moins</small>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`cal-c l${l}`} />)}<small>Plus</small></div>
    </section>
  );
}
