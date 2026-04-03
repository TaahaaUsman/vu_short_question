#!/usr/bin/env node
/**
 * Parse demo.html (or path from argv) and print lesson summaries — no API calls.
 * Usage: npm run parse
 *        node scripts/parseOnly.mjs ../newHtml/demo.html
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { parseLessonsFromHtml } from '../lib/parseLessons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const defaultHtml = path.join(root, 'newHtml', 'demo.html');
const htmlPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultHtml;

const lessons = parseLessonsFromHtml(htmlPath);
console.log(`Parsed ${lessons.length} lesson(s) from ${htmlPath}\n`);
for (const L of lessons) {
  console.log(`--- L${String(L.lessonNumber).padStart(2, '0')} ${L.lessonId} ---`);
  console.log(L.title);
  console.log(`chars: ${L.plainText.length}`);
  console.log(L.plainText.slice(0, 400).replace(/\n/g, ' ') + '...\n');
}
