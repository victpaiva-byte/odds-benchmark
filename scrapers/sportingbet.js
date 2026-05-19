/**
 * Sportingbet — odds 1x2 ("Resultado da Partida") via API CDS Entain.
 *
 * Endpoint: /cds-api/bettingoffer/fixtures (sem filtro isPriceBoost) →
 * cada fixture vem com `optionMarkets` incluindo um mercado tipo
 * "Resultado da Partida - VP (+2)" com 3 options: time A, X, time B.
 *
 * Cada outcome vira um entry independente (market='1x2', selection=name do option).
 */
import { makeEntry, isFuture, sleep } from './base.js';

const NAME = 'Sportingbet';
const HOST = 'https://www.sportingbet.bet.br';
const ACCESS_ID = 'YTRhMjczYjctNTBlNy00MWZlLTliMGMtMWNkOWQxMThmZTI2';
const SESSION_URL = `${HOST}/pt-br/sports`;

const SPORTS = [
  { sportId: 4, label: 'football' },
];

// Mercado 1x2 principal da Sportingbet. O sufixo "- VP (+2)" identifica a variante
// 3-way com empate. Excluímos "Resultado da Partida e Quais Equipes Marcam",
// "1º Tempo - Resultado da Partida", etc.
function isMatchResultMarket(name) {
  const n = (name || '').trim();
  if (!/^Resultado da Partida/i.test(n)) return false;
  // Exclui combos e variantes de tempo
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

          const market = (fx.optionMarkets || []).find(m => isMatchResultMarket(m.name?.value));
          if (!market) continue;
          // 1x2 clássico: 3 outcomes (Time A / Empate / Time B). Pula handicaps etc.
          if ((market.options || []).length !== 3) continue;

          for (const option of (market.options || [])) {
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

function teamsFromFixture(fx) {
  const teams = (fx.participants || [])
    .filter(p => p.properties?.type === 'HomeTeam' || p.properties?.type === 'AwayTeam')
    .map(p => p.name?.value)
    .filter(Boolean);
  if (teams.length >= 2) return teams.join(' x ');
  return fx.name?.value || '';
}
