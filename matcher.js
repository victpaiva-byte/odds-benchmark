/**
 * Agrupa entries de diferentes casas pelo mesmo evento+mercado+seleção.
 */
import { normalizeName, resolveTeam } from './scrapers/base.js';

const BOOKMAKERS = ['Estrelabet', 'Superbet', 'Betano', 'Sportingbet', 'Bet365'];
const TIME_WINDOW_MS = 60 * 60 * 1000; // 1h

function extractTeams(normalized) {
  for (const sep of [' x ', ' vs ', ' - ', ' × ', ' versus ']) {
    if (normalized.includes(sep)) {
      return normalized.split(sep).map(t => t.trim());
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
    // Tenta partial match por tokens longos (>3 chars)
    const tokA = [...teamsA].join(' ').split(' ').filter(t => t.length > 3);
    const tokB = [...teamsB].join(' ').split(' ').filter(t => t.length > 3);
    const partialMatch = tokA.some(t => tokB.includes(t));
    if (!partialMatch) return false;
  }

  // Janela de tempo
  const dtA = a.eventDatetime ? new Date(a.eventDatetime) : null;
  const dtB = b.eventDatetime ? new Date(b.eventDatetime) : null;
  if (dtA && dtB) {
    if (Math.abs(dtA - dtB) > TIME_WINDOW_MS) return false;
  }

  return true;
}

const MKT_GROUPS = [
  ['1x2', 'resultado', 'vencedor', 'money line', 'moneyline', 'resultado final'],
  ['ambos marcam', 'btts', 'both teams'],
  ['over', 'mais de', 'acima'],
  ['under', 'menos de', 'abaixo'],
  ['handicap', 'desvantagem'],
];

function findGroup(text) {
  const t = text.toLowerCase();
  return MKT_GROUPS.findIndex(grp => grp.some(kw => t.includes(kw)));
}

function marketsMatch(a, b) {
  const ma = normalizeName(a.market || '');
  const mb = normalizeName(b.market || '');
  const sa = normalizeName(a.selection || '');
  const sb = normalizeName(b.selection || '');

  const ga = findGroup(ma);
  const gb = findGroup(mb);
  if (ga !== -1 && gb !== -1 && ga !== gb) return false;
  if (ga === -1 && gb === -1 && ma && mb && !ma.includes(mb) && !mb.includes(ma)) return false;

  // Seleções
  if (sa && sb) {
    const ta = new Set(sa.split(' ').filter(t => t.length > 3));
    const tb = new Set(sb.split(' ').filter(t => t.length > 3));
    const selOverlap = [...ta].some(t => tb.has(t));
    if (!selOverlap && !sa.includes(sb) && !sb.includes(sa)) return false;
  }

  return true;
}

export function buildComparison(entries) {
  const now = new Date();

  // Filtra somente eventos futuros (strict)
  const future = entries.filter(e => {
    if (!e.eventDatetime) return true; // sem data, mantém (vai aparecer sem horário)
    return new Date(e.eventDatetime) > now;
  });

  const rows = [];

  for (const entry of future) {
    let placed = false;
    for (const row of rows) {
      const rep = row._entries[0];
      if (eventsMatch(entry, rep) && marketsMatch(entry, rep)) {
        const book = entry.bookmaker;
        if (!row.odds[book] || entry.oddBoosted > row.odds[book].odd) {
          row.odds[book] = {
            odd: entry.oddBoosted,
            oddBase: entry.oddBase,
            liftPct: entry.liftPct,
          };
          row._entries.push(entry);
        }
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
        market: entry.market,
        selection: entry.selection,
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

  // Calcula melhor odd por linha
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

  // Ordena: Estrelabet melhor primeiro, depois por data
  rows.sort((a, b) => {
    if (a.estrelaIsBest !== b.estrelaIsBest) return a.estrelaIsBest ? -1 : 1;
    const da = a.eventDatetime ? new Date(a.eventDatetime) : new Date('9999');
    const db = b.eventDatetime ? new Date(b.eventDatetime) : new Date('9999');
    return da - db;
  });

  return rows;
}

export function buildSummary(rows) {
  const best = rows.filter(r => r.estrelaIsBest);
  const notBest = rows.filter(r => !r.estrelaIsBest && r.estrelaOdd);
  return {
    totalMarkets: rows.length,
    estrelaIsBestCount: best.length,
    estrelaNotBestCount: notBest.length,
    winRate: rows.length ? +(best.length / rows.length * 100).toFixed(1) : 0,
    bestMarkets: best.slice(0, 10).map(r => ({
      event: r.eventRaw,
      market: r.market,
      selection: r.selection,
      estrelaOdd: r.estrelaOdd,
      bestOdd: r.bestOdd,
    })),
  };
}
