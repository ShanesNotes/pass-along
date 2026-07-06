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

const { RERANK_1_PROMPT } = await import("../packages/prompts/src/rerank1.ts");

const input = {
  understood: {
    issues: [{ value: "anxiety", vocab: true, confidence: 0.9 }],
    population: "teen",
    kind: "therapist",
    preferences: {
      modality: [{ value: "cbt", vocab: true, confidence: 0.82 }],
      logistics: ["evenings"]
    },
    location: { text: "Denver" },
    confidence: 0.86
  },
  candidates: [
    {
      id: "provider_teen_denver",
      snippets: [
        {
          span_id: "provider_teen_denver:rec_001:keystone",
          text: "The first plan for teen anxiety that worked after school instead of only in the office."
        },
        {
          span_id: "provider_teen_denver:rec_002:keystone",
          text: "They taught panic steps my daughter could use before class started."
        }
      ]
    },
    {
      id: "provider_pain_detroit",
      snippets: [
        {
          span_id: "provider_pain_detroit:rec_025:keystone",
          text: "They connected chronic pain and depression without making either one feel imagined."
        }
      ]
    }
  ]
};

const text = await completeRerankSmoke(input, key);
const rerank = requireGroundedRerank(parseJsonObject(text), input.candidates);

console.log(
  JSON.stringify(
    {
      status: "PASSED",
      source: "model",
      result_ids: rerank.results.map((result) => result.id),
      cited_span_ids: rerank.results.flatMap((result) =>
        result.why.flatMap((sentence) => sentence.cited_span_ids)
      )
    },
    null,
    2
  )
);

async function completeRerankSmoke(payload, apiKey) {
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
        systemInstruction: { parts: [{ text: RERANK_1_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(payload) }]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1200
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Google rerank smoke failed with HTTP ${response.status}`);
    }

    const completionText = extractGoogleText(await response.json());

    if (completionText.length === 0) {
      throw new Error("Google rerank smoke returned no text.");
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
    throw new Error("Rerank smoke returned no JSON object.");
  }

  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

function requireGroundedRerank(value, candidates) {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("Rerank smoke returned invalid results.");
  }

  if (value.results.length === 0 || value.results.length > 6) {
    throw new Error("Rerank smoke returned the wrong number of results.");
  }

  const candidatesById = new Map(
    candidates.map((candidate) => [
      candidate.id,
      new Set(candidate.snippets.map((snippet) => snippet.span_id))
    ])
  );

  for (const result of value.results) {
    if (!isRecord(result) || typeof result.id !== "string") {
      throw new Error("Rerank smoke returned an invalid result id.");
    }

    const spanIds = candidatesById.get(result.id);

    if (!spanIds) {
      throw new Error("Rerank smoke returned an unknown candidate id.");
    }

    if (typeof result.score !== "number" || result.score < 0 || result.score > 1) {
      throw new Error("Rerank smoke returned an invalid score.");
    }

    if (!Array.isArray(result.why)) {
      throw new Error("Rerank smoke returned invalid why sentences.");
    }

    for (const sentence of result.why) {
      if (
        !isRecord(sentence) ||
        typeof sentence.text !== "string" ||
        !Array.isArray(sentence.cited_span_ids) ||
        sentence.cited_span_ids.length === 0
      ) {
        throw new Error("Rerank smoke returned an invalid why sentence.");
      }

      for (const spanId of sentence.cited_span_ids) {
        if (typeof spanId !== "string" || !spanIds.has(spanId)) {
          throw new Error("Rerank smoke returned an ungrounded citation.");
        }
      }
    }
  }

  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
