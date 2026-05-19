/**
 * Matcher: agrupa entries 1x2 de bookmakers diferentes pelo mesmo evento e outcome.
 *
 * Cada entry deve ter market === '1x2' (filtrado no scraper) e selection
 * identificando o outcome (nome do time, "Empate"/"X"/"Draw").
 *
 * Saída: 1 row por (evento, outcome) com odds por bookmaker.
 */
import { normalizeName, resolveTeam, isFuture } from './scrapers/base.js';

const BOOKMAKERS = ['Estrelabet', 'Superbet', 'Betano', 'Sportingbet', 'Bet365'];
const TIME_WINDOW_MS = 90 * 60 * 1000; // 90 minutos de folga (start time pode variar)

function extractTeams(normalized) {
  for (const sep of [' x ', ' vs ', ' - ', ' × ', ' versus ']) {
    if (normalized.includes(sep)) {
      return normalized.split(sep).map(t => t.trim()).filter(Boolean);
    }
  }
  const words = normalized.split(' ');
  const mid = Math.floor(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

function eventsMatch(a, b) {
  const teamsA = new Set(extractTeams(a.eventNormalized).map(resolveTeam));
  const teamsB = new Set(extractTeams(b.eventNormalized).map(resolveTeam));

  // Pelo menos 1 time em comum
  const overlap = [...teamsA].some(t => teamsB.has(t));
  if (!overlap) {
    // Fallback: token overlap (palavras com >3 chars)
    const tokA = [...teamsA].join(' ').split(' ').filter(t => t.length > 3);
    const tokB = [...teamsB].join(' ').split(' ').filter(t => t.length > 3);
    if (!tokA.some(t => tokB.includes(t))) return false;
  }

  if (a.eventDatetime && b.eventDatetime) {
    if (Math.abs(new Date(a.eventDatetime) - new Date(b.eventDatetime)) > TIME_WINDOW_MS) return false;
  }
  return true;
}

/**
 * Classifica o outcome de uma entry 1x2 como 'home' | 'draw' | 'away' | null.
 * Usa o evento (par de times) + a selection (nome do outcome) pra decidir.
 */
function classifyOutcome(selection, eventNormalized) {
  const sel = normalizeName(selection || '');
  if (!sel) return null;

  // Empate em pt-BR/EN
  if (/^x$/i.test(sel) || /\bempate\b/.test(sel) || /\bdraw\b/.test(sel)) return 'draw';

  const teams = extractTeams(eventNormalized);
  if (teams.length < 2) return null;
  const [a, b] = teams.map(resolveTeam);
  const selRes = resolveTeam(sel);

  // Match exato após resolveTeam
  if (selRes === a) return 'home';
  if (selRes === b) return 'away';

  // Substring (ex: "Arsenal" ⊂ "Arsenal FC")
  if (a.includes(selRes) || selRes.includes(a)) return 'home';
  if (b.includes(selRes) || selRes.includes(b)) return 'away';

  // Fallback: token overlap (palavras significativas)
  const selTokens = sel.split(' ').filter(t => t.length > 3);
  const aTokens = a.split(' ').filter(t => t.length > 3);
  const bTokens = b.split(' ').filter(t => t.length > 3);
  const aOverlap = selTokens.filter(t => aTokens.includes(t)).length;
  const bOverlap = selTokens.filter(t => bTokens.includes(t)).length;
  if (aOverlap > bOverlap) return 'home';
  if (bOverlap > aOverlap) return 'away';
  return null;
}

export function buildComparison(entries) {
  // 1) Filtra só market === '1x2' e eventos futuros
  const oneXTwo = [];
  for (const e of entries) {
    if (e.market !== '1x2') continue;
    if (e.eventDatetime && !isFuture(new Date(e.eventDatetime))) continue;
    const outcome = classifyOutcome(e.selection, e.eventNormalized);
    if (!outcome) continue;
    oneXTwo.push({ ...e, _outcome: outcome });
  }

  // 2) Agrupa por (eventos casam + mesmo outcome)
  const rows = [];
  for (const entry of oneXTwo) {
    let placed = false;
    for (const row of rows) {
      const rep = row._entries[0];
      if (rep._outcome === entry._outcome && eventsMatch(entry, rep)) {
        const book = entry.bookmaker;
        if (!row.odds[book] || entry.oddBoosted > row.odds[book].odd) {
          row.odds[book] = {
            odd: entry.oddBoosted,
            oddBase: entry.oddBase,
            liftPct: entry.liftPct,
          };
        }
        row._entries.push(entry);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push({
        _entries: [entry],
        eventRaw: entry.eventRaw,
        eventNormalized: entry.eventNormalized,
        league: entry.league,
        sport: entry.sport,
        eventDatetime: entry.eventDatetime,
        market: '1x2',
        outcome: entry._outcome,
        selection: selectionLabel(entry._outcome, entry.eventRaw),
        odds: {
          [entry.bookmaker]: {
            odd: entry.oddBoosted,
            oddBase: entry.oddBase,
            liftPct: entry.liftPct,
          },
        },
      });
    }
  }

  // 3) Calcula bestOdd, bestBookmakers, estrela flags
  for (const row of rows) {
    const bestOdd = Math.max(...Object.values(row.odds).map(v => v.odd));
    const bestBooks = Object.entries(row.odds)
      .filter(([, v]) => v.odd === bestOdd)
      .map(([k]) => k);
    row.bestOdd = bestOdd;
    row.bestBookmakers = bestBooks;
    row.estrelaIsBest = bestBooks.includes('Estrelabet');
    row.estrelaOdd = row.odds['Estrelabet']?.odd ?? null;
    delete row._entries;
  }

  // 4) Filtra só rows onde a Estrelabet tem odd (só faz sentido comparar quando
  //    a Estrela tem super odd no outcome)
  const withEstrela = rows.filter(r => r.estrelaOdd != null);

  // 5) Ordena: Estrela vence primeiro, depois por data
  withEstrela.sort((a, b) => {
    if (a.estrelaIsBest !== b.estrelaIsBest) return a.estrelaIsBest ? -1 : 1;
    const da = a.eventDatetime ? new Date(a.eventDatetime) : new Date('9999');
    const db = b.eventDatetime ? new Date(b.eventDatetime) : new Date('9999');
    return da - db;
  });

  return withEstrela;
}

/** Label legível do outcome ("Arsenal", "Empate", "Burnley") */
function selectionLabel(outcome, eventRaw) {
  if (outcome === 'draw') return 'Empate';
  const parts = (eventRaw || '').split(/\s+x\s+|\s+vs\s+|\s+-\s+/);
  if (parts.length < 2) return outcome;
  return outcome === 'home' ? parts[0].trim() : parts[1].trim();
}

export function buildSummary(rows) {
  const best = rows.filter(r => r.estrelaIsBest);
  const notBest = rows.filter(r => !r.estrelaIsBest);
  return {
    totalMarkets: rows.length,
    estrelaIsBestCount: best.length,
    estrelaNotBestCount: notBest.length,
    winRate: rows.length ? +(best.length / rows.length * 100).toFixed(1) : 0,
    bestMarkets: best.slice(0, 10).map(r => ({
      event: r.eventRaw,
      outcome: r.outcome,
      selection: r.selection,
      estrelaOdd: r.estrelaOdd,
      bestOdd: r.bestOdd,
    })),
  };
}
