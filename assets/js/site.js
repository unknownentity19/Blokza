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
        buttons.forEach((x) => x.classList.toggle("is-on", x === b));
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
(function () {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  // Split headlines into words for staggered reveal
  document.querySelectorAll(".reveal-words").forEach((el) => {
    if (el.dataset.split) return;
    el.dataset.split = "1";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const frag = document.createDocumentFragment();
      const parts = node.nodeValue.split(/(\s+)/);
      parts.forEach((p) => {
        if (!p) return;
        if (/^\s+$/.test(p)) {
          frag.appendChild(document.createTextNode(p));
        } else {
          const w = document.createElement("span");
          w.className = "word";
          const inner = document.createElement("span");
          inner.textContent = p;
          w.appendChild(inner);
          frag.appendChild(w);
        }
      });
      node.parentNode.replaceChild(frag, node);
    });
    el.querySelectorAll(".word > span").forEach((s, i) => {
      s.style.transitionDelay = (i * 0.05) + "s";
    });
  });

  // Re-observe new reveal targets added by submenu changes
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(
      "[data-reveal-scale]:not(.is-visible),[data-reveal-left]:not(.is-visible),[data-reveal-right]:not(.is-visible),.reveal-words:not(.is-visible)"
    ).forEach((el) => io.observe(el));
  }

  // Cursor tracking on .card-hover for spotlight effect
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

  // Magnetic buttons (subtle attraction to cursor).
  // Uses the independent `translate` property so it never clobbers the
  // hover/active `transform` styles applied by CSS.
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

  // Parallax on hero glow
  const heroBg = document.querySelector(".hero");
  if (heroBg) {
    let raf = 0;
    document.addEventListener("mousemove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 20;
        const y = (e.clientY / window.innerHeight - 0.5) * 20;
        heroBg.style.setProperty("--parallax-x", x + "px");
        heroBg.style.setProperty("--parallax-y", y + "px");
        raf = 0;
      });
    });
  }

  /* ================================================================
     Infinite marquee — pixel-perfect seamless loop.
     Clone items enough times so there's never blank space,
     then scroll by exactly one set-width for a seamless reset.
     ================================================================ */

  let marqueeId = 0;

  function initMarquee(track, speed) {
    if (!track || track.dataset.cloned) return;

    const items = Array.from(track.children);
    if (items.length === 0) return;

    /*
     * The gap is read from the stylesheet rather than passed in. It used to be
     * hardcoded here as 20 and 56 to match pages.css, which meant the loop broke
     * silently — and only visibly, as a jump — the moment either value changed.
     */
    function gapOf() {
      const cs = getComputedStyle(track);
      return parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0;
    }

    function measureSet() {
      const gap = gapOf();
      let width = 0;
      items.forEach((item) => { width += item.offsetWidth + gap; });
      return width;
    }

    // Clone whole sets until the track is wider than the viewport plus one set,
    // so no blank space can appear even if the window is later widened.
    const viewportW = Math.max(window.innerWidth, 1920);
    let currentWidth = measureSet();
    const minWidth = viewportW + currentWidth;
    while (currentWidth < minWidth) {
      items.forEach((item) => {
        const clone = item.cloneNode(true);
        clone.setAttribute("aria-hidden", "true");
        track.appendChild(clone);
      });
      currentWidth += measureSet();
    }
    track.dataset.cloned = "true";

    const id = "marquee-" + (marqueeId++);
    const style = document.createElement("style");
    document.head.appendChild(style);

    /*
     * Scroll by exactly one set width, so the reset lands on an identical frame.
     * Re-applied whenever the measurement could have changed: a set measured
     * before the webfont swapped was 6px narrower than the real thing, and that
     *6px showed up as a visible jump on every single loop.
     */
    function apply() {
      const setWidth = measureSet();
      if (!setWidth) return;
      style.textContent =
        "@keyframes " + id +
        " { from { transform: translate3d(0,0,0); }" +
        " to { transform: translate3d(-" + setWidth + "px,0,0); } }";
      track.style.animation = id + " " + (setWidth / speed) + "s linear infinite";
    }

    apply();

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(apply, 200);
    }, { passive: true });
  }

  /*
   * Measure once the fonts are settled. Text items are narrower in the fallback
   * face, so measuring at parse time bakes the wrong loop distance into the
   * keyframes. `document.fonts.ready` already resolves immediately when there is
   * nothing left to load, and the `catch` covers browsers without the API.
   */
  function startMarquees() {
    document.querySelectorAll(".reviews__rail").forEach((rail) => initMarquee(rail, 30));
    document.querySelectorAll(".logos-marquee__track").forEach((track) => initMarquee(track, 35));
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(startMarquees).catch(startMarquees);
  } else {
    window.addEventListener("load", startMarquees);
  }
})();
