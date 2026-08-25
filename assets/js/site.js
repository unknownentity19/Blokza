/* =========================================================
   SAASWISE v3.1 — Site interactions
   ========================================================= */
(function () {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Mobile nav
  const toggle = document.querySelector("[data-nav-toggle]");
  const mobile = document.querySelector("[data-nav-mobile]");
  if (toggle && mobile) {
    toggle.addEventListener("click", () => {
      const open = mobile.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  // Sticky-nav state
  const nav = document.querySelector(".site-nav");
  function onScroll() {
    const h = document.documentElement;
    if (nav) nav.classList.toggle("is-stuck", h.scrollTop > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Reveal observer
  const revealSelector = "[data-reveal], [data-reveal-stagger], [data-reveal-scale], [data-reveal-left], [data-reveal-right], .reveal-words";
  if ("IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -60px 0px" }
    );
    /*
     * Observe everything `revealSelector` names, not a subset of it.
     *
     * This observed only [data-reveal] and [data-reveal-stagger] while the
     * selector above also covers -scale, -left, -right and .reveal-words. Those
     * start at opacity 0 in base.css, so anything using them was invisible: on
     * features-builder.html and features-responsive.html the hero screenshot
     * never appeared at all unless the visitor had reduced motion on, because
     * the only other thing that adds `is-visible` is the safety sweep below,
     * and that fires for elements already scrolled *above* the viewport.
     */
    document.querySelectorAll(revealSelector).forEach((el) => io.observe(el));

    // Safety sweep: fast/jump scrolling (anchor links, End key, scrollbar drags)
    // can move elements past the viewport before the observer fires, leaving
    // content permanently invisible. Reveal anything that ends up above the fold.
    let sweepRaf = 0;
    function sweep() {
      sweepRaf = 0;
      document.querySelectorAll(revealSelector).forEach((el) => {
        if (el.classList.contains("is-visible")) return;
        const r = el.getBoundingClientRect();
        if (r.bottom < 140 && r.height > 0) el.classList.add("is-visible");
      });
    }
    function queueSweep() {
      if (!sweepRaf) sweepRaf = requestAnimationFrame(sweep);
    }
    window.addEventListener("scroll", queueSweep, { passive: true });
    window.addEventListener("resize", queueSweep, { passive: true });
    window.addEventListener("load", queueSweep);
    queueSweep();
  } else {
    document.querySelectorAll(revealSelector).forEach((el) => el.classList.add("is-visible"));
  }

  // Tabs (Validate / Track / Optimize / Scale)
  document.querySelectorAll('[data-tabs]').forEach((root) => {
    const tabs = root.querySelectorAll(".tab");
    const panels = document.querySelectorAll("[data-tab-panel]");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
        const id = tab.dataset.tabFor;
        panels.forEach((p) => {
          const match = p.dataset.tabPanel === id;
          p.hidden = !match;
          // re-trigger metric bar fill animation
          if (match) {
            p.classList.remove("is-visible");
            void p.offsetWidth;
            p.classList.add("is-visible");
          } else {
            p.classList.remove("is-visible");
          }
        });
      });
    });
    // initialize first panel as visible
    const first = root.parentElement.querySelector('[data-tab-panel]:not([hidden])');
    if (first) first.classList.add("is-visible");
  });

  // Pricing toggle
  document.querySelectorAll('[data-toggle="pricing"]').forEach((root) => {
    const buttons = root.querySelectorAll("button");
    const targets = document.querySelectorAll("[data-monthly], [data-yearly]");
    buttons.forEach((b) => {
      b.addEventListener("click", () => {
        buttons.forEach((x) => {
          const on = x === b;
          x.classList.toggle("is-on", on);
          // The visual state was carried by a class alone, so the control looked
          // toggled and announced nothing.
          x.setAttribute("aria-pressed", String(on));
        });
        const mode = b.dataset.mode || "monthly";
        targets.forEach((t) => {
          if (t.hasAttribute("data-monthly") && t.hasAttribute("data-yearly")) {
            t.textContent = mode === "yearly" ? t.dataset.yearly : t.dataset.monthly;
          }
        });
      });
    });
  });

  // Active nav link
  const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll(".site-nav__links a, .site-nav__mobile a").forEach((a) => {
    const href = (a.getAttribute("href") || "").toLowerCase();
    if (href === path) a.classList.add("is-active");
  });

  // Footer year
  document.querySelectorAll("[data-year]").forEach((y) => { y.textContent = String(new Date().getFullYear()); });

  // Animated counters [data-count="42"] data-suffix data-prefix
  const counters = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window && !reduced && counters.length) {
    const cio = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || e.target.dataset.done) continue;
        e.target.dataset.done = "1";
        animateCount(e.target);
        cio.unobserve(e.target);
      }
    }, { threshold: 0.4 });
    counters.forEach((el) => cio.observe(el));
  } else {
    counters.forEach((el) => { el.textContent = (el.dataset.prefix||"") + el.dataset.count + (el.dataset.suffix||""); });
  }
  function animateCount(el) {
    const target = parseFloat(el.dataset.count);
    if (Number.isNaN(target)) return;
    const decimals = (el.dataset.count.split(".")[1] || "").length;
    const suffix = el.dataset.suffix || "";
    const prefix = el.dataset.prefix || "";
    const dur = 1400;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = prefix + (target * eased).toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
})();


