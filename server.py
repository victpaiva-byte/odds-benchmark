"""
Servidor HTTP — serve o dashboard e a API de dados.
  GET /          → dashboard HTML
  GET /data      → odds.json atual
  GET /health    → status + última atualização
  POST /trigger  → dispara coleta manual
"""
import asyncio
import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import uvicorn
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("server")

BRT = ZoneInfo("America/Sao_Paulo")
DATA_FILE = Path(__file__).parent / "data" / "odds.json"
DASHBOARD_FILE = Path(__file__).parent / "dashboard" / "index.html"
PORT = int(os.getenv("SERVER_PORT", 8080))

app = FastAPI(title="Odds Benchmark", docs_url=None, redoc_url=None)

_scrape_lock = threading.Lock()
_is_scraping = False


@app.get("/", response_class=HTMLResponse)
async def dashboard():
    if not DASHBOARD_FILE.exists():
        raise HTTPException(status_code=404, detail="dashboard/index.html não encontrado")
    return HTMLResponse(DASHBOARD_FILE.read_text(encoding="utf-8"))


@app.get("/data")
async def get_data():
    if not DATA_FILE.exists():
        return JSONResponse({"updated_at": None, "total_rows": 0, "rows": [], "raw_count": 0})
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return JSONResponse(data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    updated = None
    row_count = 0
    if DATA_FILE.exists():
        try:
            data = json.loads(DATA_FILE.read_text())
            updated = data.get("updated_at")
            row_count = data.get("total_rows", 0)
        except Exception:
            pass
    return {
        "status": "ok",
        "updated_at": updated,
        "total_rows": row_count,
        "is_scraping": _is_scraping,
        "server_time": datetime.now(tz=BRT).isoformat(),
    }


@app.post("/trigger")
async def trigger_scrape(background_tasks: BackgroundTasks):
    global _is_scraping
    if _is_scraping:
        return JSONResponse({"status": "already_running"}, status_code=409)
    background_tasks.add_task(_run_scrape)
    return {"status": "started"}


async def _run_scrape():
    global _is_scraping
    if _is_scraping:
        return
    _is_scraping = True
    try:
        from main import main
        await main()
    except Exception as e:
        logger.error("Erro na coleta via trigger: %s", e)
    finally:
        _is_scraping = False


def start_scheduler():
    """Executa coleta periódica em background."""
    import schedule
    import time

    interval = int(os.getenv("SCRAPE_INTERVAL_MINUTES", 60))

    def job():
        if _is_scraping:
            return
        logger.info("Scheduler: iniciando coleta agendada")
        asyncio.run(_run_scrape())

    schedule.every(interval).minutes.do(job)
    logger.info("Scheduler iniciado: coleta a cada %d min", interval)

    # Primeira coleta imediata
    job()

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    # Inicia scheduler em thread separada
    t = threading.Thread(target=start_scheduler, daemon=True)
    t.start()

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
