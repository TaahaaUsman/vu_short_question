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

  const lessons = [];
  $('section.lesson-section').each((_, el) => {
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

    lessons.push({
      lessonId,
      lessonNumber,
      title,
      plainText,
    });
  });

  if (!lessons.length) {
    const fromLessonHeadings = parseHeadingBasedLessons($);
    if (fromLessonHeadings.length) return fromLessonHeadings;

    const fromModuleTopicHeadings = parseModuleTopicHeadings($);
    if (fromModuleTopicHeadings.length) return fromModuleTopicHeadings;

    return parsePageBreakLessons($);
  }

  return lessons;
}

function parseHeadingBasedLessons($) {
  const lessons = [];
  const starts = $('h3')
    .toArray()
    .filter((el) => /lesson\s*\d+/i.test($(el).text().trim()));

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const $start = $(start);
    const headingText = $start.text().trim();
    const numMatch = headingText.match(/(\d+)/);
    const lessonNumber = numMatch ? parseInt(numMatch[1], 10) : i + 1;
    const lessonId = `lesson-${String(lessonNumber).padStart(2, '0')}`;

    const $container = $('<section></section>');
    let node = $start.next();

    while (node.length) {
      if (node.is('h3') && /lesson\s*\d+/i.test(node.text().trim())) break;
      $container.append(node.clone());
      node = node.next();
    }

    const titleEl = $container.find('h2').first();
    const title = titleEl.text().trim() || `Lesson ${lessonNumber}`;
    titleEl.remove();
    $container.find('.lecture-media, .lesson-nav, .footer-note, .page-break, .header-text').remove();

    const plainText = sectionToPlainText($, $container);
    if (!plainText) continue;

    lessons.push({
      lessonId,
      lessonNumber,
      title,
      plainText,
    });
  }

  return lessons;
}

function parseModuleTopicHeadings($) {
  const lessons = [];
  const markerRegex =
    /\b(lesson|module|topic)\b\s*[:\-]?\s*\d+/i;

  const starts = $('h1, h2, h3, p.header-text')
    .toArray()
    .filter((el) => markerRegex.test($(el).text().replace(/\s+/g, ' ').trim()));

  if (!starts.length) return lessons;

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const $start = $(start);
    const headingText = $start.text().replace(/\s+/g, ' ').trim();
    const lessonNumber = i + 1;
    const lessonId = `lesson-${String(lessonNumber).padStart(2, '0')}`;

    const $container = $('<section></section>');
    let node = $start;
    while (node.length) {
      if (
        node[0] !== start &&
        node.is('h1, h2, h3, p.header-text') &&
        markerRegex.test(node.text().replace(/\s+/g, ' ').trim())
      ) {
        break;
      }
      $container.append(node.clone());
      node = node.next();
    }

    $container.find('.lecture-media, .lesson-nav, .footer-note, .page-break, .header-text').remove();
    const title = headingText || `Lesson ${lessonNumber}`;
    const plainText = sectionToPlainText($, $container);
    if (!plainText) continue;

    lessons.push({
      lessonId,
      lessonNumber,
      title,
      plainText,
    });
  }

  return lessons;
}

function parsePageBreakLessons($) {
  const lessons = [];
  const nodes = $('article').first().children().toArray();
  if (!nodes.length) return lessons;

  let chunk = [];
  const chunks = [];
  for (const node of nodes) {
    if ($(node).hasClass('page-break')) {
      if (chunk.length) chunks.push(chunk);
      chunk = [];
      continue;
    }
    chunk.push(node);
  }
  if (chunk.length) chunks.push(chunk);

  for (let i = 0; i < chunks.length; i += 1) {
    const nodesInChunk = chunks[i];
    const lessonNumber = i + 1;
    const lessonId = `lesson-${String(lessonNumber).padStart(2, '0')}`;
    const $container = $('<section></section>');
    nodesInChunk.forEach((n) => $container.append($(n).clone()));

    $container.find('.lecture-media, .lesson-nav, .footer-note, .page-break, .header-text').remove();

    const titleEl = $container.find('h1, h2, h3').first();
    const title = titleEl.text().replace(/\s+/g, ' ').trim() || `Lesson ${lessonNumber}`;
    const plainText = sectionToPlainText($, $container);
    if (!plainText) continue;

    lessons.push({
      lessonId,
      lessonNumber,
      title,
      plainText,
    });
  }

  return lessons;
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
