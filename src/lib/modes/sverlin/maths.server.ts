/**
 * Inline maths, `\(O(n \log n)\)`, written in LaTeX and drawn as Unicode text: the page, the
 * server's measure, and the PDF all draw it in the embedded faces, so the server measures what the
 * page draws. Only what Unicode can write on one line converts; the rest is refused, saying what to
 * write instead.
 */

/** Commands that stand for one character or word. */
const symbols: Record<string, string> = {
  // Greek
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ϵ',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'ϕ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  // relations
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  simeq: '≃',
  cong: '≅',
  propto: '∝',
  ll: '≪',
  gg: '≫',
  in: '∈',
  notin: '∉',
  ni: '∋',
  subset: '⊂',
  subseteq: '⊆',
  supset: '⊃',
  supseteq: '⊇',
  prec: '≺',
  succ: '≻',
  mid: '∣',
  parallel: '∥',
  perp: '⊥',
  models: '⊨',
  vdash: '⊢',
  coloneqq: '≔',
  // operators
  cdot: '⋅',
  times: '×',
  div: '÷',
  pm: '±',
  mp: '∓',
  ast: '∗',
  star: '⋆',
  circ: '∘',
  bullet: '∙',
  oplus: '⊕',
  otimes: '⊗',
  cup: '∪',
  cap: '∩',
  setminus: '∖',
  wedge: '∧',
  land: '∧',
  vee: '∨',
  lor: '∨',
  neg: '¬',
  lnot: '¬',
  sum: '∑',
  prod: '∏',
  coprod: '∐',
  int: '∫',
  oint: '∮',
  partial: '∂',
  nabla: '∇',
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  emptyset: '∅',
  varnothing: '∅',
  infty: '∞',
  aleph: 'ℵ',
  ell: 'ℓ',
  hbar: 'ℏ',
  Re: 'ℜ',
  Im: 'ℑ',
  wp: '℘',
  top: '⊤',
  bot: '⊥',
  angle: '∠',
  triangle: '△',
  square: '□',
  // dots and primes
  ldots: '…',
  cdots: '⋯',
  dots: '…',
  vdots: '⋮',
  ddots: '⋱',
  prime: '′',
  // arrows
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  gets: '←',
  leftrightarrow: '↔',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  Leftrightarrow: '⇔',
  implies: '⟹',
  impliedby: '⟸',
  iff: '⟺',
  mapsto: '↦',
  uparrow: '↑',
  downarrow: '↓',
  updownarrow: '↕',
  longrightarrow: '⟶',
  longleftarrow: '⟵',
  hookrightarrow: '↪',
  leadsto: '⇝',
  // delimiters
  lceil: '⌈',
  rceil: '⌉',
  lfloor: '⌊',
  rfloor: '⌋',
  langle: '⟨',
  rangle: '⟩',
  lvert: '|',
  rvert: '|',
  vert: '|',
  lVert: '‖',
  rVert: '‖',
  Vert: '‖',
  '|': '‖',
  '{': '{',
  '}': '}',
  '#': '#',
  '%': '%',
  '&': '&',
  _: '_',
  $: '$',
  // spacing
  ',': ' ',
  ':': ' ',
  ';': ' ',
  ' ': ' ',
  quad: ' ',
  qquad: '  ',
  '!': ''
};

/** Operators named by a word, set upright with a space after. */
const named = [
  'log',
  'ln',
  'lg',
  'exp',
  'max',
  'min',
  'lim',
  'sup',
  'inf',
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'deg',
  'det',
  'gcd',
  'arg',
  'dim',
  'ker',
  'Pr',
  'argmax',
  'argmin'
];

/** Commands that only size or space what follows, which inline text drops. */
const dropped = ['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr'];

/** Commands whose argument is set as it is, upright. */
const textual = [
  'text',
  'mathrm',
  'operatorname',
  'textrm',
  'mathit',
  'mathbf',
  'textbf',
  'mathsf'
];

/** Double-struck capitals, as ℕ for the naturals. */
const doubleStruck: Record<string, string> = {
  N: 'ℕ',
  Z: 'ℤ',
  Q: 'ℚ',
  R: 'ℝ',
  C: 'ℂ',
  P: 'ℙ',
  H: 'ℍ'
};

