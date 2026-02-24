const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const YahooFinance = require('yahoo-finance2').default;

dotenv.config({ path: path.resolve(__dirname, '.env') });

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const app = express();
const PORT = process.env.PORT || 3001;
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 8000);
const DOLAR_FUTURO_CONTRACT_COUNT = Number(process.env.DOLAR_FUTURO_CONTRACT_COUNT || 3);
const YAHOO_MIN_REQUEST_INTERVAL_MS = Number(process.env.YAHOO_MIN_REQUEST_INTERVAL_MS || 350);
const YAHOO_MAX_RETRIES = Number(process.env.YAHOO_MAX_RETRIES || 3);
const YAHOO_RETRY_BASE_DELAY_MS = Number(process.env.YAHOO_RETRY_BASE_DELAY_MS || 1200);

app.use(cors());

let cache = {
    agricola: {
        sojaGrao: [],
        fareloSoja: [],
        oleoSoja: []
    },
    financeiro: [],
    dolarFuturo: [],
    lastUpdated: null
};

const CONTRACT_MONTHS = {
    ZS: [
        { m: 1, c: 'F', n: 'Jan' }, { m: 3, c: 'H', n: 'Mar' }, { m: 5, c: 'K', n: 'Mai' },
        { m: 7, c: 'N', n: 'Jul' }, { m: 8, c: 'Q', n: 'Ago' }, { m: 9, c: 'U', n: 'Set' },
        { m: 11, c: 'X', n: 'Nov' }
    ],
    DEFAULT: [
        { m: 1, c: 'F', n: 'Jan' }, { m: 3, c: 'H', n: 'Mar' }, { m: 5, c: 'K', n: 'Mai' },
        { m: 7, c: 'N', n: 'Jul' }, { m: 8, c: 'Q', n: 'Ago' }, { m: 9, c: 'U', n: 'Set' },
        { m: 10, c: 'V', n: 'Out' }, { m: 12, c: 'Z', n: 'Dez' }
    ]
};

const FINANCIAL_MONTH_CODES = [
    { m: 1, c: 'F', n: 'Jan' }, { m: 2, c: 'G', n: 'Fev' }, { m: 3, c: 'H', n: 'Mar' },
    { m: 4, c: 'J', n: 'Abr' }, { m: 5, c: 'K', n: 'Mai' }, { m: 6, c: 'M', n: 'Jun' },
    { m: 7, c: 'N', n: 'Jul' }, { m: 8, c: 'Q', n: 'Ago' }, { m: 9, c: 'U', n: 'Set' },
    { m: 10, c: 'V', n: 'Out' }, { m: 11, c: 'X', n: 'Nov' }, { m: 12, c: 'Z', n: 'Dez' }
];

const formatValue = (num, minimumFractionDigits = 2, maximumFractionDigits = 2) => {
    if (num === null || num === undefined) return '-';
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits, maximumFractionDigits }).format(num);
};

const isValidNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const toPercent = (current, previous) => {
    if (!current || !previous) return 0;
    return ((current - previous) / previous) * 100;
};

const toNumberOrNull = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let yahooLastRequestAt = 0;
let yahooRequestChain = Promise.resolve();

function isYahooRateLimitError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('429')
        || message.includes('too many requests')
        || message.includes('failed to get crumb');
}

async function throttledYahooQuote(ticker) {
    const scheduled = yahooRequestChain.then(async () => {
        const now = Date.now();
        const waitMs = Math.max(0, yahooLastRequestAt + YAHOO_MIN_REQUEST_INTERVAL_MS - now);
        if (waitMs > 0) {
            await sleep(waitMs);
        }
        yahooLastRequestAt = Date.now();
        return yahooFinance.quote(ticker);
    });

    yahooRequestChain = scheduled.catch(() => undefined);
    return scheduled;
}

async function fetchYahooQuote(ticker) {
    let lastError = null;

    for (let attempt = 0; attempt <= YAHOO_MAX_RETRIES; attempt += 1) {
        try {
            return await throttledYahooQuote(ticker);
        } catch (error) {
            lastError = error;

            if (!isYahooRateLimitError(error) || attempt === YAHOO_MAX_RETRIES) {
                break;
            }

            const backoffMs = YAHOO_RETRY_BASE_DELAY_MS * (attempt + 1);
            await sleep(backoffMs);
        }
    }

    throw lastError;
}

