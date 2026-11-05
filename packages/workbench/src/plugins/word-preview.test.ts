import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { validateWord } from '../../../../examples/plugins/word-preview/model';
import { legacyLayout } from '../../../../examples/plugins/word-preview/legacy-layout';

describe('Word package boundary', () => {
  it('accepts genuine DOC/DOCX and reads source DOC page geometry', () => {
    const bytes = new Uint8Array(readFileSync(resolve('scripts/fixtures/word-preview/fixture.doc')));
    expect(validateWord(bytes)).toBe('doc');
    expect(legacyLayout(bytes)).toMatchObject({ width: 12240, height: 15840, sections: 1 });
    expect(validateWord(new Uint8Array(readFileSync(resolve('scripts/fixtures/word-preview/fixture.docx'))))).toBe('docx');
  });
  it('rejects non-Word archives, XML entities and escaping paths before rendering', () => {
    const cases: Record<string, Uint8Array>[] = [{ 'test.txt': strToU8('not a document') }, { 'word/document.xml': strToU8('<!DOCTYPE x><x/>') }, { '../escape.xml': strToU8('<x/>') }];
    for (const files of cases) {
      expect(() => validateWord(zipSync(files))).toThrow();
    }
    expect(() => validateWord(strToU8('invalid'))).toThrow('不是有效');
  });
});
