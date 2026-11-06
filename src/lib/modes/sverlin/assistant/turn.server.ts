/**
 * Sverlin's assistant turn: a model writes or edits the source, which is built and checked, and
 * the turn shows versions and comparisons of their design; with the design values a decision sets,
 * and the build stages the attempt ladder reads. The mode-neutral parts are in $lib/server/ai/turns.
 */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import type { AssistantTurn } from '$lib/modes/assistants.server';
import { InvalidChatbotResponseError } from '$lib/server/ai/providers/types';
import type { EventId, NewProjectEvent, ProjectEvent } from '$lib/shared/projects/events';
import type { ArtifactChange } from '$lib/shared/projects/events/values';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { presentationBufferState } from '$lib/shared/projects/presentation-buffer';
import {
  stepPlaces,
  type DesignValues,
  type RenderablePresentation
} from '$lib/shared/presentations';
import { presentationVariant } from '$lib/shared/presentations';
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { differingSteps } from '$lib/shared/differing-steps';
import { unreadableProblem } from '$lib/shared/readability';
import { cutText } from '$lib/shared/text';
import { modeCatalog } from '$lib/modes/catalog';
import { designOnlyWarning } from '$lib/modes/sverlin/padding-warnings.server';
import { keptKey, writtenKey } from '$lib/modes/sverlin/library/node/design-keys';
import {
  freeLayoutName,
  pageLayoutName,
  mainViewType
} from '$lib/modes/sverlin/assistant/view-helpers.server';
import { turnViewHelpers } from '$lib/server/projects/view-helpers-config';
import { helpersHaveRun } from '$lib/modes/sverlin/assistant/helpers/context.server';
import { type BuildRequest } from '$lib/modes/server';
import {
  projectAiContext,
  projectConversationMessages,
  viewedPresentation,
  type AiContextSelection,
  type AiDesign,
  type AiProjectContext
} from '$lib/server/ai/context/project-context';
import { designVariables } from '$lib/modes/sverlin/assistant/context.server';
import type {
  Chatbot,
  BuildFeedback,
  ChatTurn,
  GeneratedMessageContent,
  SourceArtifactChatOutput,
  ViewHelpersRequest
} from '$lib/server/ai/bots/types';
import type {
  Comparisons,
  SourceDecision,
  SourceDecisionOf
} from '$lib/server/ai/decisions/source-decisions';
import {
  briefAttribute,
  projectBrief,
  type BriefEntry,
  type BriefItem
} from '$lib/shared/projects/brief';
import { briefSteering, type BriefSteering } from '$lib/server/ai/context/brief-context';
import { choiceStates, preferenceEvidence } from '$lib/server/projects/preference-model';
import {
  designPatch,
  readDesignPatch,
  withoutRemoved,
  type DesignPatch
} from '$lib/modes/sverlin/assistant/design-patch.server';
import { applySourceEdits } from '$lib/server/ai/decisions/source-edits';

import { formatDiagnosticSummary } from '$lib/server/projects/diagnostics';
import { recordText } from '$lib/server/projects/fingerprints';
import {
  assertCurrentProjectOperationActive,
  currentProjectOperationSignal
} from '$lib/server/projects/operation-context';
import {
  activateBuiltPresentations,
  appendProjectEvents,
  basedRequests,
  buildProjectSourceBatch,
  draftEvent,
  freshPresentationSeeds,
  queueBuiltPresentations,
  type PairQuestion,
  type RecordedBuild,
  type RecordedBuildBatch
} from '$lib/server/projects/service';
import { offeredOptions } from '$lib/server/projects/choosers';
import {
  answersAfter,
  askedPair,
  allowedComparisonSide,
  mootComparison,
  pictureTree,
  type GuardContext
} from '$lib/server/projects/variant-guard';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';
import type { BuildStages } from '$lib/server/ai/turns/attempt-ladder';
import {
  entrySource,
  hasWorkingVersion,
  keptVersion,
  participantDiagnostic,
  plainFailureSummary,
  replyWithRecovery,
  runAttemptLadder,
  softReturnLeft
} from '$lib/server/ai/turns/attempt-ladder';
import {
  appendAssistantResponse,
  batchSucceeded,
  blankReply,
  firstFailure,
  firstPresentedSet,
  generatedReplyText,
  generationReference,
  recordedQuestion,
  resolveAssistantContent,
  shownSlots,
  validateGeneratedReply,
  validateRecoveryExplanation
} from '$lib/server/ai/turns/replies';
import { appendSystemFailure, assistantBotId } from '$lib/server/ai/turns/failures';
import type { AttemptFailure } from '$lib/server/ai/turns/failures';
import { buildCandidateBatch, shownInRandomOrder } from '$lib/server/ai/turns/comparisons';
import type { ShownComparison } from '$lib/server/ai/turns/comparisons';
import {
  followAfterHelpers,
  prepareAnswers,
  runViewHelpers,
  withViewHelpers
} from '$lib/modes/sverlin/assistant/helpers/rounds.server';
import {
  representationSkeleton,
  representationTask
} from '$lib/modes/sverlin/assistant/skeleton.server';
import { helperPipeline } from '$lib/server/ai/bots/helper-pipeline';
import {
  generationPreparationFailure,
  runPreparedGeneration
} from '$lib/server/ai/turns/generation';
import type { GenerationOutcome } from '$lib/server/ai/turns/generation';

