# Sverlin

Sverlin is a SvelteKit research application for creating and reviewing algorithm
visualizations. PostgreSQL stores each project as an immutable event Timeline.
The web process accepts operations into the Timeline, runs them asynchronously
with bounded in-process capacity, and records success or failure. Participants
can discuss, edit, step through, and compare retained presentations.

## Visualization modes

Developer-registered modes are listed in
[`src/lib/modes/catalog.ts`](src/lib/modes/catalog.ts). Each mode folder owns
its starter artifact, assistant, validation/build code, and playback component:

| Mode      | Authored artifact                                      | Playback                                                                                                  |
| --------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `sverlin` | One Svelte 5 component (`Main.svelte`) without imports | Bundled Svelte runtime, component library, and component, seeded and stepped in an isolated browser frame |
| `html`    | A JSON manifest of script-free, complete HTML frames   | Sanitized HTML, one frame per step                                                                        |
| `html-js` | JSON containing separate HTML and JavaScript           | Sanitized HTML plus JavaScript in an isolated browser frame                                               |

For study blinding, the app shows each mode only by its catalogue title (System
A, B, C), and its pages, passkey dialog, exports and assistants name no product.

Administrator projects offer a blank starter in every mode and one populated
Svelte example, [linear search](src/lib/modes/sverlin/contract.ts). No other
example programs are bundled.

Sverlin components use a small component library without importing it. The
library's Svelte sources live in
[`src/lib/modes/sverlin/library/`](src/lib/modes/sverlin/library/). The
language, blocks and library together, is documented in one guide,
[`src/lib/modes/sverlin/README.md`](src/lib/modes/sverlin/README.md), which the
Sverlin assistant's prompt includes after its instructions in
[`assistant.md`](src/lib/modes/sverlin/assistant.md), so editing either changes
the model's guidance. HTML comments in both files are maintainer notes left out
of the prompt, and
[`guide.server.test.ts`](src/lib/modes/sverlin/guide.server.test.ts) builds its
complete examples and checks its `Node` and `Link` props and named values
against the compiler.
[`src/lib/modes/sverlin/assembly/`](src/lib/modes/sverlin/assembly/) holds what
the compiler adds around every authored component: `prelude.ts` is the import
line injected into the module script (its names are reserved), and `entry.ts`
mounts the component with the selected step and seed. The `sverlin` alias in
[`svelte.config.js`](svelte.config.js) lets the editor resolve the library from
those files. Projects keep the source they were created with, so starter or
library changes do not rewrite existing artifacts.

