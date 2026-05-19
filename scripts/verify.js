/**
 * Teste de validação: pega N eventos do data/odds.json e re-consulta as APIs ao vivo
 * pra confirmar que as odds que mostramos no dashboard batem com a fonte real.
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFileSync } from 'fs';

puppeteer.use(StealthPlugin());

const data = JSON.parse(readFileSync('data/odds.json', 'utf8'));
// Pega 5 eventos distintos (vencendo, perdendo, exclusivos)
const seen = new Set();
const samples = [];
for (const row of data.rows) {
  if (seen.has(row.eventRaw)) continue;
  seen.add(row.eventRaw);
  samples.push(row);
  if (samples.length >= 5) break;
}

const FRONTEND = 'https://sb2frontend-altenar2.biahosted.com';
const PARAMS = 'culture=pt-BR&timezoneOffset=180&integration=estrelabet&deviceType=1&numFormat=en-GB&countryCode=BR';
const SP_HOST = 'https://www.sportingbet.bet.br';
const SP_ACCESS = 'YTRhMjczYjctNTBlNy00MWZlLTliMGMtMWNkOWQxMThmZTI2';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=pt-BR,pt'],
  defaultViewport: { width: 1440, height: 900 },
});

// ── 1. Pega odds Estrelabet ao vivo ────────────────────────
const pageE = await browser.newPage();
await pageE.goto('https://www.estrelabet.bet.br/aposta-esportiva', { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise(r => setTimeout(r, 4000));
const liveEstrela = await pageE.evaluate(async (frontend, params) => {
  const r = await fetch(`${frontend}/api/widget/GetEvents?${params}&sportId=66&timeFilter=0`);
  return r.json();
}, FRONTEND, PARAMS);
await pageE.close();

// Index Estrelabet: eventName → { home, draw, away }
const estrelaIndex = new Map();
const evById = new Map((liveEstrela.events || []).map(e => [e.id, e]));
const oddById = new Map((liveEstrela.odds || []).map(o => [o.id, o]));
for (const ev of (liveEstrela.events || [])) {
  const eventMarkets = (ev.marketIds || []).map(mid => liveEstrela.markets.find(m => m.id === mid)).filter(Boolean);
  const sm = eventMarkets.find(m => m.name === 'Vencedor do encontro - Super Odds');
  if (!sm) continue;
  const odds = (sm.oddIds || []).map(id => oddById.get(id)).filter(Boolean);
  estrelaIndex.set(ev.name, odds.map(o => `${o.name}=${o.price}`).join(' | '));
}

// ── 2. Pega odds Sportingbet ao vivo ───────────────────────
const pageS = await browser.newPage();
await pageS.goto('https://www.sportingbet.bet.br/pt-br/sports', { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise(r => setTimeout(r, 4000));
const params = new URLSearchParams({
  'x-bwin-accessid': SP_ACCESS,
  lang: 'pt-br', country: 'BR', userCountry: 'BR',
  fixtureTypes: 'Standard', state: 'Latest',
  offerMapping: 'Filtered',
  offerCategories: 'Gridable',
  fixtureCategories: 'Gridable,NonGridable,Other',
  sportIds: '4',
  statisticsModes: 'None',
  skip: '0', take: '100',
  sortBy: 'Tags',
});
const liveSp = await pageS.evaluate(async (url) => {
  const r = await fetch(url, { credentials: 'include' });
  return r.json();
}, `${SP_HOST}/cds-api/bettingoffer/fixtures?${params}`);
await pageS.close();

const spIndex = new Map();
for (const fx of (liveSp.fixtures || [])) {
  const teams = (fx.participants || [])
    .filter(p => /HomeTeam|AwayTeam/.test(p.properties?.type))
    .map(p => p.name?.value);
  if (teams.length < 2) continue;
  const market = (fx.optionMarkets || []).find(m => /^Resultado da Partida/i.test(m.name?.value) && (m.options || []).length === 3);
  if (!market) continue;
  const odds = market.options.map(o => `${o.name?.value}=${o.price?.odds}`).join(' | ');
  spIndex.set(teams.join(' x '), odds);
  spIndex.set(teams.join(' - '), odds); // alternative key
}

await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]).catch(()=>{});

// ── 3. Relatório ────────────────────────────────────────────
console.log('\n════════════════ TESTE DE VALIDAÇÃO ════════════════');
console.log('Comparando 5 eventos do data/odds.json com as APIs ao vivo.\n');

for (const s of samples) {
  console.log(`📍 ${s.eventRaw} (${s.league || '?'}) — outcome ${s.outcome.toUpperCase()} = ${s.selection}`);
  console.log('   No data/odds.json (dashboard):');
  for (const [book, info] of Object.entries(s.odds)) {
    console.log(`     • ${book}: ${info.odd}`);
  }
  console.log('   Live (consultando AGORA):');
  // Estrela
  const estrelaKey = [...estrelaIndex.keys()].find(k =>
    k.toLowerCase().includes(s.eventRaw.split(' x ')[0].toLowerCase().slice(0, 8)) ||
    k.toLowerCase().includes(s.eventRaw.split(' x ')[1]?.toLowerCase().slice(0, 8))
  );
  console.log(`     • Estrelabet (Vencedor - Super Odds): ${estrelaIndex.get(estrelaKey) || '— sem evento na home agora'}`);
  // Sportingbet
  const spKey = [...spIndex.keys()].find(k =>
    k.toLowerCase().includes(s.eventRaw.split(' x ')[0].toLowerCase().slice(0, 8)) ||
    k.toLowerCase().includes(s.eventRaw.split(' x ')[1]?.toLowerCase().slice(0, 8))
  );
  console.log(`     • Sportingbet (Resultado da Partida): ${spIndex.get(spKey) || '— sem evento na lista agora'}`);
  console.log('');
}
process.exit(0);
