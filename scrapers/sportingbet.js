/**
 * Sportingbet — "Cotas Aumentadas" via API CDS da Entain.
 * Endpoint: /cds-api/bettingoffer/fixtures com isPriceBoost=true
 * Cada option em fixture.optionMarkets[].options[] tem price.odds (base)
 * e, quando boost, boostedPrice.odds (aumentada).
 */
import { makeEntry, isFuture, sleep } from './base.js';

const NAME = 'Sportingbet';
const HOST = 'https://www.sportingbet.bet.br';
const ACCESS_ID = 'YTRhMjczYjctNTBlNy00MWZlLTliMGMtMWNkOWQxMThmZTI2';
const SESSION_URL = `${HOST}/pt-br/sports`;

const SPORTS = [
  { sportId: 4,  label: 'football' },
  { sportId: 7,  label: 'basketball' },
];

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
    isPriceBoost: 'true',
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
    await page.goto(SESSION_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);

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

          const eventRaw = teamsFromFixture(fx);
          const league   = fx.competition?.name?.value || fx.tournament?.name?.value || '';

          for (const market of (fx.optionMarkets || [])) {
            for (const option of (market.options || [])) {
              const oddBoosted = option.boostedPrice?.odds;
              if (!(oddBoosted > 1.01)) continue;
              const oddBase = option.price?.odds || null;

              results.push(makeEntry({
                bookmaker: NAME,
                eventRaw,
                league,
                sport: label,
                eventDatetime: dt,
                market: market.name?.value || 'Cota Aumentada',
                selection: option.name?.value || eventRaw,
                oddBoosted,
                oddBase,
              }));
              added++;
            }
          }
        }

        console.log(`[${NAME}] sportId=${sportId} (${label}): ${fixtures.length} fixtures, ${added} entries`);
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

function teamsFromFixture(fx) {
  const teams = (fx.participants || [])
    .filter(p => p.properties?.type === 'HomeTeam' || p.properties?.type === 'AwayTeam')
    .map(p => p.name?.value)
    .filter(Boolean);
  if (teams.length >= 2) return teams.join(' x ');
  return fx.name?.value || '';
}
