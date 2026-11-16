import Link from "next/link";
import { paragraphs, type Section } from "../lib/sections.ts";

/** Page sections from the sections entity, in position order. The first heading is the page title. */
export function Sections({ sections, emptyText }: { sections: Section[]; emptyText: string }) {
  if (sections.length === 0) {
    return (
      <section className="card">
        <p className="empty">{emptyText}</p>
      </section>
    );
  }
  return (
    <>
      {sections.map((section, index) => {
        const id = `section-${section.id}`;
        return (
          <section key={section.id} className="card" aria-labelledby={id}>
            {index === 0 ? <h1 id={id}>{section.heading}</h1> : <h2 id={id}>{section.heading}</h2>}
            {paragraphs(section.body).map((text, n) => (
              <p key={n}>{text}</p>
            ))}
            {section.ctaLabel && section.ctaHref ? (
              <div className="actions">
                <Link className="button" href={section.ctaHref}>
                  {section.ctaLabel}
                </Link>
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
