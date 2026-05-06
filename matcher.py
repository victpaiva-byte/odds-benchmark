"""
Agrupa odds de diferentes casas para o mesmo evento/mercado/seleção.
Usa normalização de nomes + janela de tempo para matching.
"""
from __future__ import annotations
import re
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from unidecode import unidecode

logger = logging.getLogger(__name__)
BRT = ZoneInfo("America/Sao_Paulo")

BOOKMAKERS = ["Estrelabet", "Superbet", "Betano", "Sportingbet", "Bet365"]

# Abreviações e aliases comuns de times brasileiros
TEAM_ALIASES: dict[str, str] = {
    "atletico mineiro": "atletico mg",
    "atletico-mg": "atletico mg",
    "atletico mg": "atletico mg",
    "galo": "atletico mg",
    "flamengo": "flamengo",
    "fla": "flamengo",
    "fluminense": "fluminense",
    "flu": "fluminense",
    "vasco": "vasco",
    "vasco da gama": "vasco",
    "palmeiras": "palmeiras",
    "verdao": "palmeiras",
    "sao paulo": "sao paulo",
    "spfc": "sao paulo",
    "corinthians": "corinthians",
    "timao": "corinthians",
    "santos": "santos",
    "cruzeiro": "cruzeiro",
    "gremio": "gremio",
    "inter": "internacional",
    "internacional": "internacional",
    "bahia": "bahia",
    "bragantino": "bragantino",
    "rb bragantino": "bragantino",
    "botafogo": "botafogo",
    "fogo": "botafogo",
    "fortaleza": "fortaleza",
    "ceara": "ceara",
    "sport": "sport",
    "vitoria": "vitoria",
    "coritiba": "coritiba",
    "goias": "goias",
    "atletico goianiense": "atletico go",
    "atletico-go": "atletico go",
    "athletico": "athletico pr",
    "athletico paranaense": "athletico pr",
    "athletico-pr": "athletico pr",
    "parana": "parana",
    "cuiaba": "cuiaba",
    "america mineiro": "america mg",
    "america-mg": "america mg",
    # NBA
    "lakers": "lakers",
    "los angeles lakers": "lakers",
    "la lakers": "lakers",
    "celtics": "celtics",
    "boston celtics": "celtics",
    "warriors": "warriors",
    "golden state warriors": "warriors",
    "bulls": "bulls",
    "chicago bulls": "bulls",
}

TIME_WINDOW_MINUTES = 60  # eventos dentro desta janela são considerados o mesmo


def normalize(text: str) -> str:
    if not text:
        return ""
    text = unidecode(text.lower())
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def resolve_team(name: str) -> str:
    n = normalize(name)
    return TEAM_ALIASES.get(n, n)


def extract_teams(event_normalized: str) -> list[str]:
    """Extrai os dois times de uma string normalizada de evento."""
    separators = [" x ", " vs ", " - ", " × "]
    for sep in separators:
        if sep in event_normalized:
            parts = event_normalized.split(sep, 1)
            return [p.strip() for p in parts]
    # Fallback: divide ao meio
    words = event_normalized.split()
    mid = len(words) // 2
    return [" ".join(words[:mid]), " ".join(words[mid:])]


def events_match(a: dict, b: dict) -> bool:
    """Verifica se dois entries representam o mesmo evento."""
    teams_a = set(resolve_team(t) for t in extract_teams(a["event_normalized"]))
    teams_b = set(resolve_team(t) for t in extract_teams(b["event_normalized"]))

    if not teams_a or not teams_b:
        return False

    # Pelo menos um time em comum (cobre casos de abreviação diferente)
    overlap = teams_a & teams_b
    if not overlap:
        # Tenta match parcial: algum token de um nome contém o outro
        all_a = " ".join(teams_a)
        all_b = " ".join(teams_b)
        partial = any(tok in all_b for tok in all_a.split() if len(tok) > 3)
        partial |= any(tok in all_a for tok in all_b.split() if len(tok) > 3)
        if not partial:
            return False

    # Verifica janela de tempo
    dt_a = _parse_dt(a.get("event_datetime"))
    dt_b = _parse_dt(b.get("event_datetime"))
    if dt_a and dt_b:
        diff = abs((dt_a - dt_b).total_seconds()) / 60
        if diff > TIME_WINDOW_MINUTES:
            return False

    return True


