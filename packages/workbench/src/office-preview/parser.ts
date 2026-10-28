import { officeArchive } from './archive';
import { compound, legacyPresentation, legacyWord } from './legacy';
import { presentation, wordDocument } from './openxml';
import { spreadsheet } from './spreadsheet';
import { officeErrors, officeLimits, type OfficeBlock, type OfficePreview } from './model';

function checkModel(result: OfficePreview) {
  let characters = 0, blocks = 0;
  function count(items: OfficeBlock[], depth = 0) {
    if (depth > 32) throw new Error(officeErrors.limit);
    for (const block of items) {
      if (++blocks > officeLimits.blocks) throw new Error(officeErrors.limit);
      if (block.kind === 'paragraph') characters += block.runs.reduce((sum, run) => sum + run.text.length, 0);
      if (block.kind === 'image') characters += block.src.length;
      if (block.kind === 'table') for (const row of block.rows) for (const cell of row) count(cell.blocks, depth + 1);
      if (characters > officeLimits.characters) throw new Error(officeErrors.limit);
    }
  }
  if (result.kind === 'spreadsheet') {
    for (const sheet of result.sheets) for (const row of sheet.rows) for (const cell of row) {
      characters += cell.length;
      if (characters > officeLimits.characters) throw new Error(officeErrors.limit);
    }
  } else for (const page of result.pages) count(page.blocks);
  return result;
}
export function parseOffice(bytes: Uint8Array, extension: string): OfficePreview {
  if (bytes.length > officeLimits.fileBytes) throw new Error(officeErrors.limit);
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value);
  if (!['xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx'].includes(extension)) throw new Error(officeErrors.invalid);
  try {
    if (ole && extension.endsWith('x')) { compound(bytes); throw new Error(officeErrors.invalid); }
    if (extension === 'xls' || extension === 'xlsx') {
      if (extension === 'xlsx') {
        if (!zip || !officeArchive(bytes)['xl/workbook.xml']) throw new Error(officeErrors.invalid);
      } else if (!ole) throw new Error(officeErrors.invalid);
      return checkModel(spreadsheet(bytes));
    }
    if (extension === 'doc' || extension === 'ppt') {
      if (!ole) throw new Error(officeErrors.invalid);
      const file = compound(bytes);
      return checkModel(extension === 'doc' ? legacyWord(file) : legacyPresentation(file));
    }
    if (!zip) throw new Error(officeErrors.invalid);
    const files = officeArchive(bytes);
    return checkModel(extension === 'docx' ? wordDocument(files) : presentation(files));
  } catch (reason) {
    if (reason instanceof Error && Object.values(officeErrors).includes(reason.message)) throw reason;
    if (reason instanceof Error && /password|encrypt/i.test(reason.message)) throw new Error(officeErrors.encrypted);
    throw new Error(officeErrors.invalid);
  }
}
