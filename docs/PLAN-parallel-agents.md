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
- [ ] **B. `scripts/e2e.sh`.** Pick a free port, take a machine-wide lock so only one full suite runs at a time, then run Playwright with that port and two workers. Pass arguments through so single specs work. macOS has no `flock`, so use a `mkdir` lock with a wait loop that records the PID and clears stale locks. Must work on macOS and Linux and pass `bash -n`.
- [ ] **C. Locale conflicts.** Stop every feature from appending keys to the end of the same files. Preferred: one dictionary file per feature, merged at build time, with `scripts/check-translations.mjs` updated to match. Smaller option: sort the keys in every locale file once and enforce the order in `test:i18n`. The PR explains the choice.
- [ ] **D. `dist` in reviews.** Mark `dashboard/dist/**` as `linguist-generated -diff` in `.gitattributes` so it stays out of review diffs. Optional for later: build `dist` in CI or at release time and stop committing it.
- [ ] **E. Shared registries (optional).** Move per-lab nav and Spotlight entries out of `app-shell.tsx` into one small file per lab, so new labs stop conflicting there.

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
- [ ] `npm run check`, `npm run test:i18n`, `npm run build` and `lat check` pass.
