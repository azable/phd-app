/**
 * The assistant's questions to the participant, of three kinds, each with what it is about and how
 * it is answered: in words (text, answered in the chat), about a presentation (one shown, or one
 * the assistant made for it, with elements to highlight; answered in the chat), and about a
 * pair (a comparison, answered by a side, either is fine, or unsure). Read from the events,
 * each answer linked to its question: a message by the question it answers (feedback.submitted
 * `answers`), a pair's answer by its display set. A pair may be answered again; its latest answer
 * counts.
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
  /** Its answer once given; a pair's latest. */
  answer?: QuestionAnswer;
  /** Every answer to a pair, by event id, in the order given. */
  answerEventIds?: number[];
};

/** Every question asked, in the order asked, each with its answer once given. */
export function projectQuestions(events: readonly ProjectEvent[]): ProjectQuestion[] {
  const questions: ProjectQuestion[] = [];
  const asked = new Map<number, ProjectQuestion>();
  const pairs = new Map<string, ProjectQuestion>();
  for (const event of events) {
    if (event.type === 'assistant.responded' && event.payload.question) {
      const { text, presentationId, elements } = event.payload.question;
      const question: ProjectQuestion = {
        kind: presentationId ? 'presentation' : 'text',
        eventId: event.id,
        text,
        presentationIds: presentationId ? [presentationId] : [],
        ...(elements?.length ? { elements } : {})
      };
      asked.set(event.id, question);
      questions.push(question);
    } else if (event.type === 'visualization.presented') {
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
      if (!question) continue;
      (question.answerEventIds ??= []).push(event.id);
      const outcome = comparisonOutcome(event.payload);
      const preferred = preferredPresentation(event.payload);
      question.answer =
        outcome === 'preferred' && preferred
          ? { kind: 'preferred', eventId: event.id, presentationId: preferred }
          : { kind: outcome === 'tie' ? 'tie' : 'skip', eventId: event.id };
    }
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
