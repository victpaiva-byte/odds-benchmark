"""
Estrelabet — "Apostas Aumentadas" (plataforma Altenar).
A Altenar expõe uma API REST pública. Tentamos direto na API;
fallback para scraping DOM da página de promoções.
"""
import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.async_api import BrowserContext
from .base import BaseScraper

logger = logging.getLogger(__name__)
BRT = ZoneInfo("America/Sao_Paulo")

# Altenar API — endpoint de apostas em destaque / boosted
ALTENAR_API = "https://sb2frontend-altenar.biahosted.com/api/Sportsbook/GetPromotedEvents"
ALTENAR_PARAMS = "?count=50&siteId=15&cultureName=pt-BR&timezoneOffset=-180"

DOM_URL = "https://estrelabet.bet.br/pt/sport/pre-match"
DOM_PROMO_URL = "https://estrelabet.bet.br/pt/promotions"


class EstrelaberScraper(BaseScraper):
    name = "Estrelabet"

    async def scrape(self, context: BrowserContext) -> list[dict]:
        results = await self._scrape_api(context)
        if not results:
            logger.warning("[Estrelabet] API falhou — tentando DOM")
            results = await self._scrape_dom(context)
        logger.info("[Estrelabet] %d odds coletadas", len(results))
        return results

    async def _scrape_api(self, context: BrowserContext) -> list[dict]:
        results: list[dict] = []
        page = await context.new_page()
        try:
            url = ALTENAR_API + ALTENAR_PARAMS
            data = await page.evaluate(
                f"""async () => {{
                    const r = await fetch("{url}", {{
                        headers: {{ 'Accept': 'application/json' }}
                    }});
                    return r.ok ? r.json() : null;
                }}"""
            )
            if not data:
                return results

            events = data if isinstance(data, list) else data.get("result", data.get("data", []))

            for ev in (events if isinstance(events, list) else []):
                try:
                    event_name = ev.get("eventName") or ev.get("name", "")
                    start_raw = ev.get("startDate") or ev.get("eventDate", "")
                    event_dt = _parse_iso(start_raw)

                    if not self.is_future(event_dt):
                        continue

                    league = ev.get("leagueName") or ev.get("categoryName", "")
                    sport = "basketball" if "nba" in league.lower() else "football"

                    markets = ev.get("markets", ev.get("bets", []))
                    if not isinstance(markets, list):
                        markets = [markets]

                    for mkt in markets:
                        market_name = mkt.get("marketName") or mkt.get("name", "1X2")
                        for sel in mkt.get("selections", mkt.get("outcomes", [])):
                            odd_boosted = sel.get("priceBoosted") or sel.get("oddBoosted")
                            if not odd_boosted:
                                # Verifica se é uma odd normal marcada como boosted
                                is_boosted = sel.get("isBoosted") or sel.get("boosted", False)
                                odd_boosted = sel.get("price") or sel.get("odd") if is_boosted else None
                            if not odd_boosted:
                                continue

                            odd_base = sel.get("priceBase") or sel.get("oddBase")
                            selection = sel.get("name") or sel.get("selectionName", event_name)

                            results.append(self.make_entry(
                                event_raw=event_name,
                                event_normalized=self.normalize_name(event_name),
                                league=league,
                                sport=sport,
                                event_datetime=event_dt,
                                market=market_name,
                                selection=selection,
                                odd_boosted=float(odd_boosted),
                                odd_base=float(odd_base) if odd_base else None,
                            ))
                except Exception as e:
                    logger.debug("[Estrelabet] Erro em evento API: %s", e)

        except Exception as e:
            logger.error("[Estrelabet] Erro API: %s", e)
        finally:
            await page.close()
        return results

    async def _scrape_dom(self, context: BrowserContext) -> list[dict]:
        results: list[dict] = []
        page = await context.new_page()
        try:
            await page.goto(DOM_PROMO_URL, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(3_000)

            # Tenta encontrar link de "Apostas Aumentadas"
            boosted_link = await page.query_selector(
                "a[href*='aumentada'], a[href*='boosted'], [class*='boosted-promo']"
            )
            if boosted_link:
                href = await boosted_link.get_attribute("href")
                if href:
                    await page.goto(f"https://estrelabet.bet.br{href}", wait_until="domcontentloaded")
                    await page.wait_for_timeout(3_000)

            events = await page.query_selector_all(
                "[class*='event'], [class*='Event'], [class*='match']"
            )
            for ev in events:
                try:
                    name_el = await ev.query_selector("[class*='name'], [class*='title']")
                    event_name = (await name_el.inner_text()).strip() if name_el else ""
                    if not event_name:
                        continue

                    odd_el = await ev.query_selector("[class*='odd'], [class*='price'], [class*='value']")
                    odd_raw = (await odd_el.inner_text()).strip() if odd_el else ""
                    odd_boosted = self.parse_odd(odd_raw)
                    if not odd_boosted:
                        continue

                    date_el = await ev.query_selector("time, [class*='date']")
                    date_raw = ""
                    if date_el:
                        date_raw = await date_el.get_attribute("datetime") or await date_el.inner_text()
                    event_dt = _parse_iso(date_raw.strip())

                    if not self.is_future(event_dt):
                        continue

                    results.append(self.make_entry(
                        event_raw=event_name,
                        event_normalized=self.normalize_name(event_name),
                        league="",
                        sport="football",
                        event_datetime=event_dt,
                        market="Apostas Aumentadas",
                        selection=event_name,
                        odd_boosted=odd_boosted,
                    ))
                except Exception:
                    pass

        except Exception as e:
            logger.error("[Estrelabet] Erro DOM: %s", e)
        finally:
            await page.close()
        return results


def _parse_iso(raw: str) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.astimezone(BRT)
    except ValueError:
        pass
    m = re.search(r"(\d{2}/\d{2})\s+(\d{2}:\d{2})", raw)
    if m:
        from zoneinfo import ZoneInfo
        now = datetime.now(tz=ZoneInfo("America/Sao_Paulo"))
        try:
            dt = datetime.strptime(f"{m.group(1)}/{now.year} {m.group(2)}", "%d/%m/%Y %H:%M")
            return dt.replace(tzinfo=ZoneInfo("America/Sao_Paulo"))
        except ValueError:
            pass
    return None
