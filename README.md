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
| `sverlin` | One Svelte 5 component (`Main.svelte`) without imports | Each step's scene, drawn by the server from the component, shown and stepped in an isolated browser frame |
| `html`    | A JSON manifest of script-free, complete HTML frames   | Sanitized HTML, one frame per step                                                                        |

For study blinding, the app shows each mode only by its catalogue title (System
A, B), and its pages, passkey dialog, exports and assistants name no product.

Administrator projects offer a blank starter in every mode and one populated
Svelte example, [linear search](src/lib/modes/sverlin/contract.ts). No other
example programs are bundled.

Sverlin components use a small component library without importing it. The
library's Svelte sources live in
[`src/lib/modes/sverlin/library/`](src/lib/modes/sverlin/library/). The
language, blocks and library together, is documented in one guide,
[`src/lib/modes/sverlin/README.md`](src/lib/modes/sverlin/README.md), which the
Sverlin assistant's prompt includes after its instructions in
[`assistant/assistant.md`](src/lib/modes/sverlin/assistant/assistant.md), so
editing either changes the model's guidance. HTML comments in both files are
maintainer notes left out of the prompt, and
[`guide.server.test.ts`](src/lib/modes/sverlin/guide.server.test.ts) builds its
complete examples and checks its `Node` and `Link` props and named values
against the compiler.
[`src/lib/modes/sverlin/assembly/`](src/lib/modes/sverlin/assembly/) holds what
the compiler adds around every authored component: `prelude.ts` is the import
line injected into the module script (its names are reserved), `layout.ts` lays
every step out on the server, and `entry.ts` is the page, which draws the scenes
the server drew (see below). The `sverlin` alias in
[`svelte.config.js`](svelte.config.js) lets the editor resolve the library from
those files. Projects keep the source they were created with, so starter or
library changes do not rewrite existing artifacts.

