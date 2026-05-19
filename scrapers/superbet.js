/**
 * Superbet — odds 1x2 ("Resultado Final") via API JSON pública.
 *
 * Endpoint:
 *   https://production-superbet-offer-br.freetls.fastly.net/v2/pt-BR/events/by-date
 *     ?currentStatus=active&offerState=prematch&startDate=...&endDate=...&sportId=5
 *
 * Cada evento traz `odds[]`; filtramos pelas com `marketName === 'Resultado Final'`,
 * com `code` em ['1', 'X', '2'] (home/draw/away).
 */
import { makeEntry, isFuture, sleep } from './base.js';

const NAME = 'Superbet';
const SESSION_URL = 'https://superbet.bet.br/apostas/futebol';
const API_BASE = 'https://production-superbet-offer-br.freetls.fastly.net';

function buildUrl() {
  // Janela: agora → +30 dias
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  const fmt = d => d.toISOString().slice(0, 10) + '+' + d.toISOString().slice(11, 19);
  const params = new URLSearchParams({
    currentStatus: 'active',
    offerState: 'prematch',
    startDate: fmt(now),
    endDate: fmt(end),
    sportId: '5', // futebol na Superbet
  });
  // URLSearchParams encode `+` como `%2B`, mas o endpoint quer `+` literal
  return `${API_BASE}/v2/pt-BR/events/by-date?${params.toString().replace(/%2B/g, '+').replace(/%3A/g, ':')}`;
}

export async function scrapeSuperbet(browser) {
  const results = [];
  const page = await browser.newPage();

  try {
    console.log(`[${NAME}] Sessão em ${SESSION_URL}`);
    try {
      await page.goto(SESSION_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      console.log(`[${NAME}] goto timeout, prosseguindo`);
    }
    await sleep(2000);

    const url = buildUrl();
    const payload = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { headers: { Accept: 'application/json' } });
        return r.ok ? r.json() : null;
      } catch (e) { return { __error: e.message }; }
    }, url);

    if (!payload || payload.__error) {
      console.warn(`[${NAME}] fetch falhou: ${payload?.__error || 'sem resposta'}`);
      return results;
    }
    const events = payload?.data || [];
    console.log(`[${NAME}] ${events.length} eventos no payload`);

    let added = 0;
    for (const ev of events) {
      if (!Array.isArray(ev.odds)) continue;
      const dt = ev.matchDate ? new Date(ev.matchDate.replace(' ', 'T') + 'Z') : null;
      if (dt && !isFuture(dt)) continue;

      const matchName = (ev.matchName || '').replace(/·/g, ' x ').replace(/\s+/g, ' ').trim();
      if (!matchName) continue;

      // Filtra odds 1x2 (Resultado Final, 3 outcomes home/draw/away)
      const matchResultOdds = ev.odds.filter(o =>
        o.marketName === 'Resultado Final' && ['1', 'X', '2'].includes(o.code)
      );
      if (matchResultOdds.length < 2) continue;

      for (const o of matchResultOdds) {
        const price = +o.price;
        if (!(price > 1.01)) continue;
        const selection = o.code === '1' ? matchName.split(' x ')[0]
                        : o.code === '2' ? matchName.split(' x ')[1]
                        : 'Empate';
        results.push(makeEntry({
          bookmaker: NAME,
          eventRaw: matchName,
          league: '',  // não vem direto no payload
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
  } finally {
    try { await page.close(); } catch {}
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}
