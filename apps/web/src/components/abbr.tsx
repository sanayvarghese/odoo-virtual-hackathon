"use client";

/**
 * Hover/focus tooltip for abbreviations: MRR, GST, SKU…
 * Keyboard accessible (tab to it), pure CSS reveal — no JS.
 */
export function Abbr({ term, full }: { term: string; full: string }) {
  return (
    <span className="abbr" tabIndex={0} aria-label={`${term}: ${full}`}>
      {term}
      <span className="abbr-tip" role="tooltip">
        <b>{term}</b> — {full}
      </span>
    </span>
  );
}