Sverlin components are written in the language described in that guide:
`domain`, `input`, and algorithm blocks in `<script lang="sverlin">`, followed
by a view drawn only with `<Node>` and `<Link>`: the compiler rejects view
scripts, `<style>`, HTML and SVG elements, text outside a node, and props that
set a look, so every visible thing is selectable and its look is the design's.
The server parses each block with acorn, rejects anything outside a small
JavaScript subset, and runs it in its own interpreter in
[`src/lib/modes/sverlin/algorithm/`](src/lib/modes/sverlin/algorithm/) under
step, operation, size, and string limits. The input and algorithm do not see the
seed, so every presentation of a source shares one master trace; its labels form
the step signature. A presentation is a variant of its source's design space,
which the compiler generates from the markup and the library
([`design.server.ts`](src/lib/modes/sverlin/design.server.ts), options in
[`library/node/design.ts`](src/lib/modes/sverlin/library/node/design.ts)): each
type rendered by name chooses among its views and none (`views.Int`, which the
assistant, the guide and the Choices panel write `{Int}`, and people read
nested, one object per style, group and kind: see
[`design-keys.ts`](src/lib/modes/sverlin/library/node/design-keys.ts)), the page
frame has its values (`Stacked.ratio`, …), and every kind of node, a view and
the tags a node has (`Here[current]`), has a variable per prop, each with a
finite set of options. A kind a node takes only at some steps, by a tag the
state decides, varies paint, text, and inset but not layout or what is shown,
and such a node keeps the largest inset of every kind its tag can be, so nothing
in it moves between steps. A build gives every variable a value: the starter's,
a base variant's where it still fits, randomised (keeping the base's equal
values equal, colours' shades, and what is shown), or chosen (an option the
space lacks, or a variable it does not have, is an error). On Another variant or
New pair (dev mode only, in the top bar beside the Dev switch), and for the
presentations an assistant's `vary` or `resample` with a `count` makes, each
presentation's values are drawn at random from the design space, starting from
the viewed variant and keeping what preferences and the assistant's `vary`
decisions settled ([`choosers.ts`](src/lib/server/projects/choosers.ts)). The
assistant gives alternatives it wants shown as `comparisons` with explicit
values. The assistant is the one author of a turn: its change to the source, or
a `vary` without a `count` (which sets values without changing the source),
shows as one version, its first build, with the viewed variant's values where
they still fit and the starter's for anything new; an `edit` or `revise` may
give `values` of its own over those, which unlike a `vary`'s settle nothing
(every decision writes its values, and each comparison side's, as one JSON
object in a string, nested as the design reads and applied as a JSON Merge
Patch, `null` removing a value; text that is not one object goes back as a slip
of writing:
[`design-patch.server.ts`](src/lib/modes/sverlin/assistant/design-patch.server.ts);
values naming a template as their base, as `"...": "$textbook"`, get the
template written out in full under them, from the JSON files in
[`assistant/templates/`](src/lib/modes/sverlin/assistant/templates/templates.ts);
every design names its base, and a build whose design names none, as a first
version's or a demo example's, gets the starter base written in:
[`withStarterBase`](src/lib/modes/sverlin/design.server.ts)); after a manual
change the first presentation keeps the viewed variant's values and the second
is randomised; a manual change can also edit the viewed variant's choices as
nested JSON (the Choices tab while editing): the values it changes or adds are
built as chosen and those it removes or sets to null are no longer kept, so the
rest still follow what they inherit, their groups and tokens (`choiceEdits`);
refills of the presentation buffer stay random, as most are never shown
([`service.ts`](src/lib/server/projects/service.ts) `basedRequests`). With a
`count` (at most 8, in whole pairs), a `vary` or `resample` makes that many,
each drawn at random around the values the `vary` sets, and queues them in the
presentation buffer: what it held is consumed, the first pair shows, and each
Next pair, or New pair in dev mode, consumes the shown pair to show the next
(`queueBuiltPresentations`, `waitingBehind` in
[`presentation-buffer.ts`](src/lib/shared/projects/presentation-buffer.ts)). A
`vary`, `edit` or `revise` may instead give `comparisons` the assistant designs,
each a question and its two sides, each a short label in the participant's words
and the values it sets: each is built as one pair, both from the viewed variant
(with the `vary`'s values), differing only as its sides do, with no random draw.
The first pair is built alone and shown at once, in place of the decision's one
version, and the rest are built after it, one pair at a time, each queued as
soon as it is built (`presentRemainingComparisons` in
[`turn.server.ts`](src/lib/modes/sverlin/assistant/turn.server.ts)). The
question is stored on the pair's `visualization.presented` events, each with its
side's `label`, and shown above it on the stage and as a card in the chat, each
side by its label; the assistant's context gives a preferred side as its label
(“Cells or tallies? → tallies”), and a preference naming that display set is
read with it in the assistant's context. A comparison may also ask a brief
attribute by showing, naming it and the tag each side stands for (tone:
restrained or bold), stored as each side's `brief`: preferring a side sets the
attribute, inferred, its source the question and the side's label
(`projectBrief` in [`brief.ts`](src/lib/shared/projects/brief.ts)); a tie or
skip sets nothing. A pair is answered by preferring a side (Top or Bottom),
Either (a tie) or Unsure (a skip), all recorded as
`visualization.preference-recorded`, a tie or skip as its `outcome` with no
`preferred`. The card marks each side by the latest answer, a tick beside the
chosen side and a cross beside the other (ticks on both for Either), or a
question mark beside each while it is unanswered or Unsure. Choosing the card
shows its pair on the stage again, to answer it or answer it again (the same
command, so it also rebases on a preferred side and may start a turn); a pair's
latest answer is the one that counts, on its card and in the preference model.
In a picture built from source, a participant can pin a short comment where they
clicked, on the element selected, or both (Comment, on the stage): it waits as a
dashed numbered pin, listed above the message box, until the next message or
answer on that picture carries it as an `annotation` part, then stays a solid
pin there at its step
([`visual-annotations.svelte.ts`](src/lib/client/visualization/visual-annotations.svelte.ts)),
and the assistant reads it as feedback on that design. An answer on one of them
asks the assistant for no turn while others wait (`waitingComparisons`); it sets
aside, as `candidates-advanced` with reason `moot`, those the answer makes moot,
asking the pair just answered, about a variable it settled, or something a value
it settled hides (`mootComparison` in
[`variant-guard.ts`](src/lib/server/projects/variant-guard.ts)), and the answer
that leaves none waiting starts the assistant's turn. A preference model
([`preference-model.ts`](src/lib/server/projects/preference-model.ts)), a
Bayesian Bradley–Terry model with Davidson ties over every choice's options,
fitted from the events on each call, decides what is settled for every random
draw: a choice one option of which is at least 0.9 likely best over two answers,
a `vary` decision's value until an answer goes against it, or, where Either is
fine was its latest answer, the value showing; skips are no evidence. Its
summary
([`preference-summary.ts`](src/lib/server/projects/preference-summary.ts)), each
touched choice's likeliest option, what is most worth asking, what was never
compared, and `showFirst`, the riskiest choice no alternative has shown (a free
layout never compared first, its first automatic layout being a guess, then
views or arrangement), goes in the assistant's context as `preferences`, and so
into each request's recorded prompt. Beside it goes the design brief, `brief`:
the attributes of what the participant is trying to achieve, defined in
[`brief.ts`](src/lib/shared/projects/brief.ts) (intake's questions first, then
those marked `askFirst`, who it is for and the intended learning outcome, what
students should be able to do after seeing it, its verb tagged after those of
intended learning outcomes (notice, trace, explain, compare, apply) to steer,
the first still unknown asked by the reply with the first version and the other
with a later comparison or change, one question in words between things shown;
those marked `later`, as low vision or printing in grey, asked once, late; and
an `assumed` default, as tone's restrained look, steering while unknown; and how
the participant likes to work, `questions` (questions first, a draft first or
fewer questions) and `lead` (suggest alternatives, direct it, or a mix), whose
defaults and steering the context gives as `working`, `lead` asked with the
first alternatives offered), each unknown, inferred or confirmed, from intake's
answers and the `brief` each assistant decision returns, recorded on its
`assistant.responded`; which are worth asking or confirming now, in words or,
for those `brief.ts` marks `asked: "showing"`, by a comparison
(`prompt: "show"`), and, once a question in words has been asked since anything
new was last shown, `next: "show"`, so the next turn shows a change or a
comparison rather than asking again
([`brief-context.ts`](src/lib/server/ai/context/brief-context.ts)); and what the
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
sides alike or drawing alike at every step, or a side hiding the layout itself
or most of the picture (`allowedComparisonSide` in
[`variant-guard.ts`](src/lib/server/projects/variant-guard.ts); unlike a random
draw, the assistant may hide a top-level part such as a title) is recorded as
rejected (`revision.edits-rejected` with `rejected: "comparisons"`) and left
out, costing no repair: the others are built (`kept`), a changed source that
builds showing alone where none can be, and the reply says which were left out;
the next turn reads why in the Timeline. Only a `vary` of the shown source with
no comparison left is repaired, having nothing to show. The assistant's reply,
with its question, is recorded last, once its decision is accepted and has
presented its version (or first comparison pair), so a reply whose decision was
set aside is never shown and the reply, its pill and its question arrive
together; a `candidate-ref` in the reply (slot 0, or a pair's slot 1) and a
question about the new version name what the turn presented. Every presentation
currently shows every master step. Every array and object is made by a
collection or record type the domain block defines, and each step records the
domain type of every value by path beside its plain values. Every view is
rendered on the server inside the page frame,
[`library/Frame.svelte`](src/lib/modes/sverlin/library/Frame.svelte), at a fixed
logical size, and the page draws each step's scene with
[`library/SceneView.svelte`](src/lib/modes/sverlin/library/SceneView.svelte),
fitted to the page as a zoomable, pannable canvas with a dashed outline; the
sandboxed page loads once per presentation and the app sends each later step as
a `sverlin:step` message, and each step's scene as the page asks for it
(`sverlin:scenes-wanted`, `sverlin:scenes`): SceneView moves to it, pairing what
each step draws by the value it draws, and plays a step back as the move on from
that step reversed (`planMove`), so zoom and pan carry over, while
`sverlin:view` messages report the view to the app. Every arrangement is a set
of constraints over a node's measured children, and a node hugs them: rows,
columns, and grids are solved by CSS, with any links drawn over them, while
`layout="free"` is solved by WebCola
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
and the assistant is told it. Arrows are `<Link>` components: the compiler
stamps them like nodes, and each drawn link is selectable and referencable by
its id. Every arrangement draws its choices from a seed of its own, derived from
its kind's `layoutSeed` and its place, so the presentation seed decides no
layout and a layout changes only with those variant values; selections report
each element's surrounding free layouts (arranging node, kind, layout seed,
form, curve) in its `element-ref`, so the assistant can keep a layout the
participant liked by varying those values. Every step is laid out before any is
shown, mounting none of them: each step's markup is drawn with Svelte's string
renderer and laid out on a layout model of its own, from the library's style
sheets and measured text
([`library/model/reserve.ts`](src/lib/modes/sverlin/library/model/reserve.ts)).
The server does this as it builds each presentation
([`layout.server.ts`](src/lib/modes/sverlin/layout.server.ts)), running the
presentation's code in an isolate with no access to the server, bounded in
memory and time, and measuring text with HarfBuzz in the fonts every page embeds
([`fonts/`](src/lib/modes/sverlin/fonts/README.md)), and draws every step's
scene from it
([`library/model/scene-of.ts`](src/lib/modes/sverlin/library/model/scene-of.ts)),
keeping the result by what it was made from. The server's layout is the only
one: the page draws the scenes as given, in the frame and at the scale the
server worked out ([`library/fit.ts`](src/lib/modes/sverlin/library/fit.ts)),
and runs no authored code. A presentation the server cannot lay out, as one too
large or slow to lay out within the isolate's limits or with a character no
embedded face has, fails its build, and the assistant repairs it like a compile
error. The server also measures how large each version draws on a typical stage
([`readability.server.ts`](src/lib/modes/sverlin/readability.server.ts)), from
that same frame and scale, which the assistant sees with each version and gets
back once when its text would be too small to read. Sizes compose bottom up: a
typed component's root keeps its component's box, any other node keeps the
largest size it reaches at any step, laid out with the sizes the nodes inside it
keep, so changing content never resizes a box (inside a component's box, also
for every value the component is sized with, one size every copy shares), every
item of a collection keeps the largest size any of them reaches, so items line
up even when only some change, and each arrangement is solved once over the
union of every step, with every child and link that ever appears
([`library/node/span.ts`](src/lib/modes/sverlin/library/node/span.ts)), the node
holding it sized with it; nodes alike are laid out once. Each step's scene
places children where that solution put them, drawing only that step's links, at
a root fit shared by all steps, so positions are valid across the whole
animation, so a seed gives the same layout for each step whichever step is shown
first, and only what changes moves. The page frame is the root arrangement,
scaled down when it would not fit and up, to 1.6 times, when it would leave the
frame mostly empty. Participants' selections inside the frame reference nodes in
feedback: the compiler stamps every `<Node>` with its tag's `line:column` as the
reserved `__ref` prop, each rendered node gets an id from it, and a keyed node
from its tag and key too, so it keeps its id as other nodes come and go
([`library/type-context.ts`](src/lib/modes/sverlin/library/type-context.ts)),
and SceneView reports selections as `sverlin:selection` messages, which the app
validates and keeps per presentation and step. Feedback records them as
`element-ref` segments at the start of the message; the server checks each id
names a `<Node>` in that presentation's source
([`element-ref.ts`](src/lib/modes/sverlin/element-ref.ts)) and gives the
assistant the tag, its render, and the label the participant saw. A listing's
line also gives its lines in the listing block and the labels round it, and a
click on a token, as `:i[…]`, the token's place; the source panel lights the
same: the line, and its innermost label's code or the token's place
([`listing/source-lines.ts`](src/lib/modes/sverlin/listing/source-lines.ts)).
Otherwise a message is only the participant's words: what was on screen (the
presentation and step viewed, the pair compared, or a source chosen on its own)
is recorded beside it as `feedback.submitted` `viewing`
([`feedback-context.ts`](src/lib/client/timeline/feedback-context.ts)), not
shown in the chat, and given to the assistant as a note before those words. The
compiler stamps every `<Node>` and `<Link>` with its view as `__view`, which
with its `tags` gives its kind, and each node draws the variant's values for its
kind. The compiler injects the library components and every input and algorithm
value, the view each type rendered by name draws, `step`, and `seed` as props.
Presentations record their source's `steps`, each by every name it has, their
`variant`, where each value came from (`origins`), each type's views, and the
kinds each tag can be, which the source editor shows as a chip in each tag that
opens its kind's values in each visible presentation, flagging those a pair has
differently, after each render of a type the view each visible presentation
draws it with, and in the first top-level node's chip the page frame
([`drawn-values.ts`](src/lib/client/artifacts/drawn-values.ts)). Views of a type
no visible presentation chose are greyed out. Comparisons align each side's step
names among the source's steps, showing the previous step on the side that omits
one; presentations of two sources are never shown together.

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
component offers them. Sverlin renders every target from scene data
([`library/scene.ts`](src/lib/modes/sverlin/library/scene.ts)): each node's box,
look, text lines, and palette names, and each link's curve, in the frame's
logical coordinates, as the server draws them for the page. The page fetches a
version's scenes from `/api/projects/[projectId]/scenes`, and an export its file
from `/api/projects/[projectId]/exports`
([`server-scenes.ts`](src/lib/modes/sverlin/server-scenes.ts)). The server
rebuilds the version from its source, seed and variant and keeps the last few
([`scenes.server.ts`](src/lib/modes/sverlin/scenes.server.ts)), and makes each
export from those scenes
([`targets/export.server.ts`](src/lib/modes/sverlin/targets/export.server.ts)):
a PDF with a page per step, its text set in the embedded fonts, with DejaVu for
characters none of them has, or the scene data itself as JSON. A version an
older app built, which a rebuild no longer gives the same page code, has no
scenes: the endpoint answers 409 marked `stale`, and its stage offers whoever
may change the project a Rebuild button. That sends the `rebuild` command with
the version (`presentation`) and its seed, which builds its source again with
its seed and values kept, none drawn anew, as a new presentation of the same
version (build purpose `rebuild`); a source that no longer builds records its
problems, shown under the button. The Timeline keeps the old presentation, and a
comparison or answer stays with the presentations it was given; each side of an
old pair is rebuilt on its own
([`service.ts`](src/lib/server/projects/service.ts)
`buildProjectPresentations`).

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
pull server files into a presentation.

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
to be running. `test:browser` runs what only a browser shows: how the page moves
between steps
([`scene-motion.browser.test.ts`](src/lib/modes/sverlin/scene-motion.browser.test.ts)),
how it is used, and how soon it is ready; what each step draws is tested on the
server's scenes, with no browser
([`testing/scenes.ts`](src/lib/modes/sverlin/testing/scenes.ts)); devenv
provides the browser as `SVERLIN_TEST_BROWSER` on Linux; on macOS, set it to a
local Chrome or Chromium executable. It starts one browser for the run, gives
each test a context of its own, and waits for a presentation's `data-sv-settled`
marker at each step rather than for a fixed time
([`testing/browser.ts`](src/lib/modes/sverlin/testing/browser.ts)); it runs two
files at a time under a 20-minute limit and writes its outcome to
`test-results/browser-summary.txt`. One file runs as
`SVERLIN_RUN_BROWSER_TESTS=1 pnpm exec vitest run --configLoader native FILE`.
`pnpm run export:data -- --scope projects --project PROJECT_ID` selects one
project. Exports include complete Timelines, versioned study definitions, and
interaction telemetry where available, and each `project.json` lists its
presentations by the names the page shows them by, as `3fa2c1/Misty-Falcon-09`
(the source's hash, then its values), which the copy button beside a name, or
Alt+Shift+C for the presentation shown, copies to paste elsewhere; see
[`src/lib/server/data-export.ts`](src/lib/server/data-export.ts). Each
`project.json` also has `aiCosts`: every model call's tokens (input, cached,
written to the cache, output, reasoning) and cost, each operation's and the
project's, and the manifest adds them up across projects; prices are in
[`src/lib/shared/projects/ai-costs.ts`](src/lib/shared/projects/ai-costs.ts).
`warnings-summary.json` counts each build warning code across the exported
projects, each version once by its source: how often, in how many projects, by
model and by what wrote the version (initial, repair, a helper's pick), how
often it sent a version back and how often the next version lacked it, with each
occurrence's generation request, which holds the prompt; see
[`src/lib/server/warning-summary.ts`](src/lib/server/warning-summary.ts).
Developer view shows the project's total in the admin bar, by turn in its menu,
and the web process logs each call as an `ai.call` JSON line and each
operation's total as `ai.turn-cost`. Each time a Sverlin presentation first
shows a step, or is still not showing one after 10 seconds, the browser reports
how it loaded: the time per layout phase, where its layout came from, where a
stalled page waits, the user agent and device pixel ratio, and how wide the page
set a sample text in each embedded font; see
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
`html` in a single-candidate workspace, the only two modes. A project outside a
study, as an administrator trying one, works under the condition for its mode in
the first study open to enrollment (`trialCondition` in the registry, applied by
`projectTrialCondition` in [`study.ts`](src/lib/server/study.ts)): its layout
and presentation buffer. The `sverlin` condition keeps no buffer, so nothing
builds pairs in the background: its stage shows the one version under
discussion, and a pair, with its question, only while one of the assistant's
comparisons is current (`questionPairs` in
[`ProjectWorkspace.svelte`](src/lib/client/projects/ProjectWorkspace.svelte)).
Dev mode shows the newest variants and every pair, so those New pair and Another
variant make show at once. A mode no open study has keeps one presentation and
no buffer, comparing two when an administrator selects them. The protocol
defines the counterbalanced order, 15-minute task duration, and
interaction-capture policy; the comments beside its limits explain their
sampling and delivery tradeoffs.

View helpers are on unless a study condition sets `viewHelpers: false` or an
administrator turns them off for a project in dev mode; each turn records
whether they were on
([`view-helpers-config.ts`](src/lib/server/projects/view-helpers-config.ts)).
When on, a turn runs a helper round after its reply: short calls fill the holes
of a skeleton (another view of a type, another arrangement of a layout, or a
source with holes the assistant wrote), the app builds and measures each fill, a
decision model scores pictures of them into a shortlist, and the designing model
picks which fills go together (skipped for a round of one hole group, which has
nothing to combine). Every stage, its models, the shortlist size and how long
the reply waits are set in one place,
[`helper-pipeline.ts`](src/lib/server/ai/bots/helper-pipeline.ts):
`helpers: false` turns all of it off whatever a condition says, and
`scoring.enabled` or `choosing.enabled` false skips that stage. The pictures
come from the server PDF, drawn by `pdfjs-dist` on `@napi-rs/canvas` (npm
packages, no system package), so the Render host makes them too; if making them
fails, the round skips scoring and ranks by the app's measures.

`firstTurns` sets how the first turns go, from the big picture down. With
`flow`, a first version's reply shows one version and asks a question in words
with up to three answers shown as buttons; the app's round after it tries whole
pictures (one hole in place of the views and layouts), each helper drawing a
different representation that fits the data (cells, bars, a variable table, a
trace table, …), alike pictures kept once, and the follow-up shows them as the
comparison. With `caching`, each answer that names a task gets a round of its
own while the question waits, run once the turn has ended as a background
`prepare-answers` operation that the participant's next action cancels, as it
does a presentation refill, and the reply to that answer is given its candidates
at once.

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
([`interface-parts.ts`](src/lib/shared/interface-parts.ts)). Each system's
assistant is given its system's parts as `interfaceParts` and, asked how to use
the interface, may point at one with an `interface-ref` segment, recorded in its
reply and shown as a pill with the part's name that highlights the part on hover
or click; one its system lacks is recorded as the part's name in words, and a
participant's message cannot carry one.

New blank projects start by asking which algorithm to visualise before
authoring, inviting the participant to say who it is for and whether to ask a
few questions first or start with a first version (the algorithm's `opening` in
[`brief.ts`](src/lib/shared/projects/brief.ts), shown in every mode); every
mode's assistant, asked for questions first, asks who it is for and what
students should be able to do before building, and otherwise builds a first
version. The assistants use a bounded ladder of at most six calls: one initial
call, up to two quick retries on the same fast model where the build refuses the
source as written (each mode sorts its own refusals: Sverlin's
`refusedAsWritten`, HTML's `htmlBuildStages`, so both conditions of the study
have the same ladder and worst case), two repairs at rising effort, and a
simpler fallback that explains what it reduced; any other failure goes to the
repairs at once. A picture that builds goes back for its warnings or its
readability only to a repair, never to the fallback (`softReturnLeft`). A
Sverlin ladder whose repairs keep failing with new problems stops early, keeping
the current version and saying so (`runAttemptLadder`). Where the participant
seems to be struggling to get a point across (an earlier version restored, an
answer to a comparison reversed, the same request again, a question followed by
another, or a short negative judgement pointing at nothing), every mode's first
call steps up from the fast model to GPT-6.1 Sol at medium; the fast call may
also flag the request as unclear (`needsMoreThought`), and the turn then runs
once more stepped up, at most seven calls in all
([`struggle.ts`](src/lib/server/ai/turns/struggle.ts)). Each step up is recorded
on its generation request (`escalation`), on the `ai.call` log line, and in the
developer's views of a turn's calls. Provider retries are disabled. The default
180-second request ceiling and study deadline bound each attempt; see
[`src/lib/server/ai/bots/attempt-profiles.ts`](src/lib/server/ai/bots/attempt-profiles.ts),
[`src/lib/server/ai/turns/attempt-ladder.ts`](src/lib/server/ai/turns/attempt-ladder.ts),
[`src/lib/modes/sverlin/assistant/turn.server.ts`](src/lib/modes/sverlin/assistant/turn.server.ts)
(`refusedAsWritten`, `returnedWarnings`),
[`src/lib/modes/html/assistant/turn.server.ts`](src/lib/modes/html/assistant/turn.server.ts)
(`htmlBuildStages`), and
[`src/lib/server/projects/operations.ts`](src/lib/server/projects/operations.ts).
Generated source, attempts, diagnostics, accepted artifacts, and presentations
remain in the project Timeline. Each diagnostic records where the code it is
about starts and ends, and the source editor underlines the problems of the
latest build of the source it shows
([`source-diagnostics.ts`](src/lib/client/artifacts/source-diagnostics.ts)).
Interrupted work is explicitly failed and can be retried by the user.

After resetting the database, open the app and register a new administrator
passkey at the one-time setup page. Signed in, **Add passkey** on `/admin`
registers another, such as a second security key to recover with; any of them
signs in. From `/admin`, create a participant, assign the open study version,
and use a preview to verify both conditions before inviting participants.

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
