/**
 * Gera dashboard/benchmark.pdf — versão print-friendly do dashboard, com todas as
 * categorias (Vencendo / Perdendo / Só Estrela) em sequência numa única página linear.
 *
 * Workflow: node main.js → node scripts/build-pdf.js
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFileSync, writeFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

puppeteer.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_FILE = join(ROOT, 'data', 'odds.json');
const OUTPUT    = join(ROOT, 'dashboard', 'benchmark.pdf');

const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
const rows = (data.rows || []).filter(r => {
  if (!r.eventDatetime) return true;
  return new Date(r.eventDatetime) > new Date();
});

const RIVALS = ['Sportingbet', 'Betano'];

function classify(row) {
  const hasEstrela = !!row.estrelaOdd;
  const rivalsWithOdd = RIVALS.filter(b => row.odds[b]);
  if (!hasEstrela) return 'gap';
  if (rivalsWithOdd.length === 0) return 'excl';
  if (row.estrelaIsBest) return 'win';
  return 'loss';
}

function gapPct(row, cat) {
  const estrela = row.estrelaOdd || 0;
  const rivalOdds = RIVALS.map(b => row.odds[b]?.odd).filter(Boolean);
  if (!rivalOdds.length || !estrela) return 0;
  const bestRival = Math.max(...rivalOdds);
  if (cat === 'win')  return ((estrela - bestRival) / bestRival) * 100;
  if (cat === 'loss') return ((bestRival - estrela) / estrela) * 100;
  return 0;
}

const buckets = { win: [], loss: [], excl: [] };
for (const r of rows) {
  const cat = classify(r);
  if (buckets[cat]) buckets[cat].push({ ...r, _cat: cat });
}
buckets.win.sort((a, b) => gapPct(b, 'win') - gapPct(a, 'win'));
buckets.loss.sort((a, b) => gapPct(b, 'loss') - gapPct(a, 'loss'));
buckets.excl.sort((a, b) => (b.estrelaOdd || 0) - (a.estrelaOdd || 0));

function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) + ' ' +
         d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function rowRow(r) {
  const cat = r._cat;
  const estrela = r.odds['Estrelabet']?.odd;
  const rivals = RIVALS
    .map(b => ({ book: b, odd: r.odds[b]?.odd }))
    .filter(x => x.odd);
  rivals.sort((a, b) => b.odd - a.odd);
  const rivalCells = RIVALS.map(b => {
    const v = r.odds[b]?.odd;
    return `<td class="odd-cell">${v ? v.toFixed(2) : '<span class="muted">—</span>'}</td>`;
  }).join('');

  let gapCell = '';
  if (cat === 'win' || cat === 'loss') {
    const g = gapPct(r, cat);
    const sign = cat === 'win' ? '+' : '−';
    const cls = cat === 'win' ? 'gap-win' : 'gap-loss';
    gapCell = `<td class="${cls}">${sign}${g.toFixed(1)}% vs ${rivals[0]?.book || '—'}</td>`;
  } else if (cat === 'excl') {
    gapCell = `<td class="gap-excl">Só Estrela tem turbinada</td>`;
  }

  return `
    <tr class="row-${cat}">
      <td class="when">${fmtDT(r.eventDatetime)}</td>
      <td class="event">
        <div class="event-name">${escapeHtml(r.eventRaw)}</div>
        <div class="event-meta">${escapeHtml(r.league || '—')} · vencedor: <strong>${escapeHtml(r.selection)}</strong></div>
      </td>
      <td class="odd-cell estrela">${estrela ? estrela.toFixed(2) : '—'}</td>
      ${rivalCells}
      ${gapCell}
    </tr>
  `;
}

function section(title, icon, color, rows, kind) {
  if (!rows.length) return '';
  return `
    <section class="section ${kind}">
      <h2><span class="icon">${icon}</span> ${title} <span class="count">(${rows.length})</span></h2>
      <table>
        <thead>
          <tr>
            <th>Quando</th>
            <th>Evento / Outcome</th>
            <th class="th-estrela">Estrelabet</th>
            ${RIVALS.map(b => `<th>${b}</th>`).join('')}
            <th>Comparação</th>
          </tr>
        </thead>
        <tbody>${rows.map(rowRow).join('')}</tbody>
      </table>
    </section>
  `;
}

const winRate = (buckets.win.length + buckets.loss.length + buckets.excl.length) > 0
  ? (buckets.win.length / (buckets.win.length + buckets.loss.length + buckets.excl.length) * 100).toFixed(0)
  : 0;

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Benchmark Super Odds 1x2 — Estrelabet</title>
<style>
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, "Segoe UI", Inter, system-ui, sans-serif;
  color: #0f172a; font-size: 10pt; line-height: 1.35;
}

.cover {
  border-bottom: 2px solid #dc2626; padding-bottom: 12px; margin-bottom: 16px;
  display: flex; align-items: center; gap: 16px;
}
.cover .mark {
  width: 44px; height: 44px; border-radius: 10px;
  background: linear-gradient(135deg,#dc2626,#991b1b);
  display: grid; place-items: center; color: #fff; font-size: 22px; font-weight: 800;
}
.cover h1 { font-size: 18pt; letter-spacing: -.01em; }
.cover .tag { font-size: 10pt; color: #475569; margin-top: 2px; }
.cover .meta { margin-left: auto; text-align: right; font-size: 9pt; color: #475569; }

.kpis { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin-bottom: 18px; }
.kpi {
  border: 1px solid #e2e8f0; border-left: 4px solid #cbd5e1;
  border-radius: 8px; padding: 10px 12px; background: #fff;
}
.kpi.win  { border-left-color: #16a34a; }
.kpi.loss { border-left-color: #dc2626; }
.kpi.excl { border-left-color: #d97706; }
.kpi.gap  { border-left-color: #2563eb; }
.kpi .label { font-size: 8pt; color: #475569; text-transform: uppercase; font-weight: 700; letter-spacing: .04em; }
.kpi .val { font-size: 18pt; font-weight: 800; margin: 2px 0 0; letter-spacing: -.02em; }
.kpi.win .val  { color: #16a34a; }
.kpi.loss .val { color: #dc2626; }
.kpi.excl .val { color: #d97706; }
.kpi.gap .val  { color: #2563eb; }
.kpi .desc { font-size: 8pt; color: #64748b; margin-top: 2px; }

.exec-summary {
  margin-bottom: 20px; padding: 14px 18px;
  background: #fafafa; border: 1px solid #e2e8f0; border-radius: 10px;
  page-break-after: always;
}
.exec-summary h2 {
  font-size: 13pt; margin-bottom: 10px; color: #0f172a;
  border-bottom: 2px solid #dc2626; padding-bottom: 6px;
}
.exec-summary h3 {
  font-size: 10.5pt; margin: 12px 0 4px; color: #991b1b;
  display: flex; align-items: center; gap: 6px;
}
.exec-summary p, .exec-summary li { font-size: 9.5pt; line-height: 1.5; color: #334155; }
.exec-summary ul { margin-left: 18px; }
.exec-summary li { margin-bottom: 3px; }
.exec-summary .callout {
  background: #fff; border-left: 3px solid #dc2626;
  padding: 8px 12px; margin: 6px 0; font-size: 9pt;
}
.exec-summary .reading {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px;
}
.exec-summary .reading > div {
  border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; background: #fff;
}
.exec-summary .reading strong { color: #0f172a; }

.section { margin-top: 18px; page-break-inside: avoid; }
.section h2 {
  font-size: 12pt; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;
}
.section h2 .icon { font-size: 12pt; }
.section h2 .count {
  font-size: 9pt; font-weight: 600; color: #475569; margin-left: auto;
  background: #f1f5f9; padding: 2px 8px; border-radius: 999px;
}
.section.win  h2 { color: #166534; }
.section.loss h2 { color: #991b1b; }
.section.excl h2 { color: #92400e; }

table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th, td { padding: 5px 7px; text-align: left; vertical-align: middle; }
thead th {
  background: #1e293b; color: #fff; font-size: 8pt; font-weight: 700;
  letter-spacing: .03em; text-transform: uppercase;
}
thead th.th-estrela { background: #991b1b; }
tbody tr { border-bottom: 1px solid #e2e8f0; }
tbody tr:nth-child(even) { background: #f8fafc; }

.when { white-space: nowrap; font-variant-numeric: tabular-nums; color: #475569; }
.event { max-width: 240px; }
.event-name { font-weight: 700; font-size: 10pt; }
.event-meta { font-size: 8pt; color: #64748b; margin-top: 1px; }
.odd-cell { font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; min-width: 50px; }
.odd-cell.estrela { background: #fef3c7; font-weight: 800; color: #92400e; }
.row-win  .odd-cell.estrela { background: #dcfce7; color: #166534; }
.row-loss .odd-cell.estrela { background: #fee2e2; color: #991b1b; }

.gap-win  { color: #166534; font-weight: 700; font-size: 8.5pt; white-space: nowrap; }
.gap-loss { color: #991b1b; font-weight: 700; font-size: 8.5pt; white-space: nowrap; }
.gap-excl { color: #92400e; font-style: italic; font-size: 8.5pt; }
.muted { color: #cbd5e1; }

footer {
  margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0;
  font-size: 8pt; color: #64748b;
}
</style>
</head>
<body>

<div class="cover">
  <div class="mark">⚡</div>
  <div>
    <h1>Benchmark Super Odds 1x2</h1>
    <div class="tag">Estrelabet (turbinada) vs Sportingbet · Betano (odd padrão 1x2)</div>
  </div>
  <div class="meta">
    <div>Gerado em ${new Date().toLocaleString('pt-BR')}</div>
    <div>Coleta: ${fmtDT(data.updatedAt)}</div>
    <div>${data.totalRows} mercados analisados</div>
  </div>
</div>

<section class="exec-summary">
  <h2>Resumo Executivo — Benchmark Super Odds 1x2</h2>
  <p>
    Esta ferramenta compara, todos os dias, as <strong>Super Odds 1x2</strong> da Estrelabet
    contra as odds <strong>1x2 padrão</strong> oferecidas pelos principais concorrentes brasileiros
    (Sportingbet e Betano), para identificar em quais mercados estamos pagando mais — e em quais
    estamos perdendo para a concorrência.
  </p>

  <h3>O que a ferramenta faz</h3>
  <ul>
    <li><strong>Coleta automática:</strong> raspa as Super Odds 1x2 ativas no site da Estrelabet e
        as cotações 1x2 padrão dos mesmos eventos nas casas concorrentes.</li>
    <li><strong>Pareamento apples-to-apples:</strong> só compara odds do <em>mesmo evento</em> e
        <em>mesmo desfecho</em> (Vitória A / Empate / Vitória B), garantindo que a comparação seja
        legítima.</li>
    <li><strong>Classificação:</strong> cada mercado é rotulado como uma das quatro categorias:
        <em>vencendo, perdendo, só Estrela tem</em>, ou <em>concorrente tem e nós não</em>.</li>
  </ul>

  <h3>Como ler os números</h3>
  <div class="reading">
    <div><strong>🏆 Estrela vence:</strong> mercados onde a Super Odd da Estrela é a maior entre as casas comparadas. Significa que estamos pagando mais que o mercado nesse desfecho.</div>
    <div><strong>⚠️ Estrela perde:</strong> mercados onde uma rival oferece cota maior na 1x2 padrão do que nossa Super Odd. Oportunidade de revisão pelo time de odds.</div>
    <div><strong>⭐ Só Estrela:</strong> mercados onde só nós oferecemos cota turbinada — não há equivalente nas rivais.</div>
    <div><strong>Comparação %:</strong> diferença percentual entre nossa odd e a do melhor rival no mesmo desfecho.</div>
  </div>

  <h3>Cadência e onde acessar</h3>
  <p>
    O benchmark é gerado <strong>sob demanda</strong> a partir de uma única execução local
    (~30 segundos), produzindo dois artefatos: um <strong>dashboard interativo</strong> hospedado
    no Lovable (URL pública, sem servidor próprio) e este <strong>PDF</strong> para distribuição.
    O processo é manual hoje, mas pode ser automatizado por agendamento se útil.
  </p>

  <h3>Limitações conhecidas (transparência)</h3>
  <ul>
    <li><strong>Cobertura de concorrentes:</strong> Bet365 não é coletado (proteção técnica do site);
        Superbet não disponibiliza 1x2 padrão de forma automatizada em todos os eventos.</li>
    <li><strong>Foco em 1x2:</strong> outros mercados turbinados (combos, props, over/under) não entram
        nesta comparação — a ferramenta foca onde a comparação é matematicamente comparável.</li>
    <li><strong>Movimentação de mercado:</strong> as odds variam ao longo do dia; este relatório é
        um snapshot no momento da coleta indicado no canto superior direito.</li>
  </ul>

  <div class="callout">
    <strong>Leitura prática:</strong> a aba "Estrela perde" é a mais acionável — lista mercados
    em que algum concorrente paga mais do que nossa Super Odd para o mesmo desfecho. É a fila do
    time de odds para revisão competitiva.
  </div>
</section>

<div class="kpis">
  <div class="kpi win">
    <div class="label">🏆 Estrela vence</div>
    <div class="val">${buckets.win.length}</div>
    <div class="desc">${winRate}% dos mercados onde competimos</div>
  </div>
  <div class="kpi loss">
    <div class="label">⚠️ Estrela perde</div>
    <div class="val">${buckets.loss.length}</div>
    <div class="desc">rival oferece odd maior</div>
  </div>
  <div class="kpi excl">
    <div class="label">⭐ Só Estrela</div>
    <div class="val">${buckets.excl.length}</div>
    <div class="desc">sem turbo equivalente nas rivais</div>
  </div>
  <div class="kpi gap">
    <div class="label">Total mercados</div>
    <div class="val">${buckets.win.length + buckets.loss.length + buckets.excl.length}</div>
    <div class="desc">comparações apples-to-apples</div>
  </div>
</div>

${section('Onde a Estrela vence', '🏆', 'win',  buckets.win,  'win')}
${section('Onde a Estrela perde', '⚠️', 'loss', buckets.loss, 'loss')}
${section('Só a Estrela tem',     '⭐', 'excl', buckets.excl, 'excl')}

<footer>
  Super odd da Estrelabet (mercado "Vencedor do encontro - Super Odds") comparada com 1x2 padrão das rivais.
  Bet365 e Superbet fora deste benchmark (sem 1x2 padronizado disponível na fonte automatizada).
  Bookmakers comparados: Estrelabet, Sportingbet, Betano.
</footer>

</body>
</html>`;

// Gera PDF via Puppeteer
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'domcontentloaded' });
await page.pdf({
  path: OUTPUT,
  format: 'A4',
  printBackground: true,
  margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
});
await browser.close();

const sizeKB = (statSync(OUTPUT).size / 1024).toFixed(1);
console.log(`✓ ${OUTPUT}`);
console.log(`  ${sizeKB} KB · ${buckets.win.length} wins · ${buckets.loss.length} losses · ${buckets.excl.length} exclusivas`);
console.log(`  win-rate: ${winRate}%`);
