# Canyonland Technologies — website

Static marketing site. Plain HTML/CSS/JS, no build step, deployed on Netlify
from `main`. **Pushing to `main` publishes immediately.**

```
index.html  portfolio.html  notes.html  notes/
styles.css  script.js  success.html  404.html
netlify.toml  robots.txt  sitemap.xml  assets/
```

Preview locally with `python3 -m http.server` — there is nothing to compile.
On Windows use `py -m http.server`; bare `python3` hits the Store alias stub
and reports Python as missing even when it is installed.

## Positioning

The practice sells the **full BI lifecycle**, not legacy modernization alone.
The five stages are the spine of the page and the organizing idea of the whole
site:

| # | Stage   | What it covers |
|---|---------|----------------|
| 01 | Extract | Getting data out of the system of record — mainframe datasets, COBOL and report-writer logic, legacy databases |
| 02 | Land    | Into modern databases, reconciled against the source |
| 03 | Model   | Metrics defined once: semantic models, business rules, tested logic |
| 04 | Build   | Dashboards, applications, analytical tools |
| 05 | Enable  | Runbooks, training, AI-assisted documentation of legacy code |

Mainframe/legacy work is the **entry point** to that lifecycle — the
differentiator, not the ceiling. Most BI firms start at the warehouse and assume
someone else got the data there; this practice starts earlier. Keep that
argument intact in any rewrite.

Voice: "we" for the practice, with Rehan Ali named as principal consultant.

## Where work is described

Full case studies live on **`portfolio.html`**, not the homepage. The page
carries two sections: client engagements (numbered, non-identifying attribution,
lifecycle-stage tags) and in-house tooling, which is work we own outright and
can describe in full.

The homepage keeps a compact teaser at `#work` — the four engagement titles with
their stage tags and a link through. That anchor is retained so older `/#work`
links still land on relevant content, even though the nav item is gone. Nav is
Lifecycle · Portfolio · Notes · Focus · About · Contact; there is deliberately no
separate "Work" item, because two names for the same promise made the nav
ambiguous.

Do not describe a tool as publicly available unless its repository actually is.
An earlier draft of the portfolio page claimed the source could be read and run
while the repo was private — the same failure as the unverifiable statistics
below. `estatemap` is now public at <https://github.com/rali88/estatemap>, so
the page says so; if a future tool is not published, describe it as in-house and
drop every claim about reading or running it.

## Notes

`notes.html` indexes the explainers under `notes/`. They are **undated by
design** — a dated post that is two years old advertises neglect, and these are
evergreen. Do not add dates or a "published" line.

They exist to bring in search traffic and to give a prospect something to judge
before making contact, so each ends with the same call to action and the free
first consultation.

Booking goes to <https://calendly.com/ceo-canyonlandtech>, linked rather than
embedded. An embedded scheduler would drag third-party scripts and cookies onto
every page carrying it and would not match the design system; a link costs
nothing and keeps the site free of both. Every such link opens in a new tab and
carries `rel="noopener"`.

They make technical claims about mainframe practice — encodings, record formats,
report-writer semantics. **Those claims are the author's to verify**, not
something to extend from general knowledge. Adding a new note means adding
something you know first-hand.

## Design system — technical editorial

Type is **IBM Plex Sans + IBM Plex Mono**, loaded from Google Fonts. This is not
arbitrary: IBM designed Plex, and IBM built the platform the practice is founded
on. Mono is for labels, eyebrows, stage numbers and environment lines only.

Tokens live at the top of `styles.css`:

```
--ink #14181d   --ink-2 #3d4650   --ink-3 #616b78
--ground #fafafa   --ground-2 #f2f3f4   --paper #ffffff
--rule #dcdfe3   --rule-strong #c3c8ce
--accent #b8400c   --accent-tint #fbece4
```

Rules that hold the look together — breaking any of these breaks it:

- **Orange is rationed.** Roughly three appearances per screen: stage numbers,
  links, one rule. It comes from the logo mark; it is not a background colour.
- **No boxed cards, no drop shadows, no rounded corners.** Structure is
  hairlines (`--rule`) and whitespace. `border-radius` is `0` everywhere,
  including inputs.
- **Light display weights at large sizes.** `h1` is weight 300. Headings carry
  negative letter-spacing and `text-wrap: balance`.
- Sections are separated by hairline borders, not alternating colour blocks.
  `.band--tint` exists for occasional emphasis; use it sparingly.
- Single committed theme (light). Every colour is set explicitly from a token.

All body text measures **≥ 4.5:1** against its ground. Re-measure before
shipping any colour change — a previous version of this site shipped muted text
at 1.84:1 for months.

## The portfolio demo

