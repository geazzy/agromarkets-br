# Design Doc - FUTURA implementação

## 1) Objetivo
Definir uma referência única para decisões de projeto sobre:
- Fontes de dados de commodities agrícolas (soja, farelo e óleo).
- Indicadores financeiros de suporte.
- Regras de exibição de contratos futuros na aplicação.

Este documento deve orientar decisões de produto, backend e frontend.

## 2) Escopo
### Incluído
- Integração com fontes de mercado para commodities e indicadores financeiros.
- Definição de vencimentos e quantidade de contratos a exibir por ativo.

### Fora de escopo (neste momento)
- Estratégia final de cache, retries e circuit breaker.
- Critérios de fallback para indisponibilidade de provedores.
- SLA/SLO dos dados por tipo de ativo.
- Implementação de Soja B3 (SJC), até existir API pública confiável.

## 3) Decisões de Arquitetura (atuais)

### 3.1 Commodities agrícolas — Soja e derivados
**Decisão:** usar Yahoo Finance como fonte para contratos futuros.

- Soja em grão (Soybean ZS): Yahoo Finance API.
- Farelo de soja (Soybean Meal, símbolo ZM): Yahoo Finance API.
- Óleo de soja (Soybean Oil, símbolo ZL): Yahoo Finance API.

### 3.2 Indicadores financeiros
**Decisão:** usar AwesomeAPI para câmbio e ouro em BRL, e outras fontes para índices/futuros específicos.

- Dólar comercial: AwesomeAPI.
- PTAX: AwesomeAPI.
- EUR/BRL: AwesomeAPI.
- EUR/USD: AwesomeAPI.
- Dólar futuro: CME via Yahoo Finance.
- DXY: Yahoo Finance.
- Ouro (XAU-BRL): AwesomeAPI, com conversão para grama para exibição no dashboard financeiro.

### 3.3 Arquitetura de Software MVP
- Paralelizar por bloco lógico, com concorrência baixa (ex.: 2–4 chamadas simultâneas por provider).
- Manter intervalo mínimo entre requests por provider (token bucket/queue simples).
- Fazer cache de ciclo: não buscar o mesmo ticker duas vezes no mesmo `updateCache`.
- Em erro/429, devolver o último snapshot válido em vez de insistir em novas tentativas agressivas.

**Critérios de aceite técnicos (MVP):**
- Logs por ciclo devem evidenciar deduplicação de ticker (ticker repetido não gera nova chamada no mesmo `updateCache`).
- Logs devem registrar quando houve resposta com snapshot de fallback por erro/429 de provider.
- Não deve haver explosão de retries no mesmo ciclo (backoff progressivo e limite de tentativas respeitado).
- O endpoint de status deve indicar o timestamp do último snapshot válido.

## 4) Regras de Contratos e Vencimentos

### 4.1 Soja (Soybean ZS)
- Quantidade a apresentar: **15 contratos**.
- Cobertura aproximada: **2 anos e 2 meses**.
- Ciclo de vencimento:
	- Janeiro (F)
	- Março (H)
	- Maio (K)
	- Julho (N)
	- Agosto (Q)
	- Setembro (U)
	- Novembro (X)

### 4.2 Soja (SJC) — planejamento futuro
- Quantidade a apresentar: **8 contratos**.
- Janela de referência: próximos 12 meses.
- Ciclo de vencimento:
	- Março (H)
	- Maio (K)
	- Julho (N)
	- Setembro (U)

**Status atual:** não implementar por enquanto (ausência de API pública disponível).

### 4.3 Farelo e Óleo 
- Ativos: Farelo (ZM) e Óleo (ZL).
- Quantidade a apresentar: **15 contratos** para cada ativo.
- Ciclo de vencimento:
	- Janeiro (F)
	- Março (H)
	- Maio (K)
	- Julho (N)
	- Agosto (Q)
	- Setembro (U)
	- Outubro (V)
	- Dezembro (Z)

**Observação importante:**
- Soja em grão **não** possui contrato em Outubro (V).
- Soja em grão usa Novembro (X), enquanto farelo/óleo usam Dezembro (Z).

## 5) Endpoints e Fórmulas

### 5.1 AwesomeAPI
- Dólar comercial: https://economia.awesomeapi.com.br/json/last/USD-BRL
- Dólar PTAX: https://economia.awesomeapi.com.br/json/last/USD-BRLPTAX
- EUR-BRL: https://economia.awesomeapi.com.br/json/last/EUR-BRL
- EUR-USD: https://economia.awesomeapi.com.br/json/last/EUR-USD
- XAU-BRL: https://economia.awesomeapi.com.br/json/last/XAU-BRL

### 5.2 Yahoo Finance (commodities e futuros financeiros)
- Soja (ZS): endpoint/ticker a definir na integração oficial do Yahoo Finance.
- Farelo (ZM): endpoint/ticker a definir na integração oficial do Yahoo Finance.
- Óleo (ZL): endpoint/ticker a definir na integração oficial do Yahoo Finance.
- Dólar futuro (CME): ticker no padrão `6L{mês}{ano}.CME` (ex.: `6LH26.CME`).

