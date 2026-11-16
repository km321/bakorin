// Header checks shared by the starter and template e2e runs.
import type { Page } from "playwright";

export interface NavReport {
  ok: boolean;
  detail: string;
}

/**
 * The header's brand, links, and Sign in or user menu share one center line.
 * Measures the text itself (not the boxes), so a link stretched to the row height
 * with its text stuck at the top still fails. Items that wrapped onto another row
 * (narrow screens) are compared with their own row. Also fails when a control sticks out of the header
 * or more than one link is marked as the current page.
 */
export async function navReport(page: Page, tolerance = 1.5): Promise<NavReport> {
  return page.evaluate((tolerance) => {
    const header = document.querySelector(".site-header");
    const nav = header?.querySelector("nav");
    if (!header || !nav) return { ok: false, detail: "no .site-header nav" };
    const textBox = (el: Element) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let top = Infinity;
      let bottom = -Infinity;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.height) continue;
          top = Math.min(top, rect.top);
          bottom = Math.max(bottom, rect.bottom);
        }
      }
      return top === Infinity ? null : { top, bottom, center: (top + bottom) / 2 };
    };
    const items: { label: string; center: number }[] = [];
    const brand = header.querySelector(".brand");
    for (const el of [brand, ...nav.children]) {
      if (!el || !(el instanceof HTMLElement) || !el.offsetParent) continue;
      // Measure the name, not the panel, inside the user menu.
      const target = el.querySelector(".bk-user-menu__name, .bk-user-menu__button") ?? el;
      const box = textBox(target);
      if (box) items.push({ label: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24), center: box.center });
    }
    if (items.length < 2) return { ok: false, detail: `only ${items.length} header items` };
    // Group into rows: a new row starts when the next center is well below the last.
    const sorted = [...items].sort((a, b) => a.center - b.center);
    const rows: (typeof items)[] = [[sorted[0]!]];
    for (const item of sorted.slice(1)) {
      const row = rows[rows.length - 1]!;
      if (item.center - row[row.length - 1]!.center > 12) rows.push([item]);
      else row.push(item);
    }
    const problems: string[] = [];
    for (const row of rows) {
      const spread = row[row.length - 1]!.center - row[0]!.center;
      if (spread > tolerance) problems.push(`${row.map((i) => `${i.label}@${i.center.toFixed(1)}`).join(", ")} spread ${spread.toFixed(1)}px`);
    }
    const currents = nav.querySelectorAll('[aria-current="page"]').length;
    if (currents > 1) problems.push(`${currents} links marked as the current page`);
    const edge = header.getBoundingClientRect().right;
    for (const el of header.querySelectorAll("a, button, summary")) {
      const right = el.getBoundingClientRect().right;
      if (right > Math.min(edge, window.innerWidth) + 1) problems.push(`${(el.textContent ?? "").trim().slice(0, 24)} sticks out of the header (${right.toFixed(0)} > ${Math.min(edge, window.innerWidth).toFixed(0)})`);
    }
    return { ok: problems.length === 0, detail: problems.join("; ") || `${items.length} items in ${rows.length} row(s)` };
  }, tolerance);
}
