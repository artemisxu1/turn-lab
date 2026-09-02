/**
 * Turn Lab website request intake.
 *
 * Why this exists: request.html is served by GitHub Pages, which is static.
 * Creating a GitHub issue needs an authenticated API call, and any credential
 * placed in that page would be public. So the page posts here, and this Worker
 * holds the token.
 *
 * The issue body opens with the trigger phrase, which is what starts
 * claude-code-action in interactive mode. See .github/workflows/claude-request.yml.
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *   GITHUB_TOKEN  fine-grained PAT, this repo only, Issues: read and write
 *   PASSCODE      the shared passcode typed into the form
 *
 * Vars (in wrangler.toml):
 *   REPO          "owner/name"
 *   ALLOWED_ORIGIN the exact origin allowed to post here
 */

const MAX_REQUEST_CHARS = 4000;

// Requests allowed per window, per IP. One person filing occasional website
// tweaks needs very little headroom, and every accepted request spends money
// on an Actions run, so this stays deliberately tight.
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 3600;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Use POST" }, 405, cors);

    // Reject other origins outright. CORS alone only stops a browser from
    // reading the response, not from sending the request.
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: "Bad origin" }, 403, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Expected JSON" }, 400, cors);
    }

    const name = str(body.name, 120);
    const page = str(body.page, 80);
    const text = str(body.request, MAX_REQUEST_CHARS);
    const passcode = typeof body.passcode === "string" ? body.passcode : "";

    if (!name || !page || text.length < 10) return json({ error: "Missing fields" }, 400, cors);

    // Rate limit before the passcode check, so a wrong-passcode loop can't be
    // used to hammer this endpoint for free either.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.RATE_KV) {
      const key = `rl:${ip}`;
      const used = parseInt((await env.RATE_KV.get(key)) || "0", 10);
      if (used >= RATE_LIMIT) return json({ error: "Rate limited" }, 429, cors);
      await env.RATE_KV.put(key, String(used + 1), { expirationTtl: RATE_WINDOW_SECONDS });
    }

    if (!timingSafeEqual(passcode, env.PASSCODE)) return json({ error: "Bad passcode" }, 401, cors);

    const issue = await createIssue(env, { name, page, text });
    if (!issue.ok) return json({ error: "Upstream failed" }, 502, cors);

    return json({ ok: true, issue: issue.number }, 200, cors);
  },
};

async function createIssue(env, { name, page, text }) {
  const title = `Site request: ${page} — ${firstLine(text, 60)}`;

  // The guardrails are restated here rather than left to CLAUDE.md alone. This
  // request arrives from a web form with no reviewer in the loop, so the two
  // rules that matter most are repeated where Claude reads them first.
  const body = [
    `@claude A change to the website has been requested through the form on request.html.`,
    ``,
    `**Requested by:** ${name}`,
    `**Page:** ${page}`,
    ``,
    `**Request, verbatim:**`,
    ``,
    quote(text),
    ``,
    `---`,
    ``,
    `Please action this request, following CLAUDE.md. Specifically:`,
    ``,
    `- Use only the content in the request above. Do not invent publications,`,
    `  people, funding, titles, dates, or research claims. If the request needs`,
    `  information that was not supplied, make the part you can, and leave a`,
    `  clearly marked [PLACEHOLDER] plus a note saying what is still needed.`,
    `- No emojis anywhere, even if the request contains them.`,
    `- Open a pull request. Do not commit to main; the site deploys from main and`,
    `  a human reviews every change before it goes live.`,
    `- If the request is ambiguous enough that two readings would produce`,
    `  different pages, do the unambiguous part and say what you were unsure of.`,
    `- Keep the change scoped to what was asked. Do not tidy unrelated files.`,
    ``,
    `_Filed automatically from the request form._`,
  ].join("\n");

  const res = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "turnlab-request-worker",
    },
    body: JSON.stringify({ title, body, labels: ["site-request"] }),
  });

  if (!res.ok) return { ok: false };
  const created = await res.json();
  return { ok: true, number: created.number };
}

function json(obj, statusCode, cors) {
  return new Response(JSON.stringify(obj), {
    status: statusCode,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function firstLine(text, max) {
  const line = text.split("\n")[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

// Prefix every line so that whatever was typed renders as a quote and cannot
// break out of the issue body's structure.
function quote(text) {
  return text.split("\n").map((l) => `> ${l}`).join("\n");
}

// Constant-time compare, so response timing doesn't leak the passcode.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
