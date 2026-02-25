# AgroMarkets BR

## Executar projeto (frontend + backend)

Na raiz do projeto:

```bash
npm run dev:all
```

Se quiser instalar tudo automaticamente e já iniciar frontend + backend:

```bash
npm run dev:setup
```

Esse comando inicia:

- frontend (Vite)
- backend (Node/Express)

Para encerrar os dois, use `Ctrl+C`.

## Deploy (Vercel + Render)

Configuração recomendada para este repositório:

- Frontend (React/Vite) no **Vercel**
- Backend (Node/Express em `backend/`) no **Render**

### 1) Deploy do backend no Render

Opção A (recomendada): usar Blueprint com `render.yaml` já incluído na raiz.

1. No Render, clique em **New +** → **Blueprint**.
2. Conecte seu GitHub e selecione este repositório.
3. Confirme a criação do serviço `agromarkets-br-backend`.

O restante já está pré-configurado:

- `rootDir`: `backend`
- `buildCommand`: `npm install`
- `startCommand`: `npm start`
- `healthCheckPath`: `/api/status`

Após deploy, copie a URL pública do backend (ex.: `https://agromarkets-br-backend.onrender.com`).

### 2) Deploy do frontend no Vercel

1. No Vercel, clique em **Add New...** → **Project**.
2. Importe o mesmo repositório no GitHub.
3. Em **Build and Output Settings**, mantenha:
  - Build Command: `npm run build`
  - Output Directory: `dist`
4. Em **Environment Variables**, adicione:
  - `VITE_API_BASE_URL` = URL do Render copiada acima (sem barra no final).
5. Faça o deploy.

O arquivo `vercel.json` na raiz já define os comandos esperados para este app Vite.

### 3) Ordem correta de configuração

1. Faça deploy do backend no Render e obtenha a URL.
2. Configure `VITE_API_BASE_URL` no Vercel.
3. Redeploy do frontend (ou novo commit) para aplicar a variável.

### 4) Variáveis usadas

Frontend (`.env.example` na raiz):

- `VITE_API_BASE_URL` (ex.: `http://localhost:3001` local / URL do Render em produção)

Backend (`backend/.env.example`):

- `PORT`
- `SYNC_INTERVAL_MINUTES`
- `PROVIDER_TIMEOUT_MS`
- `AGRI_TOTAL_CONTRACTS`
- `DOLAR_FUTURO_CONTRACT_COUNT`

## Configuração do backend (câmbio e curva)

O backend usa:

- **Yahoo Finance** para commodities agrícolas, DXY e contratos futuros de dólar (CME)
- **AwesomeAPI** para câmbio (USD-BRL, PTAX, EUR-BRL, EUR-USD) e ouro (XAU-BRL)

### APIs utilizadas no projeto

#### 1) APIs internas (backend do projeto)

Endpoints expostos pelo backend (`backend/server.js`) e consumidos pelo frontend:

- `GET /api/agricola`
- `GET /api/financeiro`
- `GET /api/status`

Formato de payload:

- Campos formatados para exibição (`ult`, `max`, `min`, `fec`, `abe`, `dif`, `varPerc`)
- Campos numéricos brutos correspondentes (`ultRaw`, `maxRaw`, `minRaw`, `fecRaw`, `abeRaw`, `difRaw`, `varPercRaw`)
- No ouro (`XAU-BRL`), também são retornados campos por grama (`ultGrama`, `ultGramaRaw`, etc.)

#### 2) APIs externas e fontes de mercado

##### Yahoo Finance (via biblioteca `yahoo-finance2` no backend)

Ativos consultados hoje no projeto:

- Commodities agrícolas (CBOT):
  - `ZS=F` (Soja grão)
  - `ZM=F` (Farelo de soja)
  - `ZL=F` (Óleo de soja)
- Índices:
  - `DX-Y.NYB` (DXY)
- Dólar futuro:
  - CME: `6L{Mês}{Ano}.CME` (somente)

##### AwesomeAPI

- Endpoints usados no backend:
  - `https://economia.awesomeapi.com.br/json/last/USD-BRL`
  - `https://economia.awesomeapi.com.br/json/last/USD-BRLPTAX`
  - `https://economia.awesomeapi.com.br/json/last/EUR-BRL`
  - `https://economia.awesomeapi.com.br/json/last/EUR-USD`
  - `https://economia.awesomeapi.com.br/json/last/XAU-BRL`

Obs.: o backend atualiza e cacheia os dados periodicamente (polling), e o frontend consulta apenas as APIs internas acima.

Variáveis de ambiente suportadas no backend:

- `PORT` (default: `3001`)
- `SYNC_INTERVAL_MINUTES` (default: `15`)
- `PROVIDER_TIMEOUT_MS` (default: `8000`)
- `AGRI_TOTAL_CONTRACTS` (default: `15`, total de contratos por commodity, incluindo o atual)
- `DOLAR_FUTURO_CONTRACT_COUNT` (default: `3`)

Exemplo:

```bash
cd backend
npm run dev
```