def markets_match(a: dict, b: dict) -> bool:
    """Verifica se dois entries representam o mesmo mercado/seleção."""
    ma = normalize(a.get("market", ""))
    mb = normalize(b.get("market", ""))
    sa = normalize(a.get("selection", ""))
    sb = normalize(b.get("selection", ""))

    # Mercados equivalentes
    mkt_groups = [
        {"1x2", "resultado final", "vencedor", "money line", "moneyline", "resultado"},
        {"ambos marcam", "ambas marcam", "btts", "both teams to score"},
        {"over", "mais de", "acima de"},
        {"under", "menos de", "abaixo de"},
        {"handicap", "desvantagem"},
    ]
    ma_grp = _find_group(ma, mkt_groups)
    mb_grp = _find_group(mb, mkt_groups)

    if ma_grp is not None and mb_grp is not None:
        if ma_grp != mb_grp:
            return False
    elif ma and mb and ma not in mb and mb not in ma:
        return False

    # Seleções equivalentes
    if sa and sb:
        teams_a = {resolve_team(t) for t in extract_teams(sa)}
        teams_b = {resolve_team(t) for t in extract_teams(sb)}
        if not (teams_a & teams_b) and sa not in sb and sb not in sa:
            # Tenta match por token
            ta_tokens = {t for t in sa.split() if len(t) > 3}
            tb_tokens = {t for t in sb.split() if len(t) > 3}
            if not (ta_tokens & tb_tokens):
                return False

    return True


def build_comparison(entries: list[dict]) -> list[dict]:
    """
    Recebe todos os entries brutos e retorna uma lista de linhas comparativas.
    Cada linha: evento × mercado × seleção → { bookmaker: odd }
    Inclui somente eventos futuros.
    """
    now = datetime.now(tz=BRT)

    # Filtra futuros
    future = []
    for e in entries:
        dt = _parse_dt(e.get("event_datetime"))
        if dt is None or dt > now:
            future.append(e)

    rows: list[dict] = []

    for entry in future:
        placed = False
        for row in rows:
            rep = row["_entries"][0]
            if events_match(entry, rep) and markets_match(entry, rep):
                book = entry["bookmaker"]
                if book not in row["odds"] or entry["odd_boosted"] > row["odds"][book]["odd"]:
                    row["odds"][book] = {
                        "odd": entry["odd_boosted"],
                        "odd_base": entry.get("odd_base"),
                        "lift_pct": entry.get("lift_pct"),
                    }
                    row["_entries"].append(entry)
                placed = True
                break

        if not placed:
            rows.append({
                "_entries": [entry],
                "event_raw": entry["event_raw"],
                "event_normalized": entry["event_normalized"],
                "league": entry["league"],
                "sport": entry["sport"],
                "event_datetime": entry["event_datetime"],
                "market": entry["market"],
                "selection": entry["selection"],
                "odds": {
                    entry["bookmaker"]: {
                        "odd": entry["odd_boosted"],
                        "odd_base": entry.get("odd_base"),
                        "lift_pct": entry.get("lift_pct"),
                    }
                },
            })

    # Calcula melhor odd e destaque Estrelabet por linha
    for row in rows:
        best_odd = max((v["odd"] for v in row["odds"].values()), default=0)
        best_books = [k for k, v in row["odds"].items() if v["odd"] == best_odd]
        row["best_odd"] = best_odd
        row["best_bookmakers"] = best_books
        row["estrelabet_is_best"] = "Estrelabet" in best_books
        row["estrelabet_odd"] = row["odds"].get("Estrelabet", {}).get("odd")

    # Ordena: eventos com Estrelabet primeiro, depois por data
    rows.sort(key=lambda r: (
        not r["estrelabet_is_best"],
        r["event_datetime"] or "9999",
    ))

    # Remove campo interno antes de retornar
    for row in rows:
        del row["_entries"]

    return rows


def build_summary(rows: list[dict]) -> dict:
    """Gera resumo para o ROAM webhook."""
    estrelabet_best = [r for r in rows if r["estrelabet_is_best"]]
    estrelabet_not_best = [r for r in rows if not r["estrelabet_is_best"] and r.get("estrelabet_odd")]

    return {
        "total_markets": len(rows),
        "estrelabet_is_best_count": len(estrelabet_best),
        "estrelabet_not_best_count": len(estrelabet_not_best),
        "win_rate": round(len(estrelabet_best) / len(rows) * 100, 1) if rows else 0,
        "best_markets": [
            {
                "event": r["event_raw"],
                "market": r["market"],
                "selection": r["selection"],
                "estrelabet_odd": r["estrelabet_odd"],
                "best_odd": r["best_odd"],
            }
            for r in estrelabet_best[:10]
        ],
    }


def _find_group(text: str, groups: list[set]) -> int | None:
    for i, grp in enumerate(groups):
        if any(kw in text for kw in grp):
            return i
    return None


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=BRT)
        return dt
    except (ValueError, TypeError):
        return None
