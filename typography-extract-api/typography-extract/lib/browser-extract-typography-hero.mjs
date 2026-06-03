/**
 * Runs in the browser via Playwright `page.evaluate`.
 * Must be fully self-contained (no external closures).
 * Returns `{ typographyPage, hero }` for Node-side merging and screenshots.
 */
export default function browserExtractTypographyAndHero() {
  const hex = (rgb) => {
    if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") {
      return "";
    }
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      return (
        "#" + [m[1], m[2], m[3]].map((c) => parseInt(c, 10).toString(16).padStart(2, "0")).join("")
      );
    }
    return rgb;
  };

  const gs = (el, p) => (el ? window.getComputedStyle(el)[p] : "");

  function areaVisible(el) {
    if (!el || el.nodeType !== 1) {
      return 0;
    }
    const r = el.getBoundingClientRect();
    const vh = Math.min(window.innerHeight, 960);
    if (r.height < 48 || r.width < 120) {
      return 0;
    }
    if (r.bottom < 20 || r.top > vh * 0.95) {
      return 0;
    }
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, vh);
    const visH = bottom - top;
    if (visH < 36) {
      return 0;
    }
    return r.width * visH;
  }

  function parseBgUrls(bgi) {
    if (!bgi || bgi === "none") {
      return [];
    }
    const out = [];
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    let m;
    while ((m = re.exec(bgi))) {
      try {
        out.push(new URL(m[2].trim(), document.baseURI).href);
      } catch {
        out.push(m[2].trim());
      }
    }
    return out;
  }

  /**
   * Headline + subcopy + CTAs usually live here; avoids sampling global nav / header links.
   */
  function pickHeroContentRoot(root) {
    if (!root || !root.querySelector) {
      return document.body;
    }
    return (
      root.querySelector("#introtexttop, [id*='introtext']") ||
      root.querySelector(".sr-cover-inner") ||
      root.querySelector(".tile-copy-wrapper, .tile-content") ||
      root.querySelector(".content-wrapper") ||
      root.querySelector(".hs-bannner-text, [class*='bannner-text'], [class*='banner-text']") ||
      root.querySelector(".hero__content, .hero-content, [class*='hero__text']") ||
      root.querySelector(".wpb_wrapper") ||
      root.querySelector(".fusion-builder-row") ||
      root
    );
  }

  function isInsideSiteNav(el) {
    if (!el || !el.closest) {
      return false;
    }
    return !!el.closest(
      "header, nav, [role='navigation'], #header-outer, #top-bar, .site-header, .header-wrapper, .header-inner",
    );
  }

  /**
   * HubSpot DND + Sprocket Rocket modules (e.g. sr-one-col-01) — hero is often a div, not section/header.
   */
  function findHubSpotSrHeroRoot() {
    const moduleSelectors = [
      ".sr-one-col-01",
      ".sr-multicol-media.sr-one-col-01",
      "[class*='sr-one-col-']",
      ".sr-multicol-media",
    ];
    try {
      for (const sel of moduleSelectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (!el.querySelector("h1") || isInsideSiteNav(el)) {
            continue;
          }
          const a = areaVisible(el);
          if (a <= 0) {
            continue;
          }
          return {
            el,
            strategy: "hubspot-sr-module",
            score: a * 1.85,
            found: true,
          };
        }
      }
    } catch {
      /* ignore */
    }
    try {
      for (const el of document.querySelectorAll(".dnd-section, [class*='dnd-section']")) {
        if (!el.querySelector("h1") || isInsideSiteNav(el)) {
          continue;
        }
        const inner =
          el.querySelector(".sr-multicol-media, .widget-type-custom_widget, .dnd-module") || el;
        const a = areaVisible(inner);
        if (a <= 0) {
          continue;
        }
        return {
          el: inner,
          strategy: "hubspot-dnd-section-with-h1",
          score: a * 1.72,
          found: true,
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** First visible page h1 outside global nav/header — fallback when header wins without a title. */
  function findHeroRootFromVisibleH1() {
    let h1s;
    try {
      h1s = document.querySelectorAll("h1");
    } catch {
      return null;
    }
    for (const h1 of h1s) {
      if (isInsideSiteNav(h1)) {
        continue;
      }
      const text = String(h1.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) {
        continue;
      }
      const srMod = h1.closest?.(
        ".sr-multicol-media, .sr-one-col-01, [class*='sr-one-col'], .widget-type-custom_widget, .dnd-module",
      );
      if (srMod && !isInsideSiteNav(srMod) && areaVisible(srMod) > 150) {
        return {
          el: srMod,
          strategy: "h1-sr-module-ancestor",
          score: areaVisible(srMod),
          found: true,
        };
      }
      let a = h1;
      for (let i = 0; i < 12 && a; i++) {
        if (
          a !== document.body &&
          areaVisible(a) > 200 &&
          (a.matches?.("section") ||
            /hero|banner|jumbotron|cover|masthead|sr-one-col|sr-multicol|dnd-section|dnd-module|one-col/i.test(
              `${a.className || ""} ${a.id || ""}`,
            ))
        ) {
          return {
            el: a,
            strategy: "h1-hero-ancestor",
            score: areaVisible(a),
            found: true,
          };
        }
        a = a.parentElement;
      }
      const p = h1.parentElement;
      if (p && p !== document.body && areaVisible(p) > 150) {
        return {
          el: p,
          strategy: "h1-parent",
          score: areaVisible(p),
          found: true,
        };
      }
    }
    return null;
  }

  /**
   * Apple.com and similar: one `<section class="section-hero">` stacks many `.tile-wrapper` promos.
   * Use only the first visible tile — not the whole section (avoids merged CTAs/images).
   */
  function findFirstMultiTileHeroRoot() {
    try {
      const sections = document.querySelectorAll(
        "section.section-hero, section[class*='section-hero'], [class*='section-hero']",
      );
      for (const section of sections) {
        const tiles = section.querySelectorAll(":scope > .tile-wrapper");
        if (tiles.length < 2) {
          continue;
        }
        const first = tiles[0];
        const a = areaVisible(first);
        if (a <= 0) {
          continue;
        }
        return {
          el: first,
          strategy: "multi-tile-first",
          score: a * 1.92,
          found: true,
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function extractHeadingTextFromEl(el) {
    if (!el) {
      return "";
    }
    let t = String(el.textContent || "")
      .trim()
      .replace(/\s+/g, " ");
    if (t) {
      return t;
    }
    try {
      const vh = el.querySelector(
        ".visuallyhidden, .visually-hidden, .sr-only, [class*='visuallyhidden'], [class*='visually-hidden']",
      );
      if (vh) {
        t = String(vh.textContent || "")
          .trim()
          .replace(/\s+/g, " ");
        if (t) {
          return t;
        }
      }
    } catch {
      /* ignore */
    }
    const aria = String(el.getAttribute("aria-label") || "").trim();
    if (aria) {
      return aria.replace(/\s+/g, " ");
    }
    try {
      const tile = el.closest(".tile-wrapper, .tile-content");
      const img = tile?.querySelector(".tile-image-wrapper img, .tile-image-wrapper picture img");
      const alt = String(img?.getAttribute("alt") || "").trim();
      if (alt) {
        const m = alt.match(/^(.+?)(?:\s+apple\s+logo)?$/i);
        return (m ? m[1] : alt).trim();
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  function isHeadingTitleCandidate(el) {
    if (!el) {
      return false;
    }
    const cls = String(el.className || "").toLowerCase();
    if (/tile-headline|headline|hero-title|page-title|display-/.test(cls)) {
      return true;
    }
    if (
      el.querySelector(
        ".visuallyhidden, .visually-hidden, .sr-only, [class*='visuallyhidden'], [class*='visually-hidden']",
      )
    ) {
      return true;
    }
    return !isDisplayHeadingFontSize(gs(el, "fontSize"));
  }

  function isLikelyHeroVideoPosterUrl(url) {
    return /startframe|posterframe|_poster\.|video.*frame/i.test(String(url || ""));
  }

  /** Prefer full-bleed hero assets over Apple-style composite thumbnails. */
  function heroImageUrlRank(url) {
    const u = String(url || "").toLowerCase();
    if (!u || /\.svg(?:\?|$)/i.test(u)) {
      return 0;
    }
    if (/_small(?:\.|__|$)/i.test(u) || /\/small[._-]/i.test(u)) {
      return 0.08;
    }
    if (/_mediumtall(?:\.|__|$)/i.test(u)) {
      return 0.72;
    }
    if (/_medium(?:\.|__|$)/i.test(u)) {
      return 0.55;
    }
    if (/_large(?:\.|__|$)/i.test(u) && !/_largetall/i.test(u)) {
      return 0.9;
    }
    if (/_largetall(?:\.|__|$)/i.test(u)) {
      return 1;
    }
    return 0.75;
  }

  function parseSrcsetLargestUrl(srcset) {
    let bestUrl = "";
    let bestW = 0;
    for (const part of String(srcset || "").split(",")) {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) {
        continue;
      }
      let w = 0;
      if (bits[1]?.endsWith("w")) {
        w = parseInt(bits[1], 10) || 0;
      } else if (bits[1]?.endsWith("x")) {
        w = Math.round(parseFloat(bits[1]) * 1000) || 0;
      }
      if (!bestUrl || w >= bestW) {
        bestUrl = bits[0];
        bestW = w;
      }
    }
    return bestUrl;
  }

  function effectiveHeroMediaScore(entry) {
    const url = entry?.url || "";
    const rank = heroImageUrlRank(url);
    if (rank <= 0) {
      return 0;
    }
    let score = (Number(entry?.score) || 0) * rank;
    if (isLikelyHeroVideoPosterUrl(url)) {
      score *= 0.82;
    }
    return score;
  }

  function isLikelyLogoImage(img) {
    if (!img) {
      return false;
    }
    if (img.closest?.(".tile-image-wrapper, .tile-wrapper.theme-dark")) {
      return false;
    }
    const alt = String(img.alt || "").toLowerCase();
    const title = String(img.getAttribute("title") || "").toLowerCase();
    const src = String(img.currentSrc || img.getAttribute("src") || img.src || "").toLowerCase();
    if (/logo|brand|favicon|icon-|rb-logo|site-logo|wordmark/.test(alt + " " + src + " " + title)) {
      return true;
    }
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (nw > 0 && nh > 0 && nw / Math.max(nh, 1) > 4.5) {
      return true;
    }
    if (img.closest && img.closest("#logo, .logo, .site-logo, [class*='site-logo'], header#top")) {
      const inHeroCopy =
        img.closest("#introtop, [id*='intro'], .first-section, [class*='hero'], main .wpb_row") &&
        !img.closest("header#top, #header-outer");
      if (!inHeroCopy) {
        return true;
      }
    }
    if (nw > 0 && nh > 0 && nw < 320 && nh < 140 && nh / Math.max(nw, 1) < 0.45) {
      return true;
    }
    return false;
  }

  function isDisplayHeadingFontSize(px) {
    const n = parseFloat(String(px || "").replace(/px$/i, ""));
    return Number.isFinite(n) && n >= 48;
  }

  function extractFusionBannerBackground(el) {
    if (!el) {
      return null;
    }
    const fw = el.matches?.(".fusion-fullwidth")
      ? el
      : el.querySelector?.(".fusion-fullwidth[data-bg], .fusion-fullwidth.banner, .fusion-fullwidth[style*='background-image']");
    if (!fw) {
      return null;
    }
    const urls = [];
    const dataBg = String(fw.getAttribute("data-bg") || "").trim();
    if (dataBg && /^https?:\/\//i.test(dataBg)) {
      urls.push(dataBg);
    }
    parseBgUrls(gs(fw, "backgroundImage")).forEach((u) => {
      if (u && !urls.includes(u) && !/logo/i.test(u)) {
        urls.push(u);
      }
    });
    let color = hex(gs(fw, "backgroundColor"));
    const bgVar = String(fw.getAttribute("style") || "");
    const m = bgVar.match(/--awb-background-color:\s*([^;]+)/i);
    if (m && m[1]) {
      const c = hex(m[1].trim());
      if (c) {
        color = c;
      }
    }
    return {
      backgroundColor: color || "",
      imageUrls: urls,
      backgroundImage: gs(fw, "backgroundImage"),
      backgroundSize: gs(fw, "backgroundSize") || "cover",
      backgroundPosition: gs(fw, "backgroundPosition") || "center",
      backgroundRepeat: gs(fw, "backgroundRepeat") || "no-repeat",
    };
  }

  /**
   * Avada / Fusion themes: first full-width banner row (photo bg), not the whole <main>.
   */
  function findFusionBannerHeroRoot() {
    const seen = new Set();
  /** @type {Element[]} */
    const ordered = [];
    const pushUnique = (list) => {
      for (const el of list) {
        if (!el || seen.has(el)) {
          continue;
        }
        seen.add(el);
        ordered.push(el);
      }
    };
    try {
      pushUnique(document.querySelectorAll(".fusion-fullwidth.fusion-builder-row-1"));
      pushUnique(document.querySelectorAll(".fusion-fullwidth[data-bg]"));
      pushUnique(document.querySelectorAll(".fusion-fullwidth.banner"));
      pushUnique(document.querySelectorAll(".fusion-fullwidth.hundred-percent-height"));
      pushUnique(document.querySelectorAll(".fusion-fullwidth[style*='background-image']"));
    } catch {
      /* ignore */
    }
    for (const el of ordered) {
      const dataBg = String(el.getAttribute("data-bg") || "").trim();
      const bgUrls = parseBgUrls(gs(el, "backgroundImage"));
      const hasHeroBg =
        (dataBg && !/logo/i.test(dataBg)) || bgUrls.some((u) => !/logo/i.test(u));
      const isBannerClass = /banner|hundred-percent-height|fusion-builder-row-1/i.test(
        String(el.className || ""),
      );
      if (!hasHeroBg && !isBannerClass) {
        continue;
      }
      let a = areaVisible(el);
      if (a <= 0) {
        try {
          const r = el.getBoundingClientRect();
          if (r.width > 240 && r.height > 60 && r.top < (window.innerHeight || 800) * 0.55) {
            a = r.width * Math.min(r.height, window.innerHeight || 800);
          }
        } catch {
          /* ignore */
        }
      }
      if (a > 0) {
        return {
          el,
          strategy: "fusion-banner",
          score: Math.min(a, 450000),
          found: true,
        };
      }
    }
    return null;
  }

  function extractThemeRowBackground(heroRoot) {
    if (!heroRoot || !heroRoot.querySelector) {
      return null;
    }
    const bgEl =
      heroRoot.querySelector(".row-bg.using-bg-color") ||
      heroRoot.querySelector(".row-bg-layer .row-bg") ||
      heroRoot.querySelector("[class*='row-bg'].using-bg-color") ||
      heroRoot.querySelector(".column-image-bg[style*='background']");
    if (!bgEl) {
      return null;
    }
    let color = "";
    try {
      color = hex(window.getComputedStyle(bgEl).backgroundColor);
    } catch {
      /* ignore */
    }
    if (!color && bgEl.style && bgEl.style.backgroundColor) {
      color = hex(bgEl.style.backgroundColor);
    }
    const bgi = gs(bgEl, "backgroundImage");
    const urls = parseBgUrls(bgi).filter((u) => !/gradient/i.test(String(u)));
    return {
      backgroundColor: color || "",
      imageUrls: urls,
      backgroundImage: bgi && bgi !== "none" ? bgi : "",
      backgroundSize: gs(bgEl, "backgroundSize"),
      backgroundPosition: gs(bgEl, "backgroundPosition"),
      backgroundRepeat: gs(bgEl, "backgroundRepeat"),
    };
  }

  /**
   * Hero "body" copy is often an `h2`/`h3` (no `<p>`). Do not fall back to the document's first `<p>`.
   */
  function pickHeroBodyLikeEl(container) {
    if (!container || !container.querySelector) {
      return null;
    }
    const h5 = container.querySelector("h5.fusion-title-heading, h5");
    if (h5) {
      const fs = gs(h5, "fontSize");
      if (!isDisplayHeadingFontSize(fs)) {
        return h5;
      }
    }
    const p = container.querySelector("p");
    if (p) {
      return p;
    }
    const h1 = container.querySelector("h1");
    if (h1) {
      let sib = h1.nextElementSibling;
      for (let i = 0; i < 10 && sib; i++) {
        const tag = (sib.tagName || "").toUpperCase();
        if (tag === "H5" || tag === "H2" || tag === "H3" || tag === "H4" || tag === "P") {
          if (tag !== "H2" || !isDisplayHeadingFontSize(gs(sib, "fontSize"))) {
            return sib;
          }
        }
        const inner = sib.querySelector("h5, h2, h3, h4, p");
        if (inner && !isDisplayHeadingFontSize(gs(inner, "fontSize"))) {
          return inner;
        }
        sib = sib.nextElementSibling;
      }
    }
    const h2 = container.querySelector("h2");
    if (h2 && !isDisplayHeadingFontSize(gs(h2, "fontSize"))) {
      return h2;
    }
    return container.querySelector(
      ".description, .lead, .tile-subhead, [class*='subhead'], [class*='intro'], [class*='subtitle']",
    );
  }

  /**
   * Prefer copy **after** the headline so a short `<p>` eyebrow above `h1` is not treated as body.
   * @param {Element|null} skipEl e.g. eyebrow `<p>` already promoted to preheading
   */
  function pickHeroBodyLikeElAfterTitle(container, titleEl, skipEl) {
    if (!container || !container.querySelector || !titleEl) {
      return null;
    }
    let sib = titleEl.nextElementSibling;
    for (let i = 0; i < 18 && sib; i++) {
      if (sib === skipEl) {
        sib = sib.nextElementSibling;
        continue;
      }
      const tag = (sib.tagName || "").toUpperCase();
      if (tag === "P" || tag === "H5" || tag === "H2" || tag === "H3" || tag === "H4") {
        if (!isDisplayHeadingFontSize(gs(sib, "fontSize"))) {
          return sib;
        }
      }
      const inner = sib.querySelector && sib.querySelector("h5, p, h2, h3, h4");
      if (inner && inner !== skipEl && !isDisplayHeadingFontSize(gs(inner, "fontSize"))) {
        return inner;
      }
      sib = sib.nextElementSibling;
    }
    const nodes = container.querySelectorAll("p, h2, h3, h4");
    for (const node of nodes) {
      if (node === skipEl || node === titleEl) {
        continue;
      }
      try {
        const pos = titleEl.compareDocumentPosition(node);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
          return node;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function isInPrimaryNav(a) {
    if (!a || !a.closest) {
      return false;
    }
    return !!a.closest('nav, [role="navigation"]');
  }

  function listHeroCtaAnchors(container) {
    if (!container || !container.querySelectorAll) {
      return [];
    }
    const seen = new Set();
    const out = [];
    try {
      if (container.querySelector(".tile-ctas")) {
        container.querySelectorAll(".tile-ctas a[href]").forEach((a) => {
          if (isInPrimaryNav(a)) {
            return;
          }
          const href = (a.getAttribute("href") || "").trim();
          if (!href || href === "#") {
            return;
          }
          const txt = (a.textContent || "").replace(/\s+/g, " ").trim();
          if (txt.length < 2) {
            return;
          }
          const key = href + "\0" + txt;
          if (seen.has(key)) {
            return;
          }
          seen.add(key);
          out.push(a);
        });
        if (out.length) {
          return out;
        }
      }
    } catch {
      /* ignore */
    }
    container
      .querySelectorAll(
        "a.cta-button[href], a.button[href], a.btn[href], a[href].button, a[href].btn, " +
          "a.hs-button[href], a[class*='hs-button'][href], a[class*='hs-cta'][href], " +
          "a[role='button'][href], a[class*='cta-button'][href], a[class*='cta_'][href], " +
          "a[href][class*='cl-button'], a[href][class*='Button'], a[href][class*='button'][class*='hero'], " +
          "a[href][class*='btn-'], a[href][data-cta], a[href][class*='pill'], " +
          "a[href][class*='button__'], a[href][class*='w-button'], " +
          "a.fusion-button[href], a[class*='fusion-button'][href]",
      )
      .forEach((a) => {
        if (isInPrimaryNav(a)) {
          return;
        }
        const href = (a.getAttribute("href") || "").trim();
        if (!href || href === "#") {
          return;
        }
        const role = (a.getAttribute("role") || "").toLowerCase();
        if (role === "menuitem") {
          return;
        }
        const txt = (a.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length < 2 || /^menu$/i.test(txt)) {
          return;
        }
        if (/sidewidgetarea|mobile-menu|#menu/i.test(href)) {
          return;
        }
        const key = href + "\0" + txt;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        out.push(a);
      });
    if (out.length) {
      return out;
    }
    /* Hero CTAs often live inside <header> or [role="banner"]; excluding those removed every link. */
    container
      .querySelectorAll(
        'a[href^="http"], a[href^="/"], a[href^="./"], a[href^="../"], a[href^="mailto:"], a[href^="tel:"]',
      )
      .forEach((a) => {
        if (out.length > 4) {
          return;
        }
        if (isInPrimaryNav(a)) {
          return;
        }
        if (a.closest('footer, [role="contentinfo"]')) {
          return;
        }
        if (!container.contains(a)) {
          return;
        }
        const href = (a.getAttribute("href") || "").trim();
        if (!href || href === "#" || href.toLowerCase().startsWith("javascript:")) {
          return;
        }
        const txt = (a.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length < 2 || /^menu$/i.test(txt)) {
          return;
        }
        if (/sidewidgetarea|mobile-menu|#menu/i.test(href)) {
          return;
        }
        let r;
        try {
          r = a.getBoundingClientRect();
        } catch {
          return;
        }
        if (!r || r.width < 2 || r.height < 2) {
          return;
        }
        out.push(a);
      });
    return out;
  }

  /**
   * Collect CTAs from inner content root first, then full hero node (CTA sibling of inner wrapper).
   * @param {Element} heroEl
   * @param {Element} contentRoot from pickHeroContentRoot(heroEl)
   */
  function listHeroCtaAnchorsForHero(heroEl, contentRoot) {
    const primary = listHeroCtaAnchors(contentRoot);
    if (primary.length) {
      return primary;
    }
    if (heroEl && contentRoot && heroEl !== contentRoot) {
      return listHeroCtaAnchors(heroEl);
    }
    return [];
  }

  function pickHeroPrimaryCta(container, heroEl) {
    const c = container;
    const h = heroEl || c;
    if (!c || !c.querySelector) {
      return null;
    }
    const list = h && h !== c ? listHeroCtaAnchorsForHero(h, c) : listHeroCtaAnchors(c);
    if (list.length) {
      return list[0];
    }
    return (
      c.querySelector(".cta-group a[href], .btn-wrapper a[href], a.hs-button[href]") || null
    );
  }

  function pickHeroLinkSample(container, heroEl) {
    const c = container;
    const h = heroEl || c;
    if (!c || !c.querySelector) {
      return null;
    }
    const list = h && h !== c ? listHeroCtaAnchorsForHero(h, c) : listHeroCtaAnchors(c);
    const firstCta = list[0];
    if (firstCta) {
      return firstCta;
    }
    return (
      c.querySelector(
        ".cta-group a[href], .btn-wrapper a[href], a.cta-button[href], a.button[href], a.hs-button[href]",
      ) || c.querySelector("a[href]")
    );
  }

  function guessSrCtaStyleFromButton(btn) {
    if (!btn) {
      return "primary";
    }
    const wrap = btn.closest(".btn-wrapper");
    const cls = (wrap && wrap.className ? String(wrap.className).toLowerCase() : "") + " " + (btn.className ? String(btn.className).toLowerCase() : "");
    if (/outline-white|btn-outline-white/.test(cls)) {
      return "outline-white";
    }
    if (/btn-white-wrapper|\bbtn-white\b/.test(cls)) {
      return "white";
    }
    if (/outline-primary|btn-outline-primary/.test(cls)) {
      return "outline-primary";
    }
    if (/outline-secondary/.test(cls)) {
      return "outline-secondary";
    }
    if (/btn-primary-wrapper|gradient_one-wrapper/.test(cls)) {
      return "gradient_one";
    }
    const s = window.getComputedStyle(btn);
    const bg = hex(s.backgroundColor);
    const bw = parseFloat(s.borderTopWidth || "0") || 0;
    const fg = hex(s.color);
    if (bw >= 1 && (!bg || bg === "#ffffff")) {
      if (fg === "#ffffff") {
        return "outline-white";
      }
      return "outline-secondary";
    }
    if ((bg === "#ffffff" || bg === "#fff") && fg !== "#ffffff") {
      return "white";
    }
    if (bg && /^#f[4-9a-f]/i.test(bg)) {
      return "primary";
    }
    if (/\bbutton\b/.test(cls) && bg && bg !== "#ffffff") {
      return "primary";
    }
    if (bg && fg && fg !== "#ffffff" && fg !== "#fff") {
      const lum = (hexStr) => {
        const h = hexStr && hexStr.replace(/^#/, "");
        if (!h || h.length < 6) {
          return 0.5;
        }
        const r = parseInt(h.slice(0, 2), 16) / 255;
        const g = parseInt(h.slice(2, 4), 16) / 255;
        const b = parseInt(h.slice(4, 6), 16) / 255;
        const lin = (c) =>
          c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      if (lum(bg) < 0.22) {
        return "black";
      }
    }
    return "primary";
  }

  function inferHeroTextAlign(heroRoot) {
    if (!heroRoot) {
      return "CENTER";
    }
    let c = String(heroRoot.className || "").toLowerCase();
    if (/\btext-start\b|\btext-left\b/.test(c)) {
      return "LEFT";
    }
    if (/\btext-end\b|\btext-right\b/.test(c)) {
      return "RIGHT";
    }
    const inner =
      heroRoot.querySelector(".sr-cover-inner") || heroRoot.querySelector(".hs-bannner-text, [class*='banner-text']");
    const tgt = inner || heroRoot;
    c = String(tgt.className || "").toLowerCase();
    if (/\btext-start\b|\btext-left\b/.test(c)) {
      return "LEFT";
    }
    if (/\btext-end\b|\btext-right\b/.test(c)) {
      return "RIGHT";
    }
    if (/\btext-center\b/.test(c)) {
      return "CENTER";
    }
    const hEl = tgt.querySelector("h1, h2");
    const probe = hEl || tgt;
    const ta = window.getComputedStyle(probe).textAlign;
    if (ta === "left" || ta === "start") {
      return "LEFT";
    }
    if (ta === "right" || ta === "end") {
      return "RIGHT";
    }
    return "CENTER";
  }

  function extractBackdropChain(startEl) {
    let color = "";
    let imageCss = "";
    const imageUrls = [];
    let gradient = "";
    let depthUsed = 0;
    let bgSampleEl = startEl;
    let e = startEl;
    for (let d = 0; d < 8 && e; d++) {
      const s = window.getComputedStyle(e);
      const bgi = s.backgroundImage;
      depthUsed = d;
      if (bgi && bgi !== "none") {
        imageCss = bgi;
        if (/gradient/i.test(bgi)) {
          gradient = bgi;
        }
        const urls = parseBgUrls(bgi).filter((u) => !/gradient/i.test(String(u)));
        for (const u of urls) {
          if (!imageUrls.includes(u)) {
            imageUrls.push(u);
          }
        }
        if (urls.length) {
          bgSampleEl = e;
        }
      }
      const bgc = hex(s.backgroundColor);
      if (bgc) {
        color = bgc;
      }
      if (imageUrls.length || (gradient && !/linear-gradient\(transparent/i.test(gradient))) {
        break;
      }
      if (color && !gradient) {
        break;
      }
      e = e.parentElement;
    }
    const rs = window.getComputedStyle(bgSampleEl || startEl);
    return {
      backgroundColor: color,
      backgroundImage: imageCss && imageCss !== "none" ? imageCss : "",
      imageUrls,
      gradient: gradient || null,
      walkDepth: depthUsed,
      backgroundSize: rs.backgroundSize || "",
      backgroundPosition: rs.backgroundPosition || "",
      backgroundRepeat: rs.backgroundRepeat || "",
    };
  }

  /**
   * Collects `<img>`, `<picture>`, video posters, and non-gradient `background-image` layers
   * under the hero root for ranking + fallbacks (not only the first URL in the parent chain).
   */
  function extractHeroMediaInventory(heroRoot) {
    const byUrl = new Map();
    const vh = Math.min(window.innerHeight, 1080);

    const add = (kind, url, extra) => {
      if (!url || typeof url !== "string") {
        return;
      }
      const t = url.trim();
      if (!t || t.startsWith("data:") || t.startsWith("blob:")) {
        return;
      }
      let abs = t;
      try {
        abs = new URL(t, document.baseURI).href;
      } catch {
        return;
      }
      const score = Number(extra?.score) || 0;
      const prev = byUrl.get(abs);
      if (!prev || score > (prev.score || 0)) {
        byUrl.set(abs, { kind, url: abs, ...extra, score });
      }
    };

    const imgVisibleScore = (img) => {
      const r = img.getBoundingClientRect();
      if (r.bottom < -40 || r.top > vh + 120 || r.width < 2 || r.height < 2) {
        return 0;
      }
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;
      if ((nw > 0 && nw < 20) || (nh > 0 && nh < 20)) {
        return 0;
      }
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, vh);
      const visH = bottom - top;
      if (visH < 4) {
        return 0;
      }
      return r.width * visH;
    };

    try {
      heroRoot.querySelectorAll("img").forEach((img, i) => {
        if (i > 48) {
          return;
        }
        const src = img.currentSrc || img.getAttribute("src") || img.src;
        if (isLikelyLogoImage(img)) {
          return;
        }
        const sc = imgVisibleScore(img);
        if (sc <= 0) {
          return;
        }
        const r = img.getBoundingClientRect();
        const inTileImage = !!img.closest(".tile-image-wrapper");
        add("img", src, {
          score: sc * (inTileImage ? 1.65 : 1.15),
          displayWidth: Math.round(r.width),
          displayHeight: Math.round(r.height),
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          alt: (img.alt || "").slice(0, 200),
        });
      });
    } catch {
      /* ignore */
    }

    try {
      heroRoot.querySelectorAll("picture source[srcset]").forEach((src, i) => {
        if (i > 20) {
          return;
        }
        const ss = src.getAttribute("srcset") || "";
        const largest = parseSrcsetLargestUrl(ss);
        if (largest) {
          const inTileImage = !!src.closest(".tile-image-wrapper");
          const rank = heroImageUrlRank(largest);
          if (rank > 0) {
            add("picture-srcset", largest, {
              score: 500 * (inTileImage ? 1.5 : 1) * rank,
            });
          }
        }
      });
    } catch {
      /* ignore */
    }

    try {
      heroRoot.querySelectorAll("video[poster]").forEach((v, i) => {
        if (i > 6) {
          return;
        }
        add("video-poster", v.getAttribute("poster"), { score: 400 });
      });
    } catch {
      /* ignore */
    }

    const nodes = [heroRoot];
    try {
      heroRoot.querySelectorAll("*").forEach((el, i) => {
        if (i < 320) {
          nodes.push(el);
        }
      });
    } catch {
      /* ignore */
    }

    nodes.forEach((el) => {
      if (!el || el.nodeType !== 1) {
        return;
      }
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "img" || tag === "svg" || tag === "script" || tag === "style" || tag === "noscript") {
        return;
      }
      let bgi = "";
      try {
        bgi = window.getComputedStyle(el).backgroundImage;
      } catch {
        return;
      }
      if (!bgi || bgi === "none") {
        return;
      }
      const urls = parseBgUrls(bgi).filter((u) => !/gradient/i.test(String(u)));
      if (!urls.length) {
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.bottom < -20 || r.top > vh + 80) {
        return;
      }
      const area = Math.min(r.width * r.height, 4e6);
      const sectionBoost = /^(section|article|div|header|figure)$/i.test(tag) ? 1.25 : 1;
      const kwBoost = /cover|hero|banner|jumbotron|masthead|media|visual|bg/i.test(
        String(el.className || "") + (el.id || ""),
      )
        ? 1.35
        : 1;
      const fusionBoost =
        el.matches?.(".fusion-fullwidth") && el.getAttribute("data-bg") ? 4.5 : 1;
      const layerScore = area * sectionBoost * kwBoost * fusionBoost * 0.001;
      urls.forEach((u) => {
        if (/logo|rb-logo|favicon|icon-|\.svg$/i.test(u)) {
          return;
        }
        add("css-background", u, {
          score: layerScore,
          sourceTag: tag,
          sourceClass: String(el.className || "").slice(0, 100),
        });
      });
    });

    const media = Array.from(byUrl.values()).sort((a, b) => (b.score || 0) - (a.score || 0));

    const ranked = media
      .filter((m) => !/logo/i.test(m.url || "") && heroImageUrlRank(m.url) > 0)
      .map((m) => ({ entry: m, effective: effectiveHeroMediaScore(m) }))
      .filter((r) => r.effective > 0)
      .sort((a, b) => b.effective - a.effective);

    let recommended = ranked[0]?.entry || null;
    const bestCss = ranked.find((r) => r.entry.kind === "css-background")?.entry;
    const bestImg = ranked.find((r) => r.entry.kind === "img")?.entry;
    if (bestImg && bestCss) {
      const cssEff = effectiveHeroMediaScore(bestCss);
      const imgEff = effectiveHeroMediaScore(bestImg);
      if (cssEff > imgEff * 1.2) {
        recommended = bestCss;
      } else if (imgEff >= cssEff) {
        recommended = bestImg;
      }
    }

    const imageUrlsOrdered = [];
    const pushU = (u) => {
      if (u && !imageUrlsOrdered.includes(u)) {
        imageUrlsOrdered.push(u);
      }
    };
    if (recommended?.url) {
      pushU(recommended.url);
    }
    media.forEach((m) => pushU(m.url));

    return {
      media: media.slice(0, 45),
      recommendedImageUrl: recommended ? recommended.url : "",
      imageUrlsOrdered,
    };
  }

  function pickHeroRoot() {
    const fusionBanner = findFusionBannerHeroRoot();
    if (fusionBanner) {
      return fusionBanner;
    }

    const hubspotSr = findHubSpotSrHeroRoot();
    if (hubspotSr) {
      return hubspotSr;
    }

    const multiTile = findFirstMultiTileHeroRoot();
    if (multiTile) {
      return multiTile;
    }

    const scored = [];
    const add = (el, strategy, weight) => {
      if (!el || el.nodeType !== 1) {
        return;
      }
      let a = areaVisible(el);
      if (a <= 0) {
        return;
      }
      try {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight || 800;
        if (r.height > vh * 1.35 && !/fusion-banner|banner-class|intro-section/i.test(strategy || "")) {
          a *= 0.12;
        }
        if (a > 500000) {
          a = 500000 + Math.sqrt(a - 500000) * 40;
        }
      } catch {
        /* ignore */
      }
      scored.push({ el, strategy, score: a * (weight || 1) });
    };

    try {
      document.querySelectorAll('[role="banner"]').forEach((el) => add(el, "role-banner", 1.25));
    } catch {
      /* ignore */
    }
    try {
      document
        .querySelectorAll(
          ".home-banner, .page-banner, [class*='home-banner'], [class*='page-banner'], [class*='masthead'], [class*='Masthead']",
        )
        .forEach((el) => add(el, "banner-class", 1.14));
    } catch {
      /* ignore */
    }
    try {
      document.querySelectorAll("header").forEach((el) => {
        if (el.querySelector("h1")) {
          add(el, "header-with-h1", 1.15);
        } else if (!el.closest("#header-outer") || el.querySelector("h1, .page-title")) {
          add(el, "header", 0.42);
        }
      });
    } catch {
      /* ignore */
    }
    try {
      document
        .querySelectorAll(
          "#introtop, #introtexttop, [id*='introtop'], [id*='introtext'], .first-section, section.first-section, .wpb_row.first-section",
        )
        .forEach((el) => {
          const hasH1 = !!el.querySelector("h1");
          add(el, hasH1 ? "intro-section-with-h1" : "intro-section", hasH1 ? 1.62 : 1.28);
        });
    } catch {
      /* ignore */
    }
    try {
      document
        .querySelectorAll(
          ".fusion-fullwidth.banner, .fusion-fullwidth.hundred-percent-height, .fusion-fullwidth.fusion-builder-row-1",
        )
        .forEach((el) => add(el, "fusion-banner-class", 1.75));
    } catch {
      /* ignore */
    }
    const main = document.querySelector("main");
    if (main) {
      const sec = main.querySelector("section");
      if (sec) {
        const wrapsFusionHero = !!sec.querySelector(
          ".fusion-fullwidth[data-bg], .fusion-fullwidth.banner, .fusion-fullwidth.fusion-builder-row-1",
        );
        const secWeight = wrapsFusionHero ? 0.1 : 0.55;
        add(sec, "main-first-section", secWeight);
        if (sec.querySelector("h1")) {
          add(sec, "main-first-section-with-h1", wrapsFusionHero ? 0.12 : 0.65);
        }
      }
      const art = main.querySelector("article");
      if (art) {
        add(art, "main-article", 0.45);
      }
    }
    try {
      document
        .querySelectorAll(
          'section, [class*="hero"], [class*="Hero"], [id*="hero"], [id*="Hero"], .jumbotron',
        )
        .forEach((el) => add(el, "keyword", 1.08));
    } catch {
      /* ignore */
    }
    try {
      document
        .querySelectorAll(
          ".sr-one-col-01, [class*='sr-one-col-'], .sr-multicol-media, .dnd-section, [class*='dnd-section']",
        )
        .forEach((el) => {
          const hasH1 = !!el.querySelector("h1");
          add(
            el,
            hasH1 ? "hubspot-sr-module-with-h1" : "hubspot-sr-module",
            hasH1 ? 1.78 : 1.35,
          );
        });
    } catch {
      /* ignore */
    }

    scored.sort((x, y) => y.score - x.score);
    const best = scored[0];
    const bestHasTitle =
      best?.el &&
      (best.el.querySelector("h1") ||
        best.el.querySelector("#introtexttop h1, .wpb_wrapper h1"));
    if (scored.length && best && best.score > 20000) {
      if (/^header$/i.test(best.strategy || "") && !bestHasTitle) {
        const alt = scored.find(
          (s) =>
            s.el &&
            s.el.querySelector("h1") &&
            !/^header$/i.test(s.strategy || ""),
        );
        if (alt) {
          return { ...alt, found: true };
        }
        const h1Root = findHeroRootFromVisibleH1();
        if (h1Root) {
          return h1Root;
        }
      }
      return { ...best, found: true };
    }
    if (
      scored.length &&
      scored[0].score > 11000 &&
      /with-h1|h1-hero|role-banner|banner-class|keyword|hubspot-sr/i.test(scored[0].strategy || "")
    ) {
      return { ...scored[0], found: true };
    }

    const h1Root = findHeroRootFromVisibleH1();
    if (h1Root) {
      return h1Root;
    }

    return { el: null, strategy: "none", score: 0, found: false };
  }

  function narrowHeroRootIfMultiTile(picked) {
    if (!picked?.el || !picked.el.querySelectorAll) {
      return picked;
    }
    try {
      if (picked.el.matches?.(".tile-wrapper")) {
        return picked;
      }
      const tiles = picked.el.querySelectorAll(":scope > .tile-wrapper");
      if (tiles.length < 2) {
        return picked;
      }
      const first = tiles[0];
      if (!first || areaVisible(first) <= 0) {
        return picked;
      }
      return {
        ...picked,
        el: first,
        strategy: `${picked.strategy || "keyword"}-first-tile`,
        score: areaVisible(first),
      };
    } catch {
      return picked;
    }
  }

  function collectGoogleFontUrls(typography) {
    const out = typography.google_fonts_urls || [];
    const face = typography.font_face_urls || [];
    const sheetUrls = typography.font_stylesheet_urls || [];
    try {
      document
        .querySelectorAll(
          "link[href*='fonts.googleapis.com'], link[href*='fonts.gstatic.com']",
        )
        .forEach((l) => {
          if (l.href) {
            out.push(l.href);
          }
        });
      document.querySelectorAll('link[rel="stylesheet"][href]').forEach((l) => {
        const href = l.href || "";
        if (
          /use\.typekit\.net|fonts\.adobe\.com|p\.typekit\.net/i.test(href) &&
          !sheetUrls.includes(href)
        ) {
          sheetUrls.push(href);
        }
      });
      for (const sh of document.styleSheets) {
        try {
          for (const r of sh.cssRules || []) {
            if (
              r.type === CSSRule.IMPORT_RULE &&
              r.href &&
              /fonts\.googleapis\.com/i.test(r.href)
            ) {
              out.push(r.href);
            }
            if (r.type === CSSRule.FONT_FACE_RULE && r.style && r.style.src) {
              const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
              let m;
              while ((m = re.exec(r.style.src))) {
                try {
                  face.push(new URL(m[2].trim(), document.baseURI).href);
                } catch {
                  const raw = m[2].trim();
                  if (/^https?:\/\//i.test(raw)) {
                    face.push(raw);
                  }
                }
              }
            }
          }
        } catch {
          /* cors */
        }
      }
    } catch {
      /* ignore */
    }
    typography.google_fonts_urls = [...new Set(out)];
    typography.font_face_urls = [...new Set(face)];
    typography.font_stylesheet_urls = [...new Set(sheetUrls)];
  }

  function extractGlobalTypography() {
    const typography = {
      fonts: { headings: "", body: "" },
      headings: {},
      body: {},
      links: {},
      buttons: {},
      colors: { text: [], background: [], primary: "" },
      google_fonts_urls: [],
      font_face_urls: [],
      font_stylesheet_urls: [],
    };
    try {
      for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
        const el = document.querySelector(
          "#introtop " +
            tag +
            ", #introtexttop " +
            tag +
            ", h5.fusion-title-heading, .fusion-title h5, main " +
            tag +
            ", " +
            tag,
        );
        if (el) {
          const s = window.getComputedStyle(el);
          if (tag === "h2" && isDisplayHeadingFontSize(s.fontSize)) {
            continue;
          }
          typography.headings[tag] = {
            fontFamily: s.fontFamily,
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            lineHeight: s.lineHeight,
            letterSpacing: s.letterSpacing,
            color: hex(s.color),
          };
        }
      }
      const fh = document.querySelector(
        "#introtop h1, #introtexttop h1, main h1, h1, h5.fusion-title-heading, h5",
      );
      const fp = document.querySelector(
        "h5.fusion-title-heading, .fusion-title h5, .fusion-text p, #introtexttop p, .nectar-text-inline-images__inner, main p, p",
      );
      if (fh) {
        typography.fonts.headings = gs(fh, "fontFamily");
      }
      if (fp) {
        const s = window.getComputedStyle(fp);
        if (!isDisplayHeadingFontSize(s.fontSize)) {
          typography.fonts.body = gs(fp, "fontFamily");
          typography.body = {
            fontFamily: s.fontFamily,
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            lineHeight: s.lineHeight,
            letterSpacing: s.letterSpacing,
            color: hex(s.color),
          };
        }
      }
      const lnk = document.querySelector("a[href]");
      if (lnk) {
        const s = window.getComputedStyle(lnk);
        typography.links = {
          color: hex(s.color),
          textDecoration: s.textDecorationLine || s.textDecoration,
          fontWeight: s.fontWeight,
        };
      }
      const btn = document.querySelector(
        "a.fusion-button, button, a.btn, a[class*='btn'], [class*='button'], input[type='submit']",
      );
      if (btn) {
        const s = window.getComputedStyle(btn);
        typography.buttons = {
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          color: hex(s.color),
          backgroundColor: hex(s.backgroundColor),
          borderRadius: s.borderRadius,
        };
      }
      const tc = new Set();
      const bc = new Set();
      document
        .querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,li,button,a,section,header,footer,div")
        .forEach((el, i) => {
          if (i > 200) {
            return;
          }
          const s = window.getComputedStyle(el);
          const t = hex(s.color);
          const b = hex(s.backgroundColor);
          if (t) {
            tc.add(t);
          }
          if (b) {
            bc.add(b);
          }
        });
      typography.colors.text = Array.from(tc).slice(0, 10);
      typography.colors.background = Array.from(bc).slice(0, 10);
      if (typography.buttons && typography.buttons.backgroundColor) {
        typography.colors.primary = typography.buttons.backgroundColor;
      }
      collectGoogleFontUrls(typography);
    } catch {
      /* ignore */
    }
    return typography;
  }

  function extractHeroTypography(scope) {
    const typography = {
      fonts: { headings: "", body: "" },
      headings: {},
      body: {},
      links: {},
      buttons: {},
      buttons_secondary: null,
      colors: { text: [], background: [], primary: "" },
      google_fonts_urls: [],
      font_face_urls: [],
      font_stylesheet_urls: [],
    };
    const root = scope && scope.querySelector ? scope : document.body;
    const contentRoot = pickHeroContentRoot(root);
    const pick = (sel) => root.querySelector(sel);
    const pickContent = (sel) => contentRoot.querySelector(sel);

    try {
      for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
        const el = pickContent(tag) || pick(tag);
        if (el) {
          const s = window.getComputedStyle(el);
          typography.headings[tag] = {
            fontFamily: s.fontFamily,
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            lineHeight: s.lineHeight,
            letterSpacing: s.letterSpacing,
            color: hex(s.color),
          };
        }
      }
      const fh =
        pickContent("h1") ||
        pick("h1") ||
        pickContent("h5.fusion-title-heading, h5") ||
        pick("h5.fusion-title-heading, h5");
      const h1El = pickContent("h1") || pick("h1");
      const fp =
        h1El &&
        (pickHeroBodyLikeElAfterTitle(contentRoot, h1El, null) ||
          pickHeroBodyLikeElAfterTitle(root, h1El, null));
      const fpFallback = pickHeroBodyLikeEl(contentRoot) || pickHeroBodyLikeEl(root);
      const bodyEl = fp || fpFallback;
      if (fh) {
        typography.fonts.headings = gs(fh, "fontFamily");
      }
      if (bodyEl && bodyEl !== fh) {
        const s = window.getComputedStyle(bodyEl);
        if (!isDisplayHeadingFontSize(s.fontSize)) {
          typography.fonts.body = gs(bodyEl, "fontFamily");
          typography.body = {
            fontFamily: s.fontFamily,
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            lineHeight: s.lineHeight,
            letterSpacing: s.letterSpacing,
            color: hex(s.color),
          };
        }
      }
      const lnk = pickHeroLinkSample(contentRoot, root) || pickHeroLinkSample(root, root);
      if (lnk) {
        const s = window.getComputedStyle(lnk);
        typography.links = {
          color: hex(s.color),
          textDecoration: s.textDecorationLine || s.textDecoration,
          fontWeight: s.fontWeight,
        };
      }
      const btn = pickHeroPrimaryCta(contentRoot, root) || pickHeroPrimaryCta(root, root);
      if (btn) {
        const s = window.getComputedStyle(btn);
        let bg = hex(s.backgroundColor);
        if (!bg) {
          const wrap = btn.closest(".btn-wrapper, .button-wrapper, .cta-group");
          if (wrap) {
            bg = hex(window.getComputedStyle(wrap).backgroundColor);
          }
        }
        typography.buttons = {
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          color: hex(s.color),
          backgroundColor: bg,
          borderRadius: s.borderRadius,
          borderColor: hex(s.borderColor),
          borderWidth: s.borderWidth,
        };
      }
      const ctaList = listHeroCtaAnchorsForHero(root, contentRoot);
      if (ctaList.length > 1) {
        const s2 = window.getComputedStyle(ctaList[1]);
        let bg2 = hex(s2.backgroundColor);
        if (!bg2) {
          const w2 = ctaList[1].closest(".btn-wrapper, .button-wrapper");
          if (w2) {
            bg2 = hex(window.getComputedStyle(w2).backgroundColor);
          }
        }
        typography.buttons_secondary = {
          fontFamily: s2.fontFamily,
          fontSize: s2.fontSize,
          fontWeight: s2.fontWeight,
          color: hex(s2.color),
          backgroundColor: bg2,
          borderRadius: s2.borderRadius,
          borderColor: hex(s2.borderColor),
          borderWidth: s2.borderWidth,
        };
      }
      const tc = new Set();
      const bc = new Set();
      contentRoot.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,a,button").forEach((el, i) => {
        if (i > 80) {
          return;
        }
        const s = window.getComputedStyle(el);
        const t = hex(s.color);
        const b = hex(s.backgroundColor);
        if (t) {
          tc.add(t);
        }
        if (b) {
          bc.add(b);
        }
      });
      typography.colors.text = Array.from(tc).slice(0, 10);
      typography.colors.background = Array.from(bc).slice(0, 10);
      if (typography.buttons && typography.buttons.backgroundColor) {
        typography.colors.primary = typography.buttons.backgroundColor;
      } else if (
        typography.buttons_secondary &&
        (typography.buttons_secondary.backgroundColor || typography.buttons_secondary.borderColor)
      ) {
        typography.colors.primary =
          typography.buttons_secondary.backgroundColor || typography.buttons_secondary.borderColor;
      }
      if (!typography.colors.primary && typography.headings?.h3?.color) {
        typography.colors.primary = typography.headings.h3.color;
      }
      if (
        scope?.matches?.(".fusion-fullwidth") &&
        (!typography.body?.fontSize || isDisplayHeadingFontSize(typography.body.fontSize))
      ) {
        let sib = scope.nextElementSibling;
        for (let i = 0; i < 4 && sib; i++) {
          const h5 = sib.querySelector("h5.fusion-title-heading, h5, .fusion-text p");
          if (h5) {
            const s = window.getComputedStyle(h5);
            if (!isDisplayHeadingFontSize(s.fontSize)) {
              typography.fonts.body = gs(h5, "fontFamily");
              typography.body = {
                fontFamily: s.fontFamily,
                fontSize: s.fontSize,
                fontWeight: s.fontWeight,
                lineHeight: s.lineHeight,
                letterSpacing: s.letterSpacing,
                color: hex(s.color),
              };
              break;
            }
          }
          sib = sib.nextElementSibling;
        }
      }
      collectGoogleFontUrls(typography);
    } catch {
      /* ignore */
    }
    return typography;
  }

  const typographyPage = extractGlobalTypography();
  const picked = narrowHeroRootIfMultiTile(pickHeroRoot());

  const hero = {
    found: Boolean(picked.found && picked.el),
    strategy: picked.strategy,
    score: picked.score || 0,
    text: {
      title: "",
      titleTag: "",
      preheading: "",
      preheadingHtml: "",
      preheadingTag: "",
      subtitle: "",
      subtitleHtml: "",
      subtitleRole: "",
      subtitleHeadingSize: "",
      subtitleDisplaySize: "",
    },
    layout: {
      textAlign: "CENTER",
    },
    ctas: [],
    background: {
      type: "unknown",
      backgroundColor: "",
      backgroundImage: "",
      imageUrls: [],
      recommendedImageUrl: "",
      backgroundSize: "",
      backgroundPosition: "",
      backgroundRepeat: "",
      gradient: null,
      backdrop: {},
    },
    media: [],
    extractionMeta: {
      confidence: 0,
      warnings: [],
      imageCandidateCount: 0,
    },
    typography: null,
  };

  if (!hero.found || !picked.el) {
    hero.extractionMeta.warnings = ["hero_root_not_detected"];
    hero.extractionMeta.confidence = 0;
    return { typographyPage, hero };
  }

  const heroEl = picked.el;
  try {
    const r = heroEl.getBoundingClientRect();
    hero.rect = {
      top: Math.round(r.top),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  } catch {
    /* ignore */
  }

  const textScope = pickHeroContentRoot(heroEl);
  const h1 = textScope.querySelector("h1") || heroEl.querySelector("h1");
  const h2Only = textScope.querySelector("h2") || heroEl.querySelector("h2");
  let titleEl =
    h1 ||
    textScope.querySelector("h5.fusion-title-heading, h5") ||
    heroEl.querySelector("h5.fusion-title-heading, h5") ||
    h2Only ||
    textScope.querySelector("h3") ||
    heroEl.querySelector("h3");
  if (titleEl) {
    if (!isHeadingTitleCandidate(titleEl)) {
      titleEl = null;
    }
  }
  if (titleEl) {
    hero.text.title = extractHeadingTextFromEl(titleEl);
    hero.text.titleTag = String(titleEl.tagName || "").toLowerCase() || "h1";
  }
  if (!hero.text.title && h2Only && h2Only !== titleEl && isHeadingTitleCandidate(h2Only)) {
    hero.text.title = extractHeadingTextFromEl(h2Only);
    hero.text.titleTag = String(h2Only.tagName || "").toLowerCase() || "h2";
    titleEl = h2Only;
  }
  if (!hero.text.title && picked.strategy === "fusion-banner") {
    const pageTitle = String(document.title || "").split("|")[0].trim();
    if (pageTitle) {
      hero.text.title = pageTitle;
      hero.text.titleTag = "h1";
    }
  }

  let eyebrowSkipEl = null;
  if (h1) {
    const prev = h1.previousElementSibling;
    if (prev && /^H[3-6]$/i.test(prev.tagName)) {
      hero.text.preheading = (prev.textContent || "").trim().replace(/\s+/g, " ");
      hero.text.preheadingHtml = (prev.innerHTML || "").trim();
      hero.text.preheadingTag = String(prev.tagName || "").toLowerCase();
    } else if (prev && /^P$/i.test(prev.tagName)) {
      const pt = (prev.textContent || "").trim().replace(/\s+/g, " ");
      const cls = String(prev.className || "").toLowerCase();
      const maxLen = 160;
      const eyebrowClass =
        /\b(tagline|eyebrow|kicker|overline|microheading|micro-head|subheading-small|preheading|label-text|meta|pill|badge|eyebrow-text|surtitle)\b/.test(
          cls,
        );
      if (pt && pt.length <= maxLen && (eyebrowClass || pt.length <= 80)) {
        hero.text.preheading = pt;
        hero.text.preheadingHtml = (prev.innerHTML || "").trim();
        hero.text.preheadingTag = "p";
        eyebrowSkipEl = prev;
      }
    }
  }

  let sub =
    titleEl &&
    (pickHeroBodyLikeElAfterTitle(textScope, titleEl, eyebrowSkipEl) ||
      pickHeroBodyLikeElAfterTitle(heroEl, titleEl, eyebrowSkipEl));
  if (!sub || sub === titleEl || sub === eyebrowSkipEl) {
    sub =
      pickHeroBodyLikeEl(textScope) ||
      pickHeroBodyLikeEl(heroEl) ||
      textScope.querySelector("p") ||
      heroEl.querySelector("p");
  }
  if (sub === titleEl || sub === eyebrowSkipEl) {
    sub = null;
  }
  if (!sub || (sub.textContent || "").length < 12) {
    const nectarInner = heroEl.querySelector(".nectar-text-inline-images__inner");
    if (nectarInner) {
      const nt = (nectarInner.textContent || "").trim().replace(/\s+/g, " ");
      if (nt.length >= 12) {
        sub = nectarInner;
      }
    }
  }
  if ((!sub || (sub.textContent || "").length < 40) && picked.strategy === "fusion-banner") {
    let sib = heroEl.nextElementSibling;
    for (let i = 0; i < 4 && sib; i++) {
      const h5 = sib.querySelector("h5.fusion-title-heading, h5, .fusion-text p");
      if (h5) {
        const t = (h5.textContent || "").trim().replace(/\s+/g, " ");
        if (t.length >= 40) {
          sub = h5;
          break;
        }
      }
      sib = sib.nextElementSibling;
    }
  }
  if (sub && /all rights reserved|©\s*\d{4}/i.test((sub.textContent || "").trim())) {
    sub = null;
  }
  if (sub) {
    hero.text.subtitleRole = String(sub.tagName || "").toLowerCase();
    hero.text.subtitleHeadingSize = hero.text.subtitleRole || "h2";
    const sc = String(sub.className || "");
    const dm = sc.match(/\b(display-[1-4])\b/i);
    hero.text.subtitleDisplaySize = dm
      ? dm[1].toLowerCase()
      : /\bh5\b/i.test(sc)
        ? "h5"
        : /\bh4\b/i.test(sc)
          ? "h4"
          : /\bh3\b/i.test(sc)
            ? "h3"
            : "auto";
    hero.text.subtitle = (sub.textContent || "").trim().replace(/\s+/g, " ");
    hero.text.subtitleHtml = (sub.innerHTML || "").trim();
  }

  hero.layout = { textAlign: inferHeroTextAlign(heroEl) };

  hero.ctas = [];
  try {
    let ctaScope = pickHeroContentRoot(heroEl);
    if (picked.strategy === "fusion-banner") {
      let sib = heroEl.nextElementSibling;
      for (let i = 0; i < 3 && sib; i++) {
        if (sib.querySelector("a.fusion-button, .fusion-button")) {
          ctaScope = sib;
          break;
        }
        sib = sib.nextElementSibling;
      }
    }
    listHeroCtaAnchorsForHero(heroEl, ctaScope).forEach((a, i) => {
      if (i > 4) {
        return;
      }
      const rawHref = a.getAttribute("href") || "";
      let abs = rawHref.trim();
      try {
        abs = new URL(rawHref.trim(), document.baseURI).href;
      } catch {
        /* keep relative */
      }
      hero.ctas.push({
        label: (a.textContent || "").trim().replace(/\s+/g, " "),
        href: abs,
        cta_style: guessSrCtaStyleFromButton(a),
      });
    });
  } catch {
    /* ignore */
  }

  if (!hero.ctas.length) {
    try {
      const ctaScope = pickHeroContentRoot(heroEl);
      const b =
        (ctaScope &&
          ctaScope.querySelector(
            'button[type="button"], button:not([type]), input[type="submit"][class*="btn"]',
          )) ||
        heroEl.querySelector('button[type="button"], button:not([type])');
      if (b) {
        const lab = (b.textContent || "").replace(/\s+/g, " ").trim();
        if (lab.length > 1) {
          hero.ctas.push({
            label: lab,
            href: "#",
            cta_style: guessSrCtaStyleFromButton(b),
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  const backdrop = extractBackdropChain(heroEl);
  const fusionBg = extractFusionBannerBackground(heroEl);
  const rowBg = extractThemeRowBackground(heroEl);
  if (fusionBg) {
    if (fusionBg.backgroundColor && !backdrop.backgroundColor) {
      backdrop.backgroundColor = fusionBg.backgroundColor;
    }
    (fusionBg.imageUrls || []).forEach((u) => {
      if (u && !backdrop.imageUrls.includes(u)) {
        backdrop.imageUrls.unshift(u);
      }
    });
    if (fusionBg.backgroundSize) {
      backdrop.backgroundSize = fusionBg.backgroundSize;
    }
    if (fusionBg.backgroundPosition) {
      backdrop.backgroundPosition = fusionBg.backgroundPosition;
    }
    if (fusionBg.backgroundRepeat) {
      backdrop.backgroundRepeat = fusionBg.backgroundRepeat;
    }
  }
  if (rowBg) {
    if (rowBg.backgroundColor && !backdrop.backgroundColor) {
      backdrop.backgroundColor = rowBg.backgroundColor;
    }
    (rowBg.imageUrls || []).forEach((u) => {
      if (u && !backdrop.imageUrls.includes(u)) {
        backdrop.imageUrls.push(u);
      }
    });
  }
  const inventory = extractHeroMediaInventory(heroEl);
  hero.media = inventory.media || [];
  hero.extractionMeta.imageCandidateCount = hero.media.length;

  const mergedUrls = [];
  const addUrl = (u) => {
    if (u && !mergedUrls.includes(u)) {
      mergedUrls.push(u);
    }
  };
  if (inventory.recommendedImageUrl) {
    addUrl(inventory.recommendedImageUrl);
  }
  (backdrop.imageUrls || []).forEach(addUrl);
  (inventory.imageUrlsOrdered || []).forEach(addUrl);

  hero.background.backdrop = backdrop;
  hero.background.backgroundColor = backdrop.backgroundColor || "";
  hero.background.backgroundImage = backdrop.backgroundImage || "";
  hero.background.imageUrls = mergedUrls;
  hero.background.recommendedImageUrl =
    inventory.recommendedImageUrl || mergedUrls[0] || "";
  hero.background.gradient = backdrop.gradient;
  if (hero.background.recommendedImageUrl) {
    hero.background.backgroundSize = "cover";
    hero.background.backgroundPosition = backdrop.backgroundPosition || "center";
    hero.background.backgroundRepeat = "no-repeat";
  } else {
    hero.background.backgroundSize = backdrop.backgroundSize || "";
    hero.background.backgroundPosition = backdrop.backgroundPosition || "";
    hero.background.backgroundRepeat = backdrop.backgroundRepeat || "";
  }
  try {
    const heroVideo = heroEl.querySelector(
      "video source[src], video[src], .nectar-video-bg source[src]",
    );
    if (heroVideo) {
      const vsrc =
        heroVideo.getAttribute("src") ||
        heroVideo.getAttribute("data-nectar-video-src") ||
        "";
      if (vsrc && /^https?:\/\//i.test(vsrc)) {
        hero.background.type = "video";
        if (!hero.background.imageUrls.includes(vsrc)) {
          hero.background.imageUrls.unshift(vsrc);
        }
      }
    }
  } catch {
    /* ignore */
  }
  if (hero.background.type !== "video" && hero.background.imageUrls.length) {
    hero.background.type = "image";
  } else if (hero.background.gradient) {
    hero.background.type = "gradient";
  } else if (hero.background.backgroundColor) {
    hero.background.type = "color";
  } else {
    hero.background.type = "unknown";
  }

  hero.typography = extractHeroTypography(heroEl);

  const warnings = [];
  if (!hero.ctas.length) {
    warnings.push("no_cta_anchors_in_hero_scope");
  }
  if (!hero.background.imageUrls.length && !hero.background.gradient && !hero.background.backgroundColor) {
    warnings.push("no_hero_background_signals");
  }
  if (!hero.text.title) {
    warnings.push("no_h1_h2_title");
  }
  hero.extractionMeta.warnings = warnings;
  const areaPart = Math.min(1, (picked.score || 0) / 250000);
  const imgPart = hero.media.length ? 0.22 : 0;
  const ctaPart = hero.ctas.length ? 0.18 : 0;
  const titlePart = hero.text.title ? 0.15 : 0;
  hero.extractionMeta.confidence = Math.round(
    Math.min(0.99, 0.12 + areaPart * 0.45 + imgPart + ctaPart + titlePart) * 100,
  ) / 100;

  try {
    heroEl.setAttribute("data-ditto-hero-cap", "1");
  } catch {
    /* ignore */
  }

  return { typographyPage, hero };
}
