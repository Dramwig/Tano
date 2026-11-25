"""Rebuild packages/workbench/src/fonts/TanoUISansSC-{Regular,Medium,Bold}.woff2.

Source: Noto Sans CJK (googlefonts/noto-cjk, SIL OFL 1.1), e.g. the Debian/Ubuntu
`fonts-noto-cjk` (Regular, Bold) and `fonts-noto-cjk-extra` (Medium) packages.

    pip install fonttools brotli
    python scripts/fonts/subset-ui-cjk.py <dir containing NotoSansCJK-{Regular,Medium,Bold}.ttc>

The subset keeps GB2312 hanzi (6763) plus GB2312 punctuation/full-width rows and
a few CJK marks, drops Latin (Inter covers it) and OpenType layout features, and
renames the family to 'Tano UI Sans SC' because OFL forbids Modified Versions from
using the Reserved Font Name ("Source").
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTCollection

FAMILY = 'Tano UI Sans SC'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'packages', 'workbench', 'src', 'fonts')


def charset() -> str:
    hanzi = ''.join(bytes([a, b]).decode('gb2312')
                    for a in range(0xB0, 0xF8) for b in range(0xA1, 0xFF)
                    if not (a == 0xD7 and b > 0xF9))
    symbols = ''
    for a in (0xA1, 0xA3):
        for b in range(0xA1, 0xFF):
            try:
                symbols += bytes([a, b]).decode('gb2312')
            except UnicodeDecodeError:
                pass
    extra = '“”‘’…—–·、。〈〉《》「」『』【】〔〕〖〗〜〃々〇'
    return ''.join(sorted({c for c in hanzi + symbols + extra if ord(c) > 0x2000}))


def build(source_dir: str, weight: str) -> None:
    collection = TTCollection(os.path.join(source_dir, f'NotoSansCJK-{weight}.ttc'))
    font = next(f for f in collection.fonts if 'CJK SC' in f['name'].getDebugName(1))
    options = subset.Options()
    options.flavor = 'woff2'
    options.hinting = True
    options.layout_features = []
    options.desubroutinize = True
    options.name_IDs = ['*']
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=charset())
    subsetter.subset(font)
    for record in font['name'].names:
        if record.nameID in (1, 16):
            record.string = FAMILY
        elif record.nameID == 4:
            record.string = f'{FAMILY} {weight}'
        elif record.nameID == 6:
            record.string = f'TanoUISansSC-{weight}'
        elif record.nameID == 3:
            record.string = f'TanoUISansSC-{weight}-gb2312'
    font.flavor = 'woff2'
    target = os.path.join(OUT, f'TanoUISansSC-{weight}.woff2')
    font.save(target)
    print(target, f'{os.path.getsize(target) / 1e6:.2f} MB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    for name in ('Regular', 'Medium', 'Bold'):
        build(sys.argv[1], name)
