"""
Seletores CSS/XPath por casa. Ajuste aqui sem mexer no scraper.
Cada casa pode ter: url, container, event_name, teams, odd_boosted,
odd_base (opcional), market, selection, date_time.
"""

SUPERBET = {
    "url": "https://superbet.bet.br/odds-aumentadas/",
    # Aguardar este seletor aparecer antes de ler o DOM
    "wait_for": ".event-odds, .boosted-event, [class*='BoostEvent'], [class*='boosted']",
    # Container de cada odd aumentada
    "container": "[class*='BoostEvent'], [class*='boosted-event'], .event-odds",
    "event_name": "[class*='EventName'], [class*='event-name'], .match-name",
    "odd_boosted": "[class*='odd-value'], [class*='OddValue'], .price",
    "odd_base": "[class*='old-price'], [class*='OldPrice'], [class*='base-odd'], s",
    "market": "[class*='market-name'], [class*='MarketName'], .bet-type",
    "selection": "[class*='selection'], [class*='Selection'], .team-name",
    "date_time": "[class*='event-date'], [class*='EventDate'], time",
}

BETANO = {
    # Betano não tem página dedicada — vamos buscar eventos com badge "SO"
    "url": "https://betano.bet.br/sport/futebol/",
    "url_nba": "https://betano.bet.br/sport/basquetebol/",
    "wait_for": "[class*='selections__selection'], .selections__selection",
    # Eventos que contêm o badge SuperOdd
    "badge_selector": "[class*='so-badge'], [class*='SuperOdd'], [class*='super-odd'], .so",
    # Container do evento pai onde o badge está
    "event_container": "[class*='event'], [class*='Event']",
    "event_name": "[class*='event__title'], [class*='EventTitle'], .event-name",
    "odd_boosted": "[class*='odd__value'], [class*='OddValue'], .price-value",
    "odd_base": "[class*='odd-base'], [class*='OddBase'], [class*='strikethrough'], s",
    "market": "[class*='market__name'], [class*='MarketName']",
    "selection": "[class*='selection__name'], [class*='SelectionName']",
    "date_time": "[class*='event__start-time'], time",
}

SPORTINGBET = {
    # Sportingbet: buscar "Cotas Aumentadas" na navegação ou filtro
    "url": "https://sportingbet.bet.br/sport/football/",
    "wait_for": ".KambiBC-event-item",
    # Filtro de Cotas Aumentadas (pode ser via URL param ou badge)
    "url_boosted": "https://sportingbet.bet.br/sport/football/?filter=boosted",
    "badge_selector": "[class*='boosted'], [class*='Boosted'], [data-boosted='true']",
    "event_container": ".KambiBC-event-item, [class*='event-item']",
    "event_name": ".KambiBC-event-item__event-name, [class*='event-name']",
    "odd_boosted": ".KambiBC-odds-item, [class*='odds-value']",
    "odd_base": "[class*='old-odds'], [class*='original-odds'], s",
    "market": "[class*='market-name']",
    "selection": "[class*='outcome-label'], [class*='OutcomeLabel']",
    "date_time": "[class*='event-start-time'], time",
}

BET365 = {
    # Bet365: Acumuladores Aumentados
    "url": "https://www.bet365.bet.br/#/AC/B1/C1/D13/E5/F135/",
    "wait_for": ".gl-MarketGroup, .ovm-OverlayMarket",
    "badge_selector": "[class*='boosted'], [class*='Boosted'], [class*='power-price']",
    "event_container": ".gl-Market, [class*='event']",
    "event_name": ".gl-Market_NameLabel, [class*='event-name']",
    "odd_boosted": ".gl-Participant_Odds, [class*='Odds']",
    "odd_base": "[class*='previous-odds'], [class*='PreviousOdds'], s",
    "market": ".gl-MarketGroup_Text, [class*='market-name']",
    "selection": ".gl-Participant_Name, [class*='participant']",
    "date_time": ".gl-MarketGroup_Date, time",
}

ESTRELABET = {
    # Estrelabet: Apostas Aumentadas (plataforma Altenar)
    "url": "https://estrelabet.bet.br/pt/sport/pre-match",
    "url_boosted": "https://estrelabet.bet.br/pt/promotions/apostas-aumentadas",
    "wait_for": "[class*='event'], .altenar-event",
    "badge_selector": "[class*='boosted'], [class*='increased'], [class*='super']",
    "event_container": "[class*='event-row'], [class*='EventRow'], .event",
    "event_name": "[class*='event-name'], [class*='EventName']",
    "odd_boosted": "[class*='odd-value'], [class*='OddValue'], .price",
    "odd_base": "[class*='original-odd'], [class*='base-odd'], s",
    "market": "[class*='market-name'], [class*='MarketName']",
    "selection": "[class*='selection-name'], [class*='SelectionName']",
    "date_time": "[class*='event-date'], [class*='EventDate'], time",
}
