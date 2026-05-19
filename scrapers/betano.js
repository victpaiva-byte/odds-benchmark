/**
 * Betano — odds 1x2 ("Resultado Final") via API JSON interna.
 *
 * Endpoints:
 *   /api/sports/FOOT/hot/trending/leagues             → lista de ligas em destaque
 *   /api/sports/FOOT/hot/trending/leagues/{id}/events → eventos da liga com `markets`
 *
 * Cada evento traz `markets[]`; pegamos o de `type === 'MR12'` (com SuperOdds turbinada)
 * preferencialmente, senão `MRES` (Resultado Final padrão). 3 selections por mercado.
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { makeEntry, isFuture, sleep } from './base.js';

const NAME = 'Betano';
const HOST = 'https://www.betano.bet.br';
const SESSION_URL = `${HOST}/sport/futebol/`;
const PARAMS = 'req=s,stnf,c,mb';

/**
 * Betano protege a API com CDN/WAF que retorna 503 quando o fingerprint do browser
 * é compartilhado com outras sessões abertas. Por isso ele recebe um browser DEDICADO,
 * separado dos outros scrapers.
 */
export async function scrapeBetano(_sharedBrowser) {
  const results = [];
  puppeteer.use(StealthPlugin());
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=pt-BR,pt',
    ],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Accept': 'application/json, text/plain, */*',
  });

  try {
    console.log(`[${NAME}] Sessão em ${SESSION_URL}`);
    // networkidle2 espera os XHR de cookies/geo terminarem — em paralelo
    // isso é necessário pra que o trending/leagues responda em vez de 401/302.
    try {
      await page.goto(SESSION_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch {
      // se networkidle2 timeout, segue mesmo assim — pode ter carregado o suficiente
      console.log(`[${NAME}] networkidle2 timeout, prosseguindo`);
    }
    await sleep(3000);

    // 1) Trending leagues — retry com backoff
    let leagues = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      const result = await page.evaluate(async (host, params) => {
        try {
          const r = await fetch(`${host}/api/sports/FOOT/hot/trending/leagues?${params}`, { credentials: 'include' });
          if (r.status !== 200) return { status: r.status, leagues: [] };
          const j = await r.json();
          return { status: 200, leagues: j.data?.leagues || j.data || [] };
        } catch { return { status: 0, leagues: [] }; }
      }, HOST, PARAMS);
      if (result.status === 200 && Array.isArray(result.leagues) && result.leagues.length) {
        leagues = result.leagues;
        break;
      }
      console.log(`[${NAME}] tentativa ${attempt}: status=${result.status}, aguardando...`);
      await sleep(4000);
    }

    if (!Array.isArray(leagues) || !leagues.length) {
      console.warn(`[${NAME}] sem trending leagues após retry`);
      return results;
    }

    // 2) Eventos por liga
    for (const league of leagues) {
      const events = await page.evaluate(async (host, params, id) => {
        try {
          const r = await fetch(`${host}/api/sports/FOOT/hot/trending/leagues/${id}/events?${params}`, { credentials: 'include' });
          const j = await r.json();
          return j.data?.events || [];
        } catch { return []; }
      }, HOST, PARAMS, league.id);

      let added = 0;
      for (const ev of events) {
        const dt = ev.startTime ? new Date(ev.startTime) : null;
        if (dt && !isFuture(dt)) continue;

        // Prioriza MR12 (com SuperOdd aplicada), senão MRES (Resultado Final padrão)
        const market = (ev.markets || []).find(m => m.type === 'MR12')
                    || (ev.markets || []).find(m => m.type === 'MRES');
        if (!market || !Array.isArray(market.selections) || market.selections.length < 2) continue;

        const eventRaw = (ev.name || ev.shortName || '').replace(/\s*-\s*/, ' x ').trim();
        const leagueName = ev.leagueName || ev.leagueDescription || league.name || '';

        for (const sel of market.selections) {
          const odd = sel.price;
          if (!(odd > 1.01)) continue;
          results.push(makeEntry({
            bookmaker: NAME,
            eventRaw,
            league: leagueName,
            sport: 'football',
            eventDatetime: dt,
            market: '1x2',
            selection: sel.fullName || sel.name,
            oddBoosted: odd,
            oddBase: null,
          }));
          added++;
        }
      }
      console.log(`[${NAME}] liga "${league.name}" (${league.id}): ${events.length} events, ${added} entries 1x2`);
    }
  } catch (e) {
    console.error(`[${NAME}] Erro: ${e.message}`);
  } finally {
    try { await page.close(); } catch {}
    await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]).catch(()=>{});
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}
