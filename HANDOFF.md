# theturnlab.org

Plain HTML, CSS and JavaScript on GitHub Pages. No build step. Whatever is on
`main` is live about a minute after it lands. Chris manages it; Dr. Turn sends
him changes. The original build is by Lucy Artemis Xu, who also built a
request-form workflow so Dr. Turn could publish changes herself without a
developer. It was retired in October 2026 because Dr. Turn preferred to send
changes to Chris directly, not for any shortcoming in the design. Her version
of this file is in the git history if it is ever needed.

## Making a change

1. `git pull` in the clone.
2. Edit the page. Each page is one HTML file at the root; the nav is copied
   into every page, so a nav change touches all of them.
3. Preview: `python3 -m http.server 8000` in the repo, then
   <http://localhost:8000>.
4. Commit to `main` and push. Done.

Photos: resample to about 1600 px wide as JPEG before adding. The News page is
already 25 MB and slow on phones.

## Two things never to do

- **Do not delete `CNAME`.** It is the one-line file that tells GitHub Pages
  this repo serves theturnlab.org. Removing it switches the domain off.
- **Do not put the Members password, or any real content, in the repo.** The
  repo is public and every visitor downloads `members.js`. The Members page
  gate is a hash check in the browser, so everything behind it is readable in
  the page source. Put only links there, to UW Box, Drive or Benchling, and
  keep the protocols and inventories behind those sign-ins. To change the
  password, follow the instructions at the top of `members.js`.

## Who owns what

- Domain: Namecheap, Chris's account. The only bill.
- Repo and hosting: `artemisxu1/turn-lab` on Artemis's GitHub. Chris is a
  collaborator with write access, which is enough to change everything on the
  site but not the Pages settings. Free.

## DNS at Namecheap

Four A records on `@`: `185.199.108.153`, `185.199.109.153`,
`185.199.110.153`, `185.199.111.153`. One CNAME on `www` pointing at
`artemisxu1.github.io`. The A records are GitHub's and never change; the
CNAME names the hosting account and changes only if the repo moves.

## If the repo ever goes away

Push the clone's full history to a new repo under your own account. Settings,
Pages, source `main`. The `CNAME` file reattaches the domain. Change the
`www` record at Namecheap to the new account's `github.io` address. HTTPS
reissues itself within an hour. Twenty minutes, no data lost.

Verifying the domain under your own GitHub account beforehand (Settings,
Pages, Add a domain, one TXT record at Namecheap) stops any other account's
repo from ever claiming it.

## Gotchas

- UW's Palo Alto firewall flagged the new domain as "malware" on 30 September
  2026. A recategorisation request at
  <https://urlfiltering.paloaltonetworks.com/query/> fixed it the same day.
  If it recurs, file that again and have Dr. Turn email Campus Security with
  the details on the block page.
- A stray copy of the site may exist at `turn-lab.pages.dev` from Artemis's
  Cloudflare preview project. Harmless either way.
- `v2/`, `logo-drafts/` and `website.docx` are early drafts. The site does
  not use them.
