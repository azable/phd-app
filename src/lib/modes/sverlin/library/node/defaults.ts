/**
 * The look a Node takes for each prop it leaves unset: one fixed look, the same in every
 * presentation. What should vary between presentations is declared in the design block, and a
 * view uses it as a prop (see the guide's Design values).
 */

import type { NodeDefaults } from './props';

const surface = { fill: 'var(--sv-surface)', stroke: 'var(--sv-line)' };

export const libraryDefaults: NodeDefaults = {
  box: {
    radius: 'medium',
    strokeWidth: 'thin',
    padding: 'small',
    ...surface,
    scale: 1.25,
    weight: 'bold'
  },
  card: { radius: 'medium', strokeWidth: 'thin', padding: 'medium', ...surface },
  frame: { justify: 'center', align: 'center' },
  collection: { shape: 'plain', layout: 'row' },
  align: { row: 'center', column: 'center' },
  gap: 'medium',
  font: 'sans',
  link: { strokeWidth: 2 }
};
