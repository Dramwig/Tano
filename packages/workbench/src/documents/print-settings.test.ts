import { expect, it } from 'vitest';
import { defaultPrintSettings, printPageCss, validPrintRanges } from './print-settings';
it('validates explicit page ranges without accepting incomplete or reversed ranges', () => {
  for (const range of ['', '1', '1-5,8,11-13', ' 2 - 4 , 6 ']) expect(validPrintRanges(range)).toBe(true);
  for (const range of ['0', '5-2', '1-', '1,,2', '1-2-3', 'hello']) expect(validPrintRanges(range)).toBe(false);
});
it('applies the selected paper, orientation and margins to actual print layout', () => {
  const settings = defaultPrintSettings();
  expect(printPageCss(settings)).toContain('size: 210mm 297mm; margin: 16mm');
  settings.paper = 'a3'; settings.landscape = true; settings.margins = 0;
  expect(printPageCss(settings)).toContain('size: 420mm 297mm; margin: 0mm');
});
