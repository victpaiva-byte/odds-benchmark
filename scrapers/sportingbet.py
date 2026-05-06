"""
Sportingbet — "Cotas Aumentadas" (plataforma Kambi).
A Kambi expõe as odds via API JSON — mais confiável que scraping de DOM.
Tentamos a API primeiro; se falhar, fazemos scraping de DOM.
"""
import logging
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.async_api import BrowserContext
from .base import BaseScraper

logger = logging.getLogger(__name__)
BRT = ZoneInfo("America/Sao_Paulo")

# Kambi usa esta endpoint pública para oferta de apostas
KAMBI_OFFERING_URL = (
    "https://eu-offering-api.kambicdn.com/offering/v2018/sbsportingbetbr"
    "/betoffer/category/1000093190.json?lang=pt_BR&market=BR&useCombined=true&includeParticipants=true"
)
# Fallback DOM
DOM_URL = "https://www.sportingbet.bet.br/sport/football/"


class SportingbetScraper(BaseScraper):
    name = "Sportingbet"

    async def scrape(self, context: BrowserContext) -> list[dict]:
        # Tenta via API Kambi (mais estável)
        results = await self._scrape_api(context)
        if not results:
            logger.warning("[Sportingbet] API falhou — tentando DOM")
            results = await self._scrape_dom(context)
        logger.info("[Sportingbet] %d odds coletadas", len(results))
        return results

    async def _scrape_api(self, context: BrowserContext) -> list[dict]:
        """Consume a API pública do Kambi e filtra cotas aumentadas (label=PRICE_BOOST)."""
        results: list[dict] = []
        page = await context.new_page()
        try:
            resp = await page.evaluate(
                f"""async () => {{
                    const r = await fetch("{KAMBI_OFFERING_URL}");
                    return r.ok ? r.json() : null;
                }}"""
            )
            if not resp or "betOffers" not in resp:
                return results

            for offer in resp.get("betOffers", []):
                tags = [t.get("type", "") for t in offer.get("tags", [])]
                # "PRICE_BOOST" é o identificador Kambi para cotas aumentadas
                if "PRICE_BOOST" not in tags:
                    continue

                event = offer.get("event", {})
                event_name = event.get("name", "")
                league = event.get("group", {}).get("name", "") if isinstance(event.get("group"), dict) else ""
                start_raw = event.get("start", "")
                event_dt = _parse_iso(start_raw)

                if not self.is_future(event_dt):
                    continue

                market_name = offer.get("criterion", {}).get("label", "1X2")

                for outcome in offer.get("outcomes", []):
                    odd_boosted = outcome.get("oddsDecimal")
                    if not odd_boosted:
                        # Kambi guarda em milésimos: 2500 = 2.50
                        raw = outcome.get("odds", 0)
                        odd_boosted = raw / 1000 if raw > 0 else None
                    if not odd_boosted or odd_boosted < 1.01:
                        continue

                    odd_base = None
                    prev = outcome.get("previousOddsDecimal") or outcome.get("prevOdds")
                    if prev:
                        odd_base = prev / 1000 if prev > 100 else prev

                    results.append(self.make_entry(
                        event_raw=event_name,
                        event_normalized=self.normalize_name(event_name),
                        league=league,
                        sport="football" if "basketball" not in league.lower() else "basketball",
                        event_datetime=event_dt,
                        market=market_name,
                        selection=outcome.get("label", event_name),
                        odd_boosted=odd_boosted,
                        odd_base=odd_base,
                    ))

        except Exception as e:
            logger.error("[Sportingbet] Erro API: %s", e)
        finally:
            await page.close()
        return results

    async def _scrape_dom(self, context: BrowserContext) -> list[dict]:
        """Fallback: scraping DOM buscando badge de cota aumentada."""
        results: list[dict] = []
        page = await context.new_page()
        try:
            await page.goto(DOM_URL, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(4_000)

            boosted = await page.query_selector_all(
                "[class*='boosted'], [class*='Boosted'], [data-testid*='boost']"
            )
            for el in boosted:
                try:
                    event_el = await el.evaluate_handle(
                        "n => n.closest('[class*=\"event\"]') || n.parentElement"
                    )
                    event_name = await event_el.evaluate("n => n.innerText || ''")
                    odd_el = await el.query_selector("[class*='odds'], [class*='price']")
                    odd_raw = (await odd_el.inner_text()).strip() if odd_el else ""
                    odd_boosted = self.parse_odd(odd_raw)
                    if odd_boosted:
                        results.append(self.make_entry(
                            event_raw=event_name.strip(),
                            event_normalized=self.normalize_name(event_name),
                            league="",
                            sport="football",
                            event_datetime=None,
                            market="1X2",
                            selection=event_name.strip(),
                            odd_boosted=odd_boosted,
                        ))
                except Exception:
                    pass
        except Exception as e:
            logger.error("[Sportingbet] Erro DOM: %s", e)
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
        return None
