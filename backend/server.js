const express = require('express');
const cors = require('cors');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Cache for our data
let cache = {
    agricola: {
        sojaGrao: [],
        fareloSoja: [],
        oleoSoja: []
    },
    financeiro: [],
    lastUpdated: null
};

// Mapeamento de tickers do Yahoo Finance
// Soja: ZS=F (Soybean Futures)
// Farelo: ZM=F (Soybean Meal Futures)
// Oleo: ZL=F (Soybean Oil Futures)
//
// Para montar a curva (vários vencimentos), precisaríamos de tickers específicos de cada mês/ano
// Como o Yahoo Finance gratuito geralmente dá cotação do contrato atual (e às vezes alguns outros se soubermos os tickers exatos),
// vamos simplificar usando o contrato principal (ativo) e possivelmente derivar ou usar mocks para os meses seguintes se não quisermos errar os tickers.
// Para um MVP, podemos pegar as cotações base dos futuros principais e formatar de acordo com a interface do frontend.
//
// Tickers financeiros:
// USD/BRL: BRL=X
// EUR/BRL: EURBRL=X
// DXY: DX-Y.NYB
// Gold: GC=F

const formatValue = (num) => {
    if (num === null || num === undefined) return '-';
    // Format to pt-BR locale with 2 decimal places
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
};

function getFutureTickers(baseSymbol, monthsAhead) {
    const tickers = [];
    const startDate = new Date();

    // Soja: 7 vencimentos. Farelo/Oleo: 8 vencimentos.
    let validMonths = baseSymbol === 'ZS'
        ? [
            { m: 1, c: 'F', n: 'Jan' }, { m: 3, c: 'H', n: 'Mar' }, { m: 5, c: 'K', n: 'Mai' },
            { m: 7, c: 'N', n: 'Jul' }, { m: 8, c: 'Q', n: 'Ago' }, { m: 9, c: 'U', n: 'Set' },
            { m: 11, c: 'X', n: 'Nov' }
        ]
        : [
            { m: 1, c: 'F', n: 'Jan' }, { m: 3, c: 'H', n: 'Mar' }, { m: 5, c: 'K', n: 'Mai' },
            { m: 7, c: 'N', n: 'Jul' }, { m: 8, c: 'Q', n: 'Ago' }, { m: 9, c: 'U', n: 'Set' },
            { m: 10, c: 'V', n: 'Out' }, { m: 12, c: 'Z', n: 'Dez' }
        ];

    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + monthsAhead);

    let currentDate = new Date(startDate);

    // We want to generate all valid contract months between now and 18 months from now.
    while (currentDate <= endDate) {
        const year = currentDate.getFullYear().toString().slice(-2);
        const month = currentDate.getMonth() + 1;

        // Add all valid contracts for the current year that are >= current month
        const validForYear = validMonths.filter(v =>
            (currentDate.getFullYear() === startDate.getFullYear() && v.m >= startDate.getMonth() + 1) ||
            (currentDate.getFullYear() > startDate.getFullYear())
        );

        for (const vm of validForYear) {
            // Re-check if this specific contract month exceeds our end date
            const contractDate = new Date(currentDate.getFullYear(), vm.m - 1, 1);
            if (contractDate > endDate) break;

            const tickerStr = `${baseSymbol}${vm.c}${year}.CBT`;
            // Avoid duplicates (if loop processes same year multiple times, though logic prevents it if we increment year, but we'll increment month by month or jump years to be safe)
            if (!tickers.find(t => t.ticker === tickerStr)) {
                tickers.push({
                    ticker: tickerStr,
                    name: `${vm.n}/${year}`
                });
            }
        }

        // Jump to next year to continue generating
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        currentDate.setMonth(0); // Start from Jan of next year
    }

    return tickers;
}

