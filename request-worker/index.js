/**
 * Turn Lab website request intake and approval.
 *
 * Why this exists: the site is served by GitHub Pages, which is static. Both
 * filing a GitHub issue and merging a branch need authenticated API calls, and
 * any credential placed in a page would be public. So the pages post here, and
 * this Worker holds the token.
 *
 * The flow:
 *   request.html  -> POST /submit   -> files an issue whose body opens with the
 *                                      trigger phrase, which starts Claude
 *   Claude pushes a branch named claude/issue-<n>-<stamp>
 *   Cloudflare Pages builds that branch at a preview URL automatically
 *   review.html   -> POST /pending  -> lists those branches and their previews
 *                 -> POST /approve  -> merges the branch into main, so GitHub
 *                                      Pages redeploys and the change is live
 *                 -> POST /discard  -> deletes the branch, change never ships
 *
 * There are deliberately no pull requests here. A branch alias gives the
 * preview, and the merges API publishes it, so the token needs Contents and
 * Issues only, and never Pull requests.
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *   GITHUB_TOKEN   fine-grained PAT, this repo only:
 *                    Contents: read and write   (merge to main, delete branches)
 *                    Issues:   read and write   (file and close requests)
 *   PASSCODE       the shared passcode typed into both pages
 *
 * Vars (in wrangler.toml):
 *   REPO           "owner/name"
 *   ALLOWED_ORIGIN the exact origin allowed to post here
 *   PAGES_PROJECT  the Cloudflare Pages project name, which is the parent
 *                  domain of every branch preview
 */

const MAX_REQUEST_CHARS = 4000;
const BRANCH_PREFIX = "claude/";

// Only /submit is metered, because only /submit spends money: each one starts
// an Actions run that calls the Claude API. Reading and approving are cheap, so
// metering them would just get in the way of the person doing the reviewing.
const SUBMIT_LIMIT = 20;

// Wrong passcodes are metered separately and much more loosely, so that a
// brute-force attempt runs out of road without a legitimate reviewer, who may
// mistype once, ever noticing a limit.
const AUTH_FAIL_LIMIT = 30;

const WINDOW_SECONDS = 3600;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
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

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const route = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

    // Every route is passcode gated. Check it once, here, so no route can be
    // added later that forgets to.
    if (!timingSafeEqual(str(body.passcode, 200), env.PASSCODE)) {
      if (await overLimit(env, `af:${ip}`, AUTH_FAIL_LIMIT)) {
        return json({ error: "Rate limited" }, 429, cors);
      }
      return json({ error: "Bad passcode" }, 401, cors);
    }

    try {
      switch (route) {
        case "/":
        case "/submit":
          return await handleSubmit(env, body, ip, cors);
        case "/pending":
          return json({ ok: true, pending: await listPending(env) }, 200, cors);
        case "/approve":
          return await handleApprove(env, body, cors);
        case "/discard":
          return await handleDiscard(env, body, cors);
        default:
          return json({ error: "No such route" }, 404, cors);
      }
    } catch (err) {
      // Surface the reason rather than a bare 500, since the pages show
      // different copy for "GitHub refused us" than for "you typed it wrong".
      return json({ error: "Upstream failed", detail: String(err.message || err) }, 502, cors);
    }
  },
};

/* ---------------------------------------------------------------- submit --- */

async function handleSubmit(env, body, ip, cors) {
  const name = str(body.name, 120);
  const page = str(body.page, 80);
  const text = str(body.request, MAX_REQUEST_CHARS);
  if (!name || !page || text.length < 10) return json({ error: "Missing fields" }, 400, cors);

  if (await overLimit(env, `rl:${ip}`, SUBMIT_LIMIT)) {
    return json({ error: "Rate limited" }, 429, cors);
  }

  const title = `Site request: ${page} — ${firstLine(text, 60)}`;

  // The guardrails are restated here rather than left to CLAUDE.md alone. These
  // requests arrive from a web form and are published on a non-technical
  // reviewer's approval, so the rules that matter most are repeated where
  // Claude reads them first.
  const issueBody = [
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
    `- Push your work to a branch. Never commit to main.`,
    `- Keep the change scoped to what was asked. Do not tidy unrelated files.`,
    `- Your last comment is what the requester reads to decide whether to`,
    `  publish, so end with a plain-language summary of what you changed. Say`,
    `  explicitly if you left anything out or were unsure of anything.`,
    ``,
    `The requester will see your branch rendered as a live preview and publish`,
    `it themselves. There is no other reviewer, so a mistake here reaches the`,
    `public site if it looks plausible in the preview.`,
    ``,
    `_Filed automatically from the request form._`,
  ].join("\n");

  const created = await gh(env, `/issues`, {
    method: "POST",
    body: { title, body: issueBody, labels: ["site-request"] },
  });

  return json({ ok: true, issue: created.number }, 200, cors);
}

/* --------------------------------------------------------------- pending --- */

