"""
Base scraper — define o contrato e helpers comuns.
"""
import re
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from unidecode import unidecode
from playwright.async_api import Page, BrowserContext

logger = logging.getLogger(__name__)
BRT = ZoneInfo("America/Sao_Paulo")


class BaseScraper(ABC):
    name: str = ""
    feature: str = "super_odds"  # identificador da feature coletada

    @abstractmethod
    async def scrape(self, context: BrowserContext) -> list[dict]:
        """
        Abre página(s) e retorna lista de OddEntry dicts.
        Só retorna eventos FUTUROS (event_datetime > now).
        """

    # ── helpers ────────────────────────────────────────────────────────────

    def now_brt(self) -> datetime:
        return datetime.now(tz=BRT)

    def is_future(self, dt: datetime) -> bool:
        """Descarta eventos que já começaram ou não têm data."""
        if dt is None:
            return False
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=BRT)
        return dt > self.now_brt()

    def normalize_name(self, name: str) -> str:
        """Remove acentos, pontuação e caixa para matching."""
        if not name:
            return ""
        name = unidecode(name.lower())
        name = re.sub(r"[^a-z0-9\s]", " ", name)
        name = re.sub(r"\s+", " ", name).strip()
        return name

    def parse_odd(self, raw: str) -> float | None:
        """Converte '2,50', '2.50', '@2.50' → 2.5. Retorna None se inválido."""
        if not raw:
            return None
        raw = re.sub(r"[^\d.,]", "", raw).replace(",", ".")
        try:
            v = float(raw)
            return v if 1.01 <= v <= 1000 else None
        except ValueError:
            return None

    def make_entry(
        self,
        *,
        event_raw: str,
        event_normalized: str,
        league: str,
        sport: str,
        event_datetime: datetime | None,
        market: str,
        selection: str,
        odd_boosted: float,
        odd_base: float | None = None,
        scraped_at: datetime | None = None,
    ) -> dict:
        scraped_at = scraped_at or self.now_brt()
        lift = None
        if odd_base and odd_base > 0:
            lift = round((odd_boosted - odd_base) / odd_base * 100, 1)

        return {
            "bookmaker": self.name,
            "feature": self.feature,
            "event_raw": event_raw,
            "event_normalized": event_normalized,
            "league": league,
            "sport": sport,
            "event_datetime": event_datetime.isoformat() if event_datetime else None,
            "market": market,
            "selection": selection,
            "odd_boosted": odd_boosted,
            "odd_base": odd_base,
            "lift_pct": lift,
            "scraped_at": scraped_at.isoformat(),
        }

    async def safe_text(self, page: Page, selector: str, default: str = "") -> str:
        try:
            el = await page.query_selector(selector)
            return (await el.inner_text()).strip() if el else default
        except Exception:
            return default

    async def wait_and_get_all(self, page: Page, selector: str) -> list:
        try:
            await page.wait_for_selector(selector, timeout=15_000)
            return await page.query_selector_all(selector)
        except Exception:
            logger.warning("[%s] Seletor não encontrado: %s", self.name, selector)
            return []
