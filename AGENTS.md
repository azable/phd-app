# AGENTS.md

## Project context

This repository contains one SvelteKit application. Projects are immutable event
Timelines in PostgreSQL. The web process accepts asynchronous operations into
those Timelines and executes them through a bounded in-process executor;
interrupted work is explicitly failed and retried by the user.

Visualization modes are developer-registered in `src/lib/modes/catalog.ts`. The
`sverlin` mode authors one import-free Svelte component that uses the injected
library in `src/lib/modes/sverlin/library/`, and `html` authors script-free
frames. Each mode folder owns its assistant, starter artifact, validation/build
implementation, and playback component. The sole main study in
`src/lib/studies/main.ts` compares the two, `sverlin` and `html`. JavaScript
from authored artifacts executes only on the server, in the `isolated-vm`
isolate that lays out each step and draws its scene
([`layout.server.ts`](src/lib/modes/sverlin/layout.server.ts)), with bounded
memory and time and no Node APIs; never in the server's own context or the
application origin. The page, an opaque-origin sandboxed browser frame, draws
those scenes with the app's own code and runs none of the authored code.
Sanitize authored HTML with a library and reject external imports; an iframe
alone cannot prove that arbitrary JS will never attempt navigation.

## Communication and documentation

- Write for developers familiar with programming but only basic DevOps. Be
  concise and explain operational constraints in plain language. Define
  unavoidable specialist terms at first meaningful use and link to authoritative
  sources when a definition would interrupt the explanation.
- In Markdown, link to existing repository files with relative links. Prefer a
  named heading or symbol to a drifting line anchor. Keep behavior claims close
  to their source of truth and distinguish established behavior from
  recommendations or assumptions.
- Check the code, data or source before stating a fact about it, and say when a
  claim is unchecked; verify a subagent's factual claims before relaying them.
- During guided external-service setup, account for every warning or error as
  blocking, actionable, or harmless before the next step. Verify external state
  with a read-only check when possible.
- Keep human-facing project documentation in the root `README.md`; do not add
  `docs/` or separate guides without approval. Avoid duplicating source-level
  detail. Temporary `HANDOVER.md`, machine-consumed prompt/index files,
  licenses, installed skills, and source-adjacent provenance are not project
  guides.
- Document the rationale and source for operational constants, limits, timeouts,
  and retry counts.
- In response code examples, keep ordinary readable expressions on one line
  rather than expanding every application vertically.
- The project's Markdown is wrapped at 80 characters, so diffs show only the
  lines that change; Prettier's override in `.prettierrc` wraps it, leaving code
  blocks as written. Code stays at Prettier's 100.

## Navigation and boundaries

- Environment-neutral schemas, Timeline projections, reusable study tooling, and
  transport contracts belong under `src/lib/shared/`; concrete study definitions
  under `src/lib/studies/`; browser sessions and UI under `src/lib/client/`;
  persistence and project commands under `src/lib/server/`; mode-neutral AI
  (providers, bots, decisions, context, turns, costs) under
  `src/lib/server/ai/`.
- Each mode's browser-safe contract and starter, server build, and playback live
  together under `src/lib/modes/<mode>/`, and its AI (bot, prompts, helpers)
  under `src/lib/modes/<mode>/assistant/`. An engine (compiler, layout, library,
  scenes, build) never imports its assistant: the assistant uses the engine's
  public functions, not the reverse; mode-neutral server code reaches a mode
  only through `modes/catalog.ts`, `modes/server.ts` and
  `modes/assistants.server.ts`. Keep server-only and browser-only entry points
  separate; preserve the one-way import rules in `eslint.config.js`, which check
  both.
- Stable direct URLs belong under `static/`. Generated shadcn-svelte component
  source belongs under `src/lib/client/components/ui/` with helper
  `src/lib/client/components/utils.ts`; `components.json` is authoritative for
  aliases. Use `pnpm dlx shadcn-svelte@latest` when adding or updating those
  components.
