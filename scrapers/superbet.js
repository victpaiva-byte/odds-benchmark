/**
 * Superbet — odds 1x2 ("Resultado Final") via API JSON pública.
 *
 * Endpoint público (sem auth, sem cookies):
 *   https://production-superbet-offer-br.freetls.fastly.net/v2/pt-BR/events/by-date
 *
 * NÃO usa Puppeteer — fetch direto via Node, ~1s.
 */
import { makeEntry, isFuture } from './base.js';

const NAME = 'Superbet';
const API_BASE = 'https://production-superbet-offer-br.freetls.fastly.net';

function buildUrl() {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  const fmt = d => d.toISOString().slice(0, 10) + '+' + d.toISOString().slice(11, 19);
  const params = new URLSearchParams({
    currentStatus: 'active',
    offerState: 'prematch',
    startDate: fmt(now),
    endDate: fmt(end),
    sportId: '5',
  });
  return `${API_BASE}/v2/pt-BR/events/by-date?${params.toString().replace(/%2B/g, '+').replace(/%3A/g, ':')}`;
}

// Aceita `_browser` (ignora) — pra manter assinatura compatível com main.js
export async function scrapeSuperbet(_browser) {
  const results = [];
  try {
    console.log(`[${NAME}] Fetch ${API_BASE}/v2/.../events/by-date`);
    const r = await fetch(buildUrl(), { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      console.warn(`[${NAME}] HTTP ${r.status}`);
      return results;
    }
    const payload = await r.json();
    const events = payload?.data || [];
    console.log(`[${NAME}] ${events.length} eventos no payload`);

    let added = 0;
    for (const ev of events) {
      if (!Array.isArray(ev.odds)) continue;
      const dt = ev.matchDate ? new Date(ev.matchDate.replace(' ', 'T') + 'Z') : null;
      if (dt && !isFuture(dt)) continue;
      const matchName = (ev.matchName || '').replace(/·/g, ' x ').replace(/\s+/g, ' ').trim();
      if (!matchName) continue;

      const matchResultOdds = ev.odds.filter(o =>
        o.marketName === 'Resultado Final' && ['1', 'X', '2'].includes(o.code)
      );
      if (matchResultOdds.length < 2) continue;

      const [home, away] = matchName.split(' x ');
      for (const o of matchResultOdds) {
        const price = +o.price;
        if (!(price > 1.01)) continue;
        const selection = o.code === '1' ? home : o.code === '2' ? away : 'Empate';
        results.push(makeEntry({
          bookmaker: NAME,
          eventRaw: matchName,
          league: '',
          sport: 'football',
          eventDatetime: dt,
          market: '1x2',
          selection: (selection || '').trim(),
          oddBoosted: price,
          oddBase: null,
        }));
        added++;
      }
    }
    console.log(`[${NAME}] ${added} entries 1x2`);
  } catch (e) {
    console.error(`[${NAME}] Erro: ${e.message}`);
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}
