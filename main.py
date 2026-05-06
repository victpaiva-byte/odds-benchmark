"""
Orquestrador principal.
  - Roda todos os scrapers em paralelo (um browser, contextos separados)
  - Faz o matching e salva data/odds.json
  - Envia resumo ao ROAM via webhook
  - Pode ser chamado diretamente (python main.py) ou pelo scheduler
"""
import asyncio
import json
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

import httpx
from dotenv import load_dotenv
from playwright.async_api import async_playwright

from scrapers import ALL_SCRAPERS
from matcher import build_comparison, build_summary

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("main")

BRT = ZoneInfo("America/Sao_Paulo")
DATA_FILE = Path(__file__).parent / "data" / "odds.json"
ROAM_WEBHOOK = os.getenv("ROAM_WEBHOOK_URL", "")
HEADLESS = os.getenv("HEADLESS", "true").lower() == "true"


async def run_scraper(scraper_cls, context):
    scraper = scraper_cls()
    try:
        return await scraper.scrape(context)
    except Exception as e:
        logger.error("[%s] Scraper falhou: %s", scraper.name, e)
        return []


async def collect_all() -> list[dict]:
    """Executa todos os scrapers em paralelo e retorna lista de entries."""
    all_entries: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=HEADLESS,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        )

        # User-agent realista
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
        )

        tasks = [run_scraper(cls, context) for cls in ALL_SCRAPERS]
        results = await asyncio.gather(*tasks)

        for entries in results:
            all_entries.extend(entries)

        await browser.close()

    logger.info("Total bruto coletado: %d entries", len(all_entries))
    return all_entries


def save_data(rows: list[dict], raw_entries: list[dict]):
    DATA_FILE.parent.mkdir(exist_ok=True)
    payload = {
        "updated_at": datetime.now(tz=BRT).isoformat(),
        "total_rows": len(rows),
        "rows": rows,
        "raw_count": len(raw_entries),
    }
    DATA_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    logger.info("Salvo em %s (%d linhas)", DATA_FILE, len(rows))


async def send_roam(summary: dict):
    if not ROAM_WEBHOOK:
        logger.warning("ROAM_WEBHOOK_URL não configurado — pulando envio")
        return

    best = summary["best_markets"]
    win_rate = summary["win_rate"]
    total = summary["total_markets"]
    best_count = summary["estrelabet_is_best_count"]

    lines = [
        f"*Super Odds Benchmark — {datetime.now(tz=BRT).strftime('%d/%m %H:%M')} BRT*",
        f"Estrelabet é melhor em *{best_count}/{total}* mercados ({win_rate}%)",
        "",
        "*Top odds onde somos #1:*",
    ]

    for m in best[:8]:
        lines.append(
            f"• {m['event']} | {m['market']} — {m['selection']}: *{m['estrelabet_odd']:.2f}*"
        )

    if summary["estrelabet_not_best_count"] > 0:
        lines.append(
            f"\n_{summary['estrelabet_not_best_count']} mercado(s) com odds melhores em concorrentes_"
        )

    message = "\n".join(lines)

    payload = {"text": message}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(ROAM_WEBHOOK, json=payload)
            resp.raise_for_status()
            logger.info("ROAM: mensagem enviada (status %d)", resp.status_code)
    except Exception as e:
        logger.error("ROAM: falha no envio — %s", e)


async def main():
    logger.info("=== Iniciando coleta ===")
    raw_entries = await collect_all()

    if not raw_entries:
        logger.warning("Nenhum entry coletado — verifique os scrapers")
        return

    rows = build_comparison(raw_entries)
    summary = build_summary(rows)

    save_data(rows, raw_entries)
    await send_roam(summary)

    logger.info(
        "Coleta concluída: %d linhas | Estrelabet melhor em %d/%d (%.1f%%)",
        len(rows),
        summary["estrelabet_is_best_count"],
        summary["total_markets"],
        summary["win_rate"],
    )


if __name__ == "__main__":
    asyncio.run(main())
