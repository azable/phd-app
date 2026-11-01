/**
 * The assistant's questions to the participant, of three kinds, each with what it is about and how
 * it is answered: in words (text, answered in the chat), about a presentation (one shown, or an
 * example the assistant made for it, with elements to highlight; answered in the chat), and about a
 * pair (a comparison, answered by a side, either is fine, or decide later). Read from the events,
 * each answer linked to its question: a message by the question it answers (feedback.submitted
 * `answers`), a pair's answer by its display set.
 */

import type { ProjectEvent } from './events';
import type { MessageContent } from './events/message-content';
import { comparisonOutcome, preferredPresentation } from './events/visualization-presented';

export type QuestionAnswer =
  | { kind: 'text'; eventId: number; content: MessageContent }
  | { kind: 'preferred'; eventId: number; presentationId: string }
  | { kind: 'tie' | 'skip'; eventId: number };

export type ProjectQuestion = {
  kind: 'text' | 'presentation' | 'pair';
  /** The event that asked it: the assistant's response, or the pair's first presentation. */
  eventId: number;
  text: string;
  /** What it is about: its presentation, or the pair's two in slot order. */
  presentationIds: string[];
  /** Element ids in its presentation it is about. */
  elements?: string[];
  /** What the participant would call each side of a pair, in slot order. */
  labels?: string[];
  displaySetId?: string;
  answer?: QuestionAnswer;
};

/** Every question asked, in the order asked, each with its answer once given. */
export function projectQuestions(events: readonly ProjectEvent[]): ProjectQuestion[] {
  const questions: ProjectQuestion[] = [];
  const asked = new Map<number, ProjectQuestion>();
  const pairs = new Map<string, ProjectQuestion>();
  // Questions whose example is the next presentation their operation shows, by operation.
  const awaitingExample = new Map<string, ProjectQuestion>();
  for (const event of events) {
    if (event.type === 'assistant.responded' && event.payload.question) {
      const { text, presentationId, example, elements } = event.payload.question;
      const question: ProjectQuestion = {
        kind: presentationId || example ? 'presentation' : 'text',
        eventId: event.id,
        text,
        presentationIds: presentationId ? [presentationId] : [],
        ...(elements?.length ? { elements } : {})
      };
      if (example) awaitingExample.set(event.operationId, question);
      asked.set(event.id, question);
      questions.push(question);
    } else if (event.type === 'visualization.presented') {
      const example = awaitingExample.get(event.operationId);
      if (example) {
        example.presentationIds = [event.payload.presentation.presentationId];
        awaitingExample.delete(event.operationId);
      }
      if (!event.payload.question) continue;
      const pair = pairs.get(event.payload.displaySetId);
      const question: ProjectQuestion = pair ?? {
        kind: 'pair',
        eventId: event.id,
        text: event.payload.question,
        presentationIds: [],
        displaySetId: event.payload.displaySetId
      };
      const { slot, presentation, label } = event.payload;
      question.presentationIds[slot] = presentation.presentationId;
      if (label) (question.labels ??= [])[slot] = label;
      if (pair) continue;
      pairs.set(event.payload.displaySetId, question);
      questions.push(question);
    } else if (event.type === 'feedback.submitted' && event.payload.answers) {
      const question = asked.get(event.payload.answers);
      if (question && !question.answer)
        question.answer = { kind: 'text', eventId: event.id, content: event.payload.content };
    } else if (event.type === 'visualization.preference-recorded') {
      const question =
        (event.payload.displaySetId && pairs.get(event.payload.displaySetId)) ||
        [...pairs.values()].find(({ presentationIds }) =>
          event.payload.presentations.every((id) => presentationIds.includes(id))
        );
      if (!question || question.answer) continue;
      const outcome = comparisonOutcome(event.payload);
      const preferred = preferredPresentation(event.payload);
      question.answer =
        outcome === 'preferred' && preferred
          ? { kind: 'preferred', eventId: event.id, presentationId: preferred }
          : { kind: outcome === 'tie' ? 'tie' : 'skip', eventId: event.id };
    }
  }
  // An example never presented, as when its build failed, leaves a question in words.
  for (const question of questions)
    if (question.kind === 'presentation' && !question.presentationIds.length) {
      question.kind = 'text';
      delete question.elements;
    }
  return questions;
}

/**
 * The question a message sent now answers: the newest question in words or about a presentation,
 * while unanswered. One is open at a time; a newer one replaces it.
 */
export function openQuestion(events: readonly ProjectEvent[]): ProjectQuestion | undefined {
  const latest = projectQuestions(events).findLast(({ kind }) => kind !== 'pair');
  return latest && !latest.answer ? latest : undefined;
}

/** The most characters of a message an answer shows. */
const answerLength = 60;

/**
 * An answer as its question's caption shows it: the preferred side's label (“tallies”), either is
 * fine, later, or the start of the message, on one line with its references, of what words keeps.
 */
export function answerLabel(
  question: ProjectQuestion,
  words: (content: MessageContent) => MessageContent = (content) => content
): MessageContent | undefined {
  const answer = question.answer;
  if (!answer) return undefined;
  if (answer.kind === 'text') return abbreviated(words(answer.content));
  if (answer.kind !== 'preferred')
    return [{ type: 'markdown', text: answer.kind === 'tie' ? 'either is fine' : 'later' }];
  const slot = question.presentationIds.indexOf(answer.presentationId);
  return [{ type: 'markdown', text: question.labels?.[slot] ?? (slot === 0 ? 'top' : 'bottom') }];
}

/** A message on one line, its words cut to answerLength, the references among them kept. */
function abbreviated(content: MessageContent): MessageContent {
  let left = answerLength;
  const shown: MessageContent = [];
  for (const segment of content) {
    if (segment.type !== 'markdown') {
      if (left > 0) shown.push(segment);
      continue;
    }
    const text = segment.text.replace(/\s+/gu, ' ');
    const words = shown.length ? text : text.trimStart();
    if (!words) continue;
    if (left <= 0 || words.length > left) {
      shown.push({ type: 'markdown', text: `${words.slice(0, Math.max(left - 1, 0)).trimEnd()}…` });
      break;
    }
    shown.push({ type: 'markdown', text: words });
    left -= words.length;
  }
  return shown;
}
