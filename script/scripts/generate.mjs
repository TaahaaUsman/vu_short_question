#!/usr/bin/env node
/**
 * Generate short questions from HTML in input/ → output/{name}-short-questions.json
 *
 * - Put one or more .html files in script/input/
 * - Or pass a specific file: node scripts/generate.mjs path/to/file.html
 * - --sync copies each JSON to short-questions/vistuallization/public/courses/ and updates index.json
 * - --skip-existing skips HTML files whose output JSON already exists
 *
 * Env: OPENAI_API_KEY, OPENAI_MODEL, OPENAI_API_MODE=chat, COURSE_CODE, COURSE_TITLE
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { parseLessonsFromHtml } from '../lib/parseLessons.mjs';
import { listHtmlFiles, syncToViz, workspaceRoot } from '../lib/syncViz.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptRoot = path.join(__dirname, '..');
const repoRoot = workspaceRoot();
const rootEnvPath = path.join(repoRoot, '.env');
const scriptEnvPath = path.join(scriptRoot, '.env');
dotenv.config({ path: rootEnvPath, quiet: true });
dotenv.config({ path: scriptEnvPath, quiet: true, override: false });

const inputDir = path.join(scriptRoot, 'input');
const outDir = path.join(scriptRoot, 'output');

function argLesson() {
  const a = process.argv.find((x) => x.startsWith('--lesson='));
  if (!a) return null;
  return parseInt(a.split('=')[1], 10);
}

function resolveHtmlFiles() {
  const explicit = process.argv.find(
    (x) => !x.startsWith('--') && x.toLowerCase().endsWith('.html')
  );
  if (explicit) return [path.resolve(process.cwd(), explicit)];
  const fromInput = listHtmlFiles(inputDir);
  return fromInput;
}

function estimatedQuestionCount(charLen) {
  if (charLen < 2500) return { min: 5, max: 8, target: 6 };
  if (charLen < 8000) return { min: 8, max: 12, target: 10 };
  if (charLen < 20000) return { min: 10, max: 15, target: 12 };
  return { min: 12, max: 18, target: 14 };
}

const SYSTEM = `You generate Virtual University (Pakistan) style short exam questions for ACC311 Fundamentals of Auditing.
Rules:
- Use ONLY the lesson text provided. Do not add facts not supported by the text.
- Questions should look like typical VU short questions: define, list, distinguish, briefly explain, outline.
- Each answer must be accurate relative to the lesson text.
- Output must be valid JSON only, no markdown fences.`;

function userPayload(lesson) {
  const { min, max, target } = estimatedQuestionCount(lesson.plainText.length);
  return `Lesson metadata:
- lessonNumber: ${lesson.lessonNumber}
- lessonId: "${lesson.lessonId}"
- title: "${lesson.title.replace(/"/g, '\\"')}"

Produce between ${min} and ${max} short questions (aim ~${target} for this amount of text).

Lesson text:
---
${lesson.plainText}
---

Return a single JSON object with exactly this shape (types matter):
{
  "lessonNumber": <number>,
  "lessonId": <string>,
  "title": <string>,
  "shortQuestions": [
    {
      "id": <string, stable slug like "l01-q01">,
      "question": <string>,
      "answerBlocks": <array of blocks>
    }
  ]
}

Each block is ONE of:
{ "type": "paragraph", "text": "<string, may include **bold** and *italic* markdown spans>" }
{ "type": "bulletList", "items": ["<string>", "..."] }
{ "type": "orderedList", "items": ["<string>", "..."] }
{ "type": "table", "headers": ["<col>", "..."], "rows": [["<cell>", "..."], "..."] }

Use multiple blocks when the answer needs lists or a small table. Prefer bulletList for enumerations.`;
}

async function generateLesson(client, lesson, model) {
  const useChat = process.env.OPENAI_API_MODE === 'chat';

  if (useChat) {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPayload(lesson) },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty chat completion');
    return JSON.parse(raw);
  }

  const response = await client.responses.create({
    model,
    instructions: SYSTEM,
    input: userPayload(lesson),
    temperature: 0.35,
    max_output_tokens: 16384,
    text: { format: { type: 'json_object' } },
  });

  if (response.status && response.status !== 'completed') {
    const err = response.error?.message || response.incomplete_details || response.status;
    throw new Error(`Responses API: ${err}`);
  }

  const raw = response.output_text;
  if (!raw?.trim()) throw new Error('Empty response.output_text');
  return JSON.parse(raw);
}

function mockLessonJson(lesson) {
  const n = lesson.lessonNumber;
  const pad = String(n).padStart(2, '0');
  return {
    lessonNumber: n,
    lessonId: lesson.lessonId,
    title: lesson.title,
    shortQuestions: [
      {
        id: `l${pad}-q01`,
        question: `[Mock] Define or explain one core idea from "${lesson.title.slice(0, 60)}…" using only the lesson text.`,
        answerBlocks: [
          {
            type: 'paragraph',
            text: 'Replace this mock by running `npm run generate` with a valid OpenAI quota. Answers use **answerBlocks**: paragraph, bulletList, orderedList, table.',
          },
          {
            type: 'bulletList',
            items: ['Point one (mock)', 'Point two (mock)'],
          },
        ],
      },
    ],
  };
}

async function processOneHtml(htmlPath, opts) {
  const {
    dry,
    useMock,
    lessonFilter,
    courseCode,
    model,
    client,
    doSync,
    skipExisting,
  } = opts;

  if (!fs.existsSync(htmlPath)) {
    console.error('HTML not found:', htmlPath);
    return;
  }

  let lessons = parseLessonsFromHtml(htmlPath);
  if (lessonFilter != null && !Number.isNaN(lessonFilter)) {
    lessons = lessons.filter((L) => L.lessonNumber === lessonFilter);
    if (!lessons.length) {
      console.error('No lesson with number', lessonFilter, 'in', htmlPath);
      return;
    }
  }

  const baseName = path.basename(htmlPath, '.html');
  const outFile = path.join(outDir, `${baseName}-short-questions.json`);
  const sourceFile = path.relative(repoRoot, htmlPath).replace(/\\/g, '/');

  if (skipExisting && fs.existsSync(outFile)) {
    console.log(`\n── ${baseName}.html → ${path.basename(outFile)} ──`);
    console.log('  Skipped (output already exists)');
    return;
  }

  console.log(`\n── ${baseName}.html → ${path.basename(outFile)} (${lessons.length} lectures) ──`);

  if (dry) {
    for (const L of lessons) {
      const est = estimatedQuestionCount(L.plainText.length);
      console.log(`  L${L.lessonNumber} ${L.lessonId} | ${L.plainText.length} chars | Q est ${est.min}-${est.max}`);
    }
    return;
  }

  const payload = {
    courseCode,
    sourceHtml: sourceFile,
    generatedAt: new Date().toISOString(),
    model,
    lessons: [],
  };

  if (useMock) {
    for (const lesson of lessons) {
      console.log(`  Mock L${lesson.lessonNumber} (${lesson.lessonId})`);
      payload.lessons.push(mockLessonJson(lesson));
    }
  } else {
    for (const lesson of lessons) {
      console.log(`  Generating L${lesson.lessonNumber} (${lesson.lessonId})…`);
      const part = await generateLesson(client, lesson, model);
      payload.lessons.push(part);
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log('  Wrote', outFile);

  if (doSync) syncToViz(repoRoot, outFile, 'short');
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const useMock = process.argv.includes('--mock');
  const doSync = process.argv.includes('--sync');
  const skipExisting =
    process.argv.includes('--skip-existing') || process.argv.includes('--skip');
  const lessonFilter = argLesson();

  const htmlFiles = resolveHtmlFiles();
  if (!htmlFiles.length) {
    console.error(
      'No HTML input. Add .html file(s) to:\n  ',
      inputDir,
      '\n  Or run: node scripts/generate.mjs path/to/file.html'
    );
    process.exit(1);
  }

  console.log('HTML files:', htmlFiles.map((p) => path.relative(repoRoot, p)).join(', '));

  const courseCode = process.env.COURSE_CODE || 'ACC311';
  const model = useMock ? 'mock' : process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  let client = null;
  if (!dry && !useMock) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      console.error(
        'Missing OPENAI_API_KEY. Add it to one of these files:\n ',
        rootEnvPath,
        '\n ',
        scriptEnvPath
      );
      process.exit(1);
    }
    client = new OpenAI({ apiKey: key });
  }

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const htmlPath of htmlFiles) {
    await processOneHtml(htmlPath, {
      dry,
      useMock,
      lessonFilter,
      courseCode,
      model,
      client,
      doSync,
      skipExisting,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