export async function runSverlinAssistantTurn(
  document: ProjectDocument,
  operationId: string,
  contextSelection: AiContextSelection,
  presentationCount: 1 | 2,
  dependencies: ProjectCommandDependencies,
  inReplyTo: readonly EventId[] = []
): Promise<ProjectDocument> {
  const chatbot = dependencies.getChatbot(projectSnapshotAt(document).assistantId);
  // The first presentation keeps the viewed variant's values; every attempt builds the same seeds.
  const viewedVariant = presentationVariant(
    viewedPresentation(document, contextSelection.interactionEventIds ?? [])
  );
  const viewed = Object.keys(viewedVariant).length ? viewedVariant : undefined;
  const turn: ChatTurn =
    entrySource(document) === modeCatalog[projectSnapshotAt(document).mode].starter.source ||
    (contextSelection.interactionEventIds ?? []).some(
      (id) => document.events[id - 1]?.type === 'visualization.runtime-failed'
    )
      ? 'authoring'
      : 'feedback';
  let seeds: number[] = [];
  const failureSummaries: string[] = [];
  let buildFeedback: BuildFeedback | undefined;
  const turnBrief = new Map<BriefEntry['key'], BriefEntry>();
  // Whether a built picture went back to the assistant for a soft problem, text too small to read,
  // warnings, or alternatives it offered none of: one does once a turn, then it shows as built.
  let softReturned = false;
  // What the assistant asked the view helpers to propose views of, where they are on.
  let helperRequest: ViewHelpersRequest | undefined;
  const startedFrom = entrySource(document);
  // With the first-turns flow, a first version is shown alone on purpose, the helpers' whole
  // pictures following as its comparison (helper-pipeline.ts firstTurns.flow).
  const aloneByFlow =
    turnViewHelpers(document) &&
    (dependencies.helperPipeline ?? helperPipeline).firstTurns.flow &&
    startedFrom === modeCatalog[projectSnapshotAt(document).mode].starter.source;

  const done = await runAttemptLadder(
    document,
    operationId,
    chatbot,
    dependencies,
    async (current, attempt) => {
      const generation = await runSverlinGeneration(
        {
          chatbot,
          document: current,
          attempt,
          operationId,
          contextSelection,
          turn,
          presentationCount,
          ...(buildFeedback ? { buildFeedback } : {})
        },
        dependencies
      );
      current = generation.document;
      if (!generation.ok) {
        // The fast first call flagged the request as unclear: it runs again, stepped up.
        if (generation.rethink) return { document: current, done: false, rethink: true };
        if (!generation.retried) return { document: current, done: true };
        // The next attempt repairs what the last usable one left, if anything, told of this one.
        failureSummaries.push(`Attempt ${attempt}: ${generation.message}`);
        if (buildFeedback)
          buildFeedback = { ...buildFeedback, priorFailureSummaries: [...failureSummaries] };
        return { document: current, done: false };
      }
      // What the participant said holds whether or not the decision with it could be built: the
      // brief entries of every attempt this turn, the latest for each attribute, steer this
      // decision's comparisons and are recorded with the accepted reply.
      for (const entry of generation.result.brief ?? []) turnBrief.set(entry.key, entry);
      helperRequest = generation.result.viewHelpers ?? helperRequest;
      const brief = turnBrief.size ? [...turnBrief.values()] : undefined;

      // The reply is recorded last, once its decision is accepted and has presented its version (a
      // comparison's first pair), so the reply of an attempt set aside is never the turn's and the
      // reply, its question, and what it presents arrive together; its candidate-refs, and a
      // question about the new version, name what this turn presented. A blank reply to a change
      // says what the change does instead; the fallback's starts with what it simplified. A note
      // follows what the reply says, as which comparisons were left out. A question asked with
      // comparisons is held back, to be read after them (releaseHeldQuestion).
      const recordReply = (
        document: ProjectDocument,
        presented: readonly RenderablePresentation[] = [],
        note?: string,
        compared = false
      ) => {
        const { reply, decision, recovery } = generation.result;
        const summary = 'summary' in decision ? decision.summary : undefined;
        const question = recordedQuestion(
          document,
          'question' in decision ? decision.question : undefined,
          presented
        );
        const said: GeneratedMessageContent =
          blankReply(reply) && summary ? [{ type: 'markdown', text: summary }] : reply;
        const last = said.at(-1);
        const noted: GeneratedMessageContent = !note
          ? said
          : last?.type === 'markdown'
            ? [...said.slice(0, -1), { type: 'markdown', text: `${last.text.trimEnd()} ${note}` }]
            : [...said, { type: 'markdown', text: note }];
        return appendAssistantResponse(
          document,
          resolveAssistantContent(document, replyWithRecovery(noted, recovery), presented),
          assistantBotId(generation.generationEvent),
          operationId,
          dependencies,
          inReplyTo,
          {
            ...(question ? (compared ? { heldQuestion: question } : { question }) : {}),
            ...(brief ? { brief } : {})
          }
        );
      };

      // The source each decision asks to build, if any. Edits apply to the source being revised:
      // the failed candidate when repairing it.
      const { decision } = generation.result;
      // The assistant designs every alternative as a comparison, so no chooser fills presentations it
      // did not design: a count goes back to it once to redesign, and after that is ignored.
      const queued: number | undefined = undefined;
      const counted = 'count' in decision && Boolean(decision.count);
      // A decision that cannot be built as given is recorded, as a failed build is, so the Timeline
      // holds every candidate set aside, and the next attempt repairs it.
      const reject = async (
        kind:
          | 'edits'
          | 'values'
          | 'comparisons'
          | 'picture'
          | 'warnings'
          | 'alternatives'
          | 'helpers',
        problems: string[],
        failedSource: string
      ) => {
        const outcome = {
          edits: 'the edits could not be applied',
          values: 'the design values could not be read',
          comparisons: 'the comparisons could not be built',
          picture: 'the picture drew too large to read',
          warnings: 'the picture built with warnings',
          alternatives: 'the picture offers alternatives no comparison showed',
          helpers: 'the view helpers were not asked for the graphics requested'
        }[kind];
        const summary = `Attempt ${attempt}: ${outcome}. ${problems.join(' ')}`;
        failureSummaries.push(summary);
        current = await appendProjectEvents(
          current,
          [
            draftEvent({
              type: 'revision.edits-rejected',
              actor: { kind: 'system' },
              operationId,
              payload: {
                attempt,
                ...generationReference(current, operationId),
                ...(kind === 'edits' ? {} : { rejected: kind }),
                problems
              }
            })
          ],
          dependencies.projectService
        );
        if (attempt === chatbot.config.attemptProfiles.length) {
          return {
            document: await appendExhaustedSverlinFailure(
              current,
              operationId,
              summary,
              dependencies
            ),
            done: true
          };
        }
        buildFeedback = {
          attempt,
          buildEventId: projectHead(current).id,
          failedSource,
          assistantReply: generatedReplyText(generation.result.reply),
          diagnostics: [
            ...problems.map((message) => ({
              severity:
                kind === 'warnings' || kind === 'alternatives' || kind === 'helpers'
                  ? ('warning' as const)
                  : ('error' as const),
              code: {
                edits: 'edit_not_applied',
                values: valuesUnreadable,
                comparisons: 'comparison_not_built',
                picture: 'picture_unreadable',
                warnings: 'picture_warning',
                alternatives: 'alternatives_not_offered',
                helpers: 'helpers_not_asked'
              }[kind],
              message,
              raw: message
            }))
          ],
          priorFailureSummaries: [...failureSummaries]
        };
        // Values written wrong are a slip as a source refused as written is (see refusedAsWritten).
        return {
          document: current,
          done: false,
          ...(kind === 'values'
            ? { failure: { source: failedSource, diagnostics: buildFeedback.diagnostics } }
            : {})
        };
      };
      // The pairs a decision's comparisons ask, each built as given, and whether they were checked
      // against the design before building: a changed source's design is known only once built.
      let pairs: ShownComparison[] | undefined;
      let checked = false;
      let candidate: string | undefined;
      let variant: { base?: DesignValues; chosen?: DesignValues; randomise?: string[] | true } = {
        base: viewed
      };
      // Of comparisons some of which cannot be built as given (problems, by comparison), the others
      // are built without them, a source that builds showing alone where none can be, and the reply
      // says which were left out; the Timeline tells the next turn why. A comparison costs no repair:
      // only a vary of the shown source, with no comparison left, has nothing to show and is repaired.
      let leftOut: string | undefined;
      const droppedQuestions: string[] = [];
      const screen = async (problems: string[][]) => {
        if (!pairs || candidate === undefined || !problems.flat().length) return undefined;
        const asked = pairs;
        const kept = asked.flatMap((pair, index) => (problems[index]?.length ? [] : [index]));
        const list = (items: string[]) =>
          new Intl.ListFormat('en', { type: 'conjunction' }).format(items);
        if (!kept.length && candidate === entrySource(current))
          return reject('comparisons', problems.flat(), candidate);
        const dropped = asked.flatMap((pair, index) => (problems[index]?.length ? [pair] : []));
        current = await appendProjectEvents(
          current,
          [
            draftEvent({
              type: 'revision.edits-rejected',
              actor: { kind: 'system' },
              operationId,
              payload: {
                attempt,
                ...generationReference(current, operationId),
                rejected: 'comparisons',
                problems: problems.flat(),
                kept: kept.map((index) => index + 1)
              }
            })
          ],
          dependencies.projectService
        );
        pairs = kept.length ? kept.map((index) => asked[index]) : undefined;
        droppedQuestions.push(...dropped.map(({ question }) => `“${question}”`));
        leftOut = `I left out ${list(droppedQuestions)}, which could not be built as asked.`;
        return undefined;
      };
      if (counted && attempt === 1)
        return reject(
          'comparisons',
          [
            'A count is not built: design the alternatives yourself as comparisons, three or four pairs across families, each asking what it shows, and leave count null.'
          ],
          buildFeedback?.failedSource ?? entrySource(current)
        );
      // Values that are not one JSON object go back to be written again before anything is built.
      const unreadableDesign = unreadableValues(decision);
      if (unreadableDesign.length)
        return reject(
          'values',
          unreadableDesign,
          decision.action === 'revise'
            ? decision.source
            : (buildFeedback?.failedSource ?? entrySource(current))
        );
      switch (decision.action) {
        case 'respond':
          break;
        case 'resample':
          if (queued) {
            candidate = entrySource(current);
            variant = { base: viewed, randomise: true };
          }
          break;
        case 'revise':
          candidate = decision.source;
          variant = sourceValues(viewed, decision);
          pairs = decision.comparisons ?? undefined;
          break;
        case 'vary': {
          candidate = buildFeedback?.failedSource ?? entrySource(current);
          variant = variedValues(viewed, decision);
          pairs = decision.comparisons ?? undefined;
          if (!pairs || candidate !== entrySource(current)) break;
          const screened = await screen(
            comparisonProblems(
              pairs,
              designVariables(
                viewedPresentation(current, contextSelection.interactionEventIds ?? [])
              ),
              {
                tree: pictureTree(candidate),
                base: { ...variant.base, ...variant.chosen },
                settled: {}
              },
              briefSteering(projectBrief(current.events, brief))
            )
          );
          if (screened) return screened;
          checked = true;
          break;
        }
        case 'edit': {
          const base = buildFeedback?.failedSource ?? entrySource(current);
          const edited = applySourceEdits(base, decision.edits);
          if ('problems' in edited) return reject('edits', edited.problems, base);
          candidate = edited.source;
          variant = sourceValues(viewed, decision);
          pairs = decision.comparisons ?? undefined;
          break;
        }
        default:
          throw new Error(
            `Unhandled decision ${(decision satisfies never as { action: string }).action}.`
          );
      }
      if (pairs) pairs = shownInRandomOrder(pairs, dependencies.comparisonOrder);
      if (candidate === undefined) {
        if (attempt === 1) {
          const advanced =
            decision.action === 'resample'
              ? await advanceCandidatesForAgent(
                  current,
                  presentationCount,
                  operationId,
                  dependencies
                )
              : { document: current, presentations: [] };
          return {
            document: await recordReply(advanced.document, advanced.presentations),
            done: true
          };
        }
        failureSummaries.push(`Attempt ${attempt} did not return corrected source.`);
        if (!buildFeedback || attempt === chatbot.config.attemptProfiles.length) {
          return {
            document: await appendExhaustedSverlinFailure(
              current,
              operationId,
              failureSummaries.at(-1),
              dependencies
            ),
            done: true
          };
        }
        buildFeedback = {
          ...buildFeedback,
          attempt,
          assistantReply: generatedReplyText(generation.result.reply),
          priorFailureSummaries: [...failureSummaries]
        };
        return { document: current, done: false };
      }

      // Every attempt builds the same seeds, more of them when a decision asks for more: a decision
      // without comparisons or a count presents one version.
      const size = pairs ? pairs.length * 2 : (queued ?? 1);
      if (seeds.length < size)
        seeds = [...seeds, ...freshPresentationSeeds(size - seeds.length, seeds)];
      const batchSeeds = seeds.slice(0, size);
      const randomised = variant.randomise;
      // Comparisons build their first pair alone, so it shows before the rest are built; one whose
      // sides draw alike, or that cannot be built, gives way to the next, the source alone after the last.
      let built: Awaited<ReturnType<typeof buildCandidateBatch>>;
      // The steps at which the first pair's sides draw differently, where the server laid them out.
      let differsAt: number[] | undefined;
      for (;;) {
        const requests = pairs
          ? comparisonRequests(batchSeeds, variant.base, variant.chosen ?? {}, pairs.slice(0, 1))
          : basedRequests(
              batchSeeds.slice(0, queued ?? 1),
              variant.base,
              variant.chosen,
              randomised === true
            ).map((request, index) =>
              index === 0 && Array.isArray(randomised) && randomised.length
                ? { ...request, variant: { ...request.variant, randomise: randomised } }
                : request
            );
        built = await buildCandidateBatch(
          { document: current, candidate, requests, operationId, attempt },
          dependencies
        );
        current = built.document;
        const [first] = built.recorded.builds;
        if (!pairs) break;
        const asked = pairs[0];
        if (!batchSucceeded(built.recorded) || !first?.result.ok) {
          // A value the first comparison sets that the source does not offer leaves it out; any
          // other failure is the source's.
          const unoffered = designValueProblems(built.recorded).map(
            (problem) => `Comparison 1 (“${asked.question}”): ${problem}`
          );
          const screened = unoffered.length
            ? await screen(pairs.map((_, index) => (index ? [] : unoffered)))
            : undefined;
          if (screened) return screened;
          if (pairs?.[0] === asked) break;
          continue;
        }
        const guard = {
          tree: pictureTree(candidate),
          base: { ...variant.base, ...variant.chosen },
          settled: {}
        };
        // A changed source's design is known only once built; a vary's was checked before.
        const problems = checked
          ? pairs.map((): string[] => [])
          : comparisonProblems(
              pairs,
              designVariables(first.result.bundle),
              guard,
              briefSteering(projectBrief(current.events, brief))
            );
        checked = true;
        differsAt = pairDifferences(built.recorded.builds);
        if (differsAt?.length === 0) problems[0].push(drawnAlikeProblem(pairs[0], guard.base));
        const screened = await screen(problems);
        if (screened) return screened;
        if (pairs?.[0] === asked) break;
      }
      // A picture whose text would be too small to read on a typical stage, or one built with
      // warnings, goes back once a turn, with a repair left to show less at once or to settle the
      // warnings; after that it shows as built. Readability goes first, as it stops the picture
      // being read at all. It never takes the fallback, which simplifies what was asked and says
      // so: in project a60d96ec a working merge sort sent back for repeated steps at the third of
      // four attempts lost its return pauses, and its reply began with a difficulty.
      const returnable =
        candidate !== undefined &&
        !softReturned &&
        softReturnLeft(chatbot.config.attemptProfiles, attempt) &&
        batchSucceeded(built.recorded);
      const bundles = returnable
        ? built.recorded.builds.flatMap(({ result }) => (result.ok ? [result.bundle] : []))
        : [];
      const unreadable = bundles
        .flatMap(({ readability }) => (readability ? [readability] : []))
        .map(unreadableProblem)
        .find((problem) => problem !== undefined);
      if (unreadable && candidate !== undefined) {
        softReturned = true;
        return reject('picture', [unreadable], candidate);
      }
      const warnings = returnedWarnings(
        [...new Set(bundles.flatMap(({ warnings = [] }) => warnings))],
        !hasWorkingVersion(current)
      );
      if (warnings.length && candidate !== undefined) {
        softReturned = true;
        return reject('warnings', warnings, candidate);
      }
      // A request for particular graphics, where the helpers are on, goes back once to give them a
      // task too, beside the assistant's own alternatives.
      const unhelped =
        bundles.length > 0 &&
        !generation.result.viewHelpers &&
        turnViewHelpers(current) &&
        asksForGraphics(turnRequestText(current.events));
      if (unhelped && candidate !== undefined) {
        softReturned = true;
        return reject('helpers', [helpersProblem], candidate);
      }
      // A new or changed picture shown alone, where its source offers another form of a view, a
      // pointer or a free layout's arrangement, goes back once to offer a comparison; one the
      // participant directs is made as asked.
      const alternatives =
        !aloneByFlow &&
        !pairs &&
        !droppedQuestions.length &&
        (decision.action === 'revise' || decision.action === 'edit') &&
        bundles[0]
          ? unofferedAlternatives(
              bundles[0],
              new Set(choiceStates(preferenceEvidence(current.events)).keys()),
              shownForms(current)
            )
          : undefined;
      if (
        alternatives &&
        candidate !== undefined &&
        !directed(projectBrief(current.events, brief))
      ) {
        softReturned = true;
        return reject('alternatives', [alternatives], candidate);
      }
      if (batchSucceeded(built.recorded)) {
        // The assistant is the one author of a new or edited source: its first build stands, the
        // further variants a vary or resample with a count queues drawn at random in it.
        const shown = { document: current, recorded: built.recorded };
        current = shown.document;
        assertCurrentProjectOperationActive();
        const acceptedAfter = projectHead(current).id;
        current = await acceptSverlinCandidate(
          {
            document: current,
            recorded: shown.recorded,
            generationEvent: generation.generationEvent,
            candidate,
            ...('summary' in decision ? { summary: decision.summary } : {}),
            operationId,
            ...(pairs
              ? { setSize: 2 as const, pairs: [pairQuestion(pairs[0], differsAt)] }
              : queued
                ? { setSize: presentationCount }
                : {})
          },
          dependencies
        );
        // The reply names the first pair's sides in the assistant's order, whichever shows on top.
        const presented = firstPresentedSet(current, acceptedAfter);
        current = await recordReply(
          current,
          pairs?.[0]?.swapped ? [presented[1], presented[0], ...presented.slice(2)] : presented,
          leftOut,
          pairs !== undefined
        );
        if (pairs)
          current = await presentRemainingComparisons(
            {
              document: current,
              candidate,
              pairs,
              seeds: batchSeeds,
              viewed: variant.base,
              values: variant.chosen ?? {},
              operationId,
              attempt,
              actor: generation.generationEvent.actor
            },
            dependencies
          );
        return { document: current, done: true };
      }

      const failed = firstFailure(built.recorded);
      if (!failed || failed.buildEvent.type !== 'build.failed') {
        throw new Error('A failed build batch had no failure event.');
      }
      const summary = formatDiagnosticSummary(failed.result.diagnostics);
      failureSummaries.push(`Attempt ${attempt}: ${summary}`);
      if (!failed.buildEvent.payload.repairEligible) {
        return {
          document: await appendSystemFailure(
            current,
            `The proposed visualization could not be checked safely, so I kept the last working visualization. The remaining difficulty was: ${plainFailureSummary(participantDiagnostic(failed.result.diagnostics))}`,
            operationId,
            dependencies
          ),
          done: true
        };
      }
      if (attempt === chatbot.config.attemptProfiles.length) {
        return {
          document: await appendExhaustedSverlinFailure(
            current,
            operationId,
            participantDiagnostic(failed.result.diagnostics),
            dependencies
          ),
          done: true
        };
      }
      buildFeedback = {
        attempt,
        buildEventId:
          current.events.findLast(
            (event) => event.operationId === operationId && event.type === 'build.failed'
          )?.id ?? projectHead(current).id,
        failedSource: candidate,
        assistantReply: generatedReplyText(generation.result.reply),
        diagnostics: failed.result.diagnostics,
        priorFailureSummaries: [...failureSummaries]
      };
      return {
        document: current,
        done: false,
        failure: { source: candidate, diagnostics: failed.result.diagnostics }
      };
    },
    sverlinBuildStages
  );
  // After a first version, the helpers propose views of its main type; else of the type asked.
  if (!turnViewHelpers(done)) return done;
  const source = entrySource(done);
  const starter = modeCatalog[projectSnapshotAt(done).mode].starter.source;
  const firstVersion = startedFrom === starter && source !== starter;
  // A first version's riskiest choice goes to the helpers: the arrangement of a page drawing a
  // graph or tree, a first automatic layout being a guess, else how its main type is drawn. So
  // does a version's next turn after the helpers are switched on, where no round has run yet.
  const unexplored = firstVersion || !helpersHaveRun(done);
  // A round the app starts takes its task from what the participant asked this turn, the reply
  // having asked the helpers or not: a request for graphics, as "other ways to show which vertices
  // are done", goes to the view helpers on the type it names; one about the arrangement, as "try
  // lots of different layouts", to the layout helpers. Only with no such request does a first
  // round take the riskiest choice (project 5cb84e44's first round rearranged its page while the
  // participant had asked how done vertices look).
  const asked = turnRequestText(done.events);
  const task = asked ? cutText(asked.replace(/\s+/g, ' ').trim(), 300) : undefined;
  const askedType = asksForGraphics(asked)
    ? (typeNamedIn(asked, source) ?? mainViewType(source))
    : undefined;
  const askedLayout = asksForLayouts(asked) ? pageLayoutName(source) : undefined;
  // With the first-turns flow, a first version's round tries whole pictures instead, which its
  // follow-up offers as the comparison the reply left out (helper-pipeline.ts firstTurns.flow).
  const pipeline = dependencies.helperPipeline ?? helperPipeline;
  const wholePicture =
    pipeline.firstTurns.flow && firstVersion ? representationSkeleton(source) : undefined;
  const firstLayout = unexplored ? freeLayoutName(source) : undefined;
  const firstType = unexplored ? mainViewType(source) : undefined;
  const request: ViewHelpersRequest | undefined =
    helperRequest ??
    (askedType
      ? { type: askedType, ...(task ? { task } : {}) }
      : askedLayout
        ? { layout: askedLayout, ...(task ? { task } : {}) }
        : wholePicture
          ? { skeleton: wholePicture, task: representationTask }
          : firstLayout
            ? { layout: firstLayout }
            : firstType
              ? { type: firstType }
              : undefined);
  if (source === starter) return done;
  if (!request) return prepareAnswers(done, operationId, source, dependencies);
  const helped = await runViewHelpers(done, operationId, source, request, dependencies);
  const followed = await followAfterHelpers(helped, operationId, contextSelection, dependencies);
  return followed.events.length > helped.events.length
    ? followed
    : prepareAnswers(followed, operationId, source, dependencies);
}

