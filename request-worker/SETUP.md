# Website change requests — setup

Dr. Turn types a change into `request.html`. Claude makes it on a branch.
Cloudflare Pages renders that branch at a preview URL. She looks at the real
page on `review.html` and publishes it herself. No developer in the loop.

```
request.html          Worker /submit        GitHub
  passcode + text  →  checks passcode   →  files issue with "@claude ..."
                      meters submits                 ↓
                                          claude-request.yml runs Claude Code
                                                     ↓
                                        pushes branch claude/issue-<n>-<stamp>
                                                     ↓
                                    Cloudflare Pages builds a branch preview
                                                     ↓
review.html           Worker /pending    lists the branch + its preview URL
  [View the page]  →  the preview, rendered as the real site
  [Publish this]   →  Worker /approve  →  merges branch into main
                                                     ↓
                                        GitHub Pages redeploys, change is live
  [Throw it away]  →  Worker /discard  →  deletes the branch, nothing ships
```

There are deliberately no pull requests. A branch alias gives the preview and
the merges API publishes it, so the token never needs Pull requests access.

## Read this before setting it up

Publishing happens on one person's click, with no diff review. That is the
point, but it has consequences:

- **The passcode is the only gate on publishing to the live site.** Anyone with
  the URL and the passcode can publish arbitrary Claude-authored changes.
  Rotate it with `wrangler secret put PASSCODE`.
- **A rendered preview does not show everything.** It catches wrong wording and
  broken layout, which is most of what goes wrong. It does not catch a
  regression on a page nobody thought to open.
- **Claude cannot be relied on to refuse a bad request.** The guardrails in the
  issue body and in `CLAUDE.md` tell it not to invent facts. The preview is what
  actually protects the site.

## What Dr. Turn needs

Two links and one passcode:

- `.../request.html` to ask for a change
- `.../review.html` to look at it and publish it

## Steps

These involve logging into accounts, so they have to be run by you.

### 1. Anthropic API key

Create a key at <https://platform.claude.com>, then add it to the repo:
**Settings → Secrets and variables → Actions → New repository secret**

- Name: `ANTHROPIC_API_KEY`
- Value: the key

To bill against a Claude subscription instead, run `claude setup-token`, store
the result as `CLAUDE_CODE_OAUTH_TOKEN`, and change the `anthropic_api_key:`
line in `.github/workflows/claude-request.yml` to
`claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.

### 2. Install the Claude GitHub App

Install <https://github.com/apps/claude> on the repository. The workflow will
not run without it.

### 3. GitHub token for the Worker

**Settings → Developer settings → Personal access tokens → Fine-grained tokens
→ Generate new token**

- Repository access: **Only select repositories** → this repo
- Permissions, exactly two:
  - **Contents → Read and write** — merge to main, delete branches
  - **Issues → Read and write** — file, comment on, and close requests
- Expiry: set a calendar reminder; the form silently stops working when it lapses

`Contents: write` is what lets the Worker publish. It is the privilege that
makes the passcode worth protecting.

### 4. Cloudflare Pages project, for the previews

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to
Git**, and pick this repository.

- Framework preset: **None**
- Build command: leave empty
- Build output directory: `/`

The project name becomes the parent domain of every preview, so a project named
`turn-lab` gives previews at `<branch>.turn-lab.pages.dev`. Whatever you choose,
set `PAGES_PROJECT` in `wrangler.toml` to match.

Pages also builds `main` as its own production deployment. Ignore it — the
public site is still served by GitHub Pages. Only the branch previews are used.

### 5. Deploy the Worker

```bash
cd request-worker
npx wrangler login

# Rate-limit counters.
npx wrangler kv namespace create RATE_KV   # paste the id into wrangler.toml

# Deploy before setting secrets. The other order works, but wrangler has to
# stop and ask whether to create a Worker that does not exist yet.
npx wrangler deploy

npx wrangler secret put GITHUB_TOKEN   # the token from step 3
npx wrangler secret put PASSCODE       # what Dr. Turn will type
npx wrangler deploy                    # redeploy so the secrets are attached

# Confirm both landed. Prints names only, never values.
npx wrangler secret list
```

The first `wrangler deploy` prints the Worker URL. On a new Cloudflare account
it also asks you to claim a workers.dev subdomain, which becomes the middle
part of that URL, and DNS for it takes a few minutes to resolve.

Set `PASSCODE` to the same value as the Members page password, so the hint on
both pages ("the same passcode you use for the Members page") is true.

### 6. Point the pages at the Worker

`request.html` and `review.html` each have the Worker URL near the top of their
script block. Update both if the URL differs from what is checked in.

### 7. Test it

Submit a small real request, wait for the branch, then open `review.html`,
check the preview, and publish. Watch the repo's Actions tab if nothing appears.

### 8. When theturnlab.org goes live

Set `ALLOWED_ORIGIN` in `wrangler.toml` to `https://theturnlab.org` and redeploy.
Until then it is the `github.io` origin, and both pages will be refused from
any other origin.

## Costs

Each request spends Anthropic API tokens and GitHub Actions minutes. The
workflow caps a run at 30 turns and 20 minutes. The Worker meters `/submit` at
20 per IP per hour, and wrong passcodes at 30 per IP per hour, so neither a
stuck loop nor a brute-force attempt can run up an open-ended bill. Reading and
publishing are not metered, since they cost nothing and metering them would
obstruct the person doing the reviewing.

Actions minutes are free on public repositories. Cloudflare Pages previews are
free.

## Notes and limits

- **Attachments.** The form is text only. Photos and PDFs have to be emailed;
  the confirmation screen says so.
- **Both pages are unlisted, not private.** They are `noindex` and absent from
  every nav, but anyone with a URL can load the form.
- **The passcode is never stored in the browser.** `review.html` holds it in
  memory for the life of the tab, so closing the tab requires typing it again.
  That is deliberate: it can publish.
- **Rate limiting keys on IP.** On a NATed network everyone shares one address,
  and IPv6 addresses rotate, so the counter is approximate. It is a cost
  ceiling, not access control.
- **Revisions.** Comment `@claude also change X` on the issue and Claude pushes
  another commit to the same branch, which updates the same preview. Only users
  with write access to the repo can do this.