- The public Svelte component source contract is the mode starter and build
  implementation in `src/lib/modes/sverlin/`. Its assistant prompt belongs in
  its `assistant/` folder: instructions in `assistant/assistant.md`, followed by
  the language guide. The Sverlin language guide,
  `src/lib/modes/sverlin/README.md`, is both the assistant's language reference
  and the developer documentation of the language (an approved exception to
  keeping guides in the root `README.md`); update it in the same change as any
  change to the blocks, the subset, `Node`/`Link` props, or drawn defaults. Its
  `<!-- -->` comments are maintainer notes stripped from the prompt; everything
  else is sent to the model. Each mode has its own assistant; never make one bot
  serve more than one mode.

## Commands and operational state

- Run project commands inside the Dev Container. `.envrc` activates devenv in
  interactive terminals; for non-interactive execution use
  `devenv shell -- COMMAND`. Container setup runs
  `devenv tasks run sverlin:setup`. `devenv up` starts PostgreSQL and the app;
  `devenv up -d postgres` starts only PostgreSQL for tests; `devenv down` stops
  managed processes.
- `pnpm run dev` migrates the database and starts the SvelteKit server.
  `pnpm run dev:web` skips migrations but still executes asynchronous project
  operations. The web process runs mode-owned visualization builds and project
  operations. `pnpm run build` builds the Node application.
- Server launches reload the current `.env` through `scripts/run-with-env.sh`,
  using the same loader as devenv shells. After `.env` changes, coordinate a
  web-process restart (`devenv processes restart web`); the daemon and
  PostgreSQL do not need restarting. Do not route isolated test migrations
  through this launcher: their database URL must remain supplied by the test
  runner.
- Use `pnpm run export:data -- --scope projects` (optionally
  `--project PROJECT_ID` and `--output PATH`) to inspect complete project
  Timelines or retained operation failures. Do not bypass the canonical export
  with ad hoc PostgreSQL queries for that work; extend the export if important
  data is missing.
- The consolidated `drizzle/0000_lying_jean_grey.sql` is a fresh-database
  baseline. It does not migrate older compiler-era projects or authentication
  data. Verify the target database before any reset and never reset it
  implicitly during ordinary development.
- `pnpm run db:clear-projects` deletes every project, with its events and
  interaction sessions, from a local database, keeping accounts and study runs,
  for starting over after the view language changes. It refuses any other host.
  Run it only when the developer asks.