export async function runSverlinGeneration(
  options: {
    chatbot: Chatbot<AiProjectContext, SourceArtifactChatOutput>;
    document: ProjectDocument;
    attempt: number;
    operationId: string;
    contextSelection: AiContextSelection;
    turn: ChatTurn;
    presentationCount: 1 | 2;
    buildFeedback?: BuildFeedback;
  },
  dependencies: ProjectCommandDependencies
): Promise<GenerationOutcome<SourceArtifactChatOutput>> {
  let prompt;
  try {
    prompt = await options.chatbot.preparePrompt({
      messages: projectConversationMessages(options.document.events),
      project: withViewHelpers(
        projectAiContext(options.document, options.contextSelection),
        options.document
      ),
      attempt: options.attempt,
      turn: options.turn,
      ...(options.buildFeedback ? { buildFeedback: options.buildFeedback } : {})
    });
  } catch (error) {
    return generationPreparationFailure(options, error, dependencies);
  }
  return runPreparedGeneration(
    {
      document: options.document,
      attempt: options.attempt,
      operationId: options.operationId,
      prompt,
      attemptsLeft: options.attempt < options.chatbot.config.attemptProfiles.length,
      generate: () =>
        options.chatbot.generatePrepared(prompt, { signal: currentProjectOperationSignal() }),
      validateResult: (result) => {
        validateRecoveryExplanation(prompt, result.recovery, result.providerResponse);
        // Only the fallback explains a simplification; one any other attempt gives is not shown.
        if (prompt.attempt.purpose !== 'fallback') result.recovery = undefined;
        if (
          options.contextSelection.interactionEventIds?.some(
            (id) => options.document.events[id - 1]?.type === 'visualization.preference-recorded'
          ) &&
          result.decision.action === 'resample'
        ) {
          throw new InvalidChatbotResponseError(
            'A deferred preference adaptation cannot advance candidates itself.',
            result.providerResponse
          );
        }
        validateGeneratedReply(
          result.reply,
          shownSlots(result.decision, options.presentationCount),
          result.providerResponse
        );
        if (
          (result.decision.action === 'respond' || result.decision.action === 'resample') &&
          blankReply(result.reply)
        )
          throw new InvalidChatbotResponseError('The reply was blank.', result.providerResponse);
      },
      fallbackResponse: (result) => ({
        reply: result.reply,
        decision: result.decision,
        brief: result.brief ?? null,
        recovery: result.recovery ?? null,
        generation: result.generation
      })
    },
    dependencies
  );
}

