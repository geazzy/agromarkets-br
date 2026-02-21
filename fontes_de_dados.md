# Fontes de Dados para o Dashboard de Commodities

Para substituir os dados mockados do seu MVP por **dados reais** (ou com um pequeno atraso de 15 minutos, padrão em mercados financeiros gratuitos), você precisará consumir APIs externas.

Como o seu dashboard possui tanto **Commodities de Chicago (CBOT)** (como Soja, Farelo e Óleo) quanto **Indicadores Financeiros Brazileiros e Globais** (Dólar, PTAX, Ouro, DXY), recomendo as seguintes fontes:

### 1. Yahoo Finance API (🌟 Mais recomendada para MVPs)
Esta é a fonte gratuita mais rica e fácil de usar para acessar ativos globais, incluindo os contratos futuros agrícolas (Chicago) e moedas.
*   **Como acessar:** Não possui uma API oficial, mas a comunidade mantém bibliotecas excelentes e muito estáveis. Se você criar um backend em Node.js, pode usar a lib `yahoo-finance2`. Em Python, usa-se a `yfinance`.
*   **Tickers úteis para o seu Dashboard:**
    *   **Soja Grão (CBOT):** `ZS=F` (Contrato futuro contínuo)
    *   **Farelo de Soja:** `ZM=F`
    *   **Óleo de Soja:** `ZL=F`
    *   **Dólar/Real:** `BRL=X`
    *   **Ouro:** `GC=F`
    *   **Índice Dólar (DXY):** `DX-Y.NYB`

### 2. HG Brasil Finance (🇧🇷 Foco no Brasil)
Excelente API com um plano gratuito amigável, muito voltada para o mercado brasileiro. É a forma mais fácil de pegar cotações de moedas e taxas do BCB sem complicação.
*   **Link:** [hgbrasil.com](https://hgbrasil.com/status/finance)
*   **Útil para:** Pegar a cotação exata do Dólar Comercial (`USD`), Dólar Turismo, Euro, Selic, CDI e moedas diversas em tempo real.
*   **Limitação:** Não fornece os contratos futuros agrícolas de Chicago (CBOT).

### 3. Brapi (Mercado B3)
Uma excelente API brasileira (com plano grátis) baseada em dados da B3 (Bolsa Brasileira).
*   **Link:** [brapi.dev](https://brapi.dev/)
*   **Útil para:** Se no futuro você quiser alterar os contratos de Chicago para contratos futuros negociados no Brasil na B3, como o Milho B3 (Ticker: `CCM`), Boi Gordo (`BGI`), ou a própria Soja B3 (`SJC`).

### 4. Alpha Vantage / Finnhub
APIs globais muito consolidadas no mercado financeiro para Desenvolvedores.
*   Ambas fornecem chaves gratuitas (com limite de requisições por minuto - normalmente 5 a 25 *calls*/min).
*   Fornecem endpoints específicos para Câmbio (Forex) e Commodities.

---

### 🏛️ E os dados físicos do CEPEA?
Muitas empresas do agro brasileiro utilizam o **CEPEA/ESALQ** como balizador para o preço físico da saca de soja, milho ou arroba do boi. No entanto, o CEPEA **não possui uma API pública (REST)**. Para colocar dados do CEPEA no dashboard, você precisaria criar um script no backend para fazer *Web Scraping* (leitura automatizada do HTML) direto do site deles diariamente.

### 💡 Dica de Arquitetura para o seu MVP
Se você tentar fazer requisições dessas APIs financeiras **diretamente pelo seu código React (Frontend)**, o navegador provavelmente irá bloquear a chamada devido a erros de **CORS**, ou você acabará expondo sua chave de API para os usuários. 

**O caminho ideal é:**
1. Criar um servidor backend bem simples (ex: `Node.js + Express`).
2. O servidor backend faz a requisição para a API do *Yahoo Finance* ou *HG Brasil* a cada X minutos e salva num cache.
3. O seu frontend em React (o código que fizemos) faz um `fetch` ou um Polling para o **seu backend**, recebendo os dados limpos e já formatados na estrutura `SojaData` e `FinanceiroData`.