`estatemap-demo.js` is a JavaScript port of the extraction rules in the
in-house COBOL/JCL documentation tool. It runs entirely in the visitor's
browser; nothing is uploaded.

It is **fetched on click, never with the page**. At ~34KB it would otherwise
blow the payload budget for the majority of visitors who never open it. The
loader lives at the end of `script.js`, guarded on `#demo-load` so it costs
nothing on other pages.

A second implementation is a liability. If the port disagrees with the Python
tool, the demo quietly contradicts the determinism the tool is sold on. The
port is therefore checked against the same fixtures by a harness in the tool's
repository (`tests/browser/`), which deep-compares every extracted fact and
must report zero divergences. **Re-run it after changing either implementation.**

## Content constraints

**Client identities are confidential.** Engagements are attributed as
"Prime systems integrator · large public-sector agency". Do not name the end
client, the agency, or the prime vendor anywhere in this repo — **including HTML
comments**, which are readable in page source on the deployed site, and in
commit messages. This repository is public.

Do not invent outcome metrics. An earlier version of this site carried three
performance statistics that traced back to nothing; they were removed. Every
claim on the page should be one that survives a client asking "based on what?"
Where a number would help but isn't verified, write the qualitative version.

## Conventions

- Semantic HTML; every interactive element keyboard-reachable with a visible
  focus ring (`*:focus-visible`, 2px accent outline).
- The Netlify form needs both the real `<form>` and the hidden detection form at
  the end of `<body>`. Field name changes must be made in both.
- Assets: reference `logo-400.png` / `logo-320.png`, never the 3000px
  `logo.png` source. Page payload is ~82KB; keep it there.
- Anchor targets rely on `scroll-margin-top` to clear the sticky header.

## Before shipping

Render the page in a real browser and check: no console errors, no 4xx on any
asset, one `h1`, contrast measured rather than eyeballed, and the mobile
breakpoint at 390px. Screenshots at 1280px and 390px catch most regressions.

## Branching and deploys

`main` is production. Netlify publishes it on every push, so **merging to `main`
is the act of going live** — there is no staging step between merge and public.
Treat the pull request as the last checkpoint, not the first.

`dev` is the working branch. Do the work there (or on a short-lived branch cut
from it), and open a pull request into `main` when it is ready for review.

```
dev ──commit──▶ push ──▶ PR into main ──▶ review ──▶ merge ──▶ live
```

- **Never commit directly to `main`.** A direct push publishes unreviewed.
- Every PR gets a Netlify Deploy Preview at
  `deploy-preview-<n>--canyonlandtech.netlify.app`. Review there rather than on
  a local server — the preview applies the real redirects, headers, and form
  handling from `netlify.toml`, which a plain static server does not.
- The preview's contact form is live. Submissions land in the real Netlify
  Forms inbox, so treat any test submission as a real one.
- Run the `Before shipping` checks against the deploy preview before merging.
- **Read the automated review before merging.** Codex reviews every PR in this
  repo and comments only when it finds something. Three real defects shipped
  because its findings on merged PRs were never opened. `main` requires
  conversation resolution, so an unresolved thread now blocks the merge — treat
  that block as the point of the rule, not an obstacle. Verify each finding
  against the code rather than accepting or dismissing it on sight, and resolve
  a thread only once it is actually addressed.
- After a merge, resync `dev` before starting the next batch of work, or later
  PRs will surface conflicts that are not really yours. Update local `main`
  first — merging a stale local `main` silently reports everything up to date
  without taking in the merge:

  ```
  git checkout main && git pull
  git checkout dev && git merge main && git push
  ```

- Delete a short-lived branch once merged. **Its deploy preview does not go with
  it** — `deploy-preview-1` is still served long after `site-rebuild` was
  deleted. Netlify preserves the most recent successful deploy of every context,
  Deploy Previews included, so automatic deletion never reaches them and
  retention settings are Enterprise-only anyway.

  Old previews therefore stay publicly reachable, serving whatever that PR last
  built. They are unlisted and `robots.txt` does not cover preview subdomains.
  Worth removing for any preview that built content since corrected — a
  withdrawn claim, a fixed defect, anything confidential.

  Two ways to remove one. By hand: Netlify → Deploys → select the deploy →
  Options → Delete deploy. Or through the API, which is the better answer once
  this is more than an occasional tidy-up:

  ```
  curl -X DELETE -H "Authorization: Bearer $NETLIFY_TOKEN" \
    https://api.netlify.com/api/v1/deploys/<deploy_id>
  ```

  `.github/workflows/delete-deploy-preview.yml` does this on PR close, so
  previews are cleaned up as a matter of course rather than remembered. It needs
  two repository secrets, `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID`, and skips
  with a warning rather than failing if either is absent. Forked PRs receive no
  secrets, so their previews still need deleting by hand.
