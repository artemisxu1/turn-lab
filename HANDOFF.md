# theturnlab.org — how the site is built and how to run it

Written for Dr. Turn, as co-manager of the site. Nothing here needs a
developer; the parts that do need an account login say whose account.

## The short version

The site is plain HTML, CSS and JavaScript. There is no build step, no
framework and no database. Whatever sits on the `main` branch of the repo is
what the public sees, about a minute after it lands there.

That is the whole design. It means the site cannot break in a way that needs
someone to redeploy it, and it means anyone who can edit a file can edit the
site.

## Who owns what

| Thing | Where it lives | Whose account | Cost |
|---|---|---|---|
| Domain `theturnlab.org` | Namecheap | Rachel | yearly registration |
| Repository `artemisxu1/turn-lab` | GitHub | Artemis (Rachel: collaborator) | free |
| Live hosting | GitHub Pages, serving that repo | Artemis | free |
| Branch previews | Cloudflare Pages project `turn-lab` | Artemis | free |
| Request form backend | Cloudflare Worker `turnlab-requests` | Artemis | free tier |
| Claude, when it makes a change | GitHub Actions + an Anthropic API key | Artemis | per request, tokens |

The domain is the only recurring bill. Everything else is on a free tier,
except Anthropic API usage, which is charged per change request and is small.

Worth knowing: five of those six rows are on Artemis's personal accounts. A
collaborator on the repo can change the site's content, but cannot reach the
Pages settings, the Actions secrets, or the Cloudflare account. If the site
needs to outlive Artemis's involvement, move the repo into a GitHub
organisation owned by both of you and recreate the Cloudflare pieces under a
lab account. That is a half-day of work, not a rewrite.

## The two ways to change the site

### 1. The request form — no git, no GitHub account

This is the path built for you.

1. Open `request.html` on the site and type the change in plain English.
2. Claude makes the change on its own branch and Cloudflare renders that
   branch as a real, working copy of the site.
3. Open `review.html`, look at the rendered page, and either **Publish** or
   **Throw it away**.

Publishing merges the branch into `main`, and the live site follows a minute
later. One passcode guards both pages — the same one as the Members page.

Two things to hold onto:

- **Publishing is one click with no second reader.** That is the point of it,
  but it means the passcode is the only thing between someone with the URL and
  the live site.
- **A preview shows the page you are looking at.** It will catch wrong wording
  and broken layout. It will not catch something that broke on a page nobody
  thought to open.

To ask for a revision instead of publishing, comment `@claude also change X`
on the GitHub issue the form created. That needs write access to the repo,
which a collaborator has.

### 2. Git directly

Edit a file, commit to `main`, push. Pages redeploys on its own. There is no
build to run and no deploy command. Previewing locally is
`python3 -m http.server 8000` in the repo, then <http://localhost:8000>.

## What is in the repo

| Path | What it is |
|---|---|
| `index.html` … `join.html` | one file per page; the nav is copied into each |
| `styles.css` | every style on the site; the palette is the `:root` block at the top |
| `app.js` | nav toggle and the scroll fade-ins |
| `network.js` | the interactive node graphic on the home page |
| `images/` | all photos and figures |
| `request.html`, `review.html` | the change-request pages above; unlisted, `noindex` |
| `request-worker/` | the Cloudflare Worker behind them, and `SETUP.md` explaining it |
| `.github/workflows/` | the job that runs Claude when a request comes in |
| `CLAUDE.md` | the standing rules Claude follows on every change |

`CLAUDE.md` is the one to know about: it is what tells Claude not to invent
publications, people or funding. It is read on every automated change.

## Pointing theturnlab.org at the site

Two steps, in this order. Step 2 makes GitHub redirect the current
`artemisxu1.github.io/turn-lab/` address to `theturnlab.org`, so if DNS is not
answering yet the site is unreachable until it is. That is the only reason the
order matters.

### Step 1 — Namecheap (Rachel)

Domain List → **Manage** → **Advanced DNS**.

First delete the two records Namecheap parks new domains with: the
**URL Redirect Record** on `@`, and the **CNAME Record** pointing `www` at
`parkingpage.namecheap.com`. Both are there now and both will fight the
records below.

Then add five records:

| Type | Host | Value |
|---|---|---|
| A Record | `@` | `185.199.108.153` |
| A Record | `@` | `185.199.109.153` |
| A Record | `@` | `185.199.110.153` |
| A Record | `@` | `185.199.111.153` |
| CNAME Record | `www` | `artemisxu1.github.io.` |

Those four addresses are GitHub's published Pages servers. Leave TTL on
Automatic. Give it 30 minutes, then check:

```bash
dig +short theturnlab.org
```

It should print the four addresses above. Until it does, do not go on.

### Step 2 — one file in the repo (Artemis)

Commit a file named `CNAME` at the repo root containing one line:

```
theturnlab.org
```

That is the whole of it. GitHub Pages reads that file and adopts the domain;
there is no dashboard step and no admin access needed. The Settings → Pages
custom-domain box does nothing except write this same file.

The file is load-bearing — if it is ever deleted the custom domain switches
off, so leave it in place.

HTTPS provisions itself within a few hours of the domain resolving. If
`https://theturnlab.org` still warns after a day, Settings → Pages →
**Enforce HTTPS** finishes it, and that one does need Artemis.

### Afterwards, whenever — the request form

The Worker accepts requests from one exact web address, so `request.html` and
`review.html` stop working the moment the site moves. `wrangler.toml` already
names the new address; it just has to be deployed, which needs the Cloudflare
login:

```bash
cd request-worker
npx wrangler deploy
```

Until that runs, changes go in through git as normal. Nothing else is
affected.

## What Rachel can and cannot do as a collaborator

Can: edit any file, commit to `main`, merge, comment `@claude` on a request,
read the Actions logs. (Publishing from `review.html` is gated on the passcode
rather than on GitHub, so that works either way.)

Also can, as it happens: set the custom domain, since that is just the `CNAME`
file above and a collaborator can commit files.

Cannot: read or rotate the Actions secrets, tick **Enforce HTTPS**, reach the
Cloudflare Worker or its passcode, add other people.

Those need repo admin or Artemis's Cloudflare login. Ask, or move the repo to a
shared organisation as described above.

## Gotchas

- **Nothing hardcodes the current address.** Every link and image path in the
  site is relative, so moving from `github.io/turn-lab/` to the apex domain
  needs no edits to the pages themselves.
- **The passcode publishes.** Rotate it with
  `npx wrangler secret put PASSCODE`, and change it on the Members page to
  match, since both pages tell people it is the same one.
- **The GitHub token the Worker uses expires.** When it does, the form stops
  working silently. `request-worker/SETUP.md` step 3 covers reissuing it.
- **Two hosts serve this repo.** GitHub Pages is the public site. Cloudflare
  Pages also builds `main` at `turn-lab.pages.dev`; that build is only there so
  branch previews work, and can be ignored.