/**
 * Two builds per comparison, both from the viewed variant with the vary's values, each side with
 * the values it sets and nothing else drawn, so the pair differs only as the comparison asks.
 */
export function comparisonRequests(
  seeds: readonly number[],
  viewed: DesignValues | undefined,
  values: DesignValues,
  pairs: Comparisons
): BuildRequest[] {
  return pairs.flatMap(({ left, right }, index) =>
    [left, right].map((side, slot) => {
      // A side's null returns that value to its level on this side alone.
      const base = withoutPatched(viewed, side.values);
      return {
        seed: seeds[index * 2 + slot],
        variant: {
          ...(base ? { base } : {}),
          chosen: { ...values, ...designValues(side.values) }
        }
      };
    })
  );
}

/**
 * What a built picture's source offers that a comparison could show, as one message, or undefined:
 * a type drawn by one of several views, a pointer drawn by one of several pointer views, and a free
 * layout's arrangement; none the participant has already answered, as Cells or bars asked again
 * when they asked for something else.
 */
export function unofferedAlternatives(
  bundle: {
    views?: Record<string, string[]>;
    pointers?: Record<string, string[]>;
    variant?: Record<string, unknown>;
  },
  answered: ReadonlySet<string> = new Set(),
  shown: { views?: Record<string, string[]>; pointers?: Record<string, string[]> } = {}
): string | undefined {
  // Only forms new in this version: one the shown version already offered was the assistant's to
  // compare then, and asking again on every later change cost a model call a turn (9c06eb82).
  const same = (before: string[] | undefined, now: string[]) => before?.join() === now.join();
  const forms = [
    ...Object.entries(bundle.views ?? {})
      .filter(([type, views]) => !same(shown.views?.[type], views))
      .filter(([type, views]) => views.length > 1 && !answered.has(`views.${type}`))
      .map(([type, views]) => `${type} as ${views.join(' or ')} (views.${type})`),
    ...Object.entries(bundle.pointers ?? {})
      .filter(([type, views]) => !same(shown.pointers?.[type], views))
      .filter(([type, views]) => views.length > 1 && !answered.has(`pointers.${type}`))
      .map(([type, views]) => `the ${type} pointer as ${views.join(' or ')} (pointers.${type})`),
    ...Object.keys(bundle.variant ?? {})
      .filter((key) => key.endsWith('.layoutSeed') && shown.views === undefined)
      .map((key) => key.slice(0, -'.layoutSeed'.length))
      .filter((kind) => !answered.has(`${kind}.direction`) && !answered.has(`${kind}.layoutSeed`))
      .map((kind) => `the arrangement of ${kind} (${kind}.direction, ${kind}.layoutSeed)`)
  ];
  return forms.length
    ? `This version is shown alone, but its source offers other forms: ${forms.join('; ')}. Offer a comparison of the one most worth choosing, or send the source again if one form is clearly right.`
    : undefined;
}

