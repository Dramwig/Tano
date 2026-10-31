import { readFile, writeFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { resolve } from 'node:path';
const directory = resolve(import.meta.dirname, 'fixtures/word-preview');
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const p = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const geometry = (width, height) => `<w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="${width}" w:h="${height}"/><w:pgMar w:top="720" w:right="960" w:bottom="720" w:left="960" w:header="300" w:footer="300"/>`;
const xml = {
  '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
  '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
  'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="${r}/styles" Target="styles.xml"/><Relationship Id="header" Type="${r}/header" Target="header.xml"/><Relationship Id="footer" Type="${r}/footer" Target="footer.xml"/><Relationship Id="image" Type="${r}/image" Target="media/image.png"/></Relationships>`,
  'word/styles.xml': `<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
  'word/header.xml': `<w:hdr xmlns:w="${w}">${p('Source header')}</w:hdr>`,
  'word/footer.xml': `<w:ftr xmlns:w="${w}">${p('Source footer')}</w:ftr>`,
  'word/document.xml': `<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
    <w:p><w:r><w:rPr><w:i/><w:color w:val="008000"/><w:sz w:val="48"/></w:rPr><w:t>Original Word layout</w:t></w:r></w:p>
    ${p('Styled paragraph with original margins.')}
    <w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/><w:insideH w:val="single" w:sz="8"/><w:insideV w:val="single" w:sz="8"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="FFFF00"/></w:tcPr>${p('Merged cell')}</w:tc><w:tc>${p('Right cell')}</w:tc></w:tr><w:tr>${['A','B','C'].map(text => `<w:tc>${p(text)}</w:tc>`).join('')}</w:tr></w:tbl>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="1143000" cy="571500"/><wp:docPr id="1" name="Embedded picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1143000" cy="571500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>${p('Second page')}${p('Explicit page break.')}
    <w:p><w:pPr><w:sectPr>${geometry(12000,8000)}</w:sectPr></w:pPr></w:p>
    ${p('Portrait section')}${p('Different paper dimensions in the same document.')}<w:sectPr>${geometry(8000,12000)}</w:sectPr>
    </w:body></w:document>`,
};
await writeFile(resolve(directory, 'fixture.docx'), zipSync({ ...Object.fromEntries(Object.entries(xml).map(([path, content]) => [path, strToU8(content)])), 'word/media/image.png': new Uint8Array(await readFile(resolve(directory, 'image.png'))) }));
