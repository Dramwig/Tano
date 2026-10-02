/** Language names from refractor's grammar catalog. Keep this as data so the picker does not bundle every grammar. */
const languageIds = `
abap abnf actionscript ada agda al antlr4 apacheconf apex apl applescript aql arduino arff armasm arturo asciidoc asm6502 asmatmel aspnet autohotkey autoit avisynth avro-idl awk bash basic batch bbcode bbj bicep birb bison bnf bqn brainfuck brightscript bro bsl c cfscript chaiscript cil cilkc cilkcpp clike clojure cmake cobol coffeescript concurnas cooklang coq cpp crystal csharp cshtml csp css-extras css csv cue cypher d dart dataweave dax dhall diff django dns-zone-file docker dot ebnf editorconfig eiffel ejs elixir elm erb erlang etlua excel-formula factor false firestore-security-rules flow fortran fsharp ftl gap gcode gdscript gedcom gettext gherkin git glsl gml gn go-module go gradle graphql groovy haml handlebars haskell haxe hcl hlsl hoon hpkp hsts http ichigojam icon icu-message-format idris iecst ignore inform7 ini io j java javadoc javadoclike javascript javastacktrace jexl jolie jq js-extras js-templates jsdoc json json5 jsonp jsstacktrace jsx julia keepalived keyman kotlin kumir kusto latex latte less lilypond linker-script liquid lisp livescript llvm log lolcode lua magma makefile markdown markup-templating markup mata matlab maxscript mel mermaid metafont mizar mongodb monkey moonscript n1ql n4js nand2tetris-hdl naniscript nasm neon nevod nginx nim nix nsis objectivec ocaml odin opencl openqasm oz parigp parser pascal pascaligo pcaxis peoplecode perl php-extras php phpdoc plant-uml plsql powerquery powershell processing prolog promql properties protobuf psl pug puppet pure purebasic purescript python q qml qore qsharp r racket reason regex rego renpy rescript rest rip roboconf robotframework ruby rust sas sass scala scheme scss shell-session smali smalltalk smarty sml solidity solution-file soy sparql splunk-spl sqf sql squirrel stan stata stylus supercollider swift systemd t4-cs t4-templating t4-vb tap tcl textile toml tremor tsx tt2 turtle twig typescript typoscript unrealscript uorazor uri v vala vbnet velocity verilog vhdl vim visual-basic warpscript wasm web-idl wgsl wiki wolfram wren xeora xml-doc xojo xquery yaml yang zig
`.trim().split(/\s+/);

const labels: Record<string, string> = {
  abap: 'ABAP', abnf: 'ABNF', apl: 'APL', bnf: 'BNF', c: 'C', cpp: 'C++',
  csharp: 'C#', css: 'CSS', csv: 'CSV', fsharp: 'F#', glsl: 'GLSL',
  go: 'Go', graphql: 'GraphQL', html: 'HTML', http: 'HTTP', ini: 'INI',
  java: 'Java', javascript: 'JavaScript', json: 'JSON', json5: 'JSON5',
  jsx: 'JSX', latex: 'LaTeX', lua: 'Lua', markdown: 'Markdown',
  markup: 'HTML', mermaid: 'Mermaid', objectivec: 'Objective-C',
  php: 'PHP', powershell: 'PowerShell', qsharp: 'Q#', regex: 'RegEx',
  sql: 'SQL', tsx: 'TSX', typescript: 'TypeScript', vbnet: 'VB.NET',
  wasm: 'WebAssembly', xml: 'XML', yaml: 'YAML',
};
const aliases: Record<string, string> = {
  bash: 'sh shell', cpp: 'c++', csharp: 'cs c#', fsharp: 'f#',
  javascript: 'js', kotlin: 'kt', latex: 'tex', markdown: 'md',
  markup: 'html xml', python: 'py', qsharp: 'q#', ruby: 'rb',
  rust: 'rs', typescript: 'ts', yaml: 'yml',
};

// Load bundled icons only when the picker renders them, rather than blocking app startup.
const iconFiles = import.meta.glob<string>('./language-icons/**/*.svg', {
  import: 'default',
  query: '?url',
});
const iconAliases: Record<string, string> = {
  antlr4: 'antlr', apacheconf: 'apache', armasm: 'assembly', asm6502: 'assembly',
  asmatmel: 'assembly', aspnet: 'dotnetcore', batch: 'command',
  'css-extras': 'css', gdscript: 'godot', glsl: 'shader', 'go-module': 'go',
  hlsl: 'shader', javadoc: 'java', javadoclike: 'java', javastacktrace: 'java',
  json5: 'json', jsonp: 'json', 'js-extras': 'javascript',
  'js-templates': 'javascript', jsdoc: 'javascript', jsstacktrace: 'javascript',
  jsx: 'react', markup: 'html', 'markup-templating': 'html', nasm: 'assembly',
  objectivec: 'objective-c', 'php-extras': 'php', phpdoc: 'php',
  'plant-uml': 'uml', plsql: 'database', protobuf: 'proto', qml: 'qt',
  scss: 'sass', 'shell-session': 'console', sql: 'database', tsx: 'react_ts',
  vbnet: 'visualbasic', 'visual-basic': 'visualbasic', 'xml-doc': 'xml',
};

function languageIcon(id: string) {
  const name = iconAliases[id] ?? id;
  return iconFiles[`./language-icons/material/${name}.svg`]
    ?? iconFiles[`./language-icons/devicon/${name}.svg`];
}

export interface CodeLanguage {
  id: string;
  label: string;
  search: string;
  icon?: () => Promise<string>;
}

export const codeLanguages: readonly CodeLanguage[] = languageIds
  .map((id) => {
    const label = labels[id] ?? id.split('-').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ');
    return { id, label, search: `${id} ${label} ${aliases[id] ?? ''}`.toLowerCase(), icon: languageIcon(id) };
  })
  .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));

export function matchingCodeLanguages(query: string): readonly CodeLanguage[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return codeLanguages;
  const rank = (language: CodeLanguage) => {
    const terms = [language.id, language.label.toLowerCase(), ...(aliases[language.id]?.split(' ') ?? [])];
    if (terms.some((term) => term === needle)) return 0;
    if (terms.some((term) => term.startsWith(needle))) return 1;
    return 2;
  };
  return codeLanguages
    .filter((language) => language.search.includes(needle))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}