/** Commands with no form on one line, each with what to write instead. */
const refused: Record<string, string> = {
  frac: 'a fraction stacks: write it on the line, as $$(n+1)/2$$',
  dfrac: 'a fraction stacks: write it on the line, as $$(n+1)/2$$',
  tfrac: 'a fraction stacks: write it on the line, as $$(n+1)/2$$',
  binom: 'a binomial stacks: write it on the line, as $$C(n, k)$$',
  limits:
    'limits stacked over a symbol do not fit a line: leave out \\limits, so they sit beside it, as $$\\sum_{i=1}^n$$',
  displaystyle: 'maths here sits in a line of text: leave out \\displaystyle',
  overline: 'a line over a symbol has no form in text: write it in words',
  underline: 'a line under a symbol has no form in text: write it in words',
  hat: 'an accent over a symbol has no form in text: write it in words',
  bar: 'a bar over a symbol has no form in text: write it in words',
  vec: 'an arrow over a symbol has no form in text: write it in words',
  tilde: 'an accent over a symbol has no form in text: write it in words',
  overbrace: 'a brace over terms has no form in text: write it in words',
  underbrace: 'a brace under terms has no form in text: write it in words',
  begin: 'an environment, as a matrix or cases, has no form in a line of text: write it in words'
};

const superscripts: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  a: 'ᵃ',
  b: 'ᵇ',
  c: 'ᶜ',
  d: 'ᵈ',
  e: 'ᵉ',
  f: 'ᶠ',
  g: 'ᵍ',
  h: 'ʰ',
  i: 'ⁱ',
  j: 'ʲ',
  k: 'ᵏ',
  l: 'ˡ',
  m: 'ᵐ',
  n: 'ⁿ',
  o: 'ᵒ',
  p: 'ᵖ',
  r: 'ʳ',
  s: 'ˢ',
  t: 'ᵗ',
  u: 'ᵘ',
  v: 'ᵛ',
  w: 'ʷ',
  x: 'ˣ',
  y: 'ʸ',
  z: 'ᶻ',
  A: 'ᴬ',
  B: 'ᴮ',
  D: 'ᴰ',
  E: 'ᴱ',
  G: 'ᴳ',
  H: 'ᴴ',
  I: 'ᴵ',
  J: 'ᴶ',
  K: 'ᴷ',
  L: 'ᴸ',
  M: 'ᴹ',
  N: 'ᴺ',
  O: 'ᴼ',
  P: 'ᴾ',
  R: 'ᴿ',
  T: 'ᵀ',
  U: 'ᵁ',
  V: 'ⱽ',
  W: 'ᵂ',
  '′': '′',
  β: 'ᵝ',
  γ: 'ᵞ',
  δ: 'ᵟ',
  φ: 'ᵠ',
  χ: 'ᵡ',
  '∗': '*',
  '*': '*'
};

const subscripts: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '−': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
  β: 'ᵦ',
  γ: 'ᵧ',
  ρ: 'ᵨ',
  φ: 'ᵩ',
  χ: 'ᵪ'
};

/** Every character the conversion can write, for the server's measure to cover. */
export function mathsCharacters(): Set<string> {
  const all = [
    ...Object.values(symbols),
    ...named,
    ...Object.values(doubleStruck),
    ...Object.values(superscripts),
    ...Object.values(subscripts),
    "−√()[]<>=+/!?.,;:'|*0123456789",
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  ].join('');
  return new Set([...all].filter((character) => character.trim()));
}

/** What a conversion gives: the text, or why it cannot be written on a line. */
export type Converted = { text: string } | { problem: string };

/**
 * The text a LaTeX maths span, its inside as written between `\(` and `\)`, draws as; or why it
 * has no form on one line, saying what to write instead.
 */
