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
import { scrapeBet365 }     from './scrapers/bet365.js';
import { scrapeEstrelabet } from './scrapers/estrelabet.js';
import { buildComparison, buildSummary } from './matcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'odds.json');

// Scrapers ativos. Bet365 desativado — Cloudflare + WS binário inviável.
const PARALLEL_SCRAPERS = [
  { name: 'Estrelabet',  fn: scrapeEstrelabet },
  { name: 'Sportingbet', fn: scrapeSportingbet },
  { name: 'Betano',      fn: scrapeBetano },
  { name: 'Superbet',    fn: scrapeSuperbet },
];
const SEQUENTIAL_SCRAPERS = [];

export async function runCollection() {
  console.log('\n=== Iniciando coleta de Super Odds ===');

  const browser = await puppeteer.launch({
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

  let allEntries = [];

  try {
    // 1) Scrapers em paralelo (browser saturado é OK pra esses)
    const parallel = await Promise.allSettled(
      PARALLEL_SCRAPERS.map(s => s.fn(browser).catch(e => {
        console.error(`[${s.name}] Erro fatal: ${e.message}`);
        return [];
      }))
    );
    for (const r of parallel) {
      if (r.status === 'fulfilled') allEntries.push(...r.value);
    }

    // 2) Scrapers sequenciais (browser já idle, evita rate-limit do WAF)
    for (const s of SEQUENTIAL_SCRAPERS) {
      try {
        const entries = await s.fn(browser);
        allEntries.push(...entries);
      } catch (e) {
        console.error(`[${s.name}] Erro fatal: ${e.message}`);
      }
    }
  } finally {
    // browser.close() pode travar com Estrelabet (Altenar mantém WS persistente).
    // Race com timeout pra garantir que o processo libera os recursos.
    await Promise.race([
      browser.close(),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]).catch(() => {});
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

  // Guard: não sobrescrever um dado bom com uma coleta que falhou.
  // Se < 20 entries, provavelmente algum scraper deu timeout — mantém o anterior.
  if (rows.length < 20) {
    console.warn(`\n⚠️  Coleta retornou apenas ${rows.length} linhas — não sobrescrevendo data/odds.json (provável falha parcial)`);
    return payload;
  }

  writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));

  console.log(`\n✓ Salvo em data/odds.json (${rows.length} linhas comparativas)`);
  console.log(`  Estrelabet melhor: ${summary.estrelaIsBestCount}/${summary.totalMarkets} (${summary.winRate}%)`);

  return payload;
}

// Execução direta
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCollection()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
