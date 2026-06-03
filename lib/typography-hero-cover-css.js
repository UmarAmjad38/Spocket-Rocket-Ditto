/**
 * Per-site hero background image CSS for SR Hero 01 (.sr-cover-image).
 * Separate from typography fonts — each batch site gets its own cover URL.
 */

const fs = require("fs");
const path = require("path");

const TYPOGRAPHY_SR_HERO = ".body_dnd_area .sr-hero-01";
const MARKER_PREFIX = "/* ditto-hero-cover-asset";

/**
 * @param {string} s
 */
function cssQuoted(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Source sites (e.g. Apple tiles) often use `auto` + `repeat` on tiny thumbnails — never bake that into SR Hero cover.
 *
 * @param {Record<string, unknown>} bg
 */
function normalizeHeroCoverCssProps(bg) {
  const preferred =
    (bg.recommendedImageUrl && String(bg.recommendedImageUrl).trim()) ||
    (Array.isArray(bg.imageUrls) && bg.imageUrls[0] ? String(bg.imageUrls[0]).trim() : "");
  const rawSize = String(bg.backgroundSize || bg.backdrop?.backgroundSize || "").trim();
  const rawRep = String(bg.backgroundRepeat || bg.backdrop?.backgroundRepeat || "").trim();
  const rawPos = String(bg.backgroundPosition || bg.backdrop?.backgroundPosition || "").trim();
  const appleTileFix =
    /_small(?:\.|__|$)/i.test(preferred) && (/repeat/i.test(rawRep) || rawSize === "auto");
  const tiled = appleTileFix || /repeat-x|repeat-y|\brepeat\b/i.test(rawRep);
  return {
    size: tiled || rawSize === "auto" ? "cover" : rawSize || "cover",
    repeat: /repeat/i.test(rawRep) ? "no-repeat" : rawRep || "no-repeat",
    position: rawPos || "center",
  };
}

/**
 * @param {string} slug
 */
function heroCoverMarker(slug) {
  const s = String(slug || "site").replace(/[^a-z0-9-]/gi, "-");
  return `${MARKER_PREFIX}:${s} */`;
}

/**
 * @param {{ found?: boolean, background?: Record<string, unknown> }} hero
 * @returns {string[]}
 */
function buildHeroCoverCssLines(hero) {
  if (!hero?.found || !hero.background) {
    return [];
  }
  const bg = hero.background;
  const preferred =
    (bg.recommendedImageUrl && String(bg.recommendedImageUrl).trim()) ||
    (Array.isArray(bg.imageUrls) && bg.imageUrls[0] ? String(bg.imageUrls[0]).trim() : "");
  const url = preferred && /^https?:\/\//i.test(preferred) ? preferred : "";

  const { position: pos, size, repeat: rep } = normalizeHeroCoverCssProps(bg);
  const solid = String(bg.backgroundColor || bg.backdrop?.backgroundColor || "").trim();

  if (!url && !pos && !size && !rep && !solid) {
    return [];
  }

  const safe = (s) => String(s).replace(/[;{}]/g, "");
  /** @type {string[]} */
  const blocks = [];

  if (url) {
    const imageLines = [`${TYPOGRAPHY_SR_HERO} .sr-cover-image {`];
    imageLines.push(`  background-image: url(${cssQuoted(url)}) !important;`);
    if (size) {
      imageLines.push(`  background-size: ${safe(size)} !important;`);
    } else {
      imageLines.push(`  background-size: cover !important;`);
    }
    if (pos) {
      imageLines.push(`  background-position: ${safe(pos)} !important;`);
    } else {
      imageLines.push(`  background-position: center !important;`);
    }
    if (rep) {
      imageLines.push(`  background-repeat: ${safe(rep)} !important;`);
    } else {
      imageLines.push(`  background-repeat: no-repeat !important;`);
    }
    imageLines.push("}");
    blocks.push(...imageLines);
  } else if (solid && /^#[0-9a-f]{3,8}$/i.test(solid)) {
    blocks.push(`${TYPOGRAPHY_SR_HERO} {`);
    blocks.push(`  background-color: ${safe(solid)} !important;`);
    blocks.push("}");
  } else if (pos || size || rep) {
    const imageLines = [`${TYPOGRAPHY_SR_HERO} .sr-cover-image {`];
    if (size) {
      imageLines.push(`  background-size: ${safe(size)} !important;`);
    }
    if (pos) {
      imageLines.push(`  background-position: ${safe(pos)} !important;`);
    }
    if (rep) {
      imageLines.push(`  background-repeat: ${safe(rep)} !important;`);
    }
    imageLines.push("}");
    blocks.push(...imageLines);
  }

  return blocks;
}

/**
 * @param {string} cssText
 * @param {string} slug
 */
function stripHeroCoverBlockForSlug(cssText, slug) {
  const marker = heroCoverMarker(slug);
  const idx = cssText.indexOf(marker);
  if (idx < 0) {
    return cssText;
  }
  const start = cssText.lastIndexOf("\n", idx);
  const from = start >= 0 ? start : idx;
  const rest = cssText.slice(from + 1);
  const nextMarker = rest.search(/\n\/\* ditto-/);
  const end = nextMarker >= 0 ? from + 1 + nextMarker : cssText.length;
  return `${cssText.slice(0, from)}${cssText.slice(end)}`.replace(/\n{3,}/g, "\n\n");
}

/**
 * Append hero cover rules to a specific client-typography*.css file (idempotent per slug).
 *
 * @param {string} themeRoot
 * @param {{ found?: boolean, background?: Record<string, unknown> }} hero
 * @param {string} cssBasename e.g. client-typography-hubspot-com.css
 * @param {string} [slug] for marker idempotency
 * @returns {boolean}
 */
function appendHeroCoverCssToClientTypographyFile(themeRoot, hero, cssBasename, slug) {
  const lines = buildHeroCoverCssLines(hero);
  if (!lines.length) {
    return false;
  }
  const base = String(cssBasename || "client-typography.css").replace(/^css\//, "");
  const slugKey = slug || base.replace(/^client-typography-?/, "").replace(/\.css$/, "") || "site";
  const fp = path.join(themeRoot, "css", base);
  if (!fs.existsSync(fp)) {
    return false;
  }
  let existing = fs.readFileSync(fp, "utf8");
  const marker = heroCoverMarker(slugKey);
  if (existing.includes(marker)) {
    existing = stripHeroCoverBlockForSlug(existing, slugKey);
  }
  const block = ["", marker, ...lines, ""].join("\n");
  fs.writeFileSync(fp, `${existing.trimEnd()}\n${block}\n`, "utf8");
  return true;
}

/**
 * Remove legacy single-marker hero cover blocks (batch primary bleed fix).
 *
 * @param {string} themeRoot
 */
function stripLegacySharedHeroCoverFromPrimaryCss(themeRoot) {
  const fp = path.join(themeRoot, "css", "client-typography.css");
  if (!fs.existsSync(fp)) {
    return;
  }
  let h = fs.readFileSync(fp, "utf8");
  if (!h.includes(MARKER_PREFIX)) {
    return;
  }
  h = h.replace(
    /\n?\/\* ditto-hero-cover-asset[^*]*\*\/[\s\S]*?\.body_dnd_area \.sr-hero-01 \.sr-cover-image\s*\{[\s\S]*?\}\s*/g,
    "\n",
  );
  fs.writeFileSync(fp, `${h.trimEnd()}\n`, "utf8");
}

/**
 * Inject site CSS after header include so preview works even if content.template_path checks fail.
 *
 * @param {string} themeRoot
 * @param {string} previewBasename e.g. preview-hubspot-com.html
 * @param {string} slug
 */
function injectSiteTypographyCssIntoPreviewTemplate(themeRoot, previewBasename, slug) {
  const fp = path.join(themeRoot, "templates", previewBasename);
  if (!fs.existsSync(fp)) {
    return false;
  }
  const cssRef = `../css/client-typography-${slug}.css`;
  let h = fs.readFileSync(fp, "utf8");
  if (h.includes(cssRef)) {
    return false;
  }
  const inject = `\n\t\t{# ditto-site-typography-css:${slug} #}\n\t\t{{ require_css(get_asset_url("${cssRef}")) }}\n`;
  const re = /(\{%\s*include\s+['"]\.\/header\.html['"]\s*%\})/i;
  if (!re.test(h)) {
    return false;
  }
  h = h.replace(re, `$1${inject}`);
  fs.writeFileSync(fp, h, "utf8");
  return true;
}

module.exports = {
  TYPOGRAPHY_SR_HERO,
  normalizeHeroCoverCssProps,
  buildHeroCoverCssLines,
  appendHeroCoverCssToClientTypographyFile,
  stripLegacySharedHeroCoverFromPrimaryCss,
  injectSiteTypographyCssIntoPreviewTemplate,
};