/**
 * The type of the source a request names, as "vertices" or "Vertex" for a type Vertex: a domain
 * type whose name, or its plural, the request uses as a word. None where it names none.
 */
export function typeNamedIn(text: string, source: string): string | undefined {
  const domain = /<script domain>([\s\S]*?)<\/script>/u.exec(source)?.[1] ?? '';
  const types = [...domain.matchAll(/\bconst\s+([A-Z]\w*)\s*=/gu)].map(([, name]) => name);
  const words = new Set(text.toLowerCase().match(/[a-z]+/gu) ?? []);
  const plurals = (name: string) => [
    `${name}s`,
    `${name}es`,
    name.replace(/y$/u, 'ies'),
    name.replace(/(ex|ix)$/u, 'ices')
  ];
  return types.find((name) => {
    const lower = name.toLowerCase();
    return words.has(lower) || plurals(lower).some((plural) => words.has(plural));
  });
}

/** The view and pointer choices the version shown offers, none before a first version. */
export function shownForms(document: ProjectDocument): {
  views?: Record<string, string[]>;
  pointers?: Record<string, string[]>;
} {
  const shown =
    projectSnapshotAt(document).activePresentationSet?.presentations[0]?.payload.presentation;
  return shown?.format === 'browser-bundle-v1'
    ? { views: shown.views ?? {}, pointers: shown.pointers ?? {} }
    : {};
}