### 5.3 Conversão de ouro
- Valor de entrada: onça troy em BRL (XAU-BRL).
- Conversão para grama:

$$
XAU_{grama\_BRL} = \frac{XAU_{onça\_troy\_BRL}}{31.1035}
$$

### 5.4 Fórmulas de exibição (dashboard financeiro)
Para o índice de ouro, a apresentação final no frontend deve ser em grama.

**Responsabilidade de cálculo:**
- Backend: calcula e retorna ULT, VAR. [%], MAX, MIN e FEC de Ouro já em BRL/grama.
- Frontend: apenas consome e exibe os campos recebidos da API, sem recalcular conversões/variações.

- ULT (ouro):

$$
ULT_{ouro} = XAU_{grama\_BRL}
$$

- MAX (ouro):

$$
MAX_{ouro} = \frac{MAX_{onça\_troy\_BRL}}{31.1035}
$$

- MIN (ouro):

$$
MIN_{ouro} = \frac{MIN_{onça\_troy\_BRL}}{31.1035}
$$

- FEC (ouro):

$$
FEC_{ouro} = \frac{FEC_{onça\_troy\_BRL}}{31.1035}
$$

- VAR. [%] (ouro): calculada sobre valores em grama:

$$
VAR\%_{ouro} = \left(\frac{ULT_{ouro} - FEC_{ouro}}{FEC_{ouro}}\right) \times 100
$$

## 6) Requisitos de Exibição (frontend/API)
- Soja (ZS): exibir 15 contratos (fonte: Yahoo Finance API).
- Farelo (ZM): exibir 15 contratos (fonte: Yahoo Finance API).
- Óleo (ZL): exibir 15 contratos (fonte: Yahoo Finance API).
- Em sincronização bem-sucedida de dados no backend, a página deve atualizar os dados automaticamente no frontend (sem ação manual do usuário).
- A página deve atualizar automaticamente a cada **x minutos**, onde **x** é o valor do intervalo de sincronização configurado via `.env`.

**Nota:** Soja B3 (SJC) permanece fora do escopo de implementação nesta versão.

## 7) Requisito de Visualização — Gráfico de Curva Futura

### 7.1 Objetivo da visualização
Exibir a **curva futura de preços** das commodities agrícolas (ex.: Soja grão, Farelo e Óleo), permitindo leitura rápida da estrutura a termo (contango/backwardation), seguindo o estilo da figura de referência.

### 7.2 Descrição funcional
- O gráfico deve plotar os contratos em ordem de vencimento no eixo X.
- Cada ponto representa o preço do contrato futuro para aquele vencimento.
- A linha deve conectar os pontos, formando uma curva contínua de leitura simples.
- O usuário deve conseguir identificar facilmente:
	- vencimento do contrato (ex.: Mar/26, Mai/26, Jul/26);
	- preço correspondente a cada ponto.

### 7.3 Padrão visual esperado (referência da figura anexada)
- Tipo: **line chart** com curva suave.
- Fundo escuro e alto contraste de texto/linha.
- Linha principal em cor de destaque (ciano/verde-água no tema atual).
- Marcadores visíveis nos pontos da curva.
- Grid horizontal discreta para apoiar leitura de preço.
- Título no topo no formato:
	- `CURVA FUTURA - <COMMODITY> (<SÍMBOLO>)`
	- Exemplo: `CURVA FUTURA - SOJA GRÃO (ZS)`

### 7.4 Regras de dados para o gráfico
- Eixo X: contratos futuros ordenados por vencimento crescente.
- Eixo Y: preço do contrato na moeda configurada para o ativo.
- Quantidade de pontos deve respeitar as regras da seção 6:
	- Soja (ZS): 15 pontos.
	- Farelo (ZM): 15 pontos.
	- Óleo (ZL): 15 pontos.

**Nota:** Soja B3 (SJC) não será exibida nesta versão.

### 7.5 Critérios de aceite do gráfico
- A curva é exibida sem quebrar a ordem cronológica dos vencimentos.
- O título identifica corretamente commodity e símbolo.
- Todos os pontos previstos para o ativo selecionado são renderizados.
- Valores no eixo Y mantêm escala legível e consistente com os preços recebidos.

## 8) Dashboards do Produto

### 8.1 Dashboards por commodity (1 dashboard por ativo)
Cada commodity deve possuir seu próprio dashboard com os dois blocos principais abaixo:

1. **Tabela de contratos**
	- Colunas mínimas: Data/Contrato, Ult, Max, Min, Fec, Abe, Dif.
	- Dif negativo em vermelho e positivo em verde.
	- Deve suportar rolagem horizontal quando necessário, sem quebrar layout.
	- Manter a primeira coluna congelada durante o scroll horizontal.
	- Significados das colunas:
		- Ult: ultimo preco negociado.
		- Max: maior preco do periodo.
		- Min: menor preco do periodo.
		- Fec: preco de fechamento do periodo.
		- Abe: preco de abertura do periodo.
		- Dif: variacao do periodo (pontos ou percentual, conforme fonte).

