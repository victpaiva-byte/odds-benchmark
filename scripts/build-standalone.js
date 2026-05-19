/**
 * Gera dashboard/standalone.html — um único arquivo HTML com data/odds.json
 * embedado em window.__DATA__. Sem fetch, sem servidor. Pronto para colar no Lovable
 * ou abrir direto no browser (file://).
 *
 * Workflow:
 *   1. node main.js               # gera data/odds.json
 *   2. node scripts/build-standalone.js   # gera dashboard/standalone.html
 *   3. Copia o conteúdo de dashboard/standalone.html → Lovable
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const TEMPLATE  = join(ROOT, 'dashboard', 'server.html');
const DATA_FILE = join(ROOT, 'data', 'odds.json');
// Saímos em dois caminhos: standalone.html (legado) e index.html (entry point GH Pages).
const OUTPUT    = join(ROOT, 'dashboard', 'index.html');
const OUTPUT_LEGACY = join(ROOT, 'dashboard', 'standalone.html');

let html = readFileSync(TEMPLATE, 'utf8');
const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));

// 1. Remove o botão "Coletar agora" — não há servidor /trigger no standalone
html = html.replace(
  /\s*<button class="btn btn-trigger"[^>]*>[^<]*<\/button>/,
  ''
);

// 2. Substitui o bloco fetch("/data") por leitura direta do __DATA__ embedado.
//    O resto do loadData (renderKPIs, applyFilters, last-updated) continua igual.
html = html.replace(
  /const res = await fetch\("\/data\?" \+ Date\.now\(\)\);\s*\n\s*if \(!res\.ok\) throw new Error\("HTTP " \+ res\.status\);\s*\n\s*const data = await res\.json\(\);/,
  'const data = window.__DATA__;'
);

// 3. Remove a função triggerScrape (não há /trigger no standalone)
html = html.replace(
  /\nasync function triggerScrape\(\) \{[\s\S]*?\n\}\n/,
  '\n'
);

// 4. Remove o auto-refresh (dados estáticos, não muda sem rebuild)
html = html.replace(
  /\n\/\/ Auto-refresh a cada 10 minutos\nsetInterval\(loadData, 10 \* 60 \* 1000\);\n/,
  '\n'
);

// 5. Injeta window.__DATA__ antes do <script> principal.
//    Match no <script> que aparece logo antes do </body> (último <script>).
const dataScript = `<script>window.__DATA__ = ${JSON.stringify(data)};</script>\n`;
html = html.replace(/(<script>)(\s*(?:\/\/[^\n]*\n)*\s*const BOOKMAKERS)/, dataScript + '$1$2');

// 6. Sanidade: confirma que as transformações funcionaram
const required = [
  ['__DATA__ embedado',  'window.__DATA__ ='],
  ['fetch removido',     /fetch\("\/data/, true],
  ['trigger removido',   /triggerScrape/, true],
  ['botão removido',     /<button[^>]*btn-trigger/, true],
];
for (const [label, needle, mustBeAbsent] of required) {
  const present = needle instanceof RegExp ? needle.test(html) : html.includes(needle);
  const ok = mustBeAbsent ? !present : present;
  if (!ok) {
    console.error(`✗ Falha: ${label} (mustBeAbsent=${!!mustBeAbsent}, present=${present})`);
    process.exit(1);
  }
}

writeFileSync(OUTPUT, html);
writeFileSync(OUTPUT_LEGACY, html);

const sizeKB = (html.length / 1024).toFixed(1);
console.log(`✓ ${OUTPUT} (+ standalone.html)`);
console.log(`  ${sizeKB} KB · ${data.totalRows} linhas · atualizado ${data.updatedAt}`);
console.log(`  Estrelabet melhor: ${data.summary.estrelaIsBestCount}/${data.summary.totalMarkets} (${data.summary.winRate}%)`);
