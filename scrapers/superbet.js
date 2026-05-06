/**
 * Superbet — https://superbet.bet.br/odds-aumentadas/
 * DOM confirmado em 04/05/2026:
 *   Card:       .price-boost-page-card
 *   Liga:       .price-boost-card-header__tournament
 *   Times:      .price-boost-card-header__teams
 *   Data:       .event-time  (texto "Hoje, 11:00" ou "05/05, 18:00")
 *   Legs:       .bet-builder-legs__leg  (seleções do combo)
 *   Odd base:   .price-boost-odd-value__original
 *   Odd boost:  .price-boost-odd-value__boosted  (.e2e-odd-value)
 */
import { makeEntry, parseOdd, parseDate, isFuture, inferSport, sleep } from './base.js';

const URL  = 'https://superbet.bet.br/odds-aumentadas/';
const NAME = 'Superbet';

export async function scrapeSuperbet(browser) {
  const page = await browser.newPage();
  const results = [];

  try {
    console.log(`[${NAME}] Abrindo ${URL}`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(8000);

    const items = await page.evaluate(() => {
      const out = [];
      const cards = document.querySelectorAll('.price-boost-page-card');

      for (const card of cards) {
        // Header
        const league = card.querySelector('.price-boost-card-header__tournament')?.innerText?.trim() ?? '';
        const teamsEl = card.querySelector('.price-boost-card-header__teams');
        const teams   = teamsEl?.innerText?.replace(/\n/g, ' ').replace('⎯', 'x').trim() ?? '';
        const date    = card.querySelector('.event-time')?.innerText?.trim() ?? '';

        // Conteúdo — legs do combo e odds
        const legs = Array.from(card.querySelectorAll('.bet-builder-legs__leg'))
          .map(l => l.innerText?.trim()).filter(Boolean);
        const market = legs.join(' + ') || '1X2';

        const oddBase    = card.querySelector('.price-boost-odd-value__original')?.innerText?.trim() ?? '';
        const oddBoosted = card.querySelector('.price-boost-odd-value__boosted, .e2e-odd-value')?.innerText?.trim() ?? '';

        out.push({ league, teams, date, market, oddBase, oddBoosted });
      }
      return out;
    });

    console.log(`[${NAME}] ${items.length} cards encontrados`);

    for (const item of items) {
      const oddBoosted = parseOdd(item.oddBoosted);
      if (!oddBoosted) {
        console.log(`[${NAME}] Sem odd boosted para "${item.teams}": "${item.oddBoosted}"`);
        continue;
      }

      // Converte "Hoje, 11:00" → Date
      const dateStr = item.date.replace('Hoje, ', 'Hoje ').replace(/,\s*/, ' ');
      const eventDt = parseDate(dateStr);

      if (eventDt && !isFuture(eventDt)) {
        console.log(`[${NAME}] Evento passado ignorado: ${item.teams} @ ${item.date}`);
        continue;
      }

      results.push(makeEntry({
        bookmaker: NAME,
        eventRaw: item.teams,
        league: item.league,
        sport: inferSport(item.league, item.teams),
        eventDatetime: eventDt,
        market: item.market,
        selection: item.teams,  // combo bet — seleção = evento
        oddBoosted,
        oddBase: parseOdd(item.oddBase),
      }));
    }

  } catch (e) {
    console.error(`[${NAME}] Erro: ${e.message}`);
  } finally {
    await page.close();
  }

  console.log(`[${NAME}] ${results.length} odds coletadas`);
  return results;
}
