"""
Superbet — página dedicada: https://superbet.bet.br/odds-aumentadas/
"""
import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.async_api import BrowserContext
from .base import BaseScraper

logger = logging.getLogger(__name__)
BRT = ZoneInfo("America/Sao_Paulo")

URL = "https://superbet.bet.br/odds-aumentadas/"

# Seletores — ajuste se o site mudar
SEL_WAIT      = "[class*='EventCard'], [class*='event-card'], [class*='BoostCard']"
SEL_CARD      = "[class*='EventCard'], [class*='event-card'], [class*='BoostCard']"
SEL_TEAMS     = "[class*='EventName'], [class*='event-name'], [class*='teams']"
SEL_ODD_NEW   = "[class*='OddValue'], [class*='odd-value'], [class*='price']:not(s)"
SEL_ODD_OLD   = "s, [class*='old-price'], [class*='OldOdd']"
SEL_MARKET    = "[class*='MarketName'], [class*='market-name'], [class*='bet-type']"
SEL_SELECTION = "[class*='SelectionName'], [class*='selection-name']"
SEL_DATE      = "[class*='EventDate'], [class*='event-date'], [class*='start-time'], time"
SEL_LEAGUE    = "[class*='League'], [class*='league'], [class*='tournament']"


class SuperbetScraper(BaseScraper):
    name = "Superbet"

    async def scrape(self, context: BrowserContext) -> list[dict]:
        page = await context.new_page()
        results: list[dict] = []

        try:
            logger.info("[Superbet] Abrindo %s", URL)
            await page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(3_000)  # JS hydration

            cards = await self.wait_and_get_all(page, SEL_CARD)
            logger.info("[Superbet] %d cards encontrados", len(cards))

            for card in cards:
                try:
                    teams_el = await card.query_selector(SEL_TEAMS)
                    teams_raw = (await teams_el.inner_text()).strip() if teams_el else ""

                    odd_new_el = await card.query_selector(SEL_ODD_NEW)
                    odd_raw = (await odd_new_el.inner_text()).strip() if odd_new_el else ""
                    odd_boosted = self.parse_odd(odd_raw)
                    if not odd_boosted:
                        continue

                    odd_old_el = await card.query_selector(SEL_ODD_OLD)
                    odd_base = None
                    if odd_old_el:
                        odd_base = self.parse_odd((await odd_old_el.inner_text()).strip())

                    market_el = await card.query_selector(SEL_MARKET)
                    market = (await market_el.inner_text()).strip() if market_el else "1X2"

                    sel_el = await card.query_selector(SEL_SELECTION)
                    selection = (await sel_el.inner_text()).strip() if sel_el else teams_raw

                    date_el = await card.query_selector(SEL_DATE)
                    date_raw = (await date_el.inner_text()).strip() if date_el else ""
                    event_dt = _parse_date(date_raw)

                    if not self.is_future(event_dt):
                        continue

                    league_el = await card.query_selector(SEL_LEAGUE)
                    league = (await league_el.inner_text()).strip() if league_el else ""

                    sport = _infer_sport(league, teams_raw)

                    results.append(self.make_entry(
                        event_raw=teams_raw,
                        event_normalized=self.normalize_name(teams_raw),
                        league=league,
                        sport=sport,
                        event_datetime=event_dt,
                        market=market,
                        selection=selection,
                        odd_boosted=odd_boosted,
                        odd_base=odd_base,
                    ))

                except Exception as e:
                    logger.debug("[Superbet] Erro em card: %s", e)

        except Exception as e:
            logger.error("[Superbet] Falha geral: %s", e)
        finally:
            await page.close()

        logger.info("[Superbet] %d odds coletadas", len(results))
        return results


def _parse_date(raw: str) -> datetime | None:
    """Tenta parsear datas como '05/05 18:00', 'Hoje 18:00', 'Amanhã 20:00'."""
    if not raw:
        return None
    raw = raw.strip().lower()
    now = datetime.now(tz=BRT)

    patterns = [
        (r"(\d{2}/\d{2})\s+(\d{2}:\d{2})", "%d/%m %H:%M"),
        (r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2})", "%d/%m/%Y %H:%M"),
    ]
    for pattern, fmt in patterns:
        m = re.search(pattern, raw)
        if m:
            try:
                date_str = " ".join(m.groups())
                if "%Y" not in fmt:
                    date_str = f"{date_str}/{now.year}"
                    fmt = fmt + "/%Y"
                dt = datetime.strptime(date_str, fmt).replace(tzinfo=BRT)
                # Se a data ficou no passado e não tem ano explícito, tenta próximo ano
                if dt < now and "%Y" not in " ".join(m.groups()):
                    dt = dt.replace(year=dt.year + 1)
                return dt
            except ValueError:
                pass

    if "hoje" in raw:
        m = re.search(r"(\d{2}:\d{2})", raw)
        if m:
            h, mi = map(int, m.group(1).split(":"))
            return now.replace(hour=h, minute=mi, second=0, microsecond=0)

    if "amanhã" in raw or "amanha" in raw:
        from datetime import timedelta
        m = re.search(r"(\d{2}:\d{2})", raw)
        if m:
            h, mi = map(int, m.group(1).split(":"))
            tomorrow = now + timedelta(days=1)
            return tomorrow.replace(hour=h, minute=mi, second=0, microsecond=0)

    return None


def _infer_sport(league: str, teams: str) -> str:
    nba_kw = ["nba", "nfl", "basquete", "basketball", "lakers", "bulls", "celtics"]
    text = (league + " " + teams).lower()
    if any(k in text for k in nba_kw):
        return "basketball"
    return "football"
