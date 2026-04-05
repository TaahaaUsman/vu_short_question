# Short questions (3 marks) — ACC311

This folder has two parts: a **generator** (`script/`) and a **React viewer** (`vistuallization/`).

---

## Prerequisites

- Workspace root is the parent of `short-questions/` (the `aa` folder that contains `.env` and `newHtml/`).
- **`OPENAI_API_KEY`** in `aa/.env` (and optionally `OPENAI_MODEL`, e.g. `gpt-4.1-mini`).
- Node.js 18+.

---

## 1. Generator — `script/`

### Folders

| Path             | Purpose                                                         |
| ---------------- | --------------------------------------------------------------- |
| `script/input/`  | Put one or more handout **`.html`** files here.                 |
| `script/output/` | Generated JSON appears here (ignored by git except `.gitkeep`). |

**Output file name:** `input/{basename}.html` → `output/{basename}-short-questions.json`  
Example: `input/demo.html` → `output/demo-short-questions.json`.

### Commands

Run from **`short-questions/script/`**:

```bash
cd short-questions/script
npm install
```

| Command                 | What it does                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm run parse`         | Parse all HTML in `input/` and print lecture summaries (no API).                                                              |
| `npm run generate`      | Call OpenAI for every HTML in `input/`; write JSON to `output/`.                                                              |
| `npm run generate:mock` | Same flow with fake data (no API, good for testing paths).                                                                    |
| `npm run generate:sync` | After generate, **copy** each JSON to `vistuallization/public/courses/` and **append** `index.json` if that `dataUrl` is new. |
| `npm run generate:one`  | Example: add `--lesson=1` in `package.json` or run `node scripts/generate.mjs --lesson=1`                                     |

### CLI flags (with `node scripts/generate.mjs …`)

- `--dry-run` — only print estimated question counts per lecture; no API, no files written.
- `--mock` — write mock JSON (no API).
- `--sync` — after writing `output/*.json`, sync to the visualization app (see below).
- `--lesson=N` — only process lecture number `N` from each HTML file.
- Pass a **path to one HTML file** to process only that file (ignores `input/` scan for that run):

  ```bash
  node scripts/generate.mjs ../../newHtml/demo.html
  ```

### Environment variables

| Variable               | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `OPENAI_API_KEY`       | Required for real generation.                               |
| `OPENAI_MODEL`         | Default `gpt-4.1-mini`.                                     |
| `OPENAI_API_MODE=chat` | Use Chat Completions instead of the default Responses API.  |
| `COURSE_CODE`          | Used when `--sync` appends `index.json` (default `ACC311`). |
| `COURSE_TITLE`         | Same (default `Fundamentals of Auditing`).                  |

---

## 2. Visualization — `vistuallization/`

Static course data lives under **`public/courses/`**:

- `index.json` — list of course cards (`id`, `code`, `title`, `subtitle`, `dataUrl`).
- `*.json` — question bank files referenced by `dataUrl`.

### Run the app

```bash
cd short-questions/vistuallization
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Pick a course card to open lectures and short questions.

### After you generate new JSON

1. **Option A — automatic:** run `npm run generate:sync` from `script/` so files are copied and `index.json` gets a new entry when needed.
2. **Option B — manual:** copy `script/output/your-file-short-questions.json` into `vistuallization/public/courses/` and add an entry to `index.json` yourself.

If the dev server is already running, refresh the browser; restart dev if `public/` changes are not picked up.

---

## Typical workflow

1. Copy or save handout HTML into `script/input/` (or pass a path on the CLI).
2. `npm run parse` to verify parsing.
3. `npm run generate` (or `generate:sync` to update the viewer in one step).
4. Open `vistuallization` with `npm run dev` and check the new course card.

---

## JSON shape (short)

Top-level fields include `courseCode`, `sourceHtml`, `generatedAt`, `model`, and:

```json
"lessons": [
  {
    "lessonNumber": 1,
    "lessonId": "ls-01",
    "title": "...",
    "shortQuestions": [
      {
        "id": "l01-q01",
        "question": "...",
        "answerBlocks": [ ... ]
      }
    ]
  }
]
```

`answerBlocks` types: `paragraph`, `bulletList`, `orderedList`, `table`.

---

## Troubleshooting

- **“No HTML input”** — add `.html` files under `script/input/` or pass a file path.
- **429 / quota** — check OpenAI billing; try Responses API (default) vs `OPENAI_API_MODE=chat` if your project differs.
- **Duplicate course cards** — edit `vistuallization/public/courses/index.json` and remove old `dataUrl` entries you do not need.

Fuck everthing all we need to do. we have to push the branch to the live.