/* Submenu toggles (click + keyboard, in addition to CSS hover) */
(function () {
  document.querySelectorAll(".has-submenu").forEach((li) => {
    const trigger = li.querySelector(".submenu-trigger");
    if (!trigger) return;
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = li.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", String(open));
      // Close other submenus
      document.querySelectorAll(".has-submenu.is-open").forEach((other) => {
        if (other !== li) {
          other.classList.remove("is-open");
          const t = other.querySelector(".submenu-trigger");
          if (t) t.setAttribute("aria-expanded", "false");
        }
      });
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".has-submenu.is-open").forEach((li) => {
      li.classList.remove("is-open");
      const t = li.querySelector(".submenu-trigger");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".has-submenu.is-open").forEach((li) => {
        li.classList.remove("is-open");
        const t = li.querySelector(".submenu-trigger");
        if (t) t.setAttribute("aria-expanded", "false");
      });
    }
  });

  /*
   * The panel also opens on `:hover` and `:focus-within`, purely in CSS — and
   * only the click path above told anyone about it, so `aria-expanded` stayed
   * "false" while the panel was plainly open. Assistive technology reads the
   * attribute, not the stylesheet, so it described a collapsed menu that was on
   * screen. These mirror the two CSS conditions.
   */
  document.querySelectorAll(".has-submenu").forEach((li) => {
    const trigger = li.querySelector(".submenu-trigger");
    if (!trigger) return;
    const sync = (open) => {
      // A click-opened panel owns the state; do not let a passing pointer close it.
      if (li.classList.contains("is-open")) return;
      trigger.setAttribute("aria-expanded", String(open));
    };
    li.addEventListener("pointerenter", () => sync(true));
    li.addEventListener("pointerleave", () => sync(false));
    li.addEventListener("focusin", () => sync(true));
    li.addEventListener("focusout", (e) => {
      if (!li.contains(e.relatedTarget)) sync(false);
    });
  });
})();



/* ============ Pointer and reveal effects ============
   Restored. Removing the logo marquee took this whole IIFE with it, and the
   marquee was only the last thing in it: the headline word-split, a second
   observer for the -scale/-left/-right reveal variants, the card spotlight, the
   magnetic buttons and the hero parallax all went too. Their CSS and markup
   were left behind driving nothing, which is why two feature pages rendered
   their hero screenshot at opacity 0. The marquee itself is not restored -
   nothing on the site uses it any more. */
(function () {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  // Split headlines into words so `.reveal-words .word > span` has something to
  // animate. Without this the class is inert and the CSS matches nothing.
  document.querySelectorAll(".reveal-words").forEach((el) => {
    if (el.dataset.split) return;
    el.dataset.split = "1";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const frag = document.createDocumentFragment();
      const parts = node.nodeValue.split(/(\s+)/);
      parts.forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          return;
        }
        const word = document.createElement("span");
        word.className = "word";
        const inner = document.createElement("span");
        inner.textContent = part;
        word.appendChild(inner);
        frag.appendChild(word);
      });
      node.parentNode.replaceChild(frag, node);
    });
    el.querySelectorAll(".word > span").forEach((inner, i) => {
      inner.style.transitionDelay = (i * 0.05) + "s";
    });
  });

  // Cursor spotlight on .card-hover — base.css reads --mx/--my.
  document.querySelectorAll(".card-hover").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
    card.addEventListener("mouseleave", () => {
      card.style.removeProperty("--mx");
      card.style.removeProperty("--my");
    });
  });

  // Magnetic buttons. Uses the independent `translate` property so it never
  // clobbers the hover/active `transform` the stylesheet applies.
  document.querySelectorAll("[data-magnetic]").forEach((el) => {
    const strength = parseFloat(el.dataset.magnetic) || 0.3;
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * strength;
      const y = (e.clientY - (r.top + r.height / 2)) * strength;
      el.style.translate = x.toFixed(1) + "px " + y.toFixed(1) + "px";
    });
    el.addEventListener("mouseleave", () => { el.style.translate = ""; });
  });

  // Cursor parallax on the hero glow — pages.css reads --parallax-x/y.
  const hero = document.querySelector(".hero");
  if (hero) {
    let raf = 0;
    document.addEventListener("mousemove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        hero.style.setProperty("--parallax-x", ((e.clientX / window.innerWidth - 0.5) * 20) + "px");
        hero.style.setProperty("--parallax-y", ((e.clientY / window.innerHeight - 0.5) * 20) + "px");
        raf = 0;
      });
    });
  }
})();

/* Contact form: real submit with success/error states */
(function () {
  const form = document.getElementById("contact-form");
  if (!form) return;
  const successEl = form.querySelector("[data-success]");
  const errorEl = form.querySelector("[data-error]");
  const btn = form.querySelector("button[type='submit']");

  // The form action ships with a placeholder that has to be replaced with a real
  // endpoint id. Until it is, every submit would spend a few seconds saying
  // "Sending..." and then fail — so the fallback (which names a real address) is
  // shown straight away instead of after a pointless round-trip.
  const unconfigured = /YOUR_FORM_ID/.test(form.getAttribute("action") || "");
  if (unconfigured) {
    console.warn(
      "[SAASWISE] contact form has no endpoint: replace YOUR_FORM_ID in the form action."
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (successEl) successEl.hidden = true;
    if (errorEl) errorEl.hidden = true;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (unconfigured) {
      if (errorEl) errorEl.hidden = false;
      return;
    }
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const res = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("Submit failed");
      form.reset();
      if (successEl) successEl.hidden = false;
    } catch (err) {
      if (errorEl) errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });
})();


/* ============ Production animation engine ============ */
