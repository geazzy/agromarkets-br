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
const BRAPI_BASE_URL = process.env.BRAPI_BASE_URL || 'https://brapi.dev';
const BRAPI_API_KEY = (process.env.BRAPI_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 8000);

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
        const quote = await yahooFinance.quote(ticker);
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

    for (let offset = 0; offset <= monthsAhead; offset += 1) {
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

function normalizeDolarFuturoRow(contrato, values) {
    return {
        contrato,
        indice: contrato,
        ult: formatValue(values.price, 4, 4),
        varPerc: formatValue(values.varPerc),
        max: formatValue(values.high, 4, 4),
        min: formatValue(values.low, 4, 4),
        fec: formatValue(values.previousClose, 4, 4)
    };
}

function normalizeUsdBrlSpotRow(values, label = 'USD/BRL Spot') {
    return normalizeDolarFuturoRow(label, {
        price: values.price,
        varPerc: values.varPerc,
        high: values.high,
        low: values.low,
        previousClose: values.previousClose
    });
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

function parseBrapiUsdBrlPayload(payload) {
    const root = payload || {};
    const result = Array.isArray(root.results) ? root.results[0] : null;
    const currencyItem = Array.isArray(root.currency) ? root.currency[0] : null;
    const currencies = root.results?.currencies || root.currencies;
    const usd = currencies?.USD;

    const price = firstValidNumber(
        result?.regularMarketPrice,
        result?.bid,
        result?.price,
        result?.close,
        currencyItem?.bidPrice,
        currencyItem?.askPrice,
        usd?.buy,
        usd?.sell
    );

    const previousClose = firstValidNumber(
        result?.regularMarketPreviousClose,
        result?.previousClose,
        currencyItem?.previousClose,
        usd?.sell
    );

    const high = firstValidNumber(
        result?.regularMarketDayHigh,
        result?.high,
        currencyItem?.high,
        price
    );

    const low = firstValidNumber(
        result?.regularMarketDayLow,
        result?.low,
        currencyItem?.low,
        price
    );

    const varPerc = firstValidNumber(
        result?.regularMarketChangePercent,
        result?.changePercent,
        currencyItem?.percentageChange,
        usd?.variation,
        price && previousClose ? toPercent(price, previousClose) : 0
    );

    if (!isValidNumber(price)) {
        return null;
    }

    return {
        price,
        previousClose: isValidNumber(previousClose) ? previousClose : null,
        high: isValidNumber(high) ? high : null,
        low: isValidNumber(low) ? low : null,
        varPerc: isValidNumber(varPerc) ? varPerc : 0
    };
}

async function fetchUsdBrlSpotFromBrapi() {
    if (!BRAPI_API_KEY) {
        return null;
    }

    const headers = {
        Authorization: `Bearer ${BRAPI_API_KEY}`,
        Accept: 'application/json'
    };

    const endpoints = [
        `${BRAPI_BASE_URL}/api/v2/currency?currency=USD-BRL`,
        `${BRAPI_BASE_URL}/api/v1/currency?currency=USD-BRL`
    ];

    for (const endpoint of endpoints) {
        try {
            const payload = await fetchJsonWithTimeout(endpoint, { headers });
            const parsed = parseBrapiUsdBrlPayload(payload);

            if (parsed) {
                return parsed;
            }
        } catch (error) {
            console.error(`Error fetching USD/BRL from Brapi (${endpoint}):`, error.message);
        }
    }

    return null;
}

async function fetchDolarFuturoB3(monthsAhead = 12) {
    const contracts = getNextFinancialContracts(monthsAhead);
    const prefixes = ['DOL', 'WDO'];

    const contractQuotes = await Promise.all(contracts.map(async (contract) => {
        for (const prefix of prefixes) {
            const ticker = `${prefix}${contract.code}${contract.year}.SA`;

            try {
                const quote = await yahooFinance.quote(ticker);
                if (!quote) {
                    continue;
                }

                const hasPrice = isValidNumber(quote.regularMarketPrice);

                if (!hasPrice) {
                    continue;
                }

                return normalizeDolarFuturoRow(`${prefix} ${contract.label}`, {
                    price: quote.regularMarketPrice,
                    varPerc: quote.regularMarketChangePercent || 0,
                    high: quote.regularMarketDayHigh,
                    low: quote.regularMarketDayLow,
                    previousClose: quote.regularMarketPreviousClose
                });
            } catch (e) {
                console.error(`Error fetching ${ticker}:`, e.message);
            }
        }

        return null;
    }));

    return contractQuotes.filter(Boolean);
}

async function fetchDolarFuturoCme(monthsAhead = 12) {
    const contracts = getNextFinancialContracts(monthsAhead);

    const contractQuotes = await Promise.all(contracts.map(async (contract) => {
        const ticker = `6L${contract.code}${contract.year}.CME`;

        try {
            const quote = await yahooFinance.quote(ticker);
            if (!quote) {
                return null;
            }

            const brlUsd = quote.regularMarketPrice;
            const brlUsdPrev = quote.regularMarketPreviousClose;
            const brlUsdHigh = quote.regularMarketDayHigh;
            const brlUsdLow = quote.regularMarketDayLow;

            if (!isValidNumber(brlUsd)) {
                return null;
            }

            const usdBrl = 1 / brlUsd;
            const usdBrlPrev = brlUsdPrev ? 1 / brlUsdPrev : null;
            const usdBrlHigh = brlUsdLow ? 1 / brlUsdLow : null;
            const usdBrlLow = brlUsdHigh ? 1 / brlUsdHigh : null;

            return normalizeDolarFuturoRow(`USD/BRL ${contract.label}`, {
                price: usdBrl,
                varPerc: usdBrlPrev ? toPercent(usdBrl, usdBrlPrev) : 0,
                high: usdBrlHigh,
                low: usdBrlLow,
                previousClose: usdBrlPrev
            });
        } catch (e) {
            console.error(`Error fetching ${ticker}:`, e.message);
            return null;
        }
    }));

    return contractQuotes.filter(Boolean);
}

async function fetchUsdBrlSpotFallback() {
    try {
        const quote = await yahooFinance.quote('BRL=X');

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
    const brapiSpot = await fetchUsdBrlSpotFromBrapi();
    if (brapiSpot) {
        return brapiSpot;
    }

    return fetchUsdBrlSpotFallback();
}

async function fetchDolarFuturoData(spotOverride = null) {
    const spot = spotOverride || await fetchUsdBrlSpotData();
    const b3Contracts = await fetchDolarFuturoB3(12);
    let futures = b3Contracts;

    if (futures.length < 2) {
        const cmeContracts = await fetchDolarFuturoCme(12);
        if (cmeContracts.length) {
            futures = cmeContracts;
        }
    }

    const rows = [];

    if (spot) {
        rows.push(normalizeUsdBrlSpotRow(spot));
    }

    rows.push(...futures);
    return rows;
}

const updateCache = async () => {
    console.log(`[${new Date().toISOString()}] Fetching new data from Yahoo Finance...`);

    try {
        const usdSpot = await fetchUsdBrlSpotData();
        const sojaGrao = await fetchAgriData('ZS=F', 'ZS');
        const fareloSoja = await fetchAgriData('ZM=F', 'ZM');
        const oleoSoja = await fetchAgriData('ZL=F', 'ZL');
        const dolarFuturo = await fetchDolarFuturoData(usdSpot);

        const financeiroPromises = [
            fetchFinanceData('EURBRL=X', 'Real / Euro'),
            fetchFinanceData('DX-Y.NYB', 'DXY'),
            fetchFinanceData('GC=F', 'GOLD')
        ];

        const financeiroResults = await Promise.all(financeiroPromises);
        const usdFinanceRow = usdSpot
            ? normalizeUsdBrlFinanceiroRow(usdSpot)
            : await fetchFinanceData('BRL=X', 'USD Comercial');

        if (usdFinanceRow) {
            financeiroResults.unshift(usdFinanceRow);
        }

        const financeiro = financeiroResults.filter(r => r !== null);

        cache.agricola = {
            sojaGrao: sojaGrao.length ? sojaGrao : cache.agricola.sojaGrao,
            fareloSoja: fareloSoja.length ? fareloSoja : cache.agricola.fareloSoja,
            oleoSoja: oleoSoja.length ? oleoSoja : cache.agricola.oleoSoja
        };
        cache.financeiro = financeiro.length ? financeiro : cache.financeiro;
        cache.dolarFuturo = dolarFuturo.length ? dolarFuturo : cache.dolarFuturo;
        cache.lastUpdated = new Date();

        console.log(`[${new Date().toISOString()}] Cache updated successfully.`);
    } catch (e) {
        console.error('Error updating cache:', e.message);
    }
};

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