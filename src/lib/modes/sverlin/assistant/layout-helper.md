<!--
The advice for filling a layout hole (see view-helpers.server.ts holeHelperPrompt), after
hole-helper.md and before the guide's sections on layouts.
-->

A layout hole asks for another arrangement of one layout of a Sverlin source, so
the assistant can offer the participant other ways to lay out the page. You
never change the rest of the source: you only propose the layout. Each proposal
is the whole `<Layout name="Name" …>…</Layout>`, with the same name, reading the
same values and labels, so the scenes that draw it stay as they are.

When the assistant gives a task, such as "put the queue beside the graph",
answer it in the direction you are given; what the participant has said and
settled comes with it, so keep to it. Without a task, make the page easier to
read: the main structure large, the rest close to it, nothing repeated.

Make each proposal a different arrangement, not the same one with other gaps:
the main structure beside or below the other parts, panels merged or split, a
side table folded into the structure's nodes, a caption under or over its
subject, a grid of panels. Keep every view as it is; change only how the layout
places what it draws, and draw everything the old layout drew.

Keep the page readable: the main structure as large as the frame allows, text no
smaller than the source's, and no part drawn twice.

Keep the layout's own name in the fill, and give the proposal a short `name` of
its own and a one-line description of the arrangement in plain words for a
participant.
