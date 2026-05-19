# Odds Benchmark — Super Odds 1x2

Benchmark competitivo da Estrelabet contra concorrentes brasileiros (Sportingbet, Betano)
no mercado **Vencedor do encontro - Super Odds (1x2)**.

## O que faz

1. Coleta as Super Odds 1x2 ativas no site da Estrelabet
2. Coleta as cotações 1x2 padrão dos mesmos eventos nos concorrentes
3. Pareia evento + desfecho idênticos (apples-to-apples)
4. Produz:
   - `dashboard/standalone.html` — dashboard interativo single-file (hospedado no Lovable)
   - `dashboard/benchmark.pdf` — relatório imprimível com resumo executivo
   - `data/odds.json` — dado bruto da coleta

## Workflow

### Atualizar dados (manual)
1. Abra a aba **Actions** deste repo
2. Selecione o workflow **Atualizar dashboard**
3. Clique **Run workflow** → branch `main` → **Run**
4. O job roda em ~2 minutos: scrape + build standalone + build PDF + commit dos artefatos
5. O Lovable (conectado a este repo) faz redeploy automático após o commit

### Rodar localmente
```bash
npm install
npm run build:all   # scrape + standalone + pdf
open dashboard/benchmark.pdf
```

Ou cada passo separado:
```bash
npm run scrape             # gera data/odds.json
npm run build:standalone   # gera dashboard/standalone.html
npm run build:pdf          # gera dashboard/benchmark.pdf
```

## Estrutura

```
.
├── main.js                       Orquestrador (lança scrapers em paralelo)
├── matcher.js                    Agrupa entries 1x2 por evento + outcome
├── scrapers/
│   ├── base.js                   Helpers compartilhados (makeEntry, parseOdd, etc.)
│   ├── estrelabet.js             Altenar V2 — GetEvents → "Vencedor do encontro - Super Odds"
│   ├── sportingbet.js            CDS Entain — fixtures + "Resultado da Partida"
│   ├── betano.js                 Trending leagues → events → "Resultado Final"
│   ├── superbet.js               (legado, retorna combos — não usado no benchmark 1x2)
│   └── bet365.js                 (best-effort, sempre 0 — Cloudflare + WS binário)
├── scripts/
│   ├── build-standalone.js       Transforma dashboard/index.html → standalone single-file
│   ├── build-pdf.js              Gera benchmark.pdf via Puppeteer
│   └── verify.js                 Re-consulta APIs ao vivo e compara com data/odds.json
├── dashboard/
│   ├── index.html                Dashboard template (modo server, usa /data)
│   ├── standalone.html           Gerado: HTML único com dados embedados (vai pro Lovable)
│   └── benchmark.pdf             Gerado: relatório imprimível
└── data/
    └── odds.json                 Gerado: dados brutos da última coleta
```

## Como o pareamento funciona

O `matcher.js` só agrupa entries 1x2 quando:
- **Times em comum** após normalização (remove acentos, aliases tipo "Atlético MG" / "Galo")
- **Janela de tempo** de 90 minutos entre os start dates (folga pra inconsistências entre casas)
- **Mesmo outcome** (home / draw / away) — classificado pelo selection vs eventRaw

Cada outcome vira uma linha. Casas concorrentes sem 1x2 para um evento Estrela aparecem como
"Só Estrela tem" — nessas linhas não há comparação possível.

## Limitações

- **Bet365** não é coletado (Cloudflare + WebSocket binário ofuscado — inviável sem reverse-eng pesado)
- **Superbet** não disponibiliza 1x2 padrão automatizado de forma estável (DOM only, e o feed atual é combos)
- **Foco em futebol** (sportId=66 Altenar / sportIds=4 CDS Entain); outros esportes podem ser adicionados
- **Movimentação de mercado**: cada execução é um snapshot. Odds variam minuto-a-minuto.

## Dashboard

O HTML gerado em `dashboard/standalone.html` é hospedado no [Lovable](https://lovable.dev/) — basta
copiar o conteúdo e colar lá. Tudo embedado, sem fetch, sem servidor.

O botão **↺ Atualizar** no dashboard recarrega a página — se o Lovable estiver conectado a este
repo, ele puxa a versão mais recente após cada commit do GitHub Action.
