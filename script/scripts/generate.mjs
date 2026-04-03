#!/usr/bin/env node
/**
 * Generate short questions + structured answers per lesson via OpenAI.
 * Loads API key from repo root .env (OPENAI_API_KEY).
 *
 * Usage:
 *   npm run generate
 *   node scripts/generate.mjs --lesson=2
 *   node scripts/generate.mjs --dry-run
 *
 * API mode (env):
 *   Default: Responses API (POST /v1/responses) — matches `gpt-4.1-mini` usage in PowerShell.
 *   OPENAI_API_MODE=chat — use Chat Completions instead (older path; may hit different quota).
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { parseLessonsFromHtml } from '../lib/parseLessons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const defaultHtml = path.join(repoRoot, 'newHtml', 'demo.html');
const outDir = path.join(__dirname, '..', 'output');
const outFile = path.join(outDir, 'acc311-demo-short-questions.json');

function argLesson() {
  const a = process.argv.find((x) => x.startsWith('--lesson='));
  if (!a) return null;
  return parseInt(a.split('=')[1], 10);
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

async function main() {
  const dry = process.argv.includes('--dry-run');
  const useMock = process.argv.includes('--mock');
  const lessonFilter = argLesson();
  const htmlArg = process.argv.find((x) => !x.startsWith('--') && x.endsWith('.html'));
  const htmlPath = htmlArg ? path.resolve(process.cwd(), htmlArg) : defaultHtml;

  if (!fs.existsSync(htmlPath)) {
    console.error('HTML not found:', htmlPath);
    process.exit(1);
  }

  let lessons = parseLessonsFromHtml(htmlPath);
  if (lessonFilter != null && !Number.isNaN(lessonFilter)) {
    lessons = lessons.filter((L) => L.lessonNumber === lessonFilter);
    if (!lessons.length) {
      console.error('No lesson with number', lessonFilter);
      process.exit(1);
    }
  }

  console.log(`Lessons to process: ${lessons.length} (from ${htmlPath})`);

  if (dry) {
    for (const L of lessons) {
      const est = estimatedQuestionCount(L.plainText.length);
      console.log(`L${L.lessonNumber} ${L.lessonId} | ${L.plainText.length} chars | Q est ${est.min}-${est.max}`);
    }
    return;
  }

  const courseCode = 'ACC311';
  const sourceFile = path.relative(repoRoot, htmlPath).replace(/\\/g, '/');
  const model = useMock ? 'mock' : process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const payload = {
    courseCode,
    sourceHtml: sourceFile,
    generatedAt: new Date().toISOString(),
    model,
    lessons: [],
  };

  if (useMock) {
    for (const lesson of lessons) {
      console.log(`Mock L${lesson.lessonNumber} (${lesson.lessonId})`);
      payload.lessons.push(mockLessonJson(lesson));
    }
  } else {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      console.error('Missing OPENAI_API_KEY in .env at repo root');
      process.exit(1);
    }

    const client = new OpenAI({ apiKey: key });

    for (const lesson of lessons) {
      console.log(`Generating L${lesson.lessonNumber} (${lesson.lessonId})…`);
      const part = await generateLesson(client, lesson, model);
      payload.lessons.push(part);
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log('Wrote', outFile);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
