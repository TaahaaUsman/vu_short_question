#!/usr/bin/env node
/**
 * Parse HTML from input/ (or path argv) — no API.
 * Usage: npm run parse
 *        node scripts/parseOnly.mjs
 *        node scripts/parseOnly.mjs ../input/foo.html
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { parseLessonsFromHtml } from '../lib/parseLessons.mjs';
import { listHtmlFiles } from '../lib/syncViz.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptRoot = path.join(__dirname, '..');
const inputDir = path.join(scriptRoot, 'input');

const explicit = process.argv[2];
const files = explicit
  ? [path.resolve(process.cwd(), explicit)]
  : listHtmlFiles(inputDir);

if (!files.length) {
  console.error('No HTML. Add files to', inputDir, 'or pass a path.');
  process.exit(1);
}

for (const htmlPath of files) {
  const lessons = parseLessonsFromHtml(htmlPath);
  console.log(`Parsed ${lessons.length} lecture(s) from ${htmlPath}\n`);
  for (const L of lessons) {
    console.log(`--- L${String(L.lessonNumber).padStart(2, '0')} ${L.lessonId} ---`);
    console.log(L.title);
    console.log(`chars: ${L.plainText.length}`);
    console.log(L.plainText.slice(0, 400).replace(/\n/g, ' ') + '...\n');
  }
}
