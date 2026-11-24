import type { Construct, State } from 'micromark-util-types';

export const styleDelimiters = {
  '==': 'highlight', '^': 'superscript', '~': 'subscript', '++': 'underline', '%%': 'inline_comment',
} as const;

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    tanoStyleDelimited: 'tanoStyleDelimited';
    tanoStyleData: 'tanoStyleData';
  }
}

/** Read before unescaping, keeping code spans and escaped markers opaque. */
export function styleDelimiterConstruct(delimiter: string): Construct {
  const marker = delimiter.charCodeAt(0);
  return {
    name: 'tanoStyleDelimited',
    tokenize(effects, ok, nok) {
      let opening = 0, closing = 0, length = 0, escaped = false;
      let codeRun = 0, backticks = 0;
      const start: State = code => {
        if (code !== marker) return nok(code);
        effects.enter('tanoStyleDelimited');
        effects.enter('tanoStyleData');
        return open(code);
      };
      const open: State = code => {
        if (opening < delimiter.length) {
          if (code !== marker) return nok(code);
          opening++;
          effects.consume(code);
          return open;
        }
        if (code === marker || code === 32 || code === -1 || code === -2) return nok(code);
        return body(code);
      };
      const body: State = code => {
        if (code === null || code < -2) return nok(code);
        if (code === 96 && !escaped && delimiter !== '%%') {
          backticks++;
          effects.consume(code);
          length++;
          return body;
        }
        if (backticks) {
          if (codeRun === backticks) codeRun = 0;
          else if (!codeRun) codeRun = backticks;
          backticks = 0;
        }
        if (code === marker && !escaped && !codeRun) {
          closing++;
          effects.consume(code);
          if (closing === delimiter.length) {
            if (!length) return nok(code);
            effects.exit('tanoStyleData');
            effects.exit('tanoStyleDelimited');
            return ok;
          }
          return body;
        }
        length++;
        closing = 0;
        escaped = code === 92 && !escaped;
        effects.consume(code);
        return body;
      };
      return start;
    },
  };
}