Sverlin components are written in the language described in that guide:
`domain`, `input`, and algorithm blocks in `<script lang="sverlin">`, followed
by a view drawn only with `<Node>`, `<Pointed>`, and `<Link>`: the compiler
rejects view scripts, `<style>`, HTML and SVG elements, text outside a node, and
props that set a look, so every visible thing is selectable and its look is the
design's. The server parses each block with acorn, rejects anything outside a
small JavaScript subset, and runs it in its own interpreter in
[`src/lib/modes/sverlin/algorithm/`](src/lib/modes/sverlin/algorithm/) under
step, operation, size, and string limits. The input and algorithm do not see the
seed, so every presentation of a source shares one master trace; its labels form
the step signature. A presentation is a variant of its source's design space,
which the compiler generates from the markup and the library
([`design.server.ts`](src/lib/modes/sverlin/design.server.ts), options in
[`library/node/design.ts`](src/lib/modes/sverlin/library/node/design.ts)): each
type rendered by name chooses among its views and none (`views.Int`), the page
frame has its values (`Stacked.ratio`, …), and every kind of node, a view and
the tags a node has (`Here[current]`), has a variable per prop, each with a
finite set of options. A kind a node takes only at some steps, by a tag the
state decides, varies paint, text, and inset but not layout or what is shown,
and such a node keeps the largest inset of every kind its tag can be, so nothing
in it moves between steps. A build gives every variable a value: the starter's,
a base variant's where it still fits, randomised (keeping the base's equal
values equal, colours' shades, and what is shown), or chosen (an option the
space lacks, or a variable it does not have, is an error). On Another variant or
New pair (dev mode only, in the top bar beside the Dev switch, with a picker of
the chooser for that press), and for the presentations an assistant's `vary` or
`resample` with a `count` makes, a chooser picks each presentation's values from
the design space, starting from the viewed variant, given the variants of that
source already shown. The choosers are interchangeable
([`choosers.ts`](src/lib/server/projects/choosers.ts)): the model
([`chooser.server.ts`](src/lib/modes/sverlin/chooser.server.ts), a second,
smaller model call), OpenAI's Decisions API
([`chooser-decisions.server.ts`](src/lib/modes/sverlin/chooser-decisions.server.ts)),
or a random draw. A study condition names one (`chooser`), else
`SVERLIN_CHOOSER`, else the model (a resample's own chooser is honoured only
from an administrator); a chooser that fails, or keeps Another variant waiting
over 20 seconds, gives way to the random draw. The assistant is the one author
of a turn: its change to the source, or a `vary` without a `count` (which sets
values without changing the source), shows as one version, its first build, with
the viewed variant's values where they still fit and the starter's for anything
new, and no chooser call; an `edit` or `revise` may give `values` of its own
over those, as the pauses that pace a first version (every label paused `on`
otherwise), from each label's `runs` in the assistant's context, which unlike a
`vary`'s settle nothing; after a manual change the first presentation keeps the
viewed variant's values and the second is randomised; refills of the
presentation buffer stay random, as most are never shown
([`service.ts`](src/lib/server/projects/service.ts) `basedRequests`). With a
`count` (at most 8, in whole pairs), a `vary` or `resample` makes that many, the
chooser filling each around the values the `vary` sets, and queues them in the
presentation buffer: what it held is consumed, the first pair shows, and each
Next pair, or New pair in dev mode, consumes the shown pair to show the next
(`queueBuiltPresentations`, `waitingBehind` in
[`presentation-buffer.ts`](src/lib/shared/projects/presentation-buffer.ts)). A
`vary`, `edit` or `revise` may instead give `comparisons` the assistant designs,
each a question and its two sides, each a short label in the participant's words
and the values it sets: each is built as one pair, both from the viewed variant
(with the `vary`'s values), differing only as its sides do, with no chooser or
random draw. The first pair is built alone and shown at once, in place of the
decision's one version, and the rest are built after it, one pair at a time,
each queued as soon as it is built (`presentRemainingComparisons` in
[`commands.ts`](src/lib/server/projects/commands.ts)). The question is stored on
the pair's `visualization.presented` events, each with its side's `label`, and
shown above it on the stage and as a card in the chat, each side by its label;
the assistant's context gives a preferred side as its label (“Cells or tallies?
→ tallies”), and a preference naming that display set is read with it in the
assistant's context. A comparison may also ask a brief attribute by showing,
naming it and the tag each side stands for (tone: restrained or bold), stored as
each side's `brief`: preferring a side sets the attribute, inferred, its source
the question and the side's label (`projectBrief` in
[`brief.ts`](src/lib/shared/projects/brief.ts)); a tie or skip sets nothing. A
pair is answered by preferring a side (Top or Bottom), Either (a tie) or Unsure
(a skip), all recorded as `visualization.preference-recorded`, a tie or skip as
its `outcome` with no `preferred`. The card marks each side by the latest
answer, a tick beside the chosen side and a cross beside the other (ticks on
both for Either), or a question mark beside each while it is unanswered or
Unsure. Choosing the card shows its pair on the stage again, to answer it or
answer it again (the same command, so it also rebases on a preferred side and
may start a turn); a pair's latest answer is the one that counts, on its card
and in the preference model. An answer on one of them asks the assistant for no
turn while others wait (`waitingComparisons`); it sets aside, as
`candidates-advanced` with reason `moot`, those the answer makes moot, asking
the pair just answered, about a variable it settled, or something a value it
settled hides (`mootComparison` in
[`variant-guard.ts`](src/lib/server/projects/variant-guard.ts)), and the answer
that leaves none waiting starts the assistant's turn. A preference model
([`preference-model.ts`](src/lib/server/projects/preference-model.ts)), a
Bayesian Bradley–Terry model with Davidson ties over every choice's options,
fitted from the events on each call, decides what is settled for every chooser:
a choice one option of which is at least 0.9 likely best over two answers, a
`vary` decision's value until an answer goes against it, or, where Either is
fine was its latest answer, the value showing; skips are no evidence. Its
summary
([`preference-summary.ts`](src/lib/server/chat-bots/preference-summary.ts)),
each touched choice's likeliest option, what is most worth asking, what was
never compared, and `showFirst`, the riskiest choice no alternative has shown (a
free layout never compared first, its first automatic layout being a guess, then
views or arrangement), goes in the assistant's context as `preferences`, and so
into each request's recorded prompt. Beside it goes the design brief, `brief`:
the attributes of what the participant is trying to achieve, defined in
[`brief.ts`](src/lib/shared/projects/brief.ts) (intake's questions first, then
those marked `askFirst`, who it is for and the key takeaway, the first still
unknown asked by the reply with the first version and the other with a later
comparison or change, one question in words between things shown; those marked
`later`, as low vision or printing in grey, asked once, late; and an `assumed`
default, as tone's restrained look, steering while unknown; and how the
participant likes to work, `questions` (questions first, a draft first or fewer
questions) and `lead` (suggest alternatives, direct it, or a mix), whose
defaults and steering the context gives as `working`, `lead` asked with the
first alternatives offered), each unknown, inferred or confirmed, from intake's
answers and the `brief` each assistant decision returns, recorded on its
`assistant.responded`; which are worth asking or confirming now, in words or,
for those `brief.ts` marks `asked: "showing"`, by a comparison
(`prompt: "show"`), and, once a question in words has been asked since anything
new was last shown, `next: "show"`, so the next turn shows a change or a
comparison rather than asking again
([`brief-context.ts`](src/lib/server/chat-bots/brief-context.ts)); and what the
brief keeps out of comparisons, as colour where it must print in grey, which a
comparison varying it is sent back to the assistant for. The brief's values
weight the summary's ranking of what is worth asking. The assistant may also ask
one `question` at a time, in words or about a presentation (one shown, or the
first its decision makes, with elements to highlight), answered by the
participant's next message, which records the question it answers
(`feedback.submitted` `answers`); the chat shows each question as the last
paragraph of its reply, which is left without a last sentence or paragraph that
repeats it, the next message being its answer, and each comparison pair as its
card ([`questions.ts`](src/lib/shared/projects/questions.ts)). A comparison with
an option its variable lacks (in the changed source, for `edit` and `revise`),
sides alike, or a side hiding the layout itself or most of the picture
(`allowedComparisonSide` in
[`variant-guard.ts`](src/lib/server/projects/variant-guard.ts); unlike a
chooser, the assistant may hide a top-level part such as a title) is recorded as
rejected (`revision.edits-rejected` with `rejected: "comparisons"`) and repaired
as edits that did not apply are, the repair told to keep unchanged the
comparisons that could be built; on the last attempt those are built without the
others (`kept`), the reply saying which were left out. The assistant's reply,
with its question, is recorded last, once its decision is accepted and has
presented its version (or first comparison pair), so a reply whose decision was
set aside is never shown and the reply, its pill and its question arrive
together; a `candidate-ref` in the reply (slot 0, or a pair's slot 1) and a
question about the new version name what the turn presented. Every presentation
currently shows every master step. Every array and object is made by a
collection or record type the domain block defines, and each step records the
domain type of every value by path beside its plain values. Every view is
mounted inside the page frame,
[`library/Frame.svelte`](src/lib/modes/sverlin/library/Frame.svelte), which lays
it out at a fixed logical size and scales it to fit the page, as a zoomable,
pannable canvas with a dashed outline; the sandboxed page loads once per
presentation and the app sends each later step as a `sverlin:step` message: the
page mounts the step in a hidden layer and swaps it in once its layout settles,
so zoom and pan carry over and neither a blank page nor an unfinished layout
shows, while `sverlin:view` messages report the view to the app. Every
arrangement is a set of constraints over a node's measured children, and a node
hugs them: rows, columns, and grids are solved by CSS, with any links drawn over
them, while `layout="free"` is solved by WebCola
([`library/node/arrange.ts`](src/lib/modes/sverlin/library/node/arrange.ts))
from starting positions drawn from its kind's `layoutSeed`, with nested
arrangements laying out again as their children settle. A free layout takes a
form from the structure its links make
([`library/node/forms.ts`](src/lib/modes/sverlin/library/node/forms.ts)), its
kind's `form` or, where that structure cannot take it, the structure's natural
form, never chosen by the space; arrows are cubic curves that bend round other
nodes and labels, straight or curved as the layout's kind's `curve`, or the
link's kind's `curve`, prefer, meeting the bordered or filled boxes of the
element each end names where the node drawing it has neither. The server gives
each free layout kind the structure its data makes
([`structure.server.ts`](src/lib/modes/sverlin/structure.server.ts)): it reads
statically which data the layout's links are drawn from and follows it through
the trace, without running the view, so the form's options and starter fit it
and the chooser is told it. Arrows are `<Link>` components: the compiler stamps
them like nodes, and each drawn link is selectable and referencable by its id.
Every arrangement draws its choices from a seed of its own, derived from its
kind's `layoutSeed` and its place, so the presentation seed decides no layout
and a layout changes only with those variant values; selections report each
element's surrounding free layouts (arranging node, kind, layout seed, form,
curve) in its `element-ref`, so the assistant can keep a layout the participant
liked by varying those values. Every step is laid out before any is shown,
mounting none of them: each step's markup is drawn with Svelte's string renderer
and laid out on a layout model of its own, from the library's style sheets and
measured text
([`library/model/reserve.ts`](src/lib/modes/sverlin/library/model/reserve.ts)).
The server does this as it builds each presentation
([`layout.server.ts`](src/lib/modes/sverlin/layout.server.ts)), running the
presentation's code in an isolate with no access to the server, bounded in
memory and time, and measuring text with HarfBuzz in the fonts every page embeds
([`fonts/`](src/lib/modes/sverlin/fonts/README.md)); it gives the page the
result with its bundle, so the page mounts only the step it shows, and keeps it
by what it was made from. The page lays out itself, the same way, measuring on a
canvas, wherever that layout does not hold: the fonts did not load, a text needs
a character no embedded face has, or the screen's device pixel ratio snaps a
border to another width. Sizes compose bottom up: a typed component's root keeps
its component's box, any other node keeps the largest size it reaches at any
step, laid out with the sizes the nodes inside it keep, so changing content
never resizes a box, every item of a collection keeps the largest size any of
them reaches, so items line up even when only some change, and each arrangement
is solved once over the union of every step, with every child and link that ever
appears ([`library/node/span.ts`](src/lib/modes/sverlin/library/node/span.ts)),
the node holding it sized with it; nodes alike are laid out once. Showing a step
mounts it and places children where that solution put them, drawing only that
step's links, at a root fit shared by all steps, so positions are valid across
the whole animation, so a seed gives the same layout for each step whichever
step is shown first, and only what changes moves. The page frame is the root
arrangement, scaled down when it would not fit and up, to 1.6 times, when it
would leave the frame mostly empty. Participants' selections inside the frame
reference nodes in feedback: the compiler stamps every `<Node>` with its tag's
`line:column` as the reserved `__ref` prop, each rendered node gets an id from
it, and a keyed node from its tag and key too, so it keeps its id as other nodes
come and go
([`library/type-context.ts`](src/lib/modes/sverlin/library/type-context.ts)),
and the frame reports selections as `sverlin:selection` messages, which the app
validates and keeps per presentation and step. Feedback records them as
`element-ref` segments at the start of the message; the server checks each id
names a `<Node>` in that presentation's source
([`element-ref.ts`](src/lib/modes/sverlin/element-ref.ts)) and gives the
assistant the tag, its render, and the label the participant saw. Otherwise a
message is only the participant's words: what was on screen (the presentation
and step viewed, the pair compared, or a source chosen on its own) is recorded
beside it as `feedback.submitted` `viewing`
([`feedback-context.ts`](src/lib/client/timeline/feedback-context.ts)), not
shown in the chat, and given to the assistant as a note before those words. The
compiler stamps every `<Node>`, `<Pointed>`, and `<Link>` with its view as
`__view`, which with its `tags` gives its kind, and each node draws the
variant's values for its kind. The compiler injects the library components and
every input and algorithm value, the view each type rendered by name draws,
`step`, and `seed` as props. Presentations record their kept `masterSteps`,
their `variant`, where each value came from (`origins`), each type's views, and
the kinds each tag can be, which the source editor shows as a chip in each tag
that opens its kind's values in each visible presentation, flagging those a pair
has differently, after each render of a type the view each visible presentation
draws it with, and in the first top-level node's chip the page frame
([`drawn-values.ts`](src/lib/client/artifacts/drawn-values.ts)). Views of a type
no visible presentation chose are greyed out. Comparisons align by master step,
showing the previous step on the side that omits one.

