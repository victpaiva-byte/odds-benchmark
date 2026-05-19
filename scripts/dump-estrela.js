/**
 * Dump da resposta GetTopEvents da Estrelabet (Altenar) com foco nos mercados
 * "Vencedor do encontro - Super Odds" para entender o shape e validar contagem.
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync } from 'fs';

puppeteer.use(StealthPlugin());

const SESSION_URL = 'https://www.estrelabet.bet.br/aposta-esportiva';
const FRONTEND = 'https://sb2frontend-altenar2.biahosted.com';
const PARAMS = 'culture=pt-BR&timezoneOffset=180&integration=estrelabet&deviceType=1&numFormat=en-GB&countryCode=BR';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=pt-BR,pt'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

try {
  await page.goto(SESSION_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 4000));

  // GetTopEvents
  const top = await page.evaluate(async (frontend, params) => {
    const r = await fetch(`${frontend}/api/widget/GetTopEvents?${params}`, { headers: { Accept: 'application/json' } });
    return r.json();
  }, FRONTEND, PARAMS);
  writeFileSync('/tmp/altenar-top-events.json', JSON.stringify(top, null, 2));

  console.log('=== GetTopEvents resumo ===');
  console.log('events:', top.events?.length, 'markets:', top.markets?.length, 'odds:', top.odds?.length);

  // Filtra mercados de Super Odds
  const superMarkets = (top.markets || []).filter(m =>
    /super odd/i.test(m.name || '') || /super odd/i.test(m.headerName || '')
  );
  console.log('Markets com "Super Odds":', superMarkets.length);
  console.log('Nomes distintos:', [...new Set(superMarkets.map(m => m.name))]);
  console.log('TypeIds distintos:', [...new Set(superMarkets.map(m => m.typeId))]);

  // Index pra resolver oddIds → odd
  const oddById = new Map((top.odds || []).map(o => [o.id, o]));
  const eventById = new Map((top.events || []).map(e => [e.id, e]));
  const competitorById = new Map((top.competitors || []).map(c => [c.id, c]));

  console.log('\n=== Sample de 5 super-odd markets ===');
  for (const m of superMarkets.slice(0, 5)) {
    const odds = (m.oddIds || []).map(id => oddById.get(id)).filter(Boolean);
    // Achar o eventId via odd → ev or via m.evtId?
    const firstOdd = odds[0];
    const evtId = firstOdd?.eventId || m.eventId;
    const ev = evtId ? eventById.get(evtId) : null;
    console.log(`\nMarket id=${m.id} name="${m.name}" typeId=${m.typeId}`);
    console.log(`  Event: ${ev?.name || '?'} (${ev?.id})  startDate=${ev?.startDate}`);
    console.log(`  Odds:`);
    for (const o of odds) {
      console.log(`    - "${o.name}" price=${o.price}  (id=${o.id})`);
    }
  }

  // Vamos ver também os campos de odd e event
  console.log('\n=== Sample event keys ===', Object.keys(top.events?.[0] || {}));
  console.log('Sample odd keys:', Object.keys(top.odds?.[0] || {}));
} finally {
  await page.close();
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]).catch(()=>{});
  process.exit(0);
}
