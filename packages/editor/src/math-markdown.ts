import type { Plugin } from 'unified';
import type { Root, Nodes } from 'mdast';
type MathNode = Extract<Nodes, { type: 'math' }>;
type InlineMath = Extract<Nodes, { type: 'inlineMath' }>;
import type { Construct, State } from 'micromark-util-types';
import type { Handle } from 'mdast-util-to-markdown';
import remarkMath from 'remark-math';
import { defaultCapabilities, newMathSyntax } from './runtime';
import type { WorkspaceCapabilities } from './runtime';

interface MathSource {
  raw: string;
  value: string;
  delimiter: string;
}
declare module 'mdast' {
  interface Data {
    tanoMath?: MathSource;
  }
}
declare module 'micromark-util-types' {
  interface TokenTypeMap {
    tanoLatexInline: 'tanoLatexInline';
    tanoLatexBlock: 'tanoLatexBlock';
    tanoLatexData: 'tanoLatexData';
  }
}

/** Tokenize before Markdown unescaping; code, escapes and link destinations stay opaque. */
function latexConstruct(display: boolean): Construct {
  const type = display ? 'tanoLatexBlock' : 'tanoLatexInline';
  return {
    name: type,
    concrete: display,
    tokenize(effects, ok, nok) {
      const context = this;
      let slash = false;
      const start: State = (code) => {
        if (code !== 92) return nok(code);
        effects.enter(type);
        effects.enter('tanoLatexData');
        effects.consume(code);
        return opening;
      };
      const opening: State = (code) => {
        if (code !== (display ? 91 : 40)) return nok(code);
        effects.consume(code);
        return body;
      };
      const body: State = (code) => {
        if (code === null || (!display && code < -2)) return nok(code);
        if (slash && code === (display ? 93 : 41)) {
          effects.consume(code);
          if (!display) {
            effects.exit('tanoLatexData');
            effects.exit(type);
          }
          return display ? after : ok;
        }
        slash = code === 92 && !slash;
        if (code < -2) {
          effects.exit('tanoLatexData');
          effects.enter('lineEnding');
          effects.consume(code);
          effects.exit('lineEnding');
          return nextLine;
        }
        effects.consume(code);
        return body;
      };
      const nextLine: State = (code) => {
        if (code === null) return nok(code);
        // A display formula cannot continue after its enclosing quote/list ends.
        // Unmatched escaped brackets must fall back to ordinary Markdown before
        // the tokenizer consumes unrelated blocks as lazy container content.
        if (display && context.parser.lazy[context.now().line]) return nok(code);
        if (code < -2) {
          effects.enter('lineEnding');
          effects.consume(code);
          effects.exit('lineEnding');
          return nextLine;
        }
        effects.enter('tanoLatexData');
        return body(code);
      };
      const after: State = (code) => {
        if (code === 32 || code === -1 || code === -2) {
          effects.consume(code);
          return after;
        }
        if (code === null || code < -2) {
          effects.exit('tanoLatexData');
          effects.exit(type);
          return ok(code);
        }
        return nok(code);
      };
      return start;
    },
  };
}

export function mathSource(
  value: string,
  display: boolean,
  delimiter = 'dollar',
  minimumDollars = 0,
) {
  if (delimiter === 'latex')
    return display ? `\\[\n${value ? value + '\n' : ''}\\]` : `\\(${value}\\)`;
  const run = Math.max(
    display ? 2 : 1,
    minimumDollars,
    ...[...value.matchAll(/\$+/g)].map(([s]) => s.length + 1),
  );
  const fence = '$'.repeat(run);
  return display ? `${fence}\n${value ? value + '\n' : ''}${fence}` : `${fence}${value}${fence}`;
}

/** Both syntaxes map to the same semantic nodes plus their source spelling. */
export const remarkMathSyntax: Plugin<[{ policy?: () => WorkspaceCapabilities }?], Root> =
  function (options = {}) {
    this.use(remarkMath);
    const data = this.data();
    (data.micromarkExtensions ??= []).push({
      text: { 92: latexConstruct(false) },
      flow: { 92: latexConstruct(true) },
    });
    (data.fromMarkdownExtensions ??= []).push({
      enter: {
        tanoLatexInline(token) {
          this.enter({ type: 'inlineMath', value: '' }, token);
        },
        tanoLatexBlock(token) {
          this.enter({ type: 'math', value: '' }, token);
        },
      },
      exit: {
        tanoLatexInline(token) {
          const node = this.stack.at(-1) as InlineMath;
          node.value = this.sliceSerialize(token).slice(2, -2);
          node.data = {
            tanoMath: { raw: this.sliceSerialize(token), value: node.value, delimiter: 'latex' },
          };
          this.exit(token);
        },
        tanoLatexBlock(token) {
          const node = this.stack.at(-1) as MathNode;
          node.value = this.sliceSerialize(token)
            .trimEnd()
            .slice(2, -2)
            .replace(/^\r?\n|\r?\n$/g, '');
          node.data = {
            tanoMath: { raw: this.sliceSerialize(token), value: node.value, delimiter: 'latex' },
          };
          this.exit(token);
        },
      },
    });
    // Register after remark-math's serializers (attacher order is significant).
    this.use(function tanoMathSerializer() {
      // Capture logical source from the tokenizer, excluding enclosing list/quote prefixes.
      for (const extension of this.data().fromMarkdownExtensions ?? []) {
        if (Array.isArray(extension)) continue;
        for (const type of ['mathFlow', 'mathText'] as const) {
          const previous = extension.exit?.[type];
          if (!previous) continue;
          extension.exit![type] = function (token) {
            const node = this.stack.at(-1) as MathNode | InlineMath;
            const raw = this.sliceSerialize(token);
            previous.call(this, token);
            node.data = { ...node.data, tanoMath: { raw, value: node.value, delimiter: 'dollar' } };
          };
        }
      }
      const handle: Handle = (node) => {
        const math = node as MathNode | InlineMath;
        const value = math.value ?? '';
        const policy = options.policy?.() ?? defaultCapabilities;
        const source = math.data?.tanoMath;
        if (policy.mathSyntax === 'preserve' && source?.raw && source.value === value)
          return source.raw;
        const delimiter =
          policy.mathSyntax === 'preserve' && source?.delimiter
            ? source.delimiter
            : newMathSyntax(policy);
        const minimumDollars =
          policy.mathSyntax === 'preserve' ? source?.raw?.match(/^\$+/)?.[0].length : 0;
        return mathSource(value, math.type === 'math', delimiter, minimumDollars);
      };
      (this.data().toMarkdownExtensions ??= []).push({
        handlers: { inlineMath: handle, math: handle },
      });
    });
    return (tree, file) => {
      const source = String(file.value);
      function visit(node: Nodes) {
        if (node.type === 'math' || node.type === 'inlineMath') {
          const raw =
            node.data?.tanoMath?.raw ??
            source.slice(node.position?.start.offset, node.position?.end.offset);
          node.data = {
            ...node.data,
            tanoMath: {
              raw,
              value: node.value,
              delimiter: raw.startsWith('\\') ? 'latex' : 'dollar',
            },
          };
        } else if ('children' in node) node.children.forEach(visit);
      }
      visit(tree);
    };
  };
