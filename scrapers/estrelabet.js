/**
 * Estrelabet — Super Odds 1x2 ("Vencedor do encontro - Super Odds")
 * via API JSON pública do Altenar V2 (não precisa de browser/cookies).
 */
import { makeEntry, isFuture } from './base.js';

const NAME = 'Estrelabet';
const FRONTEND = 'https://sb2frontend-altenar2.biahosted.com';
const PARAMS = 'culture=pt-BR&timezoneOffset=180&integration=estrelabet&deviceType=1&numFormat=en-GB&countryCode=BR';

const SPORT_IDS = {
  66:  'football',
  67:  'basketball',
  68:  'tennis',
  69:  'volleyball',
  146: 'football',
};

const SUPER_ODD_MARKET_NAME = 'Vencedor do encontro - Super Odds';
const BASE_MARKET_NAME = 'Vencedor do encontro';

export async function scrapeEstrelabet(_browser) {
  const results = [];

  for (const [sportId, sportName] of Object.entries(SPORT_IDS)) {
    try {
      const url = `${FRONTEND}/api/widget/GetEvents?${PARAMS}&sportId=${sportId}&timeFilter=0`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const payload = await r.json();
      if (!payload?.events?.length) continue;

      const entries = extractSuperOdds(payload, sportName);
      if (entries.length) {
        console.log(`[${NAME}] sportId=${sportId} (${sportName}): ${entries.length} super odds 1x2`);
        results.push(...entries);
      }
    } catch (e) {
      console.warn(`[${NAME}] sportId=${sportId} falhou: ${e.message}`);
    }
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}

function extractSuperOdds(payload, sport) {
  const out = [];
  const oddById     = new Map(payload.odds.map(o => [o.id, o]));
  const champById   = new Map((payload.champs || payload.availableChamps || []).map(c => [c.id, c]));
  const competitorById = new Map((payload.competitors || []).map(c => [c.id, c]));

  const marketsByEvent = new Map();
  for (const event of payload.events) {
    const eventMarkets = (event.marketIds || []).map(mid => payload.markets.find(m => m.id === mid)).filter(Boolean);
    const superM = eventMarkets.find(m => m.name === SUPER_ODD_MARKET_NAME);
    if (!superM) continue;
    const baseM = eventMarkets.find(m =>
      m.name === BASE_MARKET_NAME ||
      (m.headerName === BASE_MARKET_NAME && m.typeId === 1 && m.name !== SUPER_ODD_MARKET_NAME)
    );
    marketsByEvent.set(event.id, { event, superM, baseM });
  }

  for (const { event, superM, baseM } of marketsByEvent.values()) {
    if (event.startDate && !isFuture(new Date(event.startDate))) continue;

    const eventRaw = normalizeEventName(event.name, event.competitorIds, competitorById);
    const league = champById.get(event.champId)?.name || '';

    const superOdds = (superM.oddIds || []).map(id => oddById.get(id)).filter(Boolean);
    const baseOdds  = baseM ? (baseM.oddIds || []).map(id => oddById.get(id)).filter(Boolean) : [];

    for (const odd of superOdds) {
      if (!(odd.price > 1.01)) continue;
      const baseOdd = matchBaseOdd(odd, baseOdds);
      out.push(makeEntry({
        bookmaker: NAME,
        eventRaw,
        league,
        sport,
        eventDatetime: event.startDate ? new Date(event.startDate) : null,
        market: '1x2',
        selection: odd.name,
        oddBoosted: odd.price,
        oddBase: baseOdd?.price || null,
      }));
    }
  }
  return out;
}

function matchBaseOdd(superOdd, baseOdds) {
  if (!baseOdds.length) return null;
  if (superOdd.competitorId) {
    const hit = baseOdds.find(b => b.competitorId === superOdd.competitorId);
    if (hit) return hit;
  }
  const hit = baseOdds.find(b => b.name === superOdd.name);
  if (hit) return hit;
  return null;
}

function normalizeEventName(rawName, competitorIds, competitorById) {
  if (competitorIds?.length === 2) {
    const a = competitorById.get(competitorIds[0])?.name;
    const b = competitorById.get(competitorIds[1])?.name;
    if (a && b) return `${a} x ${b}`;
  }
  return (rawName || '').replace(/\s+vs\.\s+/, ' x ').replace(/\s+/g, ' ').trim();
}
