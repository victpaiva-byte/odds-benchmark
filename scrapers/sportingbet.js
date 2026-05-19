/**
 * Sportingbet — odds 1x2 ("Resultado da Partida") via API CDS Entain.
 *
 * Endpoint público mas exige User-Agent + Referer + Origin (sem isso retorna 403).
 * NÃO usa Puppeteer — fetch direto via Node, ~200ms.
 */
import { makeEntry, isFuture } from './base.js';

const NAME = 'Sportingbet';
const HOST = 'https://www.sportingbet.bet.br';
const ACCESS_ID = 'YTRhMjczYjctNTBlNy00MWZlLTliMGMtMWNkOWQxMThmZTI2';

const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  Referer: `${HOST}/`,
  Origin: HOST,
};

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
    lang: 'pt-br', country: 'BR', userCountry: 'BR',
    fixtureTypes: 'Standard', state: 'Latest',
    offerMapping: 'Filtered',
    offerCategories: 'Gridable',
    fixtureCategories: 'Gridable,NonGridable,Other',
    sportIds: String(sportId),
    statisticsModes: 'None',
    skip: '0', take: '100', sortBy: 'Tags',
  });
  return `${HOST}/cds-api/bettingoffer/fixtures?${params}`;
}

export async function scrapeSportingbet(_browser) {
  const results = [];
  try {
    for (const { sportId, label } of SPORTS) {
      console.log(`[${NAME}] Fetch sportId=${sportId}`);
      const r = await fetch(buildFixturesUrl(sportId), { headers: HEADERS });
      if (!r.ok) {
        console.warn(`[${NAME}] HTTP ${r.status}`);
        continue;
      }
      const data = await r.json();
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
    }
  } catch (e) {
    console.error(`[${NAME}] Erro: ${e.message}`);
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}
