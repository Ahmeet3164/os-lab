# Plan: parallel agents without overload or rebase pain

**Priority: critical. Do this before starting any new feature work.**

Several agents now work on os-lab at the same time, each in its own worktree. On
2026-11-16 this overloaded the Mac and made test results unreliable, and every
branch hit the same conflicts when it rebased at the end.

## What went wrong

| Problem | Evidence | Cause |
|---|---|---|
| Machine overloaded | Load average 24.37, 65 Chromium processes, setup timeouts | Playwright starts one worker per CPU core, and two or three agents ran the full suite at once |
| Tests ran against another worktree's build | `ERR_CONNECTION_REFUSED` on 127.0.0.1:4322, "webServer died mid-run", 28 failed tests | Every worktree uses port 4322, and `reuseExistingServer` reuses whatever server is already there |
| Agents killed each other's runs | An agent ran `pkill -9` on Chromium and on the port-4322 server | Processes were killed by name, not by PID |
| Conflicts on every rebase | `dashboard/dist` and all 7 locale files conflict on every branch | `dist` is committed and every build rewrites hundreds of hashed files; every feature appends keys at the end of the same locale files |
| Shared files rewritten | `app-shell.tsx` conflicted with the new `winapps` lab (#287) | Nav, Spotlight and lab lists all live in one file |
| Task ID collision | CLN-30 was taken by another branch in progress | IDs were chosen without checking existing branches and `reservations/` |

## Phase 0: rules that apply now

- [ ] Only one agent lands work on master at a time, in the order the user chooses.
- [ ] During development, run single e2e specs only, on your own port with two workers: `OSLAB_E2E_PORT=<free 43xx> npx playwright test --workers=2 <spec>`.
- [ ] Run the full e2e suite once per branch, right before the PR, and only while no other agent is running it.
- [ ] Before any `scripts/e2e.sh` run, ask the user which mode to use. Suggest one that fits the change, show the `--dry-run` output (specs, locales, widths, workers, screenshots), and limit the run to the patched parts unless the user asks for more.
- [ ] Never `pkill` or `killall` by name. Only kill PIDs you started.
- [ ] Do not commit `dashboard/dist` until the last landing step.
- [ ] Rebase on `origin/master` at the start of each work phase, not only at the end.
- [ ] Check `reservations/` and the remote branches before choosing a task ID.
- [ ] Run at most two or three heavy agents at once on a laptop.

## Phase 1: land the work in progress, one branch at a time

- [ ] `feat/lab-switcher-modal`: complete; needs one clean e2e run.
- [ ] `feat/local-notifications`: finish the `lib.rs`/`console.rs` wiring, `cargo test` and `cargo build`, the docs and `reservations/CLN-33.json`, then land it.
- [ ] `feat/in-app-feedback-telemetry`: complete; needs the full e2e comparison with master. Merge only after the user approves.

### Landing steps (every branch)

1. Commit the source changes, without `dashboard/dist`.
2. `git fetch origin && git rebase origin/master`, using the conflict rules below.
3. In `dashboard/`: `npm run check` and `npm run test:i18n`; at the repo root: `lat check`. Run the Python and Rust tests for the parts you changed. Compare every failure against a clean `origin/master` worktree and list the ones that already happen there.
4. `npm run build`, then commit `dashboard/dist` as a separate last commit: `build: regenerate dashboard dist`.
5. Run your specs, then the full e2e suite once, on your own port with `--workers=2`. Compare any failure with master.
6. `git fetch origin`. If `origin/master` moved since step 2, go back to step 2.
7. Push and open the PR against `master` with the test results and the failures that already exist on master. Wait for CI.
8. `gh pr merge <N> --merge --delete-branch`, after the user approves when they asked to approve.
9. Check that the merge is on `origin/master`, then remove the worktree and its `test-results/` and `build-pages/` folders.
10. Report the PR link, the merge commit, check results with pass/fail counts, and anything unfinished. Then the next branch starts at step 1.

### Conflict rules

- `dashboard/dist`: never resolve it by hand. Run `git checkout origin/master -- dashboard/dist`, continue the rebase, and rebuild in step 4.
- `src/i18n/generated/*.json`: keep both master's keys and yours, and keep the files valid JSON (`npm run test:i18n` checks this).
- Shared code (`app-shell.tsx`, nav lists, `api.ts`): keep master's new features working alongside yours. Never drop master's changes to make yours fit.

## Phase 2: fix the tooling (one PR, after Phase 1)

- [ ] **A. Playwright isolation.** In `dashboard/playwright.config.ts`, read `workers` from `OSLAB_E2E_WORKERS` (default 2), and turn on `reuseExistingServer` only when `OSLAB_E2E_REUSE=1`, so a run never uses another worktree's server.
- [ ] **B. `scripts/e2e.sh`, with every feature switchable from arguments.** It picks a free port, takes a machine-wide lock so only one heavy run happens at a time, and runs Playwright. macOS has no `flock`, so it uses a `mkdir` lock with a wait loop that records the PID and clears stale locks. It must work on macOS and Linux and pass `bash -n`.

  | Argument | Default | What it does |
  |---|---|---|
  | `--changed[=<base>]` | on when no spec is given | Run only the specs that cover files changed since `<base>` (default `origin/master`), using the map in item G |
  | `<spec>…`, `--grep <text>` | none | Run these specs or matching tests only |
  | `--full` | off | The whole suite; only before a PR |
  | `--workers <n>` | 2 | Parallel browsers |
  | `--port <n>` | a free port | Fixed port, for debugging |
  | `--lock` / `--no-lock` | lock on | `--no-lock` only for single specs, never with `--full` or `--crawl` |
  | `--screenshots=off\|on-failure\|on` | `on-failure` | Screenshot capture |
  | `--trace=off\|on-failure\|on` | `on-failure` | Playwright trace |
  | `--video=off\|on-failure` | `off` | Video; expensive, use only for one failing spec |
  | `--crawl` | off | Full-page PNG of each route (item F) |
  | `--routes <list>` | changed routes | Crawl only these routes |
  | `--locales <list>\|all` | `en` | Locales to crawl or test |
  | `--widths desktop,phone` | `desktop` | Viewports to crawl |
  | `--out <dir>` | `dashboard/test-results/<run-id>/` | Where screenshots, traces and the report go |
  | `--build` / `--no-build` | build when `dist` is older than `src` | Rebuild `dist` first |
  | `--dry-run` | off | Print the plan (specs, routes, locales, widths, workers, capture) and exit |
  | `--help` | | Arguments and examples |

  Each argument also has an `OSLAB_E2E_*` environment variable, read by `playwright.config.ts`, so a plain `npx playwright test` follows the same defaults.
- [ ] **C. Locale conflicts.** Stop every feature from appending keys to the end of the same files. Preferred: one dictionary file per feature, merged at build time, with `scripts/check-translations.mjs` updated to match. Smaller option: sort the keys in every locale file once and enforce the order in `test:i18n`. The PR explains the choice.
- [ ] **D. `dist` in reviews.** Mark `dashboard/dist/**` as `linguist-generated -diff` in `.gitattributes` so it stays out of review diffs. Optional for later: build `dist` in CI or at release time and stop committing it.
- [ ] **E. Shared registries (optional).** Move per-lab nav and Spotlight entries out of `app-shell.tsx` into one small file per lab, so new labs stop conflicting there.
- [ ] **F. Screenshots and crawl.** `--screenshots` and `--trace` map to Playwright's `use.screenshot` and `use.trace`. `--crawl` runs a crawl spec that visits the selected routes in the selected locales and widths, saves one full-page PNG each, and writes an HTML report to review layout changes. By default it crawls only the routes the change touches, in English at desktop width. `--locales all --widths desktop,phone` is the full set (about 30 routes × 8 locales × 2 widths, about 500 images), which runs only with the lock. Output stays git-ignored.
- [ ] **G. Change-to-test map.** `dashboard/e2e/affected.json` maps source paths to the specs and routes that cover them. Examples: `src/views/cleanup/**` → `cleanup*.spec.ts` and `/cleanup/`; `src/views/feedback-page.tsx` and `src/views/settings-page.tsx` → `feedback-settings.spec.ts` and `/feedback/`, `/settings/`; `src/i18n/generated/**` → the routes that use the changed keys, in the changed locales. Shared files (`src/shell/**`, `src/components/ui.tsx`, `src/styles/**`, `astro.config.mjs`) map to a smoke subset (the hydration test plus one spec per area), not the whole suite. A test checks that every spec appears in the map, so new specs cannot be left out.
- [ ] **H. Asking before a run.** `AGENTS.md` tells agents to ask before any `scripts/e2e.sh` run and to suggest a mode, for example:
  - a change in one view: `scripts/e2e.sh --changed` (its specs only);
  - a layout or style change: `--changed --crawl --widths desktop,phone`;
  - new or changed translations: `--changed --crawl --locales <changed locales>`;
  - shared shell or styling: the smoke subset plus `--crawl` of the main routes;
  - right before the PR: `--full`, once, with the lock.

  The agent shows the `--dry-run` output with its question, so the user sees what will run and roughly how long it takes.

## Phase 3: documentation (same PR as Phase 2)

- [ ] `AGENTS.md`: a short "Parallel agents" section with the Phase 0 rules and a link to the landing steps.
- [ ] `lat.md/tooling.md`: a "Parallel work" section with the causes above, `scripts/e2e.sh`, and the landing steps. Run `lat check`.
- [ ] `CONTRIBUTING.md`: the landing steps and conflict rules for human contributors.
- [ ] This plan: tick items off and link the PRs; close it when Phase 3 lands.

## Acceptance checks

- [ ] Two `scripts/e2e.sh` runs started together: the second waits for the lock, and both pass.
- [ ] Two worktrees run single specs at the same time on different ports, and neither sees the other's build.
- [ ] A full suite run with two workers keeps the load average below the number of CPU cores.
- [ ] A test branch that adds locale keys rebases onto a master that also added keys, without a locale conflict.
- [ ] `scripts/e2e.sh --screenshots e2e/<spec>` and `scripts/e2e.sh --crawl` save PNGs under the run folder, and a failed test keeps its screenshot and trace.
- [ ] `scripts/e2e.sh --changed --dry-run` on a branch that only touches `src/views/cleanup/` lists only the cleanup specs and `/cleanup/` routes.
- [ ] Every argument in item B can be switched on and off, and `--help` lists them all with their defaults.
- [ ] `--no-lock` together with `--full` or `--crawl` is refused.
- [ ] `npm run check`, `npm run test:i18n`, `npm run build` and `lat check` pass.

## Appendix: session reports from 2026-11-16

These are the three session reports behind this plan. Times are marked
**measured** (from a log, a commit, a test runner or a command timeout) or
**estimated**, as each session reported them.

### Lab-switcher session (`feat/lab-switcher-modal`)

Task: lab switcher modal (⌘L), focused sidebar nav, sidebar action card and a
collapsible "How to use". Status: implemented and rebased; e2e blocked by the
environment; no PR yet.

| # | Step | Time | Result |
|---|---|---|---|
| 1 | Explore shell, Spotlight, api, i18n, e2e | ~16:10–16:25 (estimated) | Found the `iux-dialog` modal pattern, `client:only` islands, the i18n baseline rule |
| 2 | Create worktree `os-lab-worktrees/lab-switcher`, branch, symlink `node_modules` | ~16:25 | Hit the 120 s foreground timeout, finished in the background (exit 0); about 2 min on a slow external volume |
| 3 | Implement `active-lab.ts`, `lab-switcher.tsx`, `app-shell.tsx` rewrite, CSS, 8 locale files, e2e specs, docs | ~16:30–17:00 (estimated) | Done |
| 4 | `npm run check`, `test:i18n`, `build` before rebase | 17:06:45 (measured, build log) | Pass; 531 pages |
| 5 | `lat check` | 988 ms (measured) | Pass |
| 6 | First e2e run, before rebase | by ~17:32 (estimated) | All pass |
| 7 | Commit `fa02e4cf5`, `git rebase origin/master` | 17:24:10 (measured) | 1 conflict in `app-shell.tsx` with the new `winapps` lab (#287); `lat.md/dashboard.md` auto-merged |
| 8 | `check`, `test:i18n`, `build` after rebase | 17:25:25 (measured) | Pass; 2742 keys; 532 pages |
| 9 | E2e run B, default workers | 17:33–17:47 (estimated) | Load average 24.37 and 65 Chromium processes (measured); killed |
| 10 | E2e run C, `--workers=4` | started 17:47 (measured) | Port-4322 server died mid-run: `ERR_CONNECTION_REFUSED`, 4× "Channel closed", 28 environmental failures |

The session's own notes: run B was started with default workers (its
mistake); run C most likely raced with run B's dying server on the same port;
master's e2e was never run for comparison.

### Notifications session (`feat/local-notifications`)

Task: local notifications on every desktop platform (OS delivery, permission
status, in-app toast stack), wired to Cleanup Lab's lifecycle hooks. Status:
about 60%; Tauri module not wired; no commits.

| # | Step | Time | Result |
|---|---|---|---|
| 1 | Worktree `.worktrees/local-notifications` from `origin/master` `ab713f146` | ~16:0x (measured) | Done |
| 2 | Read conventions (`monitor.py`, `widget.py`, `cleanup_api.py`, `test_monitor.py`) | ~10 min (estimated) | Done |
| 3 | Engine `notifications.py` and 11 unit tests | ~20 min (estimated) | 11/11 pass in 0.122 s (measured) |
| 4 | Console hooks and 4 endpoints in `cleanup_api.py`, smoke scripts | ~25 min (estimated) | Pass |
| 5 | Dashboard types, store, toasts, settings card, 14 strings × 7 locales, e2e spec | ~50 min (estimated) | Done |
| 6 | `astro sync`, `npm run check`, `test:i18n`, `build` | 17:14 (measured) | Pass; 2743 keys; 531 pages in 20.47 s |
| 7 | Playwright browser download and e2e (install plus 5 runs) | 17:17–17:35 (measured) | One test passed once, then browser launches hung |
| 8 | Cargo dependency, `cargo fetch`, `notifications.rs` | ~17:40–17:55 (estimated) | Written, not compiled; `cargo fetch` took over 3 min under load |
| 9 | `lib.rs` wiring | — | Edit rejected (file not read first); pending |

The session's own notes:
- About 25 minutes were partly wasted. No Playwright browsers were installed. The first run left a stale `http.server` on port 4322 that broke the next one. Three of its own test bugs needed fixes. Later runs hung at "setting up page" with the load average at 24, while Antigravity used 87% CPU.
- It used `pkill -9` on Chromium and the port-4322 server, which affects every session's runs.
- The task ID CLN-30 was already taken by `feat/cln-30-engine` (and CLN-31 and CLN-32 were in use), so it switched to CLN-33.

### Feedback and telemetry session (`feat/in-app-feedback-telemetry`, Linux host)

Task: in-app feedback and contact forms plus opt-in telemetry, with core-api
PR #13 making the feedback list admin-only. About 36 minutes until the pause; all
times are estimated, because the session cannot see clock times.

| Step | Time | Why |
|---|---|---|
| First e2e attempt | ~10 min | Output piped through `head -30`, so the run looked frozen and sat until the 600 s timeout |
| Full e2e suite, started three times | ~5–8 min | `git stash` in the same checkout swapped `dashboard/dist` under a running suite, twice |
| Python suite, 4–5 runs | ~4 min | ~45 s each, to show 19 failures also happen on master (local `.env` value `root` caused one) |
| Reading both codebases | ~6–8 min | About 30 small reads, one at a time |
| Writing code and 53 strings × 7 locales | ~5 min | Large outputs |
| Builds and Pages checks | ~3 min | Astro build ~15 s × 4, Pages dry-run and two smoke scripts ~2 min |
| core-api PR #13 | ~4 min | CI `coverage` job fails in 3 s with no logs |
| Playwright browser path | ~1 min | The sandbox cache path pointed away from the installed browsers |

About 15 minutes of the 36 were process mistakes; the work itself needed
roughly 20.
