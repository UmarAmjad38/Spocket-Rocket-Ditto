/**
 * Brad /m/ module preview does not apply fields.json defaults and has no .body_dnd_area wrapper.
 * Bake extract into module.html + scoped CSS so background/copy/fonts actually render.
 */

const fs = require("fs");
const path = require("path");

const {
  resolveHeroHeading,
  resolveHeroDescription,
} = require("./sr-preview-hero-fields");
const {
  buildHeroCoverCssLines,
  normalizeHeroCoverCssProps,
} = require("./typography-hero-cover-css");

/**
 * @param {string} s
 */
function escapeHtmlPlain(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Duplicate full `.body_dnd_area .sr-hero-01 { … }` rules for Brad /m/ pages
 * (no `.body_dnd_area` wrapper). The old line-by-line copy dropped declaration blocks.
 *
 * @param {string} css
 */
function expandTypographyCssForBradModuleScope(css) {
  const src = String(css || "");
  if (!src.includes(".body_dnd_area .sr-hero-01")) {
    return src;
  }
  /** @type {string[]} */
  const extra = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) {
      i++;
    }
    if (i >= src.length) {
      break;
    }
    const start = i;
    if (src[i] === "@") {
      const brace = src.indexOf("{", i);
      const semi = src.indexOf(";", i);
      if (brace === -1 || (semi !== -1 && semi < brace)) {
        i = semi === -1 ? src.length : semi + 1;
        continue;
      }
      let depth = 0;
      let j = brace;
      for (; j < src.length; j++) {
        if (src[j] === "{") {
          depth++;
        } else if (src[j] === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      const block = src.slice(start, j);
      if (block.includes(".body_dnd_area .sr-hero-01")) {
        extra.push(block.replace(/\.body_dnd_area\s+/g, ""));
      }
      i = j;
      continue;
    }
    const open = src.indexOf("{", i);
    if (open === -1) {
      break;
    }
    const selector = src.slice(i, open);
    let depth = 1;
    let j = open + 1;
    for (; j < src.length && depth > 0; j++) {
      if (src[j] === "{") {
        depth++;
      } else if (src[j] === "}") {
        depth--;
      }
    }
    const rule = src.slice(start, j);
    if (selector.includes(".body_dnd_area .sr-hero-01")) {
      extra.push(rule.replace(/\.body_dnd_area\s+/g, ""));
    }
    i = j;
  }
  if (!extra.length) {
    return src;
  }
  return `${src.trimEnd()}\n\n/* ditto-brad-module-typography-scope */\n${extra.join("\n\n")}\n`;
}

/**
 * @param {string} hex
 */
function isLightHexColor(hex) {
  const n = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-f]{3}$/i.test(n) && !/^[0-9a-f]{6}$/i.test(n)) {
    return false;
  }
  const full =
    n.length === 3
      ? n
          .split("")
          .map((c) => c + c)
          .join("")
      : n;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72;
}

/**
 * Force readable heading color on Brad /m/ when stock module defaults to text-white.
 *
 * @param {{ found?: boolean, background?: Record<string, unknown>, typography?: Record<string, unknown> }} hero
 */
function buildBradModuleHeadingColorCss(hero) {
  if (!hero?.found) {
    return [];
  }
  const bg = hero.background && typeof hero.background === "object" ? hero.background : {};
  const solid = String(bg.backgroundColor || bg.backdrop?.backgroundColor || "").trim();
  const hasImage =
    Boolean(String(bg.recommendedImageUrl || "").trim()) ||
    (Array.isArray(bg.imageUrls) && bg.imageUrls.length > 0);
  if (!isLightHexColor(solid) && hasImage) {
    return [];
  }
  if (!isLightHexColor(solid) && !hasImage) {
    return [];
  }
  const typo =
    hero.typography && typeof hero.typography === "object" ? hero.typography : {};
  const heads =
    typo.headings && typeof typo.headings === "object" ? typo.headings : {};
  const h1 = heads.h1 && typeof heads.h1 === "object" ? heads.h1 : {};
  const color = String(h1.color || "#242424").trim();
  if (!/^#[0-9a-f]{3,8}$/i.test(color)) {
    return [];
  }
  const safe = color.replace(/[;{}]/g, "");
  return [
    ".sr-hero-01.ditto-brad-hero-baked h1.heading,",
    ".sr-hero-01.ditto-brad-hero-baked h1,",
    ".sr-hero-01.ditto-brad-hero-baked .heading {",
    `  color: ${safe} !important;`,
    "}",
  ];
}

