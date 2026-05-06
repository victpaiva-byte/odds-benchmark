from .superbet import SuperbetScraper
from .betano import BetanoScraper
from .sportingbet import SportingbetScraper
from .bet365 import Bet365Scraper
from .estrelabet import EstrelaberScraper

ALL_SCRAPERS = [
    SuperbetScraper,
    BetanoScraper,
    SportingbetScraper,
    Bet365Scraper,
    EstrelaberScraper,
]
