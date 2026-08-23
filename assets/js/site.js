/* =========================================================
   Cilbs v3.1 — Site interactions
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
    document.querySelectorAll("[data-reveal], [data-reveal-stagger]").forEach((el) => io.observe(el));

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
      "[cilbs] contact form has no endpoint: replace YOUR_FORM_ID in the form action."
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
