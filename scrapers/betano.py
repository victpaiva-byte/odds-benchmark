"""
Betano — SuperOdd identificada pelo badge "SO" nas listagens de jogos.
Varre futebol BR + NBA e coleta apenas eventos com o badge ativo.
"""
import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.async_api import BrowserContext
from .base import BaseScraper

logger = logging.getLogger(__name__)
BRT = ZoneInfo("America/Sao_Paulo")

URLS = [
    ("football", "https://betano.bet.br/sport/futebol/"),
    ("basketball", "https://betano.bet.br/sport/basquetebol/nba/"),
]

# Seletores — inspecione o DOM se algo mudar
# O badge "SO" fica dentro do botão de odd
SEL_WAIT      = "[class*='selections'], [class*='event-row']"
SEL_EVENT     = "[class*='event-row'], [class*='EventRow']"
SEL_BADGE     = "[class*='so-label'], [class*='SoLabel'], [data-qa='so-label']"
SEL_TEAMS     = "[class*='event__participants'], [class*='EventParticipants'], [class*='teams']"
SEL_ODD_BTN   = "[class*='selections__selection'], [class*='Selection']"
SEL_ODD_VAL   = "[class*='odd__value'], [class*='OddValue'], [class*='price']"
SEL_ODD_BASE  = "[class*='original-odd'], [class*='OriginalOdd'], s, [class*='strikethrough']"
SEL_MARKET    = "[class*='market-name'], [class*='MarketName']"
SEL_DATE      = "[class*='event__start-time'], [class*='StartTime'], time"
SEL_LEAGUE    = "[class*='league-name'], [class*='LeagueName'], [class*='competition']"


class BetanoScraper(BaseScraper):
    name = "Betano"

    async def scrape(self, context: BrowserContext) -> list[dict]:
        results: list[dict] = []

        for sport, url in URLS:
            try:
                page = await context.new_page()
                logger.info("[Betano] Abrindo %s", url)
                await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                await page.wait_for_timeout(4_000)

                # Scroll para carregar lazy-loaded events
                await _scroll_page(page)

                events = await self.wait_and_get_all(page, SEL_EVENT)
                logger.info("[Betano] %d eventos em %s", len(events), sport)

                for ev in events:
                    try:
                        # Só processa se tiver badge SO
                        badge = await ev.query_selector(SEL_BADGE)
                        # Fallback: buscar por texto "SO" em qualquer span dentro do evento
                        if not badge:
                            badges = await ev.query_selector_all("span, [class*='label']")
                            for b in badges:
                                txt = (await b.inner_text()).strip().upper()
                                if txt in ("SO", "SUPER ODD", "SUPERODDS"):
                                    badge = b
                                    break
                        if not badge:
                            continue

                        teams_el = await ev.query_selector(SEL_TEAMS)
                        teams_raw = (await teams_el.inner_text()).strip() if teams_el else ""

                        date_el = await ev.query_selector(SEL_DATE)
                        date_raw = (await date_el.get_attribute("datetime") or
                                    await date_el.inner_text()).strip() if date_el else ""
                        event_dt = _parse_date(date_raw)

                        if not self.is_future(event_dt):
                            continue

                        league_el = await ev.query_selector(SEL_LEAGUE)
                        league = (await league_el.inner_text()).strip() if league_el else ""

                        # Coleta todos os botões de odd com badge SO
                        odd_btns = await ev.query_selector_all(SEL_ODD_BTN)
                        for btn in odd_btns:
                            b = await btn.query_selector(SEL_BADGE)
                            if not b:
                                spans = await btn.query_selector_all("span, [class*='label']")
                                for s in spans:
                                    t = (await s.inner_text()).strip().upper()
                                    if t in ("SO", "SUPER ODD"):
                                        b = s
                                        break
                            if not b:
                                continue

                            odd_el = await btn.query_selector(SEL_ODD_VAL)
                            odd_raw = (await odd_el.inner_text()).strip() if odd_el else ""
                            odd_boosted = self.parse_odd(odd_raw)
                            if not odd_boosted:
                                continue

                            base_el = await btn.query_selector(SEL_ODD_BASE)
                            odd_base = None
                            if base_el:
                                odd_base = self.parse_odd((await base_el.inner_text()).strip())

                            market_el = await ev.query_selector(SEL_MARKET)
                            market = (await market_el.inner_text()).strip() if market_el else "1X2"

                            sel_name = await btn.inner_text()
                            sel_name = re.sub(r"\d+[\.,]\d+", "", sel_name).strip()

                            results.append(self.make_entry(
                                event_raw=teams_raw,
                                event_normalized=self.normalize_name(teams_raw),
                                league=league,
                                sport=sport,
                                event_datetime=event_dt,
                                market=market,
                                selection=sel_name or teams_raw,
                                odd_boosted=odd_boosted,
                                odd_base=odd_base,
                            ))

                    except Exception as e:
                        logger.debug("[Betano] Erro em evento: %s", e)

            except Exception as e:
                logger.error("[Betano] Falha em %s: %s", url, e)
            finally:
                await page.close()

        logger.info("[Betano] %d odds coletadas no total", len(results))
        return results


async def _scroll_page(page):
    for _ in range(5):
        await page.evaluate("window.scrollBy(0, window.innerHeight)")
        await page.wait_for_timeout(800)


def _parse_date(raw: str) -> datetime | None:
    if not raw:
        return None
    # ISO format: "2026-05-05T18:00:00"
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.astimezone(BRT)
    except ValueError:
        pass
    # Betano pode usar "05/05 18:00"
    now = datetime.now(tz=BRT)
    m = re.search(r"(\d{2}/\d{2})\s+(\d{2}:\d{2})", raw)
    if m:
        try:
            dt = datetime.strptime(f"{m.group(1)}/{now.year} {m.group(2)}", "%d/%m/%Y %H:%M")
            return dt.replace(tzinfo=BRT)
        except ValueError:
            pass
    return None
