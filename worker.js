/**
 * Kick ChatGPT Transcriber — Cloudflare Worker
 *
 * POST /transcribe
 * multipart/form-data:
 *   file: audio file (required)
 *   language: source language code (optional, e.g. "en")
 *   translate_to: translation language (optional, defaults to "zh")
 *
 * Required Worker secrets:
 *   OPENAI_API_KEY
 *   API_TOKEN
 */

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const OPENAI_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "cache-control": "no-store"
    }
  });
}

function authorized(request, env) {
  const expected = env.API_TOKEN;
  const supplied = request.headers.get("authorization") || "";
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

function timestamp(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return [h, String(m).padStart(2, "0"), s].join(":");
}

async function transcribe(request, env) {
  if (!env.OPENAI_API_KEY || !env.API_TOKEN) {
    return json({ error: "Server is not configured. Set OPENAI_API_KEY and API_TOKEN secrets." }, 503);
  }
  if (!authorized(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Expected multipart/form-data with a file field." }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ error: 'Missing audio file. Send it in the "file" form field.' }, 400);
  }
  if (file.size === 0) return json({ error: "The uploaded file is empty." }, 400);
  if (file.size > MAX_AUDIO_BYTES) {
    return json({ error: "Audio file exceeds the 24 MB limit. Split long recordings into smaller files." }, 413);
  }

  const language = String(form.get("language") || "").trim();
  const translateTo = String(form.get("translate_to") || "zh").trim();

  const audioForm = new FormData();
  audioForm.append("file", file, file.name || "audio-upload");
  audioForm.append("model", "whisper-1");
  audioForm.append("response_format", "verbose_json");
  audioForm.append("timestamp_granularities[]", "segment");
  if (language) audioForm.append("language", language);

  let transcriptResponse;
  try {
    transcriptResponse = await fetch(OPENAI_TRANSCRIPT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: audioForm
    });
  } catch {
    return json({ error: "Could not reach the transcription service." }, 502);
  }

  const transcriptBody = await transcriptResponse.json().catch(() => ({}));
  if (!transcriptResponse.ok) {
    return json({
      error: "Transcription request failed.",
      upstream_status: transcriptResponse.status,
      details: transcriptBody.error?.message || "OpenAI returned an error."
    }, 502);
  }

  const originalText = transcriptBody.text || "";
  const segments = (transcriptBody.segments || []).map((segment) => ({
    start_seconds: segment.start,
    end_seconds: segment.end,
    start: timestamp(segment.start),
    end: timestamp(segment.end),
    text: segment.text || ""
  }));

  let translation = "";
  let summary = "";
  if (originalText) {
    const chatResponse = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You process speech transcripts. Return valid JSON with keys translation and summary. Translate the transcript faithfully into the requested language, preserving meaning and uncertainty. Summarize the main points concisely. Do not invent missing speech or identify speakers."
          },
          {
            role: "user",
            content: `Target translation language: ${translateTo}\n\nTranscript:\n${originalText}`
          }
        ]
      })
    });

    const chatBody = await chatResponse.json().catch(() => ({}));
    if (chatResponse.ok) {
      try {
        const result = JSON.parse(chatBody.choices?.[0]?.message?.content || "{}");
        translation = result.translation || "";
        summary = result.summary || "";
      } catch {
        summary = "Translation and summary could not be parsed.";
      }
    } else {
      summary = "Transcription completed, but translation and summary failed.";
    }
  }

  return json({
    filename: file.name || null,
    language: transcriptBody.language || language || null,
    duration_seconds: transcriptBody.duration ?? null,
    transcript: originalText,
    segments,
    translation,
    summary,
    notes: [
      "Speaker identities are not inferred from voices.",
      "Unclear speech should remain marked as unclear rather than guessed.",
      "This endpoint accepts uploaded audio; it does not download Kick VOD URLs."
    ]
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "86400"
        }
      });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return json({
        name: "Kick ChatGPT Transcriber",
        status: "ok",
        endpoints: { health: "GET /health", transcribe: "POST /transcribe" }
      }, 200, origin);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok" }, 200, origin);
    }

    if (url.pathname === "/transcribe" && request.method === "POST") {
      const response = await transcribe(request, env);
      const headers = new Headers(response.headers);
      headers.set("access-control-allow-origin", origin);
      return new Response(response.body, { status: response.status, headers });
    }

    return json({ error: "Not found" }, 404, origin);
  }
};