const firstValidNumber = (...values) => {
    for (const value of values) {
        const normalized = toNumberOrNull(value);
        if (normalized !== null) return normalized;
    }
    return null;
};

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = PROVIDER_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function getValidMonths(baseSymbol) {
    return CONTRACT_MONTHS[baseSymbol] || CONTRACT_MONTHS.DEFAULT;
}

function getFutureTickers(baseSymbol, monthsAhead) {
    const tickers = [];
    const startDate = new Date();
    const validMonths = getValidMonths(baseSymbol);

    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + monthsAhead);

    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        const year = currentDate.getFullYear().toString().slice(-2);

        const validForYear = validMonths.filter(v =>
            (currentDate.getFullYear() === startDate.getFullYear() && v.m >= startDate.getMonth() + 1) ||
            (currentDate.getFullYear() > startDate.getFullYear())
        );

        for (const vm of validForYear) {
            const contractDate = new Date(currentDate.getFullYear(), vm.m - 1, 1);
            if (contractDate > endDate) break;

            const tickerStr = `${baseSymbol}${vm.c}${year}.CBT`;
            if (!tickers.find(t => t.ticker === tickerStr)) {
                tickers.push({
                    ticker: tickerStr,
                    name: `${vm.n}/${year} (${vm.c})`
                });
            }
        }

        currentDate.setFullYear(currentDate.getFullYear() + 1);
        currentDate.setMonth(0);
    }

    return tickers;
}

function getCurrentContractInfo(baseSymbol) {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const validMonths = getValidMonths(baseSymbol);

    const monthInYear = validMonths.find(vm => vm.m >= currentMonth);
    if (monthInYear) {
        return {
            ...monthInYear,
            year: currentYear.toString().slice(-2)
        };
    }

    return {
        ...validMonths[0],
        year: (currentYear + 1).toString().slice(-2)
    };
}