/**
 * Words a request for particular graphics uses, as "icons for states" or "try some drawings": few
 * and plain, so a request about pacing or wording never sends the reply back.
 */
export const graphicsWords =
  /\b(icons?|symbols?|emoji|drawings?|pictures?|images?|graphics?|glyphs?|badges?|shapes?|try (some|a few|other|different))\b/iu;

export function asksForGraphics(text: string): boolean {
  return graphicsWords.test(text);
}

/** Words a request about the page's arrangement uses, as "try lots of different layouts". */
export const layoutWords =
  /\b(layouts?|arrangements?|arrange|rearrange|placement|sparse|spread out|cramped|crowded)\b/iu;

export function asksForLayouts(text: string): boolean {
  return layoutWords.test(text);
}

export const helpersProblem =
  'The participant asked for particular graphics and the view helpers are on: set viewHelpers to the type the request is about, with a short task saying what its views should show, beside your own alternatives; or send the decision again unchanged if no type fits.';

/** What the participant wrote for the turn now running: its messages, and notes with answers. */
export function turnRequestText(events: readonly ProjectEvent[]): string {
  const started = events.findLast((event) => event.type === 'assistant.turn-started');
  if (started?.type !== 'assistant.turn-started') return '';
  const asked = new Set(started.payload.interactionEventIds ?? []);
  return events
    .flatMap((event) =>
      !asked.has(event.id)
        ? []
        : event.type === 'feedback.submitted'
          ? event.payload.content
          : event.type === 'visualization.preference-recorded'
            ? (event.payload.comment ?? [])
            : []
    )
    .flatMap((segment) => (segment.type === 'markdown' ? [segment.text] : []))
    .join(' ');
}

/** Whether the participant directs: they would rather say what they want than choose. */
export function directed(brief: readonly BriefItem[]): boolean {
  const lead = brief.find(({ key }) => key === 'lead');
  return (
    lead?.status !== undefined &&
    lead.status !== 'unknown' &&
    Boolean(lead.tags?.includes('direct'))
  );
}

export function pairQuestion(
  { question, left, right, brief, swapped }: ShownComparison,
  differsAt?: readonly number[]
): PairQuestion {
  return {
    question,
    labels: [left.label, right.label],
    ...(brief ? { brief: { key: brief.attribute, tags: [brief.left, brief.right] } } : {}),
    ...(differsAt ? { differsAt } : {}),
    ...(swapped ? { swapped } : {})
  };
}

/**
 * The steps, by the left side's, at which a pair's two builds draw differently, from what the server
 * laid out (see ModeBuildResult's drawn), matched by where each falls among the source's steps.
 * Sides pausing differently compare at the steps both show; where those all draw alike, the sides
 * still differ at the steps one alone shows, so that is left unknown rather than told as alike.
 * Unknown too where either was not laid out, or they are of two sources.
 */
export function pairDifferences(builds: readonly RecordedBuild[]): number[] | undefined {
  const [left, right] = builds.map(({ result }) => (result.ok ? result.bundle : undefined));
  if (!left?.steps || !right?.drawn || left.stepSignature !== right.stepSignature) return undefined;
  if (JSON.stringify(left.labels) === JSON.stringify(right.labels))
    return differingSteps(left.drawn, right.drawn);
  const [leftPlaces, rightPlaces] = [left, right].map(({ labels }) =>
    stepPlaces(left.steps ?? [], labels)
  );
  if (!left.drawn || !leftPlaces || !rightPlaces) return undefined;
  const rightDrawn = new Map(rightPlaces.map((place, step) => [place, right.drawn?.[step]]));
  const differs = leftPlaces.flatMap((place, step) =>
    rightDrawn.has(place) && rightDrawn.get(place) !== left.drawn?.[step] ? [step] : []
  );
  return differs.length ? differs : undefined;
}

/** Why a comparison whose two sides draw the same picture at every step cannot be asked. */
export function drawnAlikeProblem(
  { question, left, right }: Comparisons[number],
  base: DesignValues
): string {
  const sides = [designValues(left.values), designValues(right.values)];
  const changed = Object.keys({ ...sides[0], ...sides[1] }).filter(
    (variable) => (sides[0][variable] ?? base[variable]) !== (sides[1][variable] ?? base[variable])
  );
  const named = new Intl.ListFormat('en', { type: 'conjunction' }).format(changed);
  return `Comparison 1 (“${question}”): its two sides draw the same at every step: ${named} ${changed.length > 1 ? 'change' : 'changes'} nothing visible here. Compare a choice that shows, or leave it out.`;
}

/** Why a comparison cannot ask the brief attribute it names by showing, if it cannot. */
export function comparisonBriefProblem({ brief }: Comparisons[number]): string | undefined {
  if (!brief) return undefined;
  const tags = Object.keys(briefAttribute(brief.attribute).tags ?? {});
  const unnamed = [brief.left, brief.right].filter((tag) => !tags.includes(tag));
  if (unnamed.length)
    return `${brief.attribute} has no tag ${unnamed.map((tag) => JSON.stringify(tag)).join(' or ')}; its tags are ${tags.join(', ')}.`;
  if (brief.left === brief.right) return `its two sides stand for the same ${brief.attribute}.`;
  return undefined;
}

/** The values a decision's patch sets, as kept (see design-patch.server.ts), as a build chooses them. */
export function designValues(values: unknown): DesignValues {
  // Keys as written or kept, kept (see design-keys.ts): {Int} is views.Int, <Listing>.syntax
  // listing.syntax; the build sends a place's view to its pointer where only that is in the design.
  return Object.fromEntries(
    designPatch(values).set.map(({ variable, value }) => [keptKey(variable), value])
  ) as DesignValues;
}

/** A variant without the values decisions' patches remove with null, which return to their level. */
export function withoutPatched(
  base: DesignValues | undefined,
  ...patches: unknown[]
): DesignValues | undefined {
  const remove = patches.flatMap((values) => designPatch(values).remove);
  return withoutRemoved(
    base,
    remove,
    (key) => keptKey(key),
    (key) => writtenKey(key)
  );
}

/**
 * Why a decision's values cannot be read, each where it is: text that is not JSON or not one
 * object (see readDesignPatch). Checked before anything is built, so the rest read them safely.
 */
