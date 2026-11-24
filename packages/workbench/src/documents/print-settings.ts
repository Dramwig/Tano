export interface DocumentPrintSettings {
  paper: 'a4' | 'a3' | 'a5' | 'letter' | 'legal';
  landscape: boolean; copies: number; pageRanges: string; color: boolean;
  duplex: 'simplex' | 'long' | 'short'; margins: number; scale: number;
  backgrounds: boolean; headers: boolean; printer: string;
}
export const printPapers = [
  { id: 'a4', label: 'A4', width: 210, height: 297 },
  { id: 'a3', label: 'A3', width: 297, height: 420 },
  { id: 'a5', label: 'A5', width: 148, height: 210 },
  { id: 'letter', label: 'Letter', width: 215.9, height: 279.4 },
  { id: 'legal', label: 'Legal', width: 215.9, height: 355.6 },
] as const;
export function defaultPrintSettings(): DocumentPrintSettings {
  return { paper: 'a4', landscape: false, copies: 1, pageRanges: '', color: true, duplex: 'simplex', margins: 16, scale: 1, backgrounds: true, headers: false, printer: '' };
}
export function validPrintRanges(value: string) {
  return !value.trim() || value.split(',').every(part => {
    if (!/^\s*\d+\s*(?:-\s*\d+\s*)?$/.test(part)) return false;
    const [start, end = start] = part.split('-').map(Number);
    return start > 0 && end >= start && end <= 100000;
  });
}
export function printPageCss(settings: DocumentPrintSettings) {
  const paper = printPapers.find(paper => paper.id === settings.paper)!;
  return `@media print { @page { size: ${settings.landscape ? paper.height : paper.width}mm ${settings.landscape ? paper.width : paper.height}mm; margin: ${settings.margins}mm; } }`;
}
