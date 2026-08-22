/**
 * Builds a realistic multi-page site through the ordinary editor actions.
 *
 * Development only — `main.tsx` imports it behind `import.meta.env.DEV`, so it
 * is dropped from the production bundle.
 *
 * It exists because the bugs that matter only appear at size. A single page with
 * three sections behaves perfectly; seven pages that each began with their own
 * copy of the nav bar is where duplicated headers, stale `<title>` tags and
 * seven-times-over editing show up. Reaching that state by hand takes a few
 * hundred clicks, which is exactly why it went untested for so long.
 *
 * Every step below goes through the same store actions the UI calls, so what
 * this produces is what a person clicking the same things would get.
 */

import { useEditor } from '../store/editor';
import { TEMPLATES } from '../registry/templates';

const PAGES: { name: string; path: string; sections: string[] }[] = [
  { name: 'Home', path: '/', sections: ['navbar', 'hero-split', 'logos', 'feature-grid', 'stats', 'testimonials', 'cta', 'footer'] },
  { name: 'Work', path: '/work', sections: ['navbar', 'hero-center', 'gallery', 'testimonials', 'cta', 'footer'] },
  { name: 'Services', path: '/services', sections: ['navbar', 'hero-center', 'feature-grid', 'feature-alt', 'faq', 'cta', 'footer'] },
  { name: 'Pricing', path: '/pricing', sections: ['navbar', 'hero-center', 'pricing', 'faq', 'cta', 'footer'] },
  { name: 'About', path: '/about', sections: ['navbar', 'hero-split', 'stats', 'logos', 'testimonials', 'footer'] },
  { name: 'Journal', path: '/journal', sections: ['navbar', 'hero-center', 'gallery', 'cta', 'footer'] },
  { name: 'Contact', path: '/contact', sections: ['navbar', 'hero-center', 'contact', 'footer'] },
];

/** Nav labels and their destinations, applied once to the shared nav bar. */
const NAV: [string, string][] = [
  ['Work', '/work'],
  ['Services', '/services'],
  ['Pricing', '/pricing'],
  ['About', '/about'],
];

/**
 * Destinations for the buttons the section templates ship with, keyed by the
 * label they arrive with.
 *
 * Without these the demo was a seven-page site with a four-item nav, which left
 * Journal and Contact reachable only by typing the URL — the site map flagged
 * both as unlinked, correctly, and the map had no content links at all to draw.
 * A real site reaches those pages exactly this way: from a call to action in the
 * page body rather than from the nav.
 */
const BUTTON_LINKS: Record<string, { href: string; label?: string }> = {
  'Open the editor': { href: '/contact', label: 'Start a project' },
  'Talk to us': { href: '/contact' },
  'See a demo': { href: '/journal', label: 'Read the journal' },
};

function template(id: string) {
  const found = TEMPLATES.find((entry) => entry.id === id);
  if (!found) throw new Error(`seedDemo: no template "${id}"`);
  return found;
}

export function seedDemo(options: { select?: 'section' } = {}): void {
  const s = () => useEditor.getState();

  s().resetDoc();
  s().setSiteName('Northwind Studio');

  for (const [index, spec] of PAGES.entries()) {
    if (index === 0) {
      s().updatePage(s().doc.pages[0].id, { name: spec.name });
    } else {
      s().addPage();
      s().updatePage(s().doc.pages[index].id, { name: spec.name, path: spec.path });
    }
    s().selectPage(s().doc.pages[index].id);
    for (const id of spec.sections) s().insertTemplate(template(id));

    // Give the page's own buttons somewhere to go. Plain traversal stops at a
    // shared reference, so the nav bar is not touched here — it is pointed at
    // real pages once, below, for all seven pages at the same time.
    const onPage: string[] = [];
    const collect = (id: string): void => {
      const node = s().doc.nodes[id];
      if (!node) return;
      onPage.push(id);
      for (const child of node.children) collect(child);
    };
    collect(s().pageRootId());
    for (const id of onPage) {
      const node = s().doc.nodes[id];
      const label = typeof node?.props.label === 'string' ? node.props.label : '';
      const target = BUTTON_LINKS[label];
      if (!target) continue;
      s().setProp(id, 'href', target.href);
      if (target.label) s().setProp(id, 'label', target.label);
    }
  }

  // Unify the nav bar and footer every page got its own copy of.
  s().selectPage(s().doc.pages[0].id);
  const rootChildren = () => s().doc.nodes[s().pageRootId()].children;
  const first = rootChildren()[0];
  const last = rootChildren()[rootChildren().length - 1];
  s().shareSection(first);
  s().shareSection(rootChildren()[rootChildren().length - 1] === last ? last : rootChildren()[rootChildren().length - 1]);

  // Point the shared nav at real pages, once, for all seven.
  const master = (s().doc.shared ?? [])[0];
  if (master) {
    const links: string[] = [];
    const walk = (id: string): void => {
      const node = s().doc.nodes[id];
      if (!node) return;
      if (node.type === 'link') links.push(node.id);
      for (const child of node.children) walk(child);
    };
    walk(master.rootId);
    links.slice(0, NAV.length).forEach((id, i) => {
      s().setProp(id, 'label', NAV[i][0]);
      s().setProp(id, 'href', NAV[i][1]);
    });

    // The nav's own call to action. It is a button rather than a link, so the
    // loop above never reaches it, and it left the nav's most prominent control
    // pointing nowhere.
    const navButton = Object.values(s().doc.nodes).find(
      (node) => node.type === 'button' && node.props.label === 'Start free',
    );
    if (navButton) s().setProp(navButton.id, 'href', '/contact');
  }

  // Reviewing the canvas panels needs something selected; reviewing the page
  // panel needs nothing selected. The caller decides which.
  s().select(options.select === 'section' ? rootChildren()[1] ?? null : null);
  s().toast(`Demo site: ${s().doc.pages.length} pages`, 'success');
}