const fetchAgriData = async (ticker, baseSymbol) => {
    try {
        const quote = await fetchYahooQuote(ticker);
        if (!quote || !isValidNumber(quote.regularMarketPrice)) {
            return [];
        }

        const dif = quote.regularMarketChange || 0;
        const currentContract = getCurrentContractInfo(baseSymbol);

        const atual = {
            contrato: `${currentContract.n}/${currentContract.year} (${currentContract.c}) (Atual)`,
            ult: formatValue(quote.regularMarketPrice),
            max: formatValue(quote.regularMarketDayHigh),
            min: formatValue(quote.regularMarketDayLow),
            fec: formatValue(quote.regularMarketPreviousClose),
            abe: formatValue(quote.regularMarketOpen),
            dif: formatValue(dif)
        };

        const futureTickers = getFutureTickers(baseSymbol, 18);
        const results = [atual];

        for (const ft of futureTickers) {
            try {
                const quoteFuturo = await fetchYahooQuote(ft.ticker);
                if (!quoteFuturo || !isValidNumber(quoteFuturo.regularMarketPrice)) {
                    continue;
                }

                const difFuturo = quoteFuturo.regularMarketChange || 0;
                results.push({
                    contrato: ft.name,
                    ult: formatValue(quoteFuturo.regularMarketPrice),
                    max: formatValue(quoteFuturo.regularMarketDayHigh),
                    min: formatValue(quoteFuturo.regularMarketDayLow),
                    fec: formatValue(quoteFuturo.regularMarketPreviousClose),
                    abe: formatValue(quoteFuturo.regularMarketOpen),
                    dif: formatValue(difFuturo)
                });
            } catch (e) {
                console.error(`Error fetching future ${ft.ticker}:`, e.message);
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
        const quote = await fetchYahooQuote(ticker);
        if (!quote || !isValidNumber(quote.regularMarketPrice)) {
            return null;
        }

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

function getNextFinancialContracts(monthsAhead) {
    const contracts = [];
    const now = new Date();

    for (let offset = 0; contracts.length < monthsAhead; offset += 1) {
        const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const year = date.getFullYear().toString().slice(-2);
        const month = date.getMonth() + 1;
        const monthInfo = FINANCIAL_MONTH_CODES.find(vm => vm.m === month);

        if (!monthInfo) continue;

        contracts.push({
            code: monthInfo.c,
            monthName: monthInfo.n,
            year,
            label: `${monthInfo.n}/${year} (${monthInfo.c})`
        });
    }

    return contracts;
}

function normalizeUsdBrlFinanceiroRow(values) {
    return {
        indice: 'USD Comercial',
        ult: formatValue(values.price),
        varPerc: formatValue(values.varPerc),
        max: formatValue(values.high),
        min: formatValue(values.low),
        fec: formatValue(values.previousClose)
    };
}

function normalizeUsdBrlPtaxFinanceiroRow(values) {
    return {
        indice: 'Dólar PTAX',
        ult: formatValue(values.price),
        varPerc: formatValue(values.varPerc),
        max: formatValue(values.high),
        min: formatValue(values.low),
        fec: formatValue(values.previousClose)
    };
}

function normalizeDolarFuturoFinanceiroRow(label, values) {
    return {
        indice: `Dólar Futuro ${label}`,
        ult: formatValue(values.price, 4, 4),
        varPerc: formatValue(values.varPerc),
        max: formatValue(values.high, 4, 4),
        min: formatValue(values.low, 4, 4),
        fec: formatValue(values.previousClose, 4, 4)
    };
}

function getBcbPtaxDateQuery(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}-${day}-${year}`;
}

async function fetchPtaxQuotesForDate(date) {
    const dateQuery = getBcbPtaxDateQuery(date);
    const endpoint = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${dateQuery}'&@dataFinalCotacao='${dateQuery}'&$format=json`;

    try {
        const payload = await fetchJsonWithTimeout(endpoint, {
            headers: { Accept: 'application/json' }
        });

        const rows = Array.isArray(payload?.value) ? payload.value : [];
        if (!rows.length) {
            return null;
        }

        const prices = rows
            .map(item => firstValidNumber(item?.cotacaoVenda, item?.cotacaoCompra))
            .filter(isValidNumber);

        if (!prices.length) {
            return null;
        }

        return {
            price: prices[prices.length - 1],
            high: Math.max(...prices),
            low: Math.min(...prices)
        };
    } catch (error) {
        console.error(`Error fetching Dólar PTAX série (${dateQuery}):`, error.message);
        return null;
    }
}

async function fetchUsdBrlPtaxData(spotFallback = null) {
    const now = new Date();
    const currentDayData = await fetchPtaxQuotesForDate(now);

    if (currentDayData) {
        let previousClose = null;

        for (let dayOffset = 1; dayOffset <= 7; dayOffset += 1) {
            const previousDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
            const previousDayData = await fetchPtaxQuotesForDate(previousDate);

            if (previousDayData && isValidNumber(previousDayData.price)) {
                previousClose = previousDayData.price;
                break;
            }
        }

        if (!isValidNumber(previousClose) && spotFallback && isValidNumber(spotFallback.previousClose)) {
            previousClose = spotFallback.previousClose;
        }

        const varPerc = isValidNumber(previousClose)
            ? toPercent(currentDayData.price, previousClose)
            : 0;

        return {
            price: currentDayData.price,
            varPerc,
            high: currentDayData.high,
            low: currentDayData.low,
            previousClose
        };
    }

    if (spotFallback && isValidNumber(spotFallback.price)) {
        return {
            price: spotFallback.price,
            varPerc: spotFallback.varPerc || 0,
            high: spotFallback.high,
            low: spotFallback.low,
            previousClose: spotFallback.previousClose
        };
    }

    return null;
}

async function fetchDolarFuturoB3(monthsAhead = DOLAR_FUTURO_CONTRACT_COUNT) {
    const lookupWindow = Math.max(monthsAhead * 6, monthsAhead);
    const contracts = getNextFinancialContracts(lookupWindow);
    const prefixes = ['DOL', 'WDO'];
    const results = [];

    for (const contract of contracts) {
        if (results.length >= monthsAhead) {
            break;
        }

        for (const prefix of prefixes) {
            const ticker = `${prefix}${contract.code}${contract.year}.SA`;

            try {
                const quote = await fetchYahooQuote(ticker);
                if (!quote) {
                    continue;
                }

                const hasPrice = isValidNumber(quote.regularMarketPrice);

                if (!hasPrice) {
                    continue;
                }

                results.push(normalizeDolarFuturoFinanceiroRow(contract.label, {
                    price: quote.regularMarketPrice,
                    varPerc: quote.regularMarketChangePercent || 0,
                    high: quote.regularMarketDayHigh,
                    low: quote.regularMarketDayLow,
                    previousClose: quote.regularMarketPreviousClose
                }));
                break;
            } catch (e) {
                console.error(`Error fetching ${ticker}:`, e.message);
            }
        }
    }

    return results;
}

async function fetchDolarFuturoCme(monthsAhead = DOLAR_FUTURO_CONTRACT_COUNT) {
    const lookupWindow = Math.max(monthsAhead * 6, monthsAhead);
    const contracts = getNextFinancialContracts(lookupWindow);
    const results = [];

    for (const contract of contracts) {
        if (results.length >= monthsAhead) {
            break;
        }

        const ticker = `6L${contract.code}${contract.year}.CME`;

        try {
            const quote = await fetchYahooQuote(ticker);
            if (!quote) {
                continue;
            }

            const brlUsd = quote.regularMarketPrice;
            const brlUsdPrev = quote.regularMarketPreviousClose;
            const brlUsdHigh = quote.regularMarketDayHigh;
            const brlUsdLow = quote.regularMarketDayLow;

            if (!isValidNumber(brlUsd)) {
                continue;
            }

            const usdBrl = 1 / brlUsd;
            const usdBrlPrev = brlUsdPrev ? 1 / brlUsdPrev : null;
            const usdBrlHigh = brlUsdLow ? 1 / brlUsdLow : null;
            const usdBrlLow = brlUsdHigh ? 1 / brlUsdHigh : null;

            results.push(normalizeDolarFuturoFinanceiroRow(contract.label, {
                price: usdBrl,
                varPerc: usdBrlPrev ? toPercent(usdBrl, usdBrlPrev) : 0,
                high: usdBrlHigh,
                low: usdBrlLow,
                previousClose: usdBrlPrev
            }));
        } catch (e) {
            console.error(`Error fetching ${ticker}:`, e.message);
        }
    }

    return results;
}

async function fetchUsdBrlSpotFallback() {
    try {
        const quote = await fetchYahooQuote('BRL=X');

        if (!quote || !isValidNumber(quote.regularMarketPrice)) {
            return null;
        }

        return {
            price: quote.regularMarketPrice,
            varPerc: quote.regularMarketChangePercent || 0,
            high: quote.regularMarketDayHigh,
            low: quote.regularMarketDayLow,
            previousClose: quote.regularMarketPreviousClose
        };
    } catch (e) {
        console.error('Error fetching BRL=X fallback:', e.message);
        return null;
    }
}

async function fetchUsdBrlSpotData() {
    return fetchUsdBrlSpotFallback();
}

async function fetchUsdEurData() {
    try {
        const quote = await fetchYahooQuote('EURUSD=X');

        if (!quote || !isValidNumber(quote.regularMarketPrice)) {
            return null;
        }

        const eurUsd = quote.regularMarketPrice;
        const eurUsdPrev = quote.regularMarketPreviousClose;
        const eurUsdHigh = quote.regularMarketDayHigh;
        const eurUsdLow = quote.regularMarketDayLow;

        const usdEur = 1 / eurUsd;
        const usdEurPrev = isValidNumber(eurUsdPrev) ? 1 / eurUsdPrev : null;
        const usdEurHigh = isValidNumber(eurUsdLow) ? 1 / eurUsdLow : null;
        const usdEurLow = isValidNumber(eurUsdHigh) ? 1 / eurUsdHigh : null;

        return {
            indice: 'Dólar / Euro',
            ult: formatValue(usdEur, 4, 4),
            varPerc: formatValue(usdEurPrev ? toPercent(usdEur, usdEurPrev) : 0),
            max: formatValue(usdEurHigh, 4, 4),
            min: formatValue(usdEurLow, 4, 4),
            fec: formatValue(usdEurPrev, 4, 4)
        };
    } catch (e) {
        console.error('Error fetching EURUSD=X:', e.message);
        return null;
    }
}

async function fetchDolarFuturoFinanceiroRows(count = DOLAR_FUTURO_CONTRACT_COUNT) {
    let futures = await fetchDolarFuturoB3(count);

    if (futures.length < count) {
        const cmeFutures = await fetchDolarFuturoCme(count);
        const byIndice = new Map();

        for (const row of [...futures, ...cmeFutures]) {
            if (!byIndice.has(row.indice)) {
                byIndice.set(row.indice, row);
            }
        }

        futures = Array.from(byIndice.values());
    }

    return futures.slice(0, count);
}

const updateCache = async () => {
    if (updateCache.isRunning) {
        console.log(`[${new Date().toISOString()}] Previous cache update still running. Skipping this cycle.`);
        return;
    }

    updateCache.isRunning = true;
    console.log(`[${new Date().toISOString()}] Fetching new data from Yahoo Finance...`);

    try {
        const usdSpot = await fetchUsdBrlSpotData();
        const usdPtax = await fetchUsdBrlPtaxData(usdSpot);
        const sojaGrao = await fetchAgriData('ZS=F', 'ZS');
        const fareloSoja = await fetchAgriData('ZM=F', 'ZM');
        const oleoSoja = await fetchAgriData('ZL=F', 'ZL');
        const dolarFuturo = await fetchDolarFuturoFinanceiroRows(DOLAR_FUTURO_CONTRACT_COUNT);

        const financeiroResults = [];
        financeiroResults.push(await fetchFinanceData('EURBRL=X', 'Real / Euro'));
        financeiroResults.push(await fetchUsdEurData());
        financeiroResults.push(await fetchFinanceData('DX-Y.NYB', 'DXY'));
        financeiroResults.push(await fetchFinanceData('GC=F', 'GOLD'));

        const usdFinanceRow = usdSpot
            ? normalizeUsdBrlFinanceiroRow(usdSpot)
            : await fetchFinanceData('BRL=X', 'USD Comercial');

        const financeiro = [
            usdPtax ? normalizeUsdBrlPtaxFinanceiroRow(usdPtax) : null,
            usdFinanceRow,
            ...dolarFuturo,
            ...financeiroResults
        ].filter(r => r !== null);

        cache.agricola = {
            sojaGrao: sojaGrao.length ? sojaGrao : cache.agricola.sojaGrao,
            fareloSoja: fareloSoja.length ? fareloSoja : cache.agricola.fareloSoja,
            oleoSoja: oleoSoja.length ? oleoSoja : cache.agricola.oleoSoja
        };
        cache.financeiro = financeiro.length ? financeiro : cache.financeiro;
        cache.dolarFuturo = [];
        cache.lastUpdated = new Date();

        console.log(`[${new Date().toISOString()}] Cache updated successfully.`);
    } catch (e) {
        console.error('Error updating cache:', e.message);
    } finally {
        updateCache.isRunning = false;
    }
};

updateCache.isRunning = false;

updateCache();
setInterval(updateCache, SYNC_INTERVAL_MINUTES * 60 * 1000);

app.get('/api/agricola', (req, res) => {
    res.json(cache.agricola);
});

app.get('/api/financeiro', (req, res) => {
    res.json(cache.financeiro);
});

app.get('/api/dolar-futuro', (req, res) => {
    res.json(cache.dolarFuturo);
});

app.get('/api/status', (req, res) => {
    res.json({
        lastUpdated: cache.lastUpdated ? cache.lastUpdated.toISOString() : null,
        syncIntervalMinutes: SYNC_INTERVAL_MINUTES
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});