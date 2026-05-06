import unidecodeModule from 'unidecode';
const unidecode = unidecodeModule.default ?? unidecodeModule;

/** Substitui page.waitForTimeout (removido no Puppeteer >=22) */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const BRT = 'America/Sao_Paulo';

const TEAM_ALIASES = {
  'atletico mineiro': 'atletico mg', 'atletico-mg': 'atletico mg', 'galo': 'atletico mg',
  'fla': 'flamengo', 'flu': 'fluminense',
  'vasco da gama': 'vasco',
  'verdao': 'palmeiras',
  'spfc': 'sao paulo',
  'timao': 'corinthians',
  'inter': 'internacional',
  'rb bragantino': 'bragantino',
  'fogo': 'botafogo',
  'america mineiro': 'america mg', 'america-mg': 'america mg',
  'athletico paranaense': 'athletico pr', 'athletico-pr': 'athletico pr',
  'atletico goianiense': 'atletico go', 'atletico-go': 'atletico go',
  'la lakers': 'lakers', 'los angeles lakers': 'lakers',
  'boston celtics': 'celtics',
  'golden state warriors': 'warriors',
  'chicago bulls': 'bulls',
};

export function normalizeName(text) {
  if (!text) return '';
  let s = text.toLowerCase();
  try { s = unidecode(s); } catch { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  return s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function resolveTeam(name) {
  const n = normalizeName(name);
  return TEAM_ALIASES[n] ?? n;
}

export function parseOdd(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/[^\d.,]/g, '').replace(',', '.');
  const v = parseFloat(clean);
  return (v >= 1.01 && v <= 1000) ? v : null;
}

export function isFuture(dt) {
  if (!dt) return false;
  const d = dt instanceof Date ? dt : new Date(dt);
  return d > new Date();
}

export function makeEntry({
  bookmaker, eventRaw, league, sport, eventDatetime,
  market, selection, oddBoosted, oddBase = null, scrapedAt,
}) {
  const liftPct = (oddBase && oddBase > 0)
    ? +((oddBoosted - oddBase) / oddBase * 100).toFixed(1)
    : null;
  return {
    bookmaker,
    eventRaw,
    eventNormalized: normalizeName(eventRaw),
    league: league || '',
    sport: sport || 'football',
    eventDatetime: eventDatetime instanceof Date
      ? eventDatetime.toISOString()
      : (eventDatetime || null),
    market: market || '1X2',
    selection: selection || eventRaw,
    oddBoosted: +oddBoosted.toFixed(2),
    oddBase: oddBase ? +oddBase.toFixed(2) : null,
    liftPct,
    scrapedAt: (scrapedAt || new Date()).toISOString(),
  };
}

/** Tenta parsear ISO, DD/MM HH:MM e "Hoje HH:MM". Retorna Date ou null. */
export function parseDate(raw) {
  if (!raw) return null;
  raw = raw.trim();

  // ISO
  try {
    const d = new Date(raw);
    if (!isNaN(d)) return d;
  } catch {}

  const now = new Date();

  // DD/MM HH:MM
  let m = raw.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?\s+(\d{2}):(\d{2})/);
  if (m) {
    const [, day, mon, yr, hr, min] = m;
    const year = yr || now.getFullYear();
    const d = new Date(`${year}-${mon}-${day}T${hr}:${min}:00-03:00`);
    if (!isNaN(d)) return d;
  }

  // "Hoje HH:MM" ou "Amanhã HH:MM"
  m = raw.toLowerCase().match(/(hoje|amanha|amanhã)\s+(\d{2}):(\d{2})/);
  if (m) {
    const base = new Date(now);
    if (m[1] !== 'hoje') base.setDate(base.getDate() + 1);
    base.setHours(+m[2], +m[3], 0, 0);
    return base;
  }

  return null;
}

export function inferSport(league, teams) {
  const text = `${league} ${teams}`.toLowerCase();
  return /nba|nfl|basquete|basketball|lakers|bulls|celtics|knicks|warriors/.test(text)
    ? 'basketball' : 'football';
}

/** Wrapper de scraper — retorna [] e loga erros em vez de propagar. */
export async function safeScrape(name, fn) {
  try {
    const results = await fn();
    console.log(`[${name}] ${results.length} odds coletadas`);
    return results;
  } catch (e) {
    console.error(`[${name}] Falha: ${e.message}`);
    return [];
  }
}
