# Canyonland Technologies — website

Static marketing site. Plain HTML/CSS/JS, no build step, deployed on Netlify
from `main`. **Pushing to `main` publishes immediately.**

```
index.html  portfolio.html  notes.html  notes/  lab/
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

The three notes published on 2026-09-02 were reviewed and confirmed by Rehan on
that date. Treat that as the baseline: existing claims are checked, and anything
added since is not until he says so.

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

## The BI Lifecycle Lab

`/lab/` walks a synthetic mainframe payroll extract through Extract, Profile,
Model and Visualize, then answers a set of curated questions. It runs entirely
in the browser: nothing is uploaded, nothing is stored, and **no language model
is involved** — the answers are written prose with their numbers computed from
the decoded data each time they are shown.

**The corpus is synthetic and must stay that way.** `lab/tools/` holds the
generator and an independent verifier; `netlify.toml` serves 404 for
`/lab/tools/*` so the source is not published. Regenerate with
`py lab/tools/make_payroll_corpus.py`, then `py lab/tools/verify_corpus.py`.

The generator emits an `expected` block and `lab/lab.js` checks its own decode
against it on load, reporting a mismatch on the page rather than showing
confident nonsense. Same reasoning as the estatemap parity harness: a second
decoder that silently disagrees with the first is worse than one decoder.

The Tier 2 earnings cap is **a stated parameter of the synthetic dataset**, not
any jurisdiction's statutory figure. Do not present it as real.

The Lab's domain claims — the four exclusion causes as a realistic set, a
contribution past the cap framed as a refund owed, and overtime on an FLSA-exempt
employee as an HR question before a payroll one — were confirmed by Rehan on
2026-09-02. New findings or new projects need the same confirmation before they
ship; the Lab's credibility rests on the claims being right, not on them sounding
right.

Lab stages use the site's lifecycle vocabulary — Extract, Land, Model, Build —
rather than a second set of names for the same process. **Ask is a capability
shown across those four, not a fifth stage**, so it carries no stage number.

## Lab Project 2 — public workforce intelligence

`/lab/public-payroll.html` runs the same four stages over **real published
data**: the City of Chicago's payroll costing dataset (`dawh-m56b`), 4.86m rows
at employee-pay-element-per-period grain. It exists because Project 1 cannot be
checked — a corpus we wrote ourselves proves method, not accuracy. This one a
visitor can re-issue against the City's API and disagree with.

```
py lab/tools/fetch_chicago_payroll.py    # rebuild the snapshot (network)
py lab/tools/verify_chicago_payroll.py   # independent re-query (network)
```

The fetcher caches responses under `lab/tools/.cache/` (git-excluded); delete it
to force a refetch. The verifier shares no code with the fetcher and classifies
pay elements from a hand-written list, because two implementations that share
code agree without proving anything — the same reasoning as the estatemap
parity harness.

**The `employee` name column is never selected.** It is lawfully public and
irrelevant to every aggregate on the page. Counting people uses
`employee_dataset_id`, which is also never published; traceability rows cite
`record_id` so a reader can pull the original record from the City themselves.
That keeps the decision to publish a name with the City, where it already sits.
The verifier asserts the data sections carry neither field — do not relax it.

**Chicago's terms require a specific disclaimer**, and the page carries it
verbatim in the provenance panel along with the non-endorsement statement. Both
are conditions of use, not decoration. Do not trim them.

**Overtime is a judgement, and the page says so.** There is no overtime column;
there are 127 pay elements. Three rules are computed and all three published,
because the answer moves $184.7m between the narrowest and the widest. Figures
elsewhere on the page use the middle rule, stated where they appear.

The four findings are computed, not written down, so a rebuild against refreshed
City data either keeps them true or fails the verifier. `lab/index.html` and
`index.html` do state figures as static text; those carry `data-pp-figure`
attributes and the verifier checks each against the snapshot exactly, failing if
one goes missing rather than skipping.

Project 2's interpretive claims — that `DOCK` and `SUSPENSION` are recoveries
rather than errors, that extreme low annual totals are part-year employment, and
that this concentration is fairly called broad-based — were confirmed by Rehan on
2026-09-03. The arithmetic was already verified against the City's API; that
confirmation covers the meaning, which the verifier cannot check.

The gate still applies to anything added since. A new finding, a new focus year,
or a second jurisdiction needs the same confirmation before it ships — and a
claim that resembles a confirmed one is not covered by it.

Anchor offsets on Lab pages apply to `section[id]` rather than a list of stage
ids. The list version left `#more` landing 41px under the sticky navigator,
which is the second time enumerating those ids has caused exactly this bug.

## Lab Project 3 — budget against actual

`/lab/budget-actual.html` reconciles the City's Budget Ordinance (positions and
salaries) against the payroll costing dataset Project 2 uses. It exists because
Projects 1 and 2 each read a single source, and most real work is two systems
that disagree.

**Currently on the 2026 ordinance (`v2t2-vajc`), with 2025 (`2bp7-w85v`) kept
as a plan-against-plan comparison.** Moving to a new ordinance means moving the
payroll year with it: a budget is a plan for a year, and comparing it against a
different year's outcome answers a question nobody asked.

```
py lab/tools/fetch_chicago_budget.py     # rebuild the snapshot (network)
py lab/tools/verify_chicago_budget.py    # independent re-join (network)
```

The three projects make one argument and should keep making it: 1 shows the
file can be read, 2 shows the numbers are right, 3 shows the judgement. Do not
add a fourth that only repeats one of those.

**Four rules carry the whole page, and all four are printed on it** rather than
living in the code: how codes normalise between the systems (strip a leading
`D`/`T`, then leading zeros), what an FTE is (2080 hours), which headcount a
question wants (point-in-time, not annual distinct), and how a part-year actual
is expressed against a full-year plan. Each changes the answer, and none is in
either dataset's documentation.

**The elapsed periods are read from the data, never hardcoded.** The focus year
is usually incomplete — payroll refreshes quarterly, the ordinance lands in
autumn — so dollars are shown as share-of-budget against share-of-year, not as
a raw difference. Compared raw, 6 of 24 periods looks like a 71% underspend.

**Unmatched payroll is attribution, not absence.** An earlier version of this
page called it "titles that appear in no budget line at all", which was wrong:
the join is on a department-title *pair*, and most of those titles are funded
under a different department. Most of the residue is staff charged to
`D99 - Finance General`, a central accounting code the ordinance does not carry
as an operating department. The genuinely unbudgeted residue is two orders of
magnitude smaller. The verifier re-derives that split from source; do not
restate the old claim.

**The page refuses to publish a vacancy rate.** The subtraction is available and
wrong: the two sides attribute the same people to different departments, so
budget minus actual counts centrally-booked staff as missing. That refusal is
the most valuable thing on the page. Do not replace it with a number because
one would look better.

Budget-only keys are split into real positions and non-positions (fringe
benefits, adjustment pools carrying no headcount). Counting the latter as
vacancies would repeat the mixed-units error the page is about.

The verifier rebuilds the join from the City's data with its own normalisation
written as explicit steps rather than the fetcher's regular expression, and
asserts the raw join still matches zero — the page's central example fails
loudly if the City ever aligns the two code systems.

Project 3's interpretive claims — fringe-benefit and adjustment-pool lines as
non-positions rather than vacancies, 2080 hours as the FTE year, and refusing
the vacancy-rate question rather than publishing it with caveats — were
confirmed by Rehan on 2026-09-03, alongside Project 2's. The gate is unchanged
for anything added since.

The homepage Lab preview states four findings as static text. `verify_corpus.py`
reads them out of `index.html` and fails if they stop matching the corpus, so
regenerating the data cannot silently leave the marketing copy wrong. Run it
after any change to either.

**The Lab carries its own payload budget.** `lab/lab.css` and `lab/lab.js` load
only on that page, deliberately, so the marketing pages keep their discipline.
Do not move Lab styling into `styles.css`.

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
  `logo.png` source. Marketing pages were ~82KB and are now ~86KB after the
  panel, prose and booking styles; `/lab/` is exempt and carries its own
  budget. If `styles.css` keeps growing, split it per page rather than letting
  every page pay for every feature.
- Anchor targets rely on `scroll-margin-top` to clear the sticky header, and it
  derives from `--header-h` rather than a hardcoded number. The masthead is a
  fixed 87px at every width because `.masthead .wrap` reserves the space and the
  mark is capped to fit inside it. **Change the mark's size and you change the
  masthead**, which is why enlarging it once pushed the Lab's stage navigator
  underneath the header. Keep `--header-h` in step, and re-measure rather than
  assuming.

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
