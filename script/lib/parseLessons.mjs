import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

/**
 * @param {string} htmlPath - absolute or cwd-relative path to handouts HTML
 * @returns {{ lessonId: string, lessonNumber: number, title: string, plainText: string }[]}
 */
export function parseLessonsFromHtml(htmlPath) {
  const resolved = path.resolve(htmlPath);
  const html = fs.readFileSync(resolved, 'utf8');
  const $ = cheerio.load(html);

  // Strategy 1: section.lesson-section (original ACC311 format)
  const sections = $('section.lesson-section');
  if (sections.length > 0) {
    return parseSectionFormat($, sections);
  }

  // Strategy 2: <h3>LESSON N</h3> flat format (ACC501 style)
  const lessonH3s = [];
  $('h3').each((_, el) => {
    if (/^LESSON\s+\d+$/i.test($(el).text().trim())) {
      lessonH3s.push(el);
    }
  });
  if (lessonH3s.length > 0) {
    return parseMarkerFormat(
      $,
      lessonH3s,
      ($m) => {
        const m = $m.text().match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      },
      ($m, siblingEls) => {
        for (const el of siblingEls) {
          if (el.type !== 'tag') continue;
          const t = $(el).text().trim();
          if (t && !/copyright|virtual university of pakistan|join vu group/i.test(t) && t.length < 200) {
            return t.replace(/\s+/g, ' ');
          }
        }
        return $m.text().trim();
      }
    );
  }

  // Strategy 3: <h1>Module N: Title</h1> format (BIF101 style)
  const moduleH1s = [];
  $('h1').each((_, el) => {
    if (/^Module\s+\d+/i.test($(el).text().trim())) {
      moduleH1s.push(el);
    }
  });
  if (moduleH1s.length > 0) {
    return parseMarkerFormat(
      $,
      moduleH1s,
      ($m, idx) => {
        const m = $m.text().match(/\d+/);
        return m ? parseInt(m[0], 10) : idx + 1;
      },
      ($m) => {
        const text = $m.text().trim();
        return text
          .replace(/^Module\s+\d+[:;]\s*/i, '')
          .replace(/\s+Text\s*\(\d+\s*minutes?\)\s*$/i, '')
          .trim() || text;
      }
    );
  }

  return [];
}

// ── Original section.lesson-section format ────────────────────────────────────

function parseSectionFormat($, sections) {
  const lessons = [];
  sections.each((_, el) => {
    const $sec = $(el);
    const lessonId = $sec.attr('id') || '';

    const tag = $sec.find('h3.lesson-tag').first();
    const tagText = tag.text().trim();
    const numMatch = tagText.match(/(\d+)/);
    const lessonNumber = numMatch ? parseInt(numMatch[1], 10) : lessons.length + 1;

    const $clone = $sec.clone();
    $clone.find('.lecture-media, .lesson-nav, h3.lesson-tag').remove();

    const titleEl = $clone.find('h2').first();
    const title = titleEl.text().trim() || `Lesson ${lessonNumber}`;
    $clone.find('h2').first().remove();

    const plainText = sectionToPlainText($, $clone);
    lessons.push({ lessonId, lessonNumber, title, plainText });
  });
  return lessons;
}

// ── Generic marker-based flat format ─────────────────────────────────────────

function parseMarkerFormat($, markerEls, getNumber, getTitle) {
  const lessons = [];

  markerEls.forEach((markerEl, idx) => {
    const $marker = $(markerEl);
    const lessonNumber = getNumber($marker, idx);
    const lessonId = `lesson-${String(lessonNumber).padStart(2, '0')}`;

    // All following siblings at the same DOM level
    const allFollowing = $marker.nextAll().toArray();
    const nextMarkerEl = markerEls[idx + 1] || null;
    const cutIdx = nextMarkerEl ? allFollowing.indexOf(nextMarkerEl) : allFollowing.length;
    const siblingEls = allFollowing.slice(0, cutIdx < 0 ? allFollowing.length : cutIdx);

    const title = getTitle($marker, siblingEls, idx);

    const parts = [];
    for (const el of siblingEls) {
      if (el.type === 'tag') extractNodeText($, $(el), parts);
    }

    const plainText = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (plainText) {
      lessons.push({ lessonId, lessonNumber, title, plainText });
    }
  });

  return lessons;
}

// ── Text extraction helpers ───────────────────────────────────────────────────

const NOISE_RE = /copyright|virtual university of pakistan|join vu group|whatsapp\.com/i;

function extractNodeText($, $el, parts) {
  const el = $el[0];
  if (!el || el.type !== 'tag') return;
  const name = el.name;
  if (name === 'script' || name === 'style') return;

  const text = $el.text().trim();

  // Skip pure noise elements
  if (NOISE_RE.test(text) && text.length < 300) return;
  if (/^(vu|\d+)$/i.test(text)) return;

  if (name === 'p') {
    const t = text.replace(/\s+/g, ' ');
    // Skip header noise like "Business Finance – ACC501"
    if (t && !/^[A-Z][\w\s–-]{0,60}–\s*[A-Z]{2,}\d{3}$/.test(t)) parts.push(t);
    return;
  }
  if (name === 'h1') {
    if (text) parts.push(`\n# ${text.replace(/\s+/g, ' ')}\n`);
    return;
  }
  if (name === 'h2') {
    if (text) parts.push(`\n## ${text.replace(/\s+/g, ' ')}\n`);
    return;
  }
  if (name === 'h3') {
    if (text) parts.push(`\n### ${text.replace(/\s+/g, ' ')}\n`);
    return;
  }
  if (name === 'li') {
    const t = text.replace(/\s+/g, ' ');
    if (t) parts.push(`- ${t}`);
    return;
  }
  if (name === 'br') {
    parts.push('');
    return;
  }
  // Recurse into container elements
  $el.children().each((_, child) => extractNodeText($, $(child), parts));
}

function sectionToPlainText($, $root) {
  const parts = [];

  function process($el) {
    $el.contents().each((_, node) => {
      if (node.type === 'text') {
        const t = String(node.data || '').replace(/\s+/g, ' ').trim();
        if (t) parts.push(t);
        return;
      }
      if (node.type !== 'tag') return;

      const name = node.name;
      if (name === 'script' || name === 'style') return;

      const $n = $(node);

      if (name === 'p') {
        const t = $n.text().replace(/\s+/g, ' ').trim();
        if (t) parts.push(t);
        return;
      }
      if (name === 'h2' || name === 'h3') {
        const t = $n.text().replace(/\s+/g, ' ').trim();
        if (t) parts.push(`\n## ${t}\n`);
        return;
      }
      if (name === 'li') {
        const t = $n.text().replace(/\s+/g, ' ').trim();
        if (t) parts.push(`- ${t}`);
        return;
      }
      if (name === 'br') {
        parts.push('');
        return;
      }
      if (name === 'ul' || name === 'ol') {
        process($n);
        return;
      }
      process($n);
    });
  }

  process($root);
  return parts
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
