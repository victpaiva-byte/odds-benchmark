/**
 * Pega a resposta crua de events/by-date pra entender o shape.
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync } from 'fs';

puppeteer.use(StealthPlugin());

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=pt-BR,pt'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

const responses = [];

page.on('response', async (res) => {
  const u = res.url();
  if (!/events\/by-date|events\/top-list|getBetbuilderEvents/i.test(u)) return;
  try {
    const body = await res.text();
    responses.push({ url: u, status: res.status(), body });
  } catch {}
});

try {
  await page.goto('https://superbet.bet.br/apostas/futebol', { waitUntil: 'networkidle2', timeout: 40000 });
} catch {}
await new Promise(r => setTimeout(r, 8000));

console.log('Capturados:', responses.length);
for (const r of responses) {
  const file = '/tmp/superbet-' + r.url.split('/').pop().split('?')[0] + '.json';
  writeFileSync(file, r.body);
  console.log(`\n${r.url}`);
  console.log(`  status=${r.status} size=${r.body.length}  saved=${file}`);
  // mostra trecho com odds
  const o = JSON.parse(r.body);
  const keys = Array.isArray(o) ? `array len=${o.length}` : Object.keys(o).join(', ');
  console.log(`  shape: ${keys}`);
  // tenta encontrar um evento com odds
  const sample = Array.isArray(o) ? o[0] : (o.events?.[0] || o.data?.[0] || o.items?.[0]);
  if (sample) {
    console.log(`  evento sample: ${JSON.stringify(sample).slice(0, 1500)}`);
  }
}

await page.close();
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]).catch(()=>{});
process.exit(0);
