/**
 * Estrelabet — Super Odds 1x2 ("Vencedor do encontro - Super Odds")
 * Plataforma: Altenar V2 (`*.altenar2.biahosted.com`), integration=estrelabet.
 *
 * Endpoint: /api/widget/GetEvents?sportId=X  — lista eventos por esporte,
 *           com `markets`, `odds` e `events` aninhados. Filtramos os mercados
 *           cujo nome é "Vencedor do encontro - Super Odds" e criamos um
 *           entry para cada outcome (Vitória A / Empate / Vitória B).
 *
 * Diferente da versão anterior (betCardListId=108 — Bet Builder/combos), agora
 * só pegamos o mercado 1x2 turbinado, que é a definição correta de "Super Odd"
 * na Estrelabet.
 */
import { makeEntry, isFuture, sleep } from './base.js';

const NAME = 'Estrelabet';
const SESSION_URL = 'https://www.estrelabet.bet.br/aposta-esportiva';
const FRONTEND = 'https://sb2frontend-altenar2.biahosted.com';
const PARAMS = 'culture=pt-BR&timezoneOffset=180&integration=estrelabet&deviceType=1&numFormat=en-GB&countryCode=BR';

// Esportes que varremos. Altenar usa IDs próprios — observados em sport-menu.json:
const SPORT_IDS = {
  66:  'football',
  67:  'basketball',
  68:  'tennis',
  69:  'volleyball',
  146: 'football',  // e-football → trata como football para fim de comparação
};

const SUPER_ODD_MARKET_NAME = 'Vencedor do encontro - Super Odds';
// Mercado-irmão (mesma resposta) sem o sufixo — usado pra recuperar a odd base.
const BASE_MARKET_NAME = 'Vencedor do encontro';

export async function scrapeEstrelabet(browser) {
  const results = [];
  const page = await browser.newPage();

  try {
    console.log(`[${NAME}] Sessão em ${SESSION_URL}`);
    await page.goto(SESSION_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(4000);

    for (const [sportId, sportName] of Object.entries(SPORT_IDS)) {
      const payload = await page.evaluate(async (sid, frontend, params) => {
        try {
          const r = await fetch(
            `${frontend}/api/widget/GetEvents?${params}&sportId=${sid}&timeFilter=0`,
            { headers: { Accept: 'application/json' } }
          );
          return r.ok ? r.json() : null;
        } catch { return null; }
      }, sportId, FRONTEND, PARAMS);

      if (!payload?.events?.length) continue;

      const entries = extractSuperOdds(payload, sportName);
      if (entries.length) {
        console.log(`[${NAME}] sportId=${sportId} (${sportName}): ${entries.length} super odds 1x2`);
        results.push(...entries);
      }
    }
  } catch (e) {
    console.error(`[${NAME}] Erro: ${e.message}`);
  } finally {
    try { await page.close(); } catch {}
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}

/**
 * Extrai super odds 1x2 do payload do GetEvents da Altenar.
 * Para cada mercado "Vencedor do encontro - Super Odds", cria 1 entry por outcome
 * com a odd base (mercado irmão sem "- Super Odds") quando disponível.
 */
function extractSuperOdds(payload, sport) {
  const out = [];
  const oddById     = new Map(payload.odds.map(o => [o.id, o]));
  const champById   = new Map((payload.champs || payload.availableChamps || []).map(c => [c.id, c]));
  const competitorById = new Map((payload.competitors || []).map(c => [c.id, c]));

  // Index markets por evento (event.marketIds → markets)
  const marketsByEvent = new Map(); // eventId → { super, base }
  for (const event of payload.events) {
    const eventMarkets = (event.marketIds || []).map(mid => payload.markets.find(m => m.id === mid)).filter(Boolean);
    const superM = eventMarkets.find(m => m.name === SUPER_ODD_MARKET_NAME);
    if (!superM) continue;  // só nos importa se há super odd 1x2
    const baseM  = eventMarkets.find(m =>
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
      // Tenta achar a odd base correspondente (mesmo competitor / mesma posição).
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
  // 1) Match por competitorId quando ambos têm
  if (superOdd.competitorId) {
    const hit = baseOdds.find(b => b.competitorId === superOdd.competitorId);
    if (hit) return hit;
  }
  // 2) Match por nome exato (ex: "Empate" → "Empate")
  const hit = baseOdds.find(b => b.name === superOdd.name);
  if (hit) return hit;
  return null;
}

function normalizeEventName(rawName, competitorIds, competitorById) {
  // Preferir competitors A x B se temos referência
  if (competitorIds?.length === 2) {
    const a = competitorById.get(competitorIds[0])?.name;
    const b = competitorById.get(competitorIds[1])?.name;
    if (a && b) return `${a} x ${b}`;
  }
  return (rawName || '').replace(/\s+vs\.\s+/, ' x ').replace(/\s+/g, ' ').trim();
}
