/**
 * Bet365 — "Acumuladores Aumentados" / Power Price.
 * Best-effort: Bet365 ofusca classes (gl-*, pb-*) e usa WebSocket binário próprio.
 * Stealth resolve o Cloudflare; o restante depende da SPA renderizar a tempo.
 */
import { makeEntry, parseOdd, sleep } from './base.js';

const NAME = 'Bet365';
const URLS = [
  'https://www.bet365.bet.br/#/AC/B1/C1/D8/E107/',  // Power Price / acumuladores aumentados
  'https://www.bet365.bet.br/#/AC/B1/C1/D13/E5/F10/',
];

export async function scrapeBet365(browser) {
  const page = await browser.newPage();
  const results = [];

  try {
    for (const url of URLS) {
      try {
        console.log(`[${NAME}] Abrindo ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(20000); // Bet365 SPA é pesada — precisa tempo

        const items = await page.evaluate(() => {
          const out = [];
          const selectors = [
            '[class*="pb-PowerPriceMarket"]',
            '[class*="pb-MarketGroupButton"]',
            '[class*="PowerPrice"]',
            '[class*="PriceBoost"]',
            '[class*="EnhancedOdds"]',
            '[class*="BoostedOdds"]',
            '[class*="gl-MarketGroup"]',
          ];
          const found = new Set();
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(el => found.add(el));
          }
          for (const el of found) {
            const text = el.innerText?.trim() || '';
            if (!text) continue;
            const oddMatches = text.match(/\b(\d+[.,]\d{2})\b/g) || [];
            const eventLines = text.split('\n').filter(l => l.trim() && !l.match(/^\d+[.,]\d{2}$/));
            for (const oddStr of oddMatches) {
              const odd = parseFloat(oddStr.replace(',', '.'));
              if (odd < 1.01 || odd > 100) continue;
              out.push({
                eventName: eventLines.slice(0, 2).join(' - ').slice(0, 100),
                oddText: oddStr,
              });
            }
          }
          return out;
        });

        console.log(`[${NAME}] ${items.length} candidates em ${url}`);

        for (const item of items) {
          const oddBoosted = parseOdd(item.oddText);
          if (!oddBoosted) continue;
          results.push(makeEntry({
            bookmaker: NAME,
            eventRaw: item.eventName || `Bet365 #${results.length + 1}`,
            league: '',
            sport: 'football',
            eventDatetime: null,
            market: 'Power Price',
            selection: item.eventName || 'Seleção',
            oddBoosted,
          }));
        }

        if (results.length) break; // primeira URL com resultado é suficiente
      } catch (e) {
        console.warn(`[${NAME}] ${url}: ${e.message}`);
      }
    }

    if (!results.length) {
      const title = await page.title().catch(() => '');
      console.log(`[${NAME}] best-effort, 0 entries (último title: "${title}")`);
    }
  } finally {
    await page.close();
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}
