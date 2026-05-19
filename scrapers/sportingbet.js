/**
 * Sportingbet — odds 1x2 ("Resultado da Partida") via API CDS Entain.
 *
 * Endpoint: /cds-api/bettingoffer/fixtures (precisa de cookies da sessão browser —
 * fetch direto via Node retorna 403).
 */
import { makeEntry, isFuture, sleep } from './base.js';

const NAME = 'Sportingbet';
const HOST = 'https://www.sportingbet.bet.br';
const ACCESS_ID = 'YTRhMjczYjctNTBlNy00MWZlLTliMGMtMWNkOWQxMThmZTI2';
const SESSION_URL = `${HOST}/pt-br/sports`;

const SPORTS = [
  { sportId: 4, label: 'football' },
];

function isMatchResultMarket(name) {
  const n = (name || '').trim();
  if (!/^Resultado da Partida/i.test(n)) return false;
  if (/e Quais/i.test(n)) return false;
  if (/1º|2º|1o|2o/i.test(n)) return false;
  if (/Quem Vence/i.test(n)) return false;
  return true;
}

function buildFixturesUrl(sportId) {
  const params = new URLSearchParams({
    'x-bwin-accessid': ACCESS_ID,
    lang: 'pt-br',
    country: 'BR',
    userCountry: 'BR',
    fixtureTypes: 'Standard',
    state: 'Latest',
    offerMapping: 'Filtered',
    offerCategories: 'Gridable',
    fixtureCategories: 'Gridable,NonGridable,Other',
    sportIds: String(sportId),
    statisticsModes: 'None',
    skip: '0',
    take: '100',
    sortBy: 'Tags',
  });
  return `${HOST}/cds-api/bettingoffer/fixtures?${params}`;
}

export async function scrapeSportingbet(browser) {
  const results = [];
  const page = await browser.newPage();

  try {
    console.log(`[${NAME}] Sessão em ${SESSION_URL}`);
    await page.goto(SESSION_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    for (const { sportId, label } of SPORTS) {
      const url = buildFixturesUrl(sportId);
      try {
        const data = await page.evaluate(async (u) => {
          const r = await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'include' });
          return r.ok ? r.json() : null;
        }, url);

        const fixtures = data?.fixtures || [];
        let added = 0;

        for (const fx of fixtures) {
          const dt = fx.startDate ? new Date(fx.startDate) : null;
          if (dt && !isFuture(dt)) continue;

          const teams = (fx.participants || [])
            .filter(p => p.properties?.type === 'HomeTeam' || p.properties?.type === 'AwayTeam')
            .map(p => p.name?.value)
            .filter(Boolean);
          const eventRaw = teams.length >= 2 ? teams.join(' x ') : (fx.name?.value || '');
          if (!eventRaw) continue;

          const league = fx.competition?.name?.value || fx.tournament?.name?.value || '';
          const market = (fx.optionMarkets || []).find(m => isMatchResultMarket(m.name?.value));
          if (!market) continue;
          if ((market.options || []).length !== 3) continue;

          for (const option of market.options) {
            const odd = option.price?.odds;
            if (!(odd > 1.01)) continue;
            results.push(makeEntry({
              bookmaker: NAME,
              eventRaw,
              league,
              sport: label,
              eventDatetime: dt,
              market: '1x2',
              selection: option.name?.value || '',
              oddBoosted: odd,
              oddBase: null,
            }));
            added++;
          }
        }

        console.log(`[${NAME}] sportId=${sportId} (${label}): ${fixtures.length} fixtures, ${added} entries 1x2`);
      } catch (e) {
        console.warn(`[${NAME}] sportId=${sportId} falhou: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`[${NAME}] Erro: ${e.message}`);
  } finally {
    await page.close();
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}
