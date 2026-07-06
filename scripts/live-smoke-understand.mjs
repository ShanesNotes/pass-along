const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

if (!key) {
  console.log(
    JSON.stringify({
      status: "SKIPPED",
      reason: "Set GEMINI_API_KEY or GOOGLE_API_KEY to run the live smoke."
    })
  );
  process.exit(0);
}

const { UNDERSTAND_2_PROMPT } = await import(
  "../packages/prompts/src/understand2.ts"
);
const input = "Sliding scale telehealth therapist for teen anxiety near Chicago";
const text = await completeUnderstandSmoke(input, key);
const understood = requireUnderstoodQuery(parseJsonObject(text));

console.log(
  JSON.stringify(
    {
      status: "PASSED",
      source: "model",
      understood
    },
    null,
    2
  )
);

async function completeUnderstandSmoke(rawInput, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const url = new URL(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent"
  );
  url.searchParams.set("key", apiKey);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: UNDERSTAND_2_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  task: "understand_find_query",
                  input: rawInput
                })
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 900
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Google understand smoke failed with HTTP ${response.status}`);
    }

    const payload = await response.json();
    const completionText = extractGoogleText(payload);

    if (completionText.length === 0) {
      throw new Error("Google understand smoke returned no text.");
    }

    return completionText;
  } finally {
    clearTimeout(timeout);
  }
}

function extractGoogleText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

function parseJsonObject(text) {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error("Understand smoke returned no JSON object.");
  }

  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

function requireUnderstoodQuery(value) {
  if (!isRecord(value)) {
    throw new Error("Understand smoke returned a non-object value.");
  }

  if (!Array.isArray(value.issues)) {
    throw new Error("Understand smoke returned invalid issues.");
  }

  if (!["therapist", "facility", "either"].includes(value.kind)) {
    throw new Error("Understand smoke returned invalid kind.");
  }

  if (!isRecord(value.preferences)) {
    throw new Error("Understand smoke returned invalid preferences.");
  }

  if (typeof value.confidence !== "number") {
    throw new Error("Understand smoke returned invalid confidence.");
  }

  for (const issue of value.issues) {
    requireTaxonomyTag(issue, "issues");
  }

  if (value.preferences.modality !== undefined) {
    if (!Array.isArray(value.preferences.modality)) {
      throw new Error("Understand smoke returned invalid modality.");
    }

    for (const modality of value.preferences.modality) {
      requireTaxonomyTag(modality, "preferences.modality");
    }
  }

  return value;
}

function requireTaxonomyTag(value, field) {
  if (
    !isRecord(value) ||
    typeof value.value !== "string" ||
    typeof value.vocab !== "boolean" ||
    typeof value.confidence !== "number"
  ) {
    throw new Error(`Understand smoke returned invalid ${field} tag.`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