/**
 * Hero cover CSS without .body_dnd_area (Brad /m/ only has .sr-hero-01).
 *
 * @param {{ found?: boolean, background?: Record<string, unknown> }} hero
 */
function buildBradModuleHeroCoverCss(hero) {
  if (!hero?.found || !hero.background) {
    return [];
  }
  const bg = hero.background;
  const preferred =
    (bg.recommendedImageUrl && String(bg.recommendedImageUrl).trim()) ||
    (Array.isArray(bg.imageUrls) && bg.imageUrls[0] ? String(bg.imageUrls[0]).trim() : "");
  const url = preferred && /^https?:\/\//i.test(preferred) ? preferred : "";
  const solid = String(bg.backgroundColor || bg.backdrop?.backgroundColor || "").trim();
  const { position: pos, size, repeat: rep } = normalizeHeroCoverCssProps(bg);
  const safe = (s) => String(s).replace(/[;{}]/g, "");

  /** @type {string[]} */
  const lines = [];
  if (solid && /^#[0-9a-f]{3,8}$/i.test(solid)) {
    lines.push(".sr-hero-01.ditto-brad-hero-baked {");
    lines.push(`  background-color: ${safe(solid)} !important;`);
    lines.push("}");
  }
  if (url) {
    lines.push(".sr-hero-01.ditto-brad-hero-baked .sr-cover-image {");
    lines.push(`  background-image: url("${url.replace(/"/g, '\\"')}") !important;`);
    lines.push(`  background-size: ${safe(size) || "cover"} !important;`);
    lines.push(`  background-position: ${safe(pos) || "center"} !important;`);
    lines.push(`  background-repeat: ${safe(rep) || "no-repeat"} !important;`);
    lines.push("  display: block !important;");
    lines.push("}");
  }
  return lines;
}

/**
 * @param {Record<string, unknown>} hero
 * @param {Record<string, unknown>} body
 */
function buildBakedHeroInnerHtml(hero, body) {
  const text = hero.text && typeof hero.text === "object" ? hero.text : {};
  const pre = String(text.preheading || "").trim();
  const title = resolveHeroHeading(hero, body);
  const sub = String(text.subtitle || "").trim();
  const subRole = String(text.subtitleRole || "").toLowerCase();

  /** @type {string[]} */
  const parts = [];
  const showPre =
    pre &&
    title &&
    !String(title).toLowerCase().startsWith(pre.toLowerCase());
  if (showPre) {
    parts.push(
      `<h3 class="heading ditto-extract-preheading mb-2">${escapeHtmlPlain(pre)}</h3>`,
    );
  }
  if (title) {
    parts.push(`<h1 class="heading">${escapeHtmlPlain(title)}</h1>`);
  }
  if (sub) {
    if (/^h[2-6]$/.test(subRole)) {
      const tag = subRole.match(/^h[2-6]$/) ? subRole : "h2";
      parts.push(
        `<${tag} class="heading ditto-extract-subheading mb-0">${escapeHtmlPlain(sub)}</${tag}>`,
      );
    } else {
      parts.push(`<p class="mb-0">${escapeHtmlPlain(sub)}</p>`);
    }
  } else {
    const desc = resolveHeroDescription(hero, body);
    if (desc) {
      parts.push(
        desc.startsWith("<") ? desc : `<div class="description">${escapeHtmlPlain(desc)}</div>`,
      );
    }
  }

  const ctas = Array.isArray(hero.ctas) ? hero.ctas : [];
  let ctaHtml = "";
  if (ctas.length) {
    const cta = ctas[0];
    const label = escapeHtmlPlain(cta.label || "Learn more");
    const href = escapeHtmlPlain(cta.href || "#");
    const style = String(cta.cta_style || "primary").toLowerCase();
    ctaHtml = `<div class="cta-group"><div class="btn-wrapper btn-${style}-wrapper"><a class="cta-button" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a></div></div>`;
  }

  if (!parts.length && !ctaHtml) {
    return "";
  }

  const inner = parts.length
    ? `<div class="${ctaHtml ? "sr-spacer-bottom-50" : ""}">${parts.join("\n")}</div>${ctaHtml}`
    : ctaHtml;
  return inner;
}