- `/dev/demo` (dev server only, admin) shows one demo project at a fixed URL. To
  show the developer examples, write each as a `.svelte` file in `.demo/inbox/`,
  starting with `<!-- summary: … -->` (what it shows, or what it changes, at
  most 300 characters, a version summary's limit) and, to make it a child of an
  earlier example, `<!-- parent: name -->`, and to build it with chosen values,
  `<!-- variant: {"Here": {"shown": false}} -->` (nested, or flat as
  `{"Here.shown": false}`; a root example's variant naming no `"..."` base is
  built on `$starter`, written into the version, while a template's name alone
  is refused, as the demo writes out no template), and to post a note to the
  chat after it, `<!-- note: … -->` (markdown on one line; code in backticks
  links to the source): while the page is open, each is saved, in name order, as
  a version in its chat, and removed from the inbox; one the app refuses is
  posted to the chat with the reason instead, and a variant value no kind has
  (as `Main.AtI` for a kind inside `Board`, `Main.Board.AtI`) is left out with a
  warning posted after it. A version the developer names, as
  `3fa2c1/Misty-Falcon-09` (its copy button, or Alt+Shift+C for the one shown,
  copies it), maps to its example in `.demo/names.json`; when telling the
  developer about an example, name it by that reference, which the chat shows,
  never by its file name. When done, `touch .demo/flush` to replace the project
  with a fresh one ([`dev-demo.ts`](src/lib/server/dev-demo.ts)).

## Engineering rules

- Source edits and non-serving checks may run while the developer's dev server
  is running. Reuse an existing server for browser verification; inspect
  listening ports and managed process status before starting another. Do not
  stop or restart developer-owned processes without permission. Run PostgreSQL
  integration tests through `pnpm run test:postgres`, which creates an isolated
  test database; do not run test cleanup or destructive commands against the
  development database. Request a coordinated restart only when configuration
  changes require one, and explain when hot reload could interrupt active work.
- If completing an active task requires a development-environment or agent
  restart, create/update a temporary root `HANDOVER.md` before stopping. Record
  objective, completed work, current working-tree ownership, next safe action,
  remaining blockers, validation, and operational state. On the first turn after
  restart, read it fully, inspect Git status/relevant diffs, verify recorded
  state, continue safely, and delete it after the resumed task is complete.
- Repository-local skills under `.agents/skills/` describe specialized work.
  Review applicable skills and follow them. Before adding a skill, explain the
  benefit and ask approval. Manage installed skills using `npx skills`, not
  manual edits to installed skill directories or `skills-lock.json`.
- Treat unfamiliar files and modifications as possible user work. Preserve the
  browser/server import boundary and project style. Update `README.md` in the
  same change when commands, setup, structure, generated artifacts, or
  user-facing workflow change.
- Before building a mechanism, find the one the code already has for the same
  job (for example, `LayoutMemory.reserved` in
  `src/lib/modes/sverlin/assembly/entry.ts` for keeping a box's largest size)
  and extend it; a parallel implementation needs its reason stated in the
  review.
- While the language is a work in progress, do not keep old forms readable:
  when a form is replaced, the build refuses the old one with a message giving
  the new form, its translation code is deleted, and stored projects are
  cleared (`pnpm run db:clear-projects`) rather than migrated; replay fixtures
  are rewritten to the new form. Suggest this to the developer and wait for
  their agreement before removing a form or clearing projects.
- A new mode should add one folder plus one catalogue registration, not another
  cross-cutting assistant/mode mapping. Prefer project intake, operations,
  attempts, persistence, and workspace controls that are mode-neutral; where a
  part is really about one mode (as Sverlin's design values in decisions, or its
  helper rounds), put it in that mode's folder or behind a mode hook, rather
  than branching on the mode in shared code.
- AI-generated source is validated/built before activation. Timelines retain
  prompts, responses, diagnostics, source, accepted artifacts, and
  presentations.
- Generated JavaScript must not execute in the server's own context or the
  application origin; on the server it runs only in the layout isolate, whose
  limits stay bounded. The authored HTML validator and the isolated iframe/CSP
  serve different purposes. Preserve the opaque origin
  (`sandbox="allow-scripts"` without `allow-same-origin`), no external imports,
  and restrictive resource/network directives. Do not claim HTML sanitization
  alone vets JS or that an iframe absolutely prevents own-frame navigation
  requests.

## Verification

- `pnpm run test:unit` is the fast TypeScript suite; `pnpm run test` also runs
  PostgreSQL integration tests. Use `devenv up -d postgres` first for the
  latter. Run `pnpm run check`, `pnpm run lint`, and focused mode/build tests
  after relevant changes.
- Browser tests (`*.browser.test.ts`) take minutes; run none unless a change can
  only be verified in a browser, and then only the file that covers it, once.
  Otherwise rely on `pnpm run check`, `pnpm run lint` and focused unit tests,
  and name in the report any browser test that would cover the change. When
  merging, run only the tests covering code both sides changed.
- After Svelte component or module changes, run `pnpm run check`, the
  `@sveltejs/mcp` autofixer required by the repository skill, and manually
  verify affected browser interactions. There is no automated E2E suite. Do not
  add tests for reversible, low-impact changes that merely mirror
  implementation.
- For source compilation or sandbox changes, verify at least one real Svelte
  component build, static HTML sanitization, rejection of imports in authored
  source, and presentation playback behavior. After any change that shows in a
  visualization or the assistant's behaviour (the Sverlin language, its library,
  the assistant's guide, or the app around them), load one or more examples that
  illustrate it into `/dev/demo` (see above), flushing first so only they show
  unless the developer is using the page, check them there, and ask the
  developer to look at that page, naming what each shows; flush the demo once
  they are done with it. For database schema changes, regenerate the baseline
  only with the developer-authorized fresh database workflow and run
  `pnpm run test:postgres`.