Laying a presentation out, the server also describes what each step draws: each
element's box, font, paint and text, and each free layout's places and links,
its ids and anything under a pixel left out
([`library/record.ts`](src/lib/modes/sverlin/library/record.ts)). The two sides
of an assistant's comparison are compared step by step
([`differing-steps.ts`](src/lib/shared/differing-steps.ts)): a pair drawing
alike at every step goes back to the assistant as a comparison it cannot ask,
and the steps where a pair differs are recorded with it: the stage opens the
pair at the first of them and names them under its step counter, with buttons to
the nearest either way, and the assistant is told them with the participant's
messages about the pair.

Choose the visualization mode before a starting template on the Projects page or
in the workspace's **New project** dialog. HTML and HTML/JavaScript modes offer
the blank starter; Sverlin also offers linear search.

Each presentation's **Export** menu lists the render targets its mode offers
([`render-targets.ts`](src/lib/modes/render-targets.ts)); a mode's playback
component offers them. Sverlin renders every target from scene data: each node's
box, look, text lines, and palette names, and each link's curve, in the frame's
logical coordinates. The sandboxed page lays every step out once more in hidden
layers and describes it
([`library/scene.ts`](src/lib/modes/sverlin/library/scene.ts)); the app checks
what it sends ([`scene.ts`](src/lib/modes/sverlin/scene.ts)), then renders a
target in the browser ([`targets/`](src/lib/modes/sverlin/targets/)): a PDF with
a page per step, its text set in the embedded fonts the page drew it in, with
DejaVu for characters none of them has, or the scene data itself as JSON.
Presentations built before scene export cannot describe their steps; build them
again.

