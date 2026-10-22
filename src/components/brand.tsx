export function Brand({ small = false }: { small?: boolean }) {
  return <a className={`brand ${small ? "brand-small" : ""}`} href="#top" aria-label="Nova Digital home">
    <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M7 27V9h6l16 18V9M7 9l22 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
    <span>nova<span className="brand-light">digital</span><span className="brand-dot">.</span></span>
  </a>;
}
