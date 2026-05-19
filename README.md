# Odds Benchmark — Super Odds 1x2

Benchmark competitivo da Estrelabet contra concorrentes brasileiros (Sportingbet, Betano)
no mercado **Vencedor do encontro - Super Odds (1x2)**.

## O que faz

1. Coleta as Super Odds 1x2 ativas no site da Estrelabet (Altenar V2)
2. Coleta as cotações 1x2 padrão dos mesmos eventos nos concorrentes (CDS Entain + Betano API)
3. Pareia evento + desfecho idênticos (apples-to-apples)
4. Produz três artefatos:
   - `dashboard/standalone.html` — single-file com dados embedados (zero servidor)
   - `dashboard/benchmark.pdf` — relatório imprimível com resumo executivo
   - `data/odds.json` — dado bruto da coleta

---

## Ambientes

| Ambiente | Branch | URL | Atualização |
|---|---|---|---|
| **Produção** | `main` | https://odds-benchmark-estrela.fly.dev/ + https://victpaiva-byte.github.io/odds-benchmark/ | Push em `main` dispara deploy automático (Fly + Pages) |
| **Staging (local)** | branch da feature ou `dev` | `http://localhost:8080` via `npm start` | Sem CI |

**Fluxo padrão:**
```bash
# 1. Trabalha numa branch separada
git checkout -b feat/minha-coisa
# ...edits...
npm start                              # testa local em http://localhost:8080

# 2. Quando estável, merge no main
git checkout main
git merge feat/minha-coisa
git push                               # dispara deploy-prod.yml (Fly) + pages.yml (Pages)
```

## Como rodar

### Modo 1 — Standalone (sem servidor)

Roda local, gera HTML único, hospeda em qualquer static host (Vercel, Netlify, S3, GitHub Pages, Lovable, etc.).

```bash
npm install
npm run build:all        # scrape + standalone HTML + PDF
open dashboard/standalone.html
```

O `standalone.html` tem todos os dados embedados em `window.__DATA__`. Não faz fetch, não precisa de backend. O botão "↺ Atualizar" só recarrega a página — pra atualizar dados, rode o build de novo.

### Modo 2 — Servidor Express

Roda como serviço Node, com endpoints HTTP e coleta agendada/sob demanda.

```bash
npm install
npm start                # sobe servidor em :8080
```

Endpoints:
- `GET /`          — dashboard `index.html` (modo dinâmico, fetch `/data`)
- `GET /data`      — JSON da última coleta
- `GET /health`    — status + horário da última coleta
- `POST /trigger`  — dispara coleta manual (responde 409 se já estiver rodando)

Configuração via env:
- `SERVER_PORT` (default 8080)
- `SCRAPE_INTERVAL_MINUTES` (default 60) — coleta agendada periódica

### Modo 3 — GitHub Actions (já configurado)

Workflow `.github/workflows/update-dashboard.yml`:
1. Acesse a aba **Actions** do repo
2. Selecione **Atualizar dashboard** → **Run workflow** → branch `main` → **Run**
3. ~1m30s depois, um novo commit aparece com `data/odds.json`, `dashboard/standalone.html` e `dashboard/benchmark.pdf` atualizados

Ou via CLI:
```bash
gh workflow run update-dashboard.yml
```

---

## Deploy

O repo já vem com configs prontas pra três caminhos:

| Plataforma | Arquivo | Notas |
|---|---|---|
| **Docker (qualquer cloud)** | `Dockerfile` | Imagem base `ghcr.io/puppeteer/puppeteer:24.10.1` (Chromium já incluído). `EXPOSE 8080`. |
| **Fly.io** | `fly.toml` | `flyctl launch && flyctl deploy`. 1 GB RAM. |
| **Render** | `render.yaml` | 1-click via blueprint. ⚠️ Plan `starter` (512 MB) costuma falhar OOM — usar `standard` (2 GB). |
| **Static host** (Lovable, Vercel, Netlify, GitHub Pages) | `dashboard/standalone.html` | Sem servidor. Re-gera via GitHub Actions. |

---

## Estrutura

```
.
├── main.js                       Orquestrador (lança scrapers em paralelo)
├── matcher.js                    Agrupa entries 1x2 por evento + outcome
├── server.js                     Express HTTP (modo servidor)
├── scrapers/
│   ├── base.js                   Helpers (makeEntry, parseOdd, normalizeName, etc.)
│   ├── estrelabet.js             Altenar V2 — GetEvents → "Vencedor do encontro - Super Odds"
│   ├── sportingbet.js            CDS Entain — fixtures + "Resultado da Partida"
│   ├── betano.js                 Trending leagues → events → "Resultado Final" (browser dedicado, evita WAF 503)
│   ├── superbet.js               (legado, retorna combos — não usado no benchmark 1x2)
│   └── bet365.js                 (best-effort, sempre 0 — Cloudflare + WS binário)
├── scripts/
│   ├── build-standalone.js       Transforma dashboard/server.html → standalone single-file
│   ├── build-pdf.js              Gera benchmark.pdf via Puppeteer
│   ├── serve-static.js           Mini static server pra preview local (modo standalone)
│   └── verify.js                 Re-consulta APIs ao vivo, compara com data/odds.json
├── dashboard/
│   ├── index.html                Template (server mode — fetch /data, botão Coletar agora)
│   ├── standalone.html           Gerado: single-file pro static host
│   └── benchmark.pdf             Gerado: relatório imprimível
└── data/
    └── odds.json                 Gerado: dados brutos da última coleta
```

---

## Como o pareamento funciona

O `matcher.js` só agrupa entries 1x2 quando:
- **Times em comum** após normalização (remove acentos, aliases tipo "Atlético MG" / "Galo")
- **Janela de tempo** de 90 minutos entre os start dates
- **Mesmo outcome** (home / draw / away) — classificado pelo selection vs eventRaw

Cada outcome vira uma linha. Casas concorrentes sem 1x2 para um evento Estrela aparecem como
"Só Estrela tem" — nessas linhas não há comparação possível.

## Limitações

- **Bet365** não é coletado (Cloudflare + WebSocket binário ofuscado — inviável)
- **Superbet** não disponibiliza 1x2 padrão automatizado de forma estável (DOM only, feed atual é combos turbinados)
- **Foco em futebol** (sportId=66 Altenar / sportIds=4 CDS Entain)
- **Snapshot**: odds variam minuto-a-minuto, cada execução é um instantâneo
