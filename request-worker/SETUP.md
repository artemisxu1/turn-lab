# Website change requests — setup

Dr. Turn types a change into `request.html`, and Claude opens a pull request
with that change made. Nothing reaches the live site until someone merges.

```
request.html            Cloudflare Worker         GitHub
(GitHub Pages, static)  (holds the token)
  passcode + text  -->  checks passcode     -->  creates issue with "@claude ..."
                        rate limits                        |
                                                           v
                                            claude-request.yml runs Claude Code
                                                           |
                                                           v
                                                  opens a pull request
                                                           |
                                                     you merge it
                                                           |
                                                           v
                                                    Pages redeploys
```

The Worker exists because GitHub Pages is static. Filing a GitHub issue needs
an authenticated API call, and any token put into `request.html` would be
public. The Worker is the only place a credential can safely live.

## What Dr. Turn needs

The page URL and the passcode. Nothing else — no GitHub account, no login.

## Steps

These involve logging into accounts, so they have to be run by you.

### 1. Anthropic API key

Create a key at <https://platform.claude.com>, then add it to the repo:
**Settings → Secrets and variables → Actions → New repository secret**

- Name: `ANTHROPIC_API_KEY`
- Value: the key

To bill against a Claude subscription instead of the API, run
`claude setup-token`, store the result as `CLAUDE_CODE_OAUTH_TOKEN`, and change
the `anthropic_api_key:` line in `.github/workflows/claude-request.yml` to
`claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.

### 2. Install the Claude GitHub App

Install <https://github.com/apps/claude> on `artemisxu1/turn-lab`. The workflow
will not run without it.

### 3. GitHub token for the Worker

**Settings → Developer settings → Personal access tokens → Fine-grained tokens
→ Generate new token**

- Repository access: **Only select repositories** → `artemisxu1/turn-lab`
- Permissions: **Issues → Read and write** (nothing else)
- Expiry: set a calendar reminder; the form silently stops working when it lapses

Scoping it to one repository and one permission means a leaked token can file
issues and nothing more.

### 4. Deploy the Worker

```bash
cd request-worker
npx wrangler login

# Rate-limit counters. Paste the printed id into wrangler.toml and uncomment
# the kv_namespaces block.
npx wrangler kv namespace create RATE_KV

npx wrangler secret put GITHUB_TOKEN   # the token from step 3
npx wrangler secret put PASSCODE       # what Dr. Turn will type

npx wrangler deploy
```

`wrangler deploy` prints the Worker URL. Set `PASSCODE` to the same value as
the Members page password, so the hint on the form ("the same passcode you use
for the Members page") is true — otherwise reword that hint.

### 5. Point the form at the Worker

In `request.html`, replace the placeholder on the `REQUEST_ENDPOINT` line with
the URL from step 4.

### 6. Test it

Submit a small real request through the form, for example asking to fix a typo.
Confirm an issue appears, the workflow runs, and a pull request opens.

### 7. When turnlab.org goes live

Set `ALLOWED_ORIGIN` in `wrangler.toml` to `https://turnlab.org` and redeploy.
Until then it is the `github.io` origin, and the form will be refused from any
other origin.

## Costs

Each request spends Anthropic API tokens and GitHub Actions minutes. The
workflow caps a run at 30 turns and 20 minutes, and the Worker allows 5
requests per IP per hour, so a stuck loop or a hostile submitter cannot run up
an open-ended bill. Actions minutes are free on public repositories.

## Notes and limits

- **Attachments.** The form is text only. Photos and PDFs have to be emailed;
  the confirmation screen says so.
- **The passcode is the only gate.** It is a shared secret in a public page's
  request path, which suits a low-stakes internal form but is not real
  authentication. Rotate it with `wrangler secret put PASSCODE`.
- **The page is unlisted, not private.** It is `noindex` and absent from every
  nav, but anyone with the URL can load it and see the form.
- **Claude cannot be relied on to refuse a bad request.** The guardrails in the
  issue body and in `CLAUDE.md` tell it not to invent facts, but the pull
  request review is what actually protects the site. Read the diff before
  merging, particularly for anything naming a person, a paper, or a date.
- **Revisions.** Comment `@claude also change X` on the issue or the pull
  request and it will push another commit. Only users with write access can
  trigger this; requests from the form work because the token that files them
  belongs to the repository owner.
