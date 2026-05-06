"""
Bet365 — "Acumuladores Aumentados".
A Bet365 usa um DOM altamente ofuscado; vamos tentar interceptar
as respostas XHR que carregam os dados de odds (mais estável).
"""
import logging
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.async_api import BrowserContext
from .base import BaseScraper

logger = logging.getLogger(__name__)
BRT = ZoneInfo("America/Sao_Paulo")

# Página de acumuladores / price boost na Bet365 BR
URL = "https://www.bet365.bet.br/#/AC/B1/C1/D13/E5/F10/"


class Bet365Scraper(BaseScraper):
    name = "Bet365"

    async def scrape(self, context: BrowserContext) -> list[dict]:
        results: list[dict] = []
        page = await context.new_page()
        intercepted: list[dict] = []

        async def on_response(response):
            """Intercepta respostas JSON com dados de odds."""
            url = response.url
            if "bet365" not in url:
                return
            if not any(k in url for k in ("marketprices", "odds", "boosted", "acumulador")):
                return
            try:
                body = await response.text()
                if "oddsDecimal" in body or "priceDecimal" in body:
                    intercepted.append(json.loads(body))
            except Exception:
                pass

        page.on("response", on_response)

        try:
            logger.info("[Bet365] Abrindo %s", URL)
            await page.goto(URL, wait_until="domcontentloaded", timeout=40_000)
            await page.wait_for_timeout(5_000)

            # Tenta parsear dados interceptados
            for data in intercepted:
                _extract_from_xhr(data, results, self)

            # Se não capturou nada via XHR, tenta DOM
            if not results:
                logger.info("[Bet365] Tentando scraping de DOM")
                results = await self._scrape_dom(page)

        except Exception as e:
            logger.error("[Bet365] Falha: %s", e)
        finally:
            await page.close()

        logger.info("[Bet365] %d odds coletadas", len(results))
        return results

    async def _scrape_dom(self, page) -> list[dict]:
        results: list[dict] = []
        try:
            # Bet365 usa classes ofuscadas — busca por atributos de dados
            items = await page.query_selector_all(
                "[class*='MaB'], [class*='gl-Market'], [class*='PowerPrice']"
            )
            for item in items:
                try:
                    text = await item.inner_text()
                    lines = [l.strip() for l in text.split("\n") if l.strip()]
                    odd_val = None
                    for line in lines:
                        v = self.parse_odd(line)
                        if v and v > 1.01:
                            odd_val = v
                            break
                    if odd_val:
                        results.append(self.make_entry(
                            event_raw=" ".join(lines[:3]),
                            event_normalized=self.normalize_name(" ".join(lines[:3])),
                            league="",
                            sport="football",
                            event_datetime=None,
                            market="Acumulador Aumentado",
                            selection=" ".join(lines[:3]),
                            odd_boosted=odd_val,
                        ))
                except Exception:
                    pass
        except Exception as e:
            logger.error("[Bet365] Erro DOM: %s", e)
        return results


def _extract_from_xhr(data: dict, results: list, scraper: BaseScraper):
    """Tenta extrair odds de estruturas JSON comuns da Bet365."""
    for key, val in data.items() if isinstance(data, dict) else []:
        if isinstance(val, list):
            for item in val:
                if isinstance(item, dict):
                    _extract_from_xhr(item, results, scraper)
        elif isinstance(val, dict):
            _extract_from_xhr(val, results, scraper)

    if isinstance(data, dict) and ("oddsDecimal" in data or "priceDecimal" in data):
        odd_boosted = data.get("oddsDecimal") or data.get("priceDecimal")
        if odd_boosted and float(odd_boosted) > 1.01:
            event_name = data.get("eventName", data.get("name", ""))
            results.append(scraper.make_entry(
                event_raw=event_name,
                event_normalized=scraper.normalize_name(event_name),
                league=data.get("leagueName", ""),
                sport="football",
                event_datetime=None,
                market=data.get("marketName", "Acumulador"),
                selection=data.get("participantName", event_name),
                odd_boosted=float(odd_boosted),
                odd_base=data.get("previousOdds"),
            ))
