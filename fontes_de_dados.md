# Fontes de Dados do Projeto

Este documento descreve as fontes de dados atualmente utilizadas no AgroMarkets BR, com base no backend em `backend/server.js`.

## 1) APIs internas (consumidas pelo frontend)

O frontend React não consulta provedores externos diretamente. Ele consome apenas os endpoints do backend:

- `GET /api/agricola`
- `GET /api/financeiro`
- `GET /api/dolar-futuro`
- `GET /api/status`

## 2) APIs externas utilizadas pelo backend

### 2.1 Yahoo Finance (via `yahoo-finance2`)

Principal fonte para commodities, câmbio, índices e contratos futuros.

**Commodities agrícolas (CBOT):**
- `ZS=F` (Soja grão)
- `ZM=F` (Farelo de soja)
- `ZL=F` (Óleo de soja)

**Câmbio e índices:**
- `BRL=X` (USD/BRL comercial)
- `EURBRL=X` (EUR/BRL)
- `EURUSD=X` (base para cálculo de USD/EUR)
- `DX-Y.NYB` (DXY)
- `GC=F` (Ouro)

**Dólar futuro:**
- B3: `DOL{Mês}{Ano}.SA` e `WDO{Mês}{Ano}.SA`
- CME (fallback): `6L{Mês}{Ano}.CME`

### 2.2 PTAX (Banco Central do Brasil - OData)

Fonte oficial para o indicador de dólar PTAX.

- Endpoint utilizado:
    - `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(...)`
- Referência de documentação:
    - [Olinda BCB](https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/aplicacao#!/)

## 3) Fontes não utilizadas atualmente

As fontes abaixo não fazem parte da implementação atual do backend:

- Alpha Vantage
- Finnhub
- HG Brasil

## 4) Observações de arquitetura

- O backend faz polling periódico dos provedores externos e mantém cache em memória.
- O frontend consulta apenas o backend, reduzindo problemas de CORS e evitando exposição de credenciais/chaves.
- O intervalo de atualização é controlado por `SYNC_INTERVAL_MINUTES` (default: `15`).

## 5) Sobre dados físicos (CEPEA)

Dados CEPEA não estão integrados no projeto atual. Caso necessário no futuro, a integração tende a exigir processo próprio de coleta (ex.: scraper/ETL), já que não há API REST pública oficial amplamente estável para esse uso.
