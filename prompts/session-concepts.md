- All generated output (filenames, titles, tags, summary, details) MUST always be written in Korean.
- From the user messages below, extract new technical concepts that appeared and were explained in this session.
- Output ONLY a raw JSON array (no markdown code fences, no other text).
Format:
```json
{
  "filename": "kebab-case.md",
  "title": "concept name",
  "tags": ["tag1", "tag2"],
  "summary": "1–3 sentence summary",
  "details": "detailed explanation (markdown allowed)"
}
```
- Tech-stack concepts related to: {{LEARNING_STACKS}}
- Project-domain concepts related to: {{LEARNING_DOMAINS}}
- If there are no qualifying concepts, output [] only.
