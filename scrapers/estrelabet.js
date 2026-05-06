/**
 * Estrelabet — "Super Múltipla" / Bet Cards turbinados.
 * Plataforma: Altenar V2 (`*.altenar2.biahosted.com`) com integration=estrelabet.
 * Endpoints:
 *   - GetBetCards (betCardListId=108)  → cards com `price` (base) e `boostInfo.price` (boosted)
 *   - GetEventDetails(eventId=X)        → resolve nome/liga/competidores
 */
import { makeEntry, isFuture, sleep } from './base.js';

const NAME = 'Estrelabet';
const SESSION_URL = 'https://www.estrelabet.bet.br/aposta-esportiva';

const ALTENAR_FRONTEND = 'https://sb2frontend-altenar2.biahosted.com';
const ALTENAR_PARAMS = 'culture=pt-BR&timezoneOffset=180&integration=estrelabet&deviceType=1&numFormat=en-GB&countryCode=BR';

const BET_CARDS_URL    = `${ALTENAR_FRONTEND}/api/BetCards/GetBetCards?${ALTENAR_PARAMS}&betCardListId=108&sportId=0`;
const EVENT_DETAILS_URL = (eventId) =>
  `${ALTENAR_FRONTEND}/api/widget/GetEventDetails?${ALTENAR_PARAMS}&eventId=${eventId}`;

export async function scrapeEstrelabet(browser) {
  const results = [];
  const page = await browser.newPage();

  try {
    console.log(`[${NAME}] Sessão em ${SESSION_URL}`);
    await page.goto(SESSION_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(4000);

    const cards = await page.evaluate(async (url) => {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      return r.ok ? r.json() : null;
    }, BET_CARDS_URL);

    const list = (cards?.betCards || []).filter(c => c.boostInfo && c.boostInfo.price > c.price);
    console.log(`[${NAME}] BetCards turbinados: ${list.length} de ${cards?.betCards?.length || 0}`);

    // Cache de detalhes pra evitar refetch do mesmo eventId
    const detailsCache = new Map();
    async function getDetails(eventId) {
      if (detailsCache.has(eventId)) return detailsCache.get(eventId);
      const d = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url, { headers: { Accept: 'application/json' } });
          return r.ok ? r.json() : null;
        } catch { return null; }
      }, EVENT_DETAILS_URL(eventId));
      detailsCache.set(eventId, d);
      return d;
    }

    for (const card of list) {
      const eventIds = card.eventIds || [];
      const primaryId = eventIds[0];
      const details = primaryId ? await getDetails(primaryId) : null;

      const eventRaw = details?.name?.replace(/\s+vs\.\s+/, ' x ').replace(/\s+/g, ' ').trim()
        || `Combo Estrelabet #${card.id}`;
      const league = details?.champ?.name || details?.category?.name || '';
      const sport = inferSportFromId(details?.sport?.id) || 'football';
      const startDate = details?.startDate ? new Date(details.startDate) : null;
      if (startDate && !isFuture(startDate)) continue;

      const oddBoosted = +card.boostInfo.price;
      const oddBase    = +card.price;
      if (!(oddBoosted > 1.01)) continue;

      const legs = card.odds?.length || 0;
      const market = legs > 1 ? `Combo Turbinado (${legs} legs)` : 'Super Odd';

      results.push(makeEntry({
        bookmaker: NAME,
        eventRaw,
        league,
        sport,
        eventDatetime: startDate,
        market,
        selection: eventRaw,
        oddBoosted,
        oddBase,
      }));
    }
  } catch (e) {
    console.error(`[${NAME}] Erro: ${e.message}`);
  } finally {
    try { await page.close(); } catch {}
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}

function inferSportFromId(sportId) {
  // Mapping observado em sport-menu.json: 66=Futebol, 67=Basquete, 68=Tênis, 146=E-Football
  const SPORT_MAP = {
    66: 'football',
    67: 'basketball',
    68: 'tennis',
    69: 'volleyball',
    146: 'football',  // e-football → trata como football pra fim de comparação
  };
  return SPORT_MAP[sportId];
}