export function mathsText(written: string): Converted {
  let latex = written;
  let at = 0;
  const fail = (problem: string): never => {
    throw new MathsProblem(problem);
  };
  // The text of one group, `{…}`, or one item after ^ or _ or a command.
  const argument = (): string => {
    while (latex[at] === ' ') at++;
    if (latex[at] === '{') {
      const end = closing(at);
      const inner = latex.slice(at + 1, end);
      at = end + 1;
      return inner;
    }
    if (latex[at] === '\\') {
      const name = commandAt(at);
      at += name.length + 1;
      return `\\${name}`;
    }
    const character = latex[at];
    if (character === undefined) fail('a ^, _ or command ends the maths with nothing after it');
    at++;
    return character;
  };
  const closing = (open: number): number => {
    let depth = 0;
    for (let index = open; index < latex.length; index++) {
      if (latex[index] === '\\') index++;
      else if (latex[index] === '{') depth++;
      else if (latex[index] === '}' && --depth === 0) return index;
    }
    return fail('a { is never closed with }');
  };
  const commandAt = (start: number): string => {
    const word = /^[A-Za-z]+/u.exec(latex.slice(start + 1));
    if (word) return word[0];
    const next = latex[start + 1];
    if (next === undefined) return fail('a \\ ends the maths with nothing after it');
    return next;
  };
  const scripted = (
    marks: Record<string, string>,
    kind: 'superscript' | 'subscript',
    group: string
  ) => {
    const inner = convert(group);
    let out = '';
    for (const character of inner) {
      if (character === ' ') continue;
      const mark = marks[character];
      if (mark === undefined)
        fail(
          `${kind === 'superscript' ? '^' : '_'}{${group}} cannot be written as a ${kind}, as Unicode has no ${kind} ${character}: write it on the line, as ${kind === 'superscript' ? `$$n \\cdot ${group}$$` : `$$A[${group}]$$`}`
        );
      out += mark;
    }
    return out;
  };
  const convert = (text: string): string => {
    const saved = { latex, at };
    latex = text;
    at = 0;
    let out = '';
    while (at < latex.length) {
      const character = latex[at];
      if (character === '\\') {
        const name = commandAt(at);
        at += name.length + 1;
        if (name in symbols) out += symbols[name];
        else if (named.includes(name)) {
          if (/[\p{L}\p{N}]$/u.test(out)) out += ' ';
          out += name;
          if (latex[at] && !/[\s^_({[]/u.test(latex[at])) out += ' ';
        } else if (dropped.includes(name)) continue;
        else if (textual.includes(name)) out += argument();
        else if (name === 'mathbb') {
          const letter = argument();
          const struck = doubleStruck[letter];
          if (!struck)
            fail(`\\mathbb{${letter}} has no double-struck form: write ${letter} plainly`);
          out += struck;
        } else if (name === 'sqrt') {
          const radicand = convert(argument());
          if ([...radicand].length === 1 || /^\(.*\)$/u.test(radicand)) out += `√${radicand}`;
          else
            fail(
              `\\sqrt{${radicand}} has no bar over a long radicand in text: write one symbol, as $$\\sqrt{n}$$, or put the radicand in brackets, as $$\\sqrt{(n+1)}$$`
            );
        } else if (name === 'bmod' || name === 'mod') out += ' mod ';
        else if (name === 'pmod') out += ` (mod ${convert(argument())})`;
        else if (name in refused) fail(`\\${name}: ${refused[name]}`);
        else
          fail(
            `\\${name} is no maths command Sverlin writes as text: write it in words or with a symbol, as \\le for ≤`
          );
        continue;
      }
      if (character === '^') {
        at++;
        out += scripted(superscripts, 'superscript', argument());
        continue;
      }
      if (character === '_') {
        at++;
        out += scripted(subscripts, 'subscript', argument());
        continue;
      }
      if (character === '{') {
        const end = closing(at);
        out += convert(latex.slice(at + 1, end));
        at = end + 1;
        continue;
      }
      if (character === '}') fail('a } closes no {');
      at++;
      if (character === '-') out += '−';
      else if (character === "'") out += '′';
      else if (/\s/u.test(character)) {
        if (!out.endsWith(' ') && out) out += ' ';
      } else out += character;
    }
    latex = saved.latex;
    at = saved.at;
    return out;
  };
  try {
    return { text: convert(latex).trim() };
  } catch (cause) {
    if (cause instanceof MathsProblem) return { problem: `$$${written}$$: ${cause.message}.` };
    throw cause;
  }
}

class MathsProblem extends Error {}

/** The fence inline maths is written between: `$$…$$`. */
const fences = [['$$', '$$']] as const;

/** The old maths fence, `\(…\)`, which the build refuses, naming `$$…$$`. */
export const oldMathsFence = '\\(';
export const oldMathsMessage = '\\(…\\) is no maths fence: write inline maths between $$ and $$.';

/**
 * The inline maths fence opening at an offset of some text, if one does. A second `$` is no name
 * character, so `$$` never opens a token, `$name[…]`, and a lone `$` stays text.
 */
export function mathsFenceAt(text: string, at: number): (typeof fences)[number] | undefined {
  return fences.find(([open]) => text.startsWith(open, at));
}

/** Each inline maths span in some text, from its opening fence to just past its closing one. */
export function mathsSpans(text: string): { start: number; end: number; inside: string }[] {
  const spans: { start: number; end: number; inside: string }[] = [];
  for (let at = 0; at < text.length; at++) {
    const fence = mathsFenceAt(text, at);
    if (!fence) continue;
    const [open, close] = fence;
    const end = text.indexOf(close, at + open.length);
    if (end < 0) {
      spans.push({ start: at, end: -1, inside: text.slice(at + open.length) });
      return spans;
    }
    spans.push({ start: at, end: end + close.length, inside: text.slice(at + open.length, end) });
    at = end + close.length - 1;
  }
  return spans;
}

/** The message for an opening fence with no closing one after it. */
export const unclosedMaths =
  'This inline maths is never closed: write it between $$ and $$, as $$O(n \\log n)$$.';

/** The message for a token inside maths. */
export const tokenInMaths = (token: string): string =>
  `${token}…] is inside maths, $$…$$: a token refers to a place in text, so write it beside the maths, never inside.`;
