# Deploy

App: Node 20 + Express + Puppeteer (com Chromium headless). Coleta a cada `SCRAPE_INTERVAL_MINUTES` minutos e serve o dashboard em `/`.

## Pré-requisitos da plataforma

- Suporte a **Docker** (a imagem base instala Chromium e libs nativas).
- Pelo menos **1GB de RAM** (Puppeteer + Chromium precisa).
- Processo de **longa duração** (não serverless tradicional — coleta agendada).
- Porta `8080` exposta.

## Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| `SERVER_PORT` | `8080` | Porta HTTP |
| `SCRAPE_INTERVAL_MINUTES` | `60` | Intervalo da coleta automática |

## Caminhos

### Render (1-click via render.yaml)
1. Push do repo pra GitHub/GitLab.
2. No [render.com](https://render.com), New → Blueprint → conectar repo.
3. O `render.yaml` é detectado automaticamente.
4. Plan `starter` ($7/mês, 512MB) **não é suficiente** — subir pra `standard` (2GB) ou maior.

### Fly.io
```bash
brew install flyctl
flyctl auth signup    # ou login
flyctl launch --copy-config --no-deploy   # lê fly.toml
flyctl deploy
```
Free tier: 1 VM `shared-cpu-1x` com 1GB roda confortavelmente.

### Docker em VPS / k8s interno
```bash
docker build -t odds-benchmark .
docker run -d -p 8080:8080 --name odds-benchmark odds-benchmark
```

## Healthcheck

`GET /health` retorna:
```json
{ "status":"ok", "updatedAt":"...", "totalRows": 56, "isRunning": false }
```

## Endpoints

- `GET /` — Dashboard HTML
- `GET /data` — JSON de comparações
- `GET /health` — Status
- `POST /trigger` — Dispara coleta manual

## Limitações conhecidas

- **Bet365** não retorna entries (Cloudflare resolvido com stealth, mas SPA usa WebSocket binário ofuscado). Marcado como best-effort.
- **Sportingbet basquete** retorna 0 boost (a casa não oferece price boost em basquete no momento).
- O dado é volátil: cada coleta sobrescreve `data/odds.json`. Se quiser histórico, persistir num volume externo ou banco.