/**
 * @param {string} moduleDir
 * @param {Record<string, unknown>|null|undefined} typographyExtract
 * @param {Record<string, unknown>} [body]
 */
function bakeExtractedHeroIntoModuleHtmlForBrad(moduleDir, typographyExtract, body = {}) {
  const hero = typographyExtract?.hero;
  if (!hero?.found) {
    return { baked: false, reason: "no_hero" };
  }

  const moduleHtmlPath = path.join(moduleDir, "module.html");
  if (!fs.existsSync(moduleHtmlPath)) {
    return { baked: false, reason: "missing_module_html" };
  }

  let html = fs.readFileSync(moduleHtmlPath, "utf8");
  const inner = buildBakedHeroInnerHtml(hero, body);
  if (!inner) {
    return { baked: false, reason: "empty_hero_inner" };
  }

  html = html.replace(/\sprototype-no-background/g, " ditto-brad-hero-baked");
  html = html.replace(
    /{% if module\.design_settings\.background_option == 'image' %}\s*<div class="sr-cover-image"[^>]*><\/div>\s*{% endif %}/,
    '<div class="sr-cover-image ditto-hero-cover" role="img" aria-label="Hero Background Image"></div>',
  );

  const heroBlockRe =
    /{% if module\.heading \|\| module\.description %}[\s\S]*?{% endif %}\s*\{\{ macros\.cta\(module\.ctas\) \}\}/;
  if (heroBlockRe.test(html)) {
    html = html.replace(heroBlockRe, inner);
  } else {
    html = html.replace(/\{\{ macros\.cta\(module\.ctas\) \}\}/, `${inner}\n\n\t\t\t\t{{ macros.cta(module.ctas) }}`);
  }

  const coverLines = [
    ...buildBradModuleHeroCoverCss(hero),
    ...buildBradModuleHeadingColorCss(hero),
  ];
  if (coverLines.length) {
    const block = `\n\t\t/* ditto-brad-hero-cover-bake */\n\t\t${coverLines.join("\n\t\t")}\n`;
    if (html.includes("ditto-brad-hero-cover-bake")) {
      html = html.replace(
        /\t\t\/\* ditto-brad-hero-cover-bake \*\/[\s\S]*?(?=\t\t\{\{ macros\.design_settings)/,
        block,
      );
    } else {
      html = html.replace(
        /(\t\t\{\{ macros\.design_settings\(name, module\.design_settings, true\) \}\})/,
        `${block}$1`,
      );
    }
  }

  fs.writeFileSync(moduleHtmlPath, html, "utf8");
  return { baked: true, reason: "ok" };
}

/**
 * @param {string} workdir
 * @param {{ found?: boolean, background?: Record<string, unknown> }} hero
 */
function ensureHeroCoverInClientTypographyCss(workdir, hero) {
  const { appendHeroCoverCssToClientTypographyFile } = require("./typography-hero-cover-css");
  appendHeroCoverCssToClientTypographyFile(workdir, hero, "client-typography.css", "brad");
}

module.exports = {
  escapeHtmlPlain,
  expandTypographyCssForBradModuleScope,
  buildBradModuleHeroCoverCss,
  buildBradModuleHeadingColorCss,
  isLightHexColor,
  buildBakedHeroInnerHtml,
  bakeExtractedHeroIntoModuleHtmlForBrad,
  ensureHeroCoverInClientTypographyCss,
};
