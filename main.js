/**
 * Orquestrador: coleta todos os scrapers e salva data/odds.json
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

puppeteer.use(StealthPlugin());
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { scrapeSuperbet }   from './scrapers/superbet.js';
import { scrapeBetano }     from './scrapers/betano.js';
import { scrapeSportingbet } from './scrapers/sportingbet.js';
import { scrapeEstrelabet } from './scrapers/estrelabet.js';
import { buildComparison, buildSummary } from './matcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'odds.json');

// Scrapers que usam fetch direto (não precisam de browser) — rodam imediatamente.
const FETCH_SCRAPERS = [
  { name: 'Estrelabet',  fn: scrapeEstrelabet },
  { name: 'Sportingbet', fn: scrapeSportingbet },
  { name: 'Superbet',    fn: scrapeSuperbet },
];
// Scrapers que precisam de browser (Betano: WAF). Recebem a Promise do browser.
const BROWSER_SCRAPERS = [
  { name: 'Betano', fn: scrapeBetano },
];

export async function runCollection() {
  console.log('\n=== Iniciando coleta de Super Odds ===');

  // 1) Lança o browser EM PARALELO com os fetches diretos (não bloqueia).
  const browserPromise = puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--lang=pt-BR,pt',
    ],
    defaultViewport: { width: 1440, height: 900 },
  });

  const allEntries = [];
  let browser = null;

  try {
    // 2) Fetches diretos (sem esperar o browser) e scrapers do browser (esperam) em paralelo
    const all = await Promise.allSettled([
      ...FETCH_SCRAPERS.map(s =>
        s.fn(null).catch(e => { console.error(`[${s.name}] Erro fatal: ${e.message}`); return []; })
      ),
      ...BROWSER_SCRAPERS.map(s =>
        browserPromise
          .then(b => { browser = b; return s.fn(b); })
          .catch(e => { console.error(`[${s.name}] Erro fatal: ${e.message}`); return []; })
      ),
    ]);

    for (const r of all) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) allEntries.push(...r.value);
    }
  } finally {
    // Browser pode não ter sido inicializado se algo deu pau cedo
    if (!browser) {
      try { browser = await browserPromise; } catch {}
    }
    if (browser) {
      await Promise.race([
        browser.close(),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]).catch(() => {});
    }
  }

  console.log(`\nTotal de entries brutos: ${allEntries.length}`);

  const rows = buildComparison(allEntries);
  const summary = buildSummary(rows);

  mkdirSync(join(__dirname, 'data'), { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    totalRows: rows.length,
    rawCount: allEntries.length,
    summary,
    rows,
  };

  // Guard: não sobrescrever um dado bom com uma coleta que falhou parcialmente.
  if (rows.length < 20) {
    console.warn(`\n⚠️  Coleta retornou apenas ${rows.length} linhas — não sobrescrevendo data/odds.json`);
    return payload;
  }

  writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));

  console.log(`\n✓ Salvo em data/odds.json (${rows.length} linhas comparativas)`);
  console.log(`  Estrelabet melhor: ${summary.estrelaIsBestCount}/${summary.totalMarkets} (${summary.winRate}%)`);

  return payload;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCollection()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