async function listPending(env) {
  const branches = await gh(env, `/branches?per_page=100`);
  const mine = branches.filter((b) => b.name.startsWith(BRANCH_PREFIX));

  return await Promise.all(
    mine.map(async (b) => {
      const issueNumber = issueFromBranch(b.name);
      const previewUrl = `https://${slugify(b.name)}.${env.PAGES_PROJECT}.pages.dev`;

      // Fetched in parallel, and each one tolerates failure: a preview that has
      // not finished building, or an issue that was deleted, should still leave
      // the rest of the card renderable.
      const [commit, issue, ready] = await Promise.all([
        gh(env, `/commits/${b.commit.sha}`).catch(() => null),
        issueNumber ? gh(env, `/issues/${issueNumber}`).catch(() => null) : null,
        fetch(previewUrl, { method: "HEAD" })
          .then((r) => r.ok)
          .catch(() => false),
      ]);

      const comments =
        issueNumber && issue
          ? await gh(env, `/issues/${issueNumber}/comments?per_page=100`).catch(() => [])
          : [];
      const last = comments.length ? comments[comments.length - 1].body : "";

      return {
        branch: b.name,
        sha: b.commit.sha,
        issue: issueNumber,
        requestedBy: issue ? fieldFrom(issue.body, "Requested by") : "",
        requestText: issue ? quotedFrom(issue.body) : "",
        summary: summaryFrom(last),
        changedAt: commit ? commit.commit.author.date : null,
        previewUrl,
        previewReady: ready,
        compareUrl: `https://github.com/${env.REPO}/compare/main...${b.name}`,
      };
    })
  );
}

/* --------------------------------------------------- approve and discard --- */

async function handleApprove(env, body, cors) {
  const branch = str(body.branch, 200);
  if (!branch.startsWith(BRANCH_PREFIX)) return json({ error: "Not a request branch" }, 400, cors);

  // Merge into main. GitHub Pages redeploys from main, so this is what makes
  // the change public.
  await gh(env, `/merges`, {
    method: "POST",
    body: {
      base: "main",
      head: branch,
      commit_message: `Publish requested change from ${branch}\n\nApproved through review.html.`,
    },
  });

  await afterResolve(env, branch, "approved and published");
  return json({ ok: true }, 200, cors);
}

async function handleDiscard(env, body, cors) {
  const branch = str(body.branch, 200);
  if (!branch.startsWith(BRANCH_PREFIX)) return json({ error: "Not a request branch" }, 400, cors);

  await afterResolve(env, branch, "discarded without publishing");
  return json({ ok: true }, 200, cors);
}

// Both outcomes end the same way: say what happened on the issue, close it, and
// remove the branch so it stops showing up as pending. Each step is allowed to
// fail without failing the whole call, because the merge already happened and
// reporting a failure now would invite a double merge.
async function afterResolve(env, branch, what) {
  const n = issueFromBranch(branch);
  if (n) {
    await gh(env, `/issues/${n}/comments`, {
      method: "POST",
      body: { body: `This request was ${what} from the review page.` },
    }).catch(() => {});
    await gh(env, `/issues/${n}`, { method: "PATCH", body: { state: "closed" } }).catch(() => {});
  }
  await gh(env, `/git/refs/heads/${branch}`, { method: "DELETE" }).catch(() => {});
}

/* ----------------------------------------------------------------- utils --- */

async function gh(env, path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}${path}`, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "turnlab-request-worker",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status} on ${path}: ${detail.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// Counts one hit against key and reports whether the caller is now over.
// Without the KV binding there is no counter, so nothing is limited.
async function overLimit(env, key, limit) {
  if (!env.RATE_KV) return false;
  const used = parseInt((await env.RATE_KV.get(key)) || "0", 10);
  if (used >= limit) return true;
  await env.RATE_KV.put(key, String(used + 1), { expirationTtl: WINDOW_SECONDS });
  return false;
}

// Cloudflare Pages branch aliases are lowercased with every non-alphanumeric
// character replaced by a hyphen, so claude/issue-1-2026 becomes
// claude-issue-1-2026.<project>.pages.dev.
function slugify(branch) {
  return branch.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

function issueFromBranch(branch) {
  const m = branch.match(/^claude\/issue-(\d+)-/);
  return m ? parseInt(m[1], 10) : null;
}

function fieldFrom(issueBody, label) {
  const m = (issueBody || "").match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`));
  return m ? m[1].trim() : "";
}

// The original request is the block quoted with "> " in the issue body.
function quotedFrom(issueBody) {
  return (issueBody || "")
    .split("\n")
    .filter((l) => l.startsWith("> "))
    .map((l) => l.slice(2))
    .join("\n")
    .trim();
}

// Claude's closing comment carries a "### Summary" section. Prefer it, and fall
// back to the whole comment with the progress checklist and status line
// stripped, so the reviewer never sees raw workflow chatter.
function summaryFrom(comment) {
  if (!comment) return "";
  const m = comment.match(/###\s*Summary\s*\n([\s\S]*)$/);
  const text = m ? m[1] : comment;
  return text
    .split("\n")
    .filter((l) => !/^\s*[-*]\s*\[[ x]\]/.test(l) && !/^\s*###/.test(l) && !/^\*\*Claude/.test(l))
    .join("\n")
    .replace(/<img[^>]*>/g, "")
    .trim()
    .slice(0, 1200);
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
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
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
