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
import { makeEntry, isFuture, sleep } from './base.js';

const NAME = 'Betano';
const HOST = 'https://www.betano.bet.br';
const SESSION_URL = `${HOST}/sport/futebol/`;
const PARAMS = 'req=s,stnf,c,mb';

export async function scrapeBetano(browser) {
  const results = [];
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Accept': 'application/json, text/plain, */*',
  });

  try {
    console.log(`[${NAME}] Sessão em ${SESSION_URL}`);
    // domcontentloaded é ~30s mais rápido que networkidle2; sleep curto cobre cookies.
    try {
      await page.goto(SESSION_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch {
      console.log(`[${NAME}] goto timeout, prosseguindo`);
    }
    await sleep(2500);

    // 1) Trending leagues — 2 tentativas (era 4)
    let leagues = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
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
      await sleep(3000);
    }

    if (!Array.isArray(leagues) || !leagues.length) {
      console.warn(`[${NAME}] sem trending leagues`);
      return results;
    }

    // 2) Eventos por liga — todas em PARALELO (era sequencial = 5 min)
    const leagueResults = await Promise.all(leagues.map(league =>
      page.evaluate(async (host, params, id) => {
        try {
          const r = await fetch(`${host}/api/sports/FOOT/hot/trending/leagues/${id}/events?${params}`, { credentials: 'include' });
          const j = await r.json();
          return j.data?.events || [];
        } catch { return []; }
      }, HOST, PARAMS, league.id).then(events => ({ league, events }))
    ));

    for (const { league, events } of leagueResults) {
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
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}