Generated JavaScript is compiled but **never executed by the server** or in the
application origin; Sverlin algorithm blocks are interpreted by trusted server
code, not handed to a JavaScript engine. Authored HTML is vetted with
[`sanitize-html`](https://github.com/apostrophecms/sanitize-html); executable
presentations use an opaque-origin, sandboxed iframe and a restrictive
[Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
that blocks external imports, resource loads, and network APIs. A browser
sandbox alone cannot guarantee that arbitrary JavaScript never attempts to
navigate its own frame to an external URL. The static HTML condition forbids
scripts entirely. Source limits and import checks are in the mode build files,
and iframe policy is in [`src/lib/modes/sandbox.ts`](src/lib/modes/sandbox.ts).
Sverlin bundling also restricts module resolution: the entry, authored
component, and library may reach only the Svelte runtime, the injected library,
and the library's own files, so `require()` or any other module request cannot
pull server files into a presentation. HTML/JS only transforms its script and
never resolves modules.

Shared project orchestration lives in
[`src/lib/server/projects/`](src/lib/server/projects/) and its
environment-neutral contracts in
[`src/lib/shared/projects/`](src/lib/shared/projects/). The browser workspace
lives in [`src/lib/client/projects/`](src/lib/client/projects/). Module-specific
code stays under its mode folder; browser-safe contracts do not import server
code.

A **mode** owns the authoring workflow, validation/build implementation, and
playback component. A **build** validates source and prepares a
**presentation**; **playback** displays and steps through that presentation in
the browser. Study conditions select a mode and configure its workspace; a study
run's **kind** distinguishes participant runs from previews. Labels and artifact
formats come from the mode catalogue.

## Development

Use the Dev Container and its checked-in devenv environment.
[`devenv.nix`](devenv.nix) supplies Node 24, pnpm 10, PostgreSQL 17, and the
local process manager. Interactive terminals activate the environment through
[`.envrc`](.envrc); for a non-interactive command, use
`devenv shell -- COMMAND`. If `.env` does not exist, copy
[`.env.example`](.env.example) to `.env` and set `OPENAI_API_KEY` for
AI-assisted editing. Keep personal values out of Git.

In VS Code, install the recommended Svelte extension.
[`.vscode/settings.json`](.vscode/settings.json) enables its TypeScript plugin
so `.ts` files can resolve Svelte components and their props. If component
imports remain marked as missing, run **TypeScript: Restart TS Server** from the
Command Palette. Use `pnpm run check` for project diagnostics; plain `tsc` does
not understand Svelte component declarations.

Server commands (`dev`, `dev:web`, `preview`, and `start`) reload the current
`.env` through [`scripts/run-with-env.sh`](scripts/run-with-env.sh), overriding
stale inherited values. Shells and server launches share
[`scripts/load-env.sh`](scripts/load-env.sh); blank database and authentication
settings receive development defaults only inside devenv. After editing `.env`,
restart the web process (`devenv processes restart web` when managed by devenv);
the process manager and PostgreSQL can stay running. Environment changes require
a new server launch, rather than relying on Vite's hot reload. PostgreSQL tests
keep their isolated database URL because the test runner invokes migrations
directly.

```sh
devenv up                 # PostgreSQL, migration, and the application
devenv down               # stop managed processes
devenv up -d postgres     # PostgreSQL alone for database tests
pnpm run dev              # migrate and run the application when managing PostgreSQL separately
pnpm run dev:web          # run the application when migrations are already current
```

The application uses <http://localhost:5173>. Source edits, type checks,
linting, and tests can run while the development server stays up; Vite applies
source changes through hot reload; the long-lived operation executor dispatches
through the latest loaded command module, so build, assistant, and library edits
reach asynchronous operations, but changes to the executor class itself need a
restart. Reuse that server for browser verification and check listening ports
before starting another. PostgreSQL integration tests use an isolated test
database, as described below. Coordinate changes that require a restart or may
interrupt active work. The web process owns asynchronous work and cancels it on
shutdown; see
[`src/lib/server/runtime-state.ts`](src/lib/server/runtime-state.ts).
`/api/health/ready` reports whether the local process is ready.

The consolidated
[`drizzle/0000_lying_jean_grey.sql`](drizzle/0000_lying_jean_grey.sql) is a
**fresh-database baseline**. It does not migrate projects or credentials from
earlier compiler versions. The local development database was reset for this
branch; any other existing database needs its own deliberate reset before
applying this baseline, followed by new administrator registration. Do not treat
`.devenv/state/postgres` as a disposable build cache. The canonical export
command below is the supported way to inspect complete project histories or
retained operation failures.

```sh
pnpm run check
pnpm run lint
pnpm run test:unit
pnpm run test:postgres
pnpm run test:browser
pnpm run test               # unit, PostgreSQL integration, and browser tests
pnpm run build
pnpm run export:data -- --scope projects
```

`test:postgres` creates an isolated test database and requires only PostgreSQL
to be running. `test:browser` runs what only a browser shows, such as where a
Sverlin step's moves start in two presentations stacked as the comparison view
shows them
([`motion.browser.test.ts`](src/lib/modes/sverlin/motion.browser.test.ts));
devenv provides the browser as `SVERLIN_TEST_BROWSER` on Linux; on macOS, set it
to a local Chrome or Chromium executable.
`pnpm run export:data -- --scope projects --project PROJECT_ID` selects one
project. Exports include complete Timelines, versioned study definitions, and
interaction telemetry where available; see
[`src/lib/server/data-export.ts`](src/lib/server/data-export.ts). Each time a
Sverlin presentation first shows a step, or is still not showing one after 10
seconds, the browser reports how it loaded: the time per layout phase, where its
layout came from, where a stalled page waits, the user agent and device pixel
ratio, and how wide the page set a sample text in each embedded font; see
[`src/lib/shared/presentation-load-timing.ts`](src/lib/shared/presentation-load-timing.ts).
Once the project is quiet, it is recorded as a `visualization.loaded` event,
which changes nothing else, so it is in the export's `project.json` (a viewer
who may not change the project, such as an administrator, records nothing). The
web process also writes it as a `sverlin.presentation-load` JSON line to its log
(devenv's `web` process output), and the browser console shows it as `[sverlin]`
lines. Developer view (`?dev=1`) shows each in the chat as one line, which opens
to the full report with a copy button; participants and the assistant never see
it.

Project and export formats start at version 1. The fresh database baseline uses
`mode` for visualization workflows and `kind` for participant/preview study
runs.

## Study and operations

[`src/lib/studies/main.ts`](src/lib/studies/main.ts) defines the sole main study
(`main-study`, version 1), registered for enrollment in
[`src/lib/shared/study/registry.ts`](src/lib/shared/study/registry.ts). Concrete
study definitions live under `src/lib/studies/`; reusable study contracts,
projections, and interaction schemas remain under
[`src/lib/shared/study/`](src/lib/shared/study/). The main study compares
Svelte-backed `sverlin` in a two-candidate workspace with script-free, per-frame
`html` in a single-candidate workspace. The separate `html-js` mode is not a
study condition. A project outside a study, as an administrator trying one,
works under the condition for its mode in the first study open to enrollment
(`trialCondition` in the registry, applied by `projectTrialCondition` in
[`study.ts`](src/lib/server/study.ts)): its layout, presentation buffer and
chooser. The `sverlin` condition keeps no buffer, so nothing builds pairs in the
background: its stage shows the one version under discussion, and a pair, with
its question, only while one of the assistant's comparisons is current
(`questionPairs` in
[`ProjectWorkspace.svelte`](src/lib/client/projects/ProjectWorkspace.svelte)).
Dev mode shows the newest variants and every pair, so those New pair and Another
variant make show at once. A mode no open study has keeps one presentation and
no buffer, comparing two when an administrator selects them. The protocol
defines the counterbalanced order, 15-minute task duration, and
interaction-capture policy; the comments beside its limits explain their
sampling and delivery tradeoffs.

The stage says what it is waiting for
([`PresentationStage.svelte`](src/lib/client/visualization/PresentationStage.svelte)):
before a project's first version, “Making a first version…” over the blank
starter; with another comparison waiting, an answer is confirmed briefly before
the next pair fades in, its question counted (“Question 2 of 3”); after the last
answer of a set, the pair is held, greyed with “Updating…” and the chosen side
marked, until the turn shows something or ends; and while the assistant works
with no comparison up, the version shown is dimmed slightly with “Updating…”. A
participant's first project opens with a short, skippable introduction to the
interface, reopened from a help button, and one-time hints the first time
comparisons, Choices, version tags or a past moment appear
([`src/lib/client/tour/`](src/lib/client/tour/)), all drawn from one list of the
workspace's parts with plain descriptions per system
([`interface-parts.ts`](src/lib/shared/interface-parts.ts)).

New blank projects start by asking which algorithm to visualise before
authoring, inviting the participant to say who it is for and whether to ask a
few questions first or start with a first version (the algorithm's `opening` in
[`brief.ts`](src/lib/shared/projects/brief.ts), shown in every mode). The
assistants use a bounded five-call ladder: one initial call, up to three
repairs, and a simpler fallback that explains what it reduced. A Sverlin ladder
whose repairs keep failing with new problems stops early, keeping the current
version and saying so (`runAttemptLadder`). Provider retries are disabled. The
default 180-second request ceiling and study deadline bound each attempt; see
[`src/lib/server/chat-bots/attempt-profiles.ts`](src/lib/server/chat-bots/attempt-profiles.ts),
[`src/lib/server/projects/commands.ts`](src/lib/server/projects/commands.ts),
and
[`src/lib/server/projects/operations.ts`](src/lib/server/projects/operations.ts).
Generated source, attempts, diagnostics, accepted artifacts, and presentations
remain in the project Timeline. Each diagnostic records where the code it is
about starts and ends, and the source editor underlines the problems of the
latest build of the source it shows
([`source-diagnostics.ts`](src/lib/client/artifacts/source-diagnostics.ts)).
Interrupted work is explicitly failed and can be retried by the user.

After resetting the database, open the app and register a new administrator
passkey at the one-time setup page. From `/admin`, create a participant, assign
the open study version, and use a preview to verify both conditions before
inviting participants.

## Deployment

The study runs on [Render](https://render.com) from the Blueprint
[`render.yaml`](render.yaml): one always-on Node web service and one managed
PostgreSQL 17 database, about $31 a month in total. The free plans do not fit: a
free web service sleeps when idle, cutting off running operations, and a free
database expires after 30 days.

Once set up, a release is a merge to `main`. The GitHub workflow
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the type check,
lint, unit, and PostgreSQL tests; when they pass, Render builds the commit,
applies migrations (`preDeployCommand`), and switches traffic to the new
instance once `/api/health/ready` answers. A failed build, migration, or health
check leaves the previous version serving. The old instance gets up to five
minutes to finish its operations; any it cannot finish fail and can be retried,
as after any interruption. Avoid releasing during a participant's session. To
roll back, choose an earlier deploy under the service's **Events** and select
**Rollback**; a rollback does not undo migrations.

First setup:

1. In Render, choose **New → Blueprint**, connect the GitHub repository, and
   apply `render.yaml`.
2. Set `BETTER_AUTH_URL` and `ORIGIN` to the service's public URL
   (`https://phd-app.onrender.com`, or another name if Render reports that one
   taken) and `OPENAI_API_KEY`. Render prompts for them only when it creates a
   Blueprint; for resources an existing Blueprint adds, set them in the
   service's **Environment** page. Passkeys are bound to the URL's hostname, so
   add any custom domain before the next step; changing it later means
   registering passkeys again. Render generates `BETTER_AUTH_SECRET`.
3. After the first deploy, open the URL and register the administrator passkey
   at the one-time setup page; then continue as in
   [Study and operations](#study-and-operations).

Later changes to `sync: false` values are made in the service's **Environment**
page, not in `render.yaml`; saving them restarts the service.

The server lays presentations out in V8 isolates (`isolated-vm`, with prebuilt
binaries for Linux, macOS and Windows), which need Node started with
`--no-node-snapshot`: `render.yaml`'s start command, the `dev:web`, `preview`
and `start` scripts, and the tests pass it. Text is measured with `harfbuzzjs`,
WebAssembly, so nothing is compiled on install.

To export research data, copy the database's **External Database URL** from
Render and run
`DATABASE_URL='…' PGSSLMODE=require pnpm run export:data -- --scope projects`
from the Dev Container. Paid Render databases keep a few days of point-in-time
recovery; export regularly during the study to keep your own copy.
