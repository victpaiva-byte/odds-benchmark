/**
 * Conta quantos eventos com 1x2 a Betano tem em todas as ligas trending.
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=pt-BR,pt'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

try {
  await page.goto('https://www.betano.bet.br/sport/futebol/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  // Pega trending leagues
  const leagues = await page.evaluate(async () => {
    const r = await fetch('https://www.betano.bet.br/api/sports/FOOT/hot/trending/leagues?req=s,stnf,c,mb', { credentials: 'include' });
    const j = await r.json();
    return j.data?.leagues || j.data?.data || j.data || [];
  });
  console.log('Trending leagues:', Array.isArray(leagues) ? leagues.length : 'not array');
  if (Array.isArray(leagues)) {
    console.log('IDs e nomes:');
    for (const l of leagues.slice(0, 20)) console.log(`  ${l.id}: ${l.name || l.leagueName}`);
  }

  // Pega eventos de TODAS as leagues
  let totalEvents = 0;
  let totalWith1x2 = 0;
  const sample = [];
  if (Array.isArray(leagues)) {
    for (const l of leagues) {
      const events = await page.evaluate(async (id) => {
        try {
          const r = await fetch(`https://www.betano.bet.br/api/sports/FOOT/hot/trending/leagues/${id}/events?req=s,stnf,c,mb`, { credentials: 'include' });
          const j = await r.json();
          return j.data?.events || [];
        } catch { return []; }
      }, l.id);
      totalEvents += events.length;
      for (const ev of events) {
        const market = (ev.markets || []).find(m => m.type === 'MR12' || m.type === 'MRES');
        if (market && market.selections?.length >= 2) {
          totalWith1x2++;
          if (sample.length < 5) {
            sample.push({
              event: ev.name,
              league: ev.leagueName,
              startTime: new Date(ev.startTime).toISOString(),
              marketType: market.type,
              selections: market.selections.map(s => `${s.fullName}=${s.price}`),
            });
          }
        }
      }
    }
  }
  console.log(`\nTotal events: ${totalEvents}, com 1x2: ${totalWith1x2}`);
  console.log('\nSample:');
  for (const s of sample) console.log(s);
} finally {
  await page.close();
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]).catch(()=>{});
  process.exit(0);
}
