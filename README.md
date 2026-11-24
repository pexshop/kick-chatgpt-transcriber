# Kick ChatGPT Transcriber

A Cloudflare Worker backend for transcribing audio recordings with OpenAI, returning timestamped segments, a Chinese translation, and a concise summary.

> **Current limitation:** this starter accepts an audio file upload. It does not fetch or extract audio directly from Kick VOD URLs. Use an audio file you are authorized to process, or connect a permitted media source. Do not bypass login, DRM, or platform access controls.

## Features

- Audio upload through `POST /transcribe`
- Speech-to-text using OpenAI Whisper (`whisper-1`)
- Segment timestamps when returned by the transcription API
- Translation (Chinese by default)
- Concise summary
- Bearer-token authentication
- 24 MB upload limit
- Health endpoint

## Deploy to Cloudflare Workers

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**.
2. Create a Worker and paste the contents of `worker.js`, or deploy this project with Wrangler.
3. In Worker **Settings → Variables and Secrets**, add these as **Secrets**:
   - `OPENAI_API_KEY`: your OpenAI API key
   - `API_TOKEN`: a long, random token that your client will send
4. Deploy the Worker.
5. Test `GET https://YOUR-WORKER.workers.dev/health`.

Never put either secret in browser code, a public repository, or a chat message.

## API

### POST /transcribe

Headers:

```http
Authorization: Bearer YOUR_API_TOKEN
```

Body: `multipart/form-data`

| Field | Required | Description |
|---|---|---|
| `file` | Yes | Audio file, maximum 24 MB |
| `language` | No | Source language code, e.g. `en` |
| `translate_to` | No | Target language code; defaults to `zh` |

Example with curl:

```bash
curl -X POST "https://YOUR-WORKER.workers.dev/transcribe" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -F "file=@recording.mp3" \
  -F "language=en" \
  -F "translate_to=zh"
```

Successful response shape:

```json
{
  "filename": "recording.mp3",
  "language": "english",
  "duration_seconds": 123.4,
  "transcript": "Recognized speech...",
  "segments": [
    {
      "start_seconds": 0,
      "end_seconds": 3.2,
      "start": "00:00:00.00",
      "end": "00:00:03.20",
      "text": "Recognized speech..."
    }
  ],
  "translation": "中文翻译……",
  "summary": "内容摘要……"
}
```

## ChatGPT integration

The Worker is an HTTP backend, not by itself a ChatGPT connector. To make it callable from ChatGPT, connect it through a private plugin/action or an MCP server that exposes the upload workflow. Keep the API token server-side and never expose it in a public client.

## Long recordings

The endpoint currently limits each upload to 24 MB. Split longer recordings into smaller files and add each chunk's time offset when combining segment timestamps.

## Development

The Worker uses the Cloudflare Workers runtime and native `fetch`, `FormData`, and `File`; no npm dependencies are required.
