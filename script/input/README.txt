Place your handout HTML files here (e.g. demo.html, acc311-beautiful.html).

The generator reads every .html in this folder and writes matching JSON to ../output/:
  demo.html  →  output/demo-short-questions.json

Optional: npm run generate:sync  → also copies JSON into vistuallization/public/courses/ and appends index.json.

You can also pass a file path: node scripts/generate.mjs C:\path\to\file.html
