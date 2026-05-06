/**
 * Betano — "CA TURBINADA" / "Odds Turbinadas".
 * Usa a API interna `/api/sports/{SPORT}/hot/smartpicks` que popula o carrossel.
 * Estrutura: data.sports[].tabs[] (filtrar tab.title === 'Odds Turbinadas')
 *           → promoMarkets[] com title (evento), subtitle[] (legs do combo)
 *             e selections[] com price (boosted) e originalPrice (base).
 */
import { makeEntry, isFuture, sleep } from './base.js';

const NAME = 'Betano';
const HOST = 'https://www.betano.bet.br';

const SPORTS = [
  { code: 'FOOT', label: 'football',   pageUrl: `${HOST}/sport/futebol/` },
  { code: 'BASK', label: 'basketball', pageUrl: `${HOST}/sport/basquetebol/` },
];

const SMARTPICKS_TAB = 'Odds Turbinadas';

export async function scrapeBetano(browser) {
  const results = [];
  const page = await browser.newPage();

  try {
    for (const sport of SPORTS) {
      try {
        console.log(`[${NAME}] Sessão em ${sport.pageUrl}`);
        await page.goto(sport.pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(3000);

        const apiUrl = `${HOST}/api/sports/${sport.code}/hot/smartpicks?req=s,stnf,c,mb`;
        const json = await page.evaluate(async (url) => {
          const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
          return r.ok ? r.json() : null;
        }, apiUrl);

        if (!json) {
          console.warn(`[${NAME}] ${sport.code}: API smartpicks sem resposta`);
          continue;
        }

        const sports = json?.data?.sports || [];
        for (const s of sports) {
          for (const tab of (s.tabs || [])) {
            if (tab.title !== SMARTPICKS_TAB) continue;
            for (const promo of (tab.promoMarkets || [])) {
              const entries = promoToEntries(promo, sport.label);
              results.push(...entries);
            }
          }
        }

        console.log(`[${NAME}] ${sport.code}: ${results.length} entries acumulados`);
      } catch (e) {
        console.warn(`[${NAME}] ${sport.code} falhou: ${e.message}`);
      }
    }
  } finally {
    await page.close();
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}

function promoToEntries(promo, sport) {
  const eventRaw = (promo.title || '').replace(/\s+-\s+/, ' x ').trim();
  if (!eventRaw) return [];

  const market = (promo.subtitle || [])
    .map(s => `${s.marketName}: ${s.selectionName}`.trim())
    .filter(Boolean)
    .join(' + ') || 'CA Turbinada';

  const selections = Array.isArray(promo.selections) ? promo.selections : [];
  const out = [];
  for (const sel of selections) {
    const oddBoosted = +sel.price;
    const oddBase    = sel.originalPrice ? +sel.originalPrice : null;
    if (!(oddBoosted > 1.01)) continue;

    out.push(makeEntry({
      bookmaker: 'Betano',
      eventRaw,
      league: '',
      sport,
      eventDatetime: null, // smartpicks não traz data; o matcher aceita null
      market,
      selection: sel.name || eventRaw,
      oddBoosted,
      oddBase,
    }));
  }
  return out;
}