export function unreadableValues(decision: SourceDecision): string[] {
  const fields: [string, unknown][] = [
    ...('values' in decision ? [['values', decision.values] as [string, unknown]] : []),
    ...('comparisons' in decision ? (decision.comparisons ?? []) : []).flatMap(
      ({ question, left, right }, index): [string, unknown][] => [
        [`Comparison ${index + 1} (“${question}”), its first side’s values`, left.values],
        [`Comparison ${index + 1} (“${question}”), its second side’s values`, right.values]
      ]
    )
  ];
  return fields.flatMap(([where, values]) => {
    const read = readDesignPatch(values);
    return 'problem' in read ? [`${where}: ${read.problem}`] : [];
  });
}

/**
 * What keeps each of a decision's comparisons from being built as given: a value its variable does
 * not offer, two sides alike, a side hiding the layout itself or most of the picture, a choice the
 * brief keeps out of comparisons (a colour where it must print in grey), or a brief attribute asked
 * by showing with tags it does not name.
 */
export function comparisonProblems(
  pairs: Comparisons,
  design: AiDesign,
  guard: GuardContext,
  brief: BriefSteering
): string[][] {
  return pairs.map((pair, index) => {
    const { question, left, right } = pair;
    const name = `Comparison ${index + 1} (“${question}”)`;
    const set = [designPatch(left.values), designPatch(right.values)].flatMap(
      ({ set }: DesignPatch) => set
    );
    const problems = set.flatMap(({ variable, value }) =>
      offeredOptions(design, variable)?.includes(value)
        ? []
        : [`${name}: ${variable} has no option ${JSON.stringify(value)} in project.design.`]
    );
    const asked = comparisonBriefProblem(pair);
    if (asked) problems.push(`${name}: ${asked}`);
    const sides = [designValues(left.values), designValues(right.values)];
    for (const variable of Object.keys({ ...sides[0], ...sides[1] })) {
      const excluded = brief.excluded(variable);
      if (excluded)
        problems.push(`${name}: ${variable} is kept out of comparisons by the brief: ${excluded}.`);
    }
    const differ = Object.keys({ ...sides[0], ...sides[1] }).some(
      (variable) =>
        (sides[0][variable] ?? guard.base[variable]) !==
        (sides[1][variable] ?? guard.base[variable])
    );
    if (!differ) problems.push(`${name}: its two sides set the same values.`);
    if (sides.some((side) => !allowedComparisonSide(guard, side)))
      problems.push(`${name}: a side hides the layout itself or most of the picture.`);
    return problems;
  });
}

/** The problems of a failed batch's builds, when every one is a value the design does not offer. */
export function designValueProblems(recorded: RecordedBuildBatch): string[] {
  const diagnostics = recorded.builds.flatMap((build) =>
    build.result.ok ? [] : build.result.diagnostics
  );
  return diagnostics.length && diagnostics.every(({ code }) => code === 'design_value')
    ? [...new Set(diagnostics.map(({ message }) => message))]
    : [];
}

/**
 * Build the comparisons after the first, one pair at a time, each queued behind those before as
 * soon as it is built, so the participant answers the first while the rest build. A pair an answer
 * given meanwhile has made moot is not built, and one that fails to build is left out.
 */
export async function presentRemainingComparisons(
  options: {
    document: ProjectDocument;
    candidate: string;
    pairs: ShownComparison[];
    seeds: readonly number[];
    viewed: DesignValues | undefined;
    /** The values every side takes, a vary's. */
    values: DesignValues;
    operationId: string;
    attempt: number;
    actor: NewProjectEvent<'visualization.presented'>['actor'];
  },
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  let document = options.document;
  // Preferences after the first pair was shown answer this batch's questions.
  const shownAt =
    document.events.findLast(
      (event) =>
        event.type === 'visualization.presented' && event.operationId === options.operationId
    )?.id ?? projectHead(document).id;
  for (const [index, pair] of options.pairs.entries()) {
    if (index === 0) continue;
    assertCurrentProjectOperationActive();
    const asked = askedPair(designValues(pair.left.values), designValues(pair.right.values));
    if (answersAfter(document.events, shownAt).some((answer) => mootComparison(answer, asked)))
      continue;
    const built = await buildCandidateBatch(
      {
        document,
        candidate: options.candidate,
        requests: comparisonRequests(
          options.seeds.slice(index * 2, index * 2 + 2),
          options.viewed,
          options.values,
          [pair]
        ),
        operationId: options.operationId,
        attempt: options.attempt
      },
      dependencies
    );
    document = built.document;
    if (!batchSucceeded(built.recorded)) continue;
    // A pair whose sides draw alike at every step is left out, as one that fails to build.
    const differsAt = pairDifferences(built.recorded.builds);
    if (differsAt?.length === 0) continue;
    document = await activateBuiltPresentations(
      built.recorded,
      dependencies.projectService,
      options.actor,
      pairQuestion(pair, differsAt)
    );
  }
  return document;
}

export async function acceptSverlinCandidate(
  options: {
    document: ProjectDocument;
    recorded: RecordedBuildBatch;
    generationEvent: NewProjectEvent<'ai.generation-succeeded'>;
    candidate: string;
    /** What the revision shows, for a first source, or what it changes. */
    summary?: string;
    operationId: string;
    /** Presentations shown at once, when the batch is queued (queueBuiltPresentations). */
    setSize?: 1 | 2;
    /** What each queued set asks, for a vary's comparisons. */
    pairs?: readonly PairQuestion[];
  },
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const snapshot = projectSnapshotAt(options.document);
  const current = snapshot.artifacts[snapshot.entryArtifactId];
  if (!current) throw new Error('The project has no entry artifact.');
  const change: ArtifactChange = {
    operation: 'upsert',
    artifact: { ...current, content: recordText(options.candidate, current.content.mediaType) }
  };
  // New variants of an unchanged source join its version.
  const unchanged = options.candidate === current.content.text;
  const document = await appendProjectEvents(
    options.document,
    unchanged
      ? []
      : [
          draftEvent({
            type: 'artifact.version-created',
            actor: options.generationEvent.actor,
            operationId: options.operationId,
            payload: {
              origin: { kind: 'assistant-edit' },
              changes: [change],
              ...(options.summary ? { summary: options.summary } : {})
            }
          })
        ],
    dependencies.projectService
  );
  return options.setSize
    ? queueBuiltPresentations(
        { ...options.recorded, document },
        options.setSize,
        dependencies.projectService,
        options.generationEvent.actor,
        options.pairs
      )
    : activateBuiltPresentations(
        { ...options.recorded, document },
        dependencies.projectService,
        options.generationEvent.actor
      );
}

