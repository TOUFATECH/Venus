'use client';
// Champ de formulaire et liste déroulante, partagés par les réglages, la sécurité et la fiche d'un titre
import { Children, cloneElement, isValidElement, useId } from 'react';

// Le libellé est relié au premier champ (un clic dessus y mène, les lecteurs d'écran et la commande vocale le
// nomment), et l'aide en petit le décrit
const NAMEABLE = new Set(['input', 'select', 'textarea']);
export function Field({ label, hint, children, style }) {
  const id = useId();
  let target = null;
  const kids = Children.map(children, (c) => {
    if (target || !isValidElement(c) || !(NAMEABLE.has(c.type) || c.type === Select)) return c;
    target = c.props.id || `${id}f`;
    return cloneElement(c, { id: target, 'aria-describedby': c.props['aria-describedby'] || (hint ? `${id}h` : undefined) });
  });
  return <div className="field" style={style}><label htmlFor={target || undefined}>{label}</label>{kids}{hint ? <small id={`${id}h`}>{hint}</small> : null}</div>;
}
export function Select({ opts, value, onChange, ...rest }) {
  return <select className="input" defaultValue={String(value ?? '')} onChange={onChange} {...rest}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