2. **Gráfico de curva futura**
	- Exibir ao lado da tabela (desktop) e abaixo da tabela (mobile).
	- Seguir integralmente os requisitos da seção 7.

**Dashboards mínimos de commodity:**
- Soja grão (ZS).
- Farelo de soja (ZM).
- Óleo de soja (ZL).

**Nota:** dashboard de Soja B3 (SJC) fica adiado até definição de API pública.


### 8.2 Dashboard de indicadores financeiros
Criar um dashboard dedicado para indicadores financeiros, separado dos dashboards de commodities.

**Tabela de indicadores (mínimo):**
- Índice
- Último valor (Ult)
- Variação % (Var. [%])
- Máxima (Max)
- Mínima (Min)
- Fechamento (Fec)
- Manter a primeira coluna congelada durante o scroll horizontal.

**Significados das colunas (quando aplicável):**
- Ult: ultimo valor do indice.
- Max: maior valor do periodo.
- Min: menor valor do periodo.
- Fec: valor de fechamento do periodo.

**Regra específica para Ouro (XAU-BRL):**
- No dashboard, exibir em grama (BRL/grama) para as colunas ULT, MAX, MIN e FEC.
- Recalcular VAR. [%] a partir dos valores em grama (ULT e FEC).
- Identificar o índice no payload/API como: Ouro (XAU-BRL, por grama).
- Não aplicar conversão de unidade nem recálculo de variação no frontend.

**Regra de cor:**
- Var negativa em vermelho e positiva em verde.

**Indicadores mínimos exibidos:**
- Dólar PTAX
- USD Comercial
- Dólar Futuro (vencimentos disponíveis)
- Real/Euro (EUR-BRL)
- Dólar/Euro (EUR-USD)
- Ouro (XAU-BRL)

### 8.3 Layout de referência (como figura anexada)
- Linha superior com dois cards: tabela da commodity (esquerda) e curva futura (direita).
- Linha inferior com card único de largura total para indicadores financeiros.
- Títulos em caixa alta e padrão visual homogêneo.
- Fundo escuro, contraste alto e grade/tabelas discretas no mesmo tema visual.

### 8.4 Critérios de aceite dos dashboards
- Existe um dashboard por commodity listada na seção 8.1.
- Existe um dashboard exclusivo para indicadores financeiros.
- Os cards respeitam a composição visual da referência (tabela + curva na parte superior e indicadores abaixo).
- Os dados exibidos em tabela e gráfico são consistentes entre si para o mesmo ativo e vencimento.

## 9) Premissas
- Yahoo Finance API estará acessível para Soja (ZS), Farelo (ZM) e Óleo (ZL).
- Yahoo Finance API estará acessível para contratos de dólar futuro da CME.
- AwesomeAPI será utilizada como fonte principal para câmbio e XAU-BRL.
- Yahoo Finance será a fonte do DXY enquanto não houver fonte alternativa definida.
- Intervalo de sincronizacao definido via .env.
- O frontend utilizará esse mesmo intervalo de sincronização para agendar refresh automático dos dados exibidos.

## 10) Pendências para decisão
1. Definir endpoint/fornecedor oficial do Yahoo Finance para dados de Soja (ZS), Farelo (ZM) e Óleo (ZL) no ambiente de produção.
2. Definir endpoint/fornecedor oficial para dólar futuro da CME via Yahoo Finance.
3. Definir endpoint/fornecedor oficial para curva de soja na B3 (pós-MVP, quando SJC entrar em escopo).
4. Definir política de atualização por ativo (tempo real, atraso aceitável e cache).
5. Definir estratégia de fallback entre provedores por prioridade.

## 11) Critérios de aceite (versão inicial)
- A aplicação retorna os contratos corretos por ativo conforme seção 4.
- A aplicação respeita a quantidade de contratos por ativo conforme seção 6.
- Indicadores financeiros mínimos disponíveis: USD-BRL, PTAX, Dólar Futuro (vencimentos disponíveis), EUR-BRL, EUR-USD, XAU-BRL.
- Conversão de XAU para grama aplicada corretamente pela fórmula definida.
- No dashboard financeiro, Ouro exibido em BRL/grama em ULT, MAX, MIN e FEC, com VAR. [%] recalculada em grama.

## 12) Histórico de revisão
- 2026-02-25: Documento reorganizado e consolidado a partir do conteúdo inicial.
- 2026-02-25: Incluída especificação de visualização do gráfico de curva futura de commodities.
- 2026-02-25: Incluída especificação de dashboards por commodity e dashboard de indicadores financeiros.
- 2026-02-25: Soja B3 (SJC) marcada como fora de escopo temporário por indisponibilidade de API pública.
- 2026-02-25: Definida regra de exibição do Ouro em BRL/grama no dashboard financeiro e fórmula de recálculo de VAR. [%].