const fetchAgriData = async (ticker, baseName, baseSymbol) => {
    try {
        const quote = await yahooFinance.quote(ticker);
        const dif = quote.regularMarketChange || 0;

        const atual = {
            contrato: `${baseName} (Atual)`,
            ult: formatValue(quote.regularMarketPrice),
            max: formatValue(quote.regularMarketDayHigh),
            min: formatValue(quote.regularMarketDayLow),
            fec: formatValue(quote.regularMarketPreviousClose),
            abe: formatValue(quote.regularMarketOpen),
            dif: formatValue(dif)
        };

        const futureTickers = getFutureTickers(baseSymbol, 18);
        const results = [atual];

        // Fetch all future contracts concurrently
        const quotePromises = futureTickers.map(ft =>
            yahooFinance.quote(ft.ticker)
                .then(quoteFuturo => {
                    const difFuturo = quoteFuturo.regularMarketChange || 0;
                    return {
                        contrato: ft.name,
                        ult: formatValue(quoteFuturo.regularMarketPrice),
                        max: formatValue(quoteFuturo.regularMarketDayHigh),
                        min: formatValue(quoteFuturo.regularMarketDayLow),
                        fec: formatValue(quoteFuturo.regularMarketPreviousClose),
                        abe: formatValue(quoteFuturo.regularMarketOpen),
                        dif: formatValue(difFuturo)
                    };
                })
                .catch(e => {
                    console.error(`Error fetching future ${ft.ticker}:`, e.message);
                    return null;
                })
        );

        const futureQuotes = await Promise.all(quotePromises);

        // Filter out any failed requests
        for (const fq of futureQuotes) {
            if (fq) {
                results.push(fq);
            }
        }

        return results;

    } catch (e) {
        console.error(`Error fetching ${ticker}:`, e.message);
        return [];
    }
};

const fetchFinanceData = async (ticker, name) => {
    try {
        const quote = await yahooFinance.quote(ticker);
        const varPerc = quote.regularMarketChangePercent || 0;
        return {
            indice: name,
            ult: formatValue(quote.regularMarketPrice),
            varPerc: formatValue(varPerc),
            max: formatValue(quote.regularMarketDayHigh),
            min: formatValue(quote.regularMarketDayLow),
            fec: formatValue(quote.regularMarketPreviousClose)
        };
    } catch (e) {
        console.error(`Error fetching ${ticker}:`, e.message);
        return null;
    }
};

const updateCache = async () => {
    console.log(`[${new Date().toISOString()}] Fetching new data from Yahoo Finance...`);

    try {
        const sojaGrao = await fetchAgriData('ZS=F', 'Mar', 'ZS');
        const fareloSoja = await fetchAgriData('ZM=F', 'Mar', 'ZM');
        const oleoSoja = await fetchAgriData('ZL=F', 'Mar', 'ZL');

        const financeiroPromises = [
            fetchFinanceData('BRL=X', 'USD Comercial'),
            fetchFinanceData('EURBRL=X', 'Real / Euro'),
            fetchFinanceData('DX-Y.NYB', 'DXY'),
            fetchFinanceData('GC=F', 'GOLD')
        ];

        const financeiroResults = await Promise.all(financeiroPromises);
        const financeiro = financeiroResults.filter(r => r !== null);

        cache.agricola = {
            sojaGrao: sojaGrao.length ? sojaGrao : cache.agricola.sojaGrao,
            fareloSoja: fareloSoja.length ? fareloSoja : cache.agricola.fareloSoja,
            oleoSoja: oleoSoja.length ? oleoSoja : cache.agricola.oleoSoja
        };
        cache.financeiro = financeiro.length ? financeiro : cache.financeiro;
        cache.lastUpdated = new Date();

        console.log(`[${new Date().toISOString()}] Cache updated successfully.`);
    } catch (e) {
        console.error('Error updating cache:', e.message);
    }
};

// Initial API fetch
updateCache();

// Poll every 15 minutes (15 * 60 * 1000 ms)
setInterval(updateCache, 15 * 60 * 1000);

app.get('/api/agricola', (req, res) => {
    res.json(cache.agricola);
});

app.get('/api/financeiro', (req, res) => {
    res.json(cache.financeiro);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
