# Fontes de Dados para o Dashboard de Commodities

Para substituir os dados mockados do seu MVP por **dados reais** (ou com um pequeno atraso de 15 minutos, padrão em mercados financeiros gratuitos), você precisará consumir APIs externas.

Como o seu dashboard possui tanto **Commodities de Chicago (CBOT)** (como Soja, Farelo e Óleo) quanto **Indicadores Financeiros Brasileiros e Globais** (Dólar, Ouro, DXY), o plano adotado no projeto é:

### 1. Yahoo Finance API (curva futura e fallback)
Esta é a fonte usada para ativos globais, incluindo os contratos futuros agrícolas de Chicago e a curva de dólar futuro.
*   **Como acessar:** Não possui uma API oficial, mas a comunidade mantém bibliotecas excelentes e muito estáveis. Se você criar um backend em Node.js, pode usar a lib `yahoo-finance2`. Em Python, usa-se a `yfinance`.
*   **Tickers utilizados no projeto:**
    *   **Soja Grão (CBOT):** `ZS=F` (Contrato futuro contínuo)
    *   **Farelo de Soja:** `ZM=F`
    *   **Óleo de Soja:** `ZL=F`
    *   **Dólar/Real (fallback):** `BRL=X`
    *   **Ouro:** `GC=F`
    *   **Índice Dólar (DXY):** `DX-Y.NYB`

### 2. PTAX (Banco Central do Brasil - OData)
Fonte oficial para dólar PTAX usada no backend para o indicador de referência.
*   **Link:** [Olinda BCB](https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/aplicacao#!/)
*   **Útil para:** Cotação oficial de dólar (PTAX), sem dependência de plano pago de terceiros.

### 3. Alpha Vantage / Finnhub
APIs globais muito consolidadas no mercado financeiro para Desenvolvedores.
*   Ambas fornecem chaves gratuitas (com limite de requisições por minuto - normalmente 5 a 25 *calls*/min).
*   Fornecem endpoints específicos para Câmbio (Forex) e Commodities.

### 4. HG Brasil
Não será utilizada neste projeto.

---

### 🏛️ E os dados físicos do CEPEA?
Muitas empresas do agro brasileiro utilizam o **CEPEA/ESALQ** como balizador para o preço físico da saca de soja, milho ou arroba do boi. No entanto, o CEPEA **não possui uma API pública (REST)**. Para colocar dados do CEPEA no dashboard, você precisaria criar um script no backend para fazer *Web Scraping* (leitura automatizada do HTML) direto do site deles diariamente.

### 💡 Dica de Arquitetura para o seu MVP
Se você tentar fazer requisições dessas APIs financeiras **diretamente pelo seu código React (Frontend)**, o navegador provavelmente irá bloquear a chamada devido a erros de **CORS**, ou você acabará expondo sua chave de API para os usuários. 

**O caminho ideal é:**
1. Criar um servidor backend bem simples (ex: `Node.js + Express`).
2. O servidor backend faz a requisição para o Yahoo Finance (spot/curva) e PTAX (BCB) a cada X minutos e salva num cache.
3. O seu frontend em React (o código que fizemos) faz um `fetch` ou um Polling para o **seu backend**, recebendo os dados limpos e já formatados na estrutura `SojaData` e `FinanceiroData`.