export async function advanceCandidatesForAgent(
  document: ProjectDocument,
  presentationCount: 1 | 2,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<{ document: ProjectDocument; presentations: RenderablePresentation[] }> {
  const current = presentationBufferState(document, 0).available.slice(0, presentationCount);
  let available = presentationBufferState(document, 0).available;
  const remaining = available.slice(current.length);
  if (remaining.length < presentationCount) {
    const snapshot = projectSnapshotAt(document);
    const artifact = snapshot.artifacts[snapshot.entryArtifactId];
    if (!artifact || snapshot.mode !== 'sverlin') {
      throw new Error('Only source-authored projects can generate buffered candidates.');
    }
    const recorded = await buildProjectSourceBatch(
      {
        document,
        sourceContent: artifact.content.text,
        source: artifact.content,
        sourceLabel: artifact.path,
        requests: freshPresentationSeeds((presentationCount - remaining.length) as 1 | 2).map(
          (seed) => ({ seed })
        ),
        purpose: 'seed-change',
        input: 'committed-artifact',
        operationId
      },
      dependencies.projectService
    );
    document = recorded.document;
    if (!batchSucceeded(recorded)) {
      throw new Error('The next visualization candidates could not be built.');
    }
    document = await activateBuiltPresentations(recorded, dependencies.projectService);
    available = presentationBufferState(document, 0).available;
  }
  if (current.length > 0) {
    document = await appendProjectEvents(
      document,
      [
        draftEvent({
          type: 'visualization.candidates-advanced',
          actor: { kind: 'system' },
          operationId,
          payload: {
            presentations: current.map(({ presentationId }) => presentationId),
            reason: 'agent-request'
          }
        })
      ],
      dependencies.projectService
    );
    available = presentationBufferState(document, 0).available;
  }
  const ids = new Set(
    available.slice(0, presentationCount).map(({ presentationId }) => presentationId)
  );
  return {
    document,
    presentations: document.events.flatMap((event) =>
      event.type === 'visualization.presented' && ids.has(event.payload.presentation.presentationId)
        ? [event.payload.presentation]
        : []
    )
  };
}

export function appendExhaustedSverlinFailure(
  document: ProjectDocument,
  operationId: string,
  finalDifficulty: string | undefined,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  return appendSystemFailure(
    document,
    `I could not build the requested visualization after several repairs and a simpler fallback${keptVersion(document)}.${finalDifficulty ? ` The remaining difficulty was: ${plainFailureSummary(finalDifficulty)}` : ''}`,
    operationId,
    dependencies
  );
}

/**
 * The stage of the build that finds a problem, by its code, in the order a build checks: the source
 * as written (its blocks, labels, and views), then running the algorithm on each case, then the
 * listing, then laying out the steps. A later stage runs only once the earlier ones pass, so its
 * problems were hidden until then. Codes from outside the build have none.
 */
export const buildStages: Record<string, number> = {
  js_parse_error: 0,
  import: 0,
  missing_algorithm: 0,
  sverlin_block: 0,
  algorithm_written: 0,
  name_clash: 0,
  reserved_prop: 0,
  unknown_prop: 0,
  invalid_prop: 0,
  design_value: 0,
  bound_prop: 0,
  view_case: 1,
  algorithm_error: 1,
  // Scenes are checked against the labels the run reached, once the view is clear.
  view_storyboard: 2,
  listing_label: 2,
  link_placement: 3,
  layout_failed: 3,
  draw_failed: 3,
  too_large: 3,
  too_many_steps: 3
};
export const buildStage = (code: string | undefined): number | undefined =>
  code === undefined
    ? undefined
    : (buildStages[code] ?? (code.startsWith('view_') ? 0 : undefined));

/** A scene or listing naming a label: checked only once the run has given its labels. */
export const labelReferenceCodes = new Set(['listing_label', 'view_storyboard']);

/** A decision's design values that are not one JSON object (see readDesignPatch): written wrong. */
export const valuesUnreadable = 'values_unreadable';

/**
 * Whether the build refused a failed attempt's source as written: every problem from its first
 * stage (the source's blocks, labels, and views), a scene or listing naming a label that does not
 * exist, or design values that are not one JSON object. Such a slip gets the ladder's quick retries
 * (writtenRetries in ai/bots/attempt-profiles.ts); a failure of the run or the layout, a problem
 * with no code, or an attempt set aside for another reason goes to the slower repairs.
 */
export function refusedAsWritten(failure: AttemptFailure | undefined): boolean {
  return (
    !!failure?.diagnostics.length &&
    failure.diagnostics.every(
      ({ code }) =>
        buildStage(code) === 0 ||
        (code !== undefined && (labelReferenceCodes.has(code) || code === valuesUnreadable))
    )
  );
}

/** How Sverlin's build sorts its problems, for the attempt ladder (see attempt-ladder.ts BuildStages). */
export const sverlinBuildStages: BuildStages = {
  stageOf: (code) => buildStage(code),
  refusedAsWritten: (failure) => refusedAsWritten(failure)
};

/**
 * The warnings a build sends back once a turn. A first source has no design to read names from,
 * so a design value it names that the design lacks is left out without sending it back: in
 * benchmark run 4 such guessed names, as Cells.Eliminated.opacity, sent back two of Sol's first
 * sources that built. Nor does a first source go back for steps that draw the picture before them
 * (repeatedStepWarnings in modes/sverlin/storyboard.server.ts): nothing the participant asked sets its
 * pauses yet, and some repeat rightly, as a merge sort's calls on one value return showing
 * nothing new (project a60d96ec). The warning stays with the version, for the next turn to read.
 */
export function returnedWarnings(warnings: readonly string[], firstSource: boolean): string[] {
  // A look only, as padding nobody sees, never sends a picture back: it is right, only roomier.
  const returned = warnings.filter((warning) => !warning.endsWith(designOnlyWarning));
  return firstSource
    ? returned.filter(
        (warning) =>
          !warning.endsWith('The value is left out.') &&
          !warning.includes('draw the same picture as the step before them')
      )
    : returned;
}

/**
 * The variant a vary decision builds from: the viewed one, with the values it sets, and the
 * variables it asks to draw afresh.
 */
/**
 * A changed source's first build: the viewed variant's values, with the assistant's own values for
 * it, as where its steps pause; unlike a vary's, they settle nothing, being no one's request.
 */
export function sourceValues(
  viewed: DesignValues | undefined,
  decision: SourceDecisionOf<'revise' | 'edit'>
): { base?: DesignValues; chosen?: DesignValues } {
  const base = withoutPatched(viewed, decision.values);
  const chosen = designValues(decision.values);
  return {
    ...(base ? { base } : {}),
    ...(Object.keys(chosen).length ? { chosen } : {})
  };
}

export function variedValues(
  viewed: DesignValues | undefined,
  decision: SourceDecisionOf<'vary'>
): { base?: DesignValues; chosen: DesignValues; randomise: string[] } {
  const base = withoutPatched(viewed, decision.values);
  return {
    ...(base ? { base } : {}),
    chosen: designValues(decision.values),
    randomise: decision.randomise.map((key) => keptKey(key))
  };
}

/** Sverlin's authoring turn, as the assistants registry calls it (see ../../assistants.server.ts). */
export const runAssistantTurn: AssistantTurn = runSverlinAssistantTurn;
