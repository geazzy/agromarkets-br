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
const AGRI_TOTAL_CONTRACTS = Number(process.env.AGRI_TOTAL_CONTRACTS || 15);
const YAHOO_MIN_REQUEST_INTERVAL_MS = Number(process.env.YAHOO_MIN_REQUEST_INTERVAL_MS || 350);
const YAHOO_MAX_RETRIES = Number(process.env.YAHOO_MAX_RETRIES || 3);
const YAHOO_RETRY_BASE_DELAY_MS = Number(process.env.YAHOO_RETRY_BASE_DELAY_MS || 1200);
const AWESOME_API_BASE_URL = process.env.AWESOME_API_BASE_URL || 'https://economia.awesomeapi.com.br/json/last';
const TROY_OUNCE_IN_GRAMS = 31.1035;

app.use(cors());

let cache = {
    agricola: {
        sojaGrao: [],
        fareloSoja: [],
        oleoSoja: []
    },
    financeiro: [],
    lastValidSnapshotAt: null
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

const toRaw = (value) => (isValidNumber(value) ? value : null);

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

const toSafeErrorMessage = (error) => String(error?.message || 'unknown_error');

function logEvent(level, event, data = {}) {
    const payload = {
        ts: new Date().toISOString(),
        level,
        event,
        ...data
    };
    const line = JSON.stringify(payload);

    if (level === 'error') {
        console.error(line);
        return;
    }

    if (level === 'warn') {
        console.warn(line);
        return;
    }

    console.log(line);
}

function createCycleId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function extractHttpStatusFromError(error) {
    const message = String(error?.message || '');
    const statusFromHttp = message.match(/http\s*(\d{3})/i);
    const statusFromStatus = message.match(/status\s*(\d{3})/i);
    const status = statusFromHttp?.[1] || statusFromStatus?.[1] || null;
    return status ? Number(status) : null;
}

let yahooLastRequestAt = 0;
let yahooRequestChain = Promise.resolve();
let activeCycleStats = null;
let activeCycleContext = null;

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
    if (activeCycleContext?.yahooQuoteMemo?.has(ticker)) {
        if (activeCycleStats) {
            activeCycleStats.yahooDedupHits += 1;
        }
        return activeCycleContext.yahooQuoteMemo.get(ticker);
    }

    const fetchPromise = fetchYahooQuoteUncached(ticker);
    if (activeCycleContext?.yahooQuoteMemo) {
        activeCycleContext.yahooQuoteMemo.set(ticker, fetchPromise);
    }

    return fetchPromise;
}

async function fetchYahooQuoteUncached(ticker) {
    let lastError = null;

    for (let attempt = 0; attempt <= YAHOO_MAX_RETRIES; attempt += 1) {
        if (activeCycleStats) {
            activeCycleStats.yahooRequests += 1;
        }

        try {
            const quote = await throttledYahooQuote(ticker);

            if (activeCycleStats) {
                activeCycleStats.yahooSuccess += 1;
            }

            return quote;
        } catch (error) {
            lastError = error;
            const isRateLimited = isYahooRateLimitError(error);

            if (activeCycleStats) {
                if (isRateLimited) {
                    activeCycleStats.yahoo429 += 1;
                }
            }

            if (!isRateLimited || attempt === YAHOO_MAX_RETRIES) {
                if (activeCycleStats) {
                    activeCycleStats.yahooFailures += 1;
                }

                logEvent('error', 'yahoo_fetch_failed', {
                    cycleId: activeCycleStats?.cycleId || null,
                    ticker,
                    attempt: attempt + 1,
                    maxAttempts: YAHOO_MAX_RETRIES + 1,
                    status: extractHttpStatusFromError(error),
                    rateLimited: isRateLimited,
                    message: toSafeErrorMessage(error)
                });
                break;
            }

            const backoffMs = YAHOO_RETRY_BASE_DELAY_MS * (attempt + 1);

            if (activeCycleStats) {
                activeCycleStats.yahooRetries += 1;
            }

            logEvent('warn', 'yahoo_fetch_retry', {
                cycleId: activeCycleStats?.cycleId || null,
                ticker,
                attempt: attempt + 1,
                maxAttempts: YAHOO_MAX_RETRIES + 1,
                status: extractHttpStatusFromError(error),
                backoffMs,
                message: toSafeErrorMessage(error)
            });
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

function getAwesomeQuoteEntry(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const [entry] = Object.values(payload);
    return entry && typeof entry === 'object' ? entry : null;
}

async function fetchAwesomePairData(pair, eventOnError) {
    const endpoint = `${AWESOME_API_BASE_URL}/${pair}`;

    try {
        const payload = await fetchJsonWithTimeout(endpoint, {
            headers: { Accept: 'application/json' }
        });

        const quote = getAwesomeQuoteEntry(payload);
        if (!quote) {
            return null;
        }

        const price = firstValidNumber(quote.bid, quote.ask, quote.last, quote.high, quote.low, quote.open);
        if (!isValidNumber(price)) {
            return null;
        }

        const high = firstValidNumber(quote.high, price);
        const low = firstValidNumber(quote.low, price);
        const previousClose = firstValidNumber(quote.open, quote.bid, quote.ask, price);
        const varPerc = firstValidNumber(quote.pctChange, quote.varBid, quote.variation);

        return {
            price,
            varPerc: isValidNumber(varPerc)
                ? varPerc
                : (isValidNumber(previousClose) && previousClose !== 0 ? toPercent(price, previousClose) : 0),
            high,
            low,
            previousClose
        };
    } catch (error) {
        logEvent('error', eventOnError, {
            cycleId: activeCycleStats?.cycleId || null,
            pair,
            endpoint,
            message: toSafeErrorMessage(error)
        });
        return null;
    }
}

function getCurrentContractTicker(baseSymbol) {
    const currentContract = getCurrentContractInfo(baseSymbol);
    return `${baseSymbol}${currentContract.c}${currentContract.year}.CBT`;
}

function getFutureTickers(baseSymbol, contractsAhead = 2) {
    const tickers = [];
    const currentDate = new Date();
    const validMonths = getValidMonths(baseSymbol);
    const currentTicker = getCurrentContractTicker(baseSymbol);
    let year = currentDate.getFullYear();
    let guard = 0;

    while (tickers.length < contractsAhead && guard < 10) {
        const yearShort = year.toString().slice(-2);

        for (const vm of validMonths) {
            if (year === currentDate.getFullYear() && vm.m < currentDate.getMonth() + 1) {
                continue;
            }

            const tickerStr = `${baseSymbol}${vm.c}${yearShort}.CBT`;
            if (tickerStr === currentTicker) {
                continue;
            }

            if (!tickers.find(t => t.ticker === tickerStr)) {
                tickers.push({ ticker: tickerStr, name: `${vm.n}/${yearShort} (${vm.c})` });
            }

            if (tickers.length >= contractsAhead) {
                break;
            }
        }

        year += 1;
        guard += 1;
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

const fetchAgriData = async (ticker, baseSymbol, totalContracts = AGRI_TOTAL_CONTRACTS) => {
    try {
        const quote = await fetchYahooQuote(ticker);
        if (!quote || !isValidNumber(quote.regularMarketPrice)) {
            return [];
        }

        const dif = quote.regularMarketChange || 0;
        const currentContract = getCurrentContractInfo(baseSymbol);
        const currentPrice = toRaw(quote.regularMarketPrice);
        const currentHigh = toRaw(quote.regularMarketDayHigh);
        const currentLow = toRaw(quote.regularMarketDayLow);
        const currentPreviousClose = toRaw(quote.regularMarketPreviousClose);
        const currentOpen = toRaw(quote.regularMarketOpen);
        const currentDif = toRaw(dif) ?? 0;

        const atual = {
            contrato: `${currentContract.n}/${currentContract.year} (${currentContract.c}) (Atual)`,
            ult: formatValue(currentPrice),
            ultRaw: currentPrice,
            max: formatValue(currentHigh),
            maxRaw: currentHigh,
            min: formatValue(currentLow),
            minRaw: currentLow,
            fec: formatValue(currentPreviousClose),
            fecRaw: currentPreviousClose,
            abe: formatValue(currentOpen),
            abeRaw: currentOpen,
            dif: formatValue(currentDif),
            difRaw: currentDif
        };

        const futureTickers = getFutureTickers(baseSymbol, Math.max(0, totalContracts - 1));
        const results = [atual];

        for (const ft of futureTickers) {
            try {
                const quoteFuturo = await fetchYahooQuote(ft.ticker);
                if (!quoteFuturo || !isValidNumber(quoteFuturo.regularMarketPrice)) {
                    continue;
                }

                const difFuturo = quoteFuturo.regularMarketChange || 0;
                const futurePrice = toRaw(quoteFuturo.regularMarketPrice);
                const futureHigh = toRaw(quoteFuturo.regularMarketDayHigh);
                const futureLow = toRaw(quoteFuturo.regularMarketDayLow);
                const futurePreviousClose = toRaw(quoteFuturo.regularMarketPreviousClose);
                const futureOpen = toRaw(quoteFuturo.regularMarketOpen);
                const futureDif = toRaw(difFuturo) ?? 0;

                results.push({
                    contrato: ft.name,
                    ult: formatValue(futurePrice),
                    ultRaw: futurePrice,
                    max: formatValue(futureHigh),
                    maxRaw: futureHigh,
                    min: formatValue(futureLow),
                    minRaw: futureLow,
                    fec: formatValue(futurePreviousClose),
                    fecRaw: futurePreviousClose,
                    abe: formatValue(futureOpen),
                    abeRaw: futureOpen,
                    dif: formatValue(futureDif),
                    difRaw: futureDif
                });
            } catch (e) {
                logEvent('error', 'agri_future_fetch_failed', {
                    cycleId: activeCycleStats?.cycleId || null,
                    baseSymbol,
                    ticker: ft.ticker,
                    message: toSafeErrorMessage(e)
                });
            }
        }

        return results.slice(0, Math.max(1, totalContracts));
    } catch (e) {
        logEvent('error', 'agri_spot_fetch_failed', {
            cycleId: activeCycleStats?.cycleId || null,
            baseSymbol,
            ticker,
            message: toSafeErrorMessage(e)
        });
        return [];
    }
};

const fetchFinanceData = async (ticker, name) => {
    try {
        const quote = await fetchYahooQuote(ticker);
        if (!quote || !isValidNumber(quote.regularMarketPrice)) {
            return null;
        }

        const price = toRaw(quote.regularMarketPrice);
        const high = toRaw(quote.regularMarketDayHigh);
        const low = toRaw(quote.regularMarketDayLow);
        const previousClose = toRaw(quote.regularMarketPreviousClose);
        const varPerc = toRaw(quote.regularMarketChangePercent) ?? 0;

        return {
            indice: name,
            ult: formatValue(price),
            ultRaw: price,
            varPerc: formatValue(varPerc),
            varPercRaw: varPerc,
            max: formatValue(high),
            maxRaw: high,
            min: formatValue(low),
            minRaw: low,
            fec: formatValue(previousClose),
            fecRaw: previousClose
        };
    } catch (e) {
        logEvent('error', 'finance_fetch_failed', {
            cycleId: activeCycleStats?.cycleId || null,
            ticker,
            name,
            message: toSafeErrorMessage(e)
        });
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
        ultRaw: toRaw(values.price),
        varPerc: formatValue(values.varPerc),
        varPercRaw: toRaw(values.varPerc),
        max: formatValue(values.high),
        maxRaw: toRaw(values.high),
        min: formatValue(values.low),
        minRaw: toRaw(values.low),
        fec: formatValue(values.previousClose),
        fecRaw: toRaw(values.previousClose)
    };
}

function normalizeUsdBrlPtaxFinanceiroRow(values) {
    return {
        indice: 'Dólar PTAX',
        ult: formatValue(values.price),
        ultRaw: toRaw(values.price),
        varPerc: formatValue(values.varPerc),
        varPercRaw: toRaw(values.varPerc),
        max: formatValue(values.high),
        maxRaw: toRaw(values.high),
        min: formatValue(values.low),
        minRaw: toRaw(values.low),
        fec: formatValue(values.previousClose),
        fecRaw: toRaw(values.previousClose)
    };
}

function normalizeEurBrlFinanceiroRow(values) {
    return {
        indice: 'Real / Euro',
        ult: formatValue(values.price),
        ultRaw: toRaw(values.price),
        varPerc: formatValue(values.varPerc),
        varPercRaw: toRaw(values.varPerc),
        max: formatValue(values.high),
        maxRaw: toRaw(values.high),
        min: formatValue(values.low),
        minRaw: toRaw(values.low),
        fec: formatValue(values.previousClose),
        fecRaw: toRaw(values.previousClose)
    };
}

function normalizeEurUsdFinanceiroRow(values) {
    return {
        indice: 'Dólar/Euro (EUR-USD)',
        ult: formatValue(values.price, 4, 4),
        ultRaw: toRaw(values.price),
        varPerc: formatValue(values.varPerc),
        varPercRaw: toRaw(values.varPerc),
        max: formatValue(values.high, 4, 4),
        maxRaw: toRaw(values.high),
        min: formatValue(values.low, 4, 4),
        minRaw: toRaw(values.low),
        fec: formatValue(values.previousClose, 4, 4),
        fecRaw: toRaw(values.previousClose)
    };
}

function normalizeXauBrlFinanceiroRow(values) {
    const toGram = (value) => (isValidNumber(value) ? value / TROY_OUNCE_IN_GRAMS : null);
    const priceGram = toGram(values.price);
    const highGram = toGram(values.high);
    const lowGram = toGram(values.low);
    const previousCloseGram = toGram(values.previousClose);
    const varPercGram = isValidNumber(priceGram) && isValidNumber(previousCloseGram) && previousCloseGram !== 0
        ? toPercent(priceGram, previousCloseGram)
        : (isValidNumber(values.varPerc) ? values.varPerc : 0);

    return {
        indice: 'Ouro (XAU-BRL, por grama)',
        ult: formatValue(priceGram, 4, 4),
        ultRaw: toRaw(priceGram),
        varPerc: formatValue(varPercGram),
        varPercRaw: toRaw(varPercGram),
        max: formatValue(highGram, 4, 4),
        maxRaw: toRaw(highGram),
        min: formatValue(lowGram, 4, 4),
        minRaw: toRaw(lowGram),
        fec: formatValue(previousCloseGram, 4, 4),
        fecRaw: toRaw(previousCloseGram),
        ultGrama: formatValue(priceGram, 4, 4),
        ultGramaRaw: toRaw(priceGram),
        maxGrama: formatValue(highGram, 4, 4),
        maxGramaRaw: toRaw(highGram),
        minGrama: formatValue(lowGram, 4, 4),
        minGramaRaw: toRaw(lowGram),
        fecGrama: formatValue(previousCloseGram, 4, 4),
        fecGramaRaw: toRaw(previousCloseGram)
    };
}

function normalizeDolarFuturoFinanceiroRow(label, values) {
    return {
        indice: `Dólar Futuro ${label}`,
        ult: formatValue(values.price, 4, 4),
        ultRaw: toRaw(values.price),
        varPerc: formatValue(values.varPerc),
        varPercRaw: toRaw(values.varPerc),
        max: formatValue(values.high, 4, 4),
        maxRaw: toRaw(values.high),
        min: formatValue(values.low, 4, 4),
        minRaw: toRaw(values.low),
        fec: formatValue(values.previousClose, 4, 4),
        fecRaw: toRaw(values.previousClose)
    };
}

async function fetchUsdBrlPtaxData(spotFallback = null) {
    const ptaxData = await fetchAwesomePairData('USD-BRLPTAX', 'ptax_awesome_fetch_failed');

    if (ptaxData) {
        return ptaxData;
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

async function fetchDolarFuturoCme(monthsAhead = DOLAR_FUTURO_CONTRACT_COUNT) {
    const lookupWindow = Math.max(monthsAhead * 3, monthsAhead);
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

            const brlUsd = firstValidNumber(
                quote.regularMarketPrice,
                quote.postMarketPrice,
                quote.preMarketPrice,
                quote.regularMarketPreviousClose
            );

            if (!isValidNumber(brlUsd) || brlUsd === 0) {
                continue;
            }

            const brlUsdPrev = firstValidNumber(quote.regularMarketPreviousClose, brlUsd);
            const brlUsdHigh = firstValidNumber(quote.regularMarketDayHigh, brlUsd);
            const brlUsdLow = firstValidNumber(quote.regularMarketDayLow, brlUsd);

            const usdBrl = 1 / brlUsd;
            const usdBrlPrev = isValidNumber(brlUsdPrev) && brlUsdPrev !== 0 ? 1 / brlUsdPrev : null;
            const usdBrlHigh = isValidNumber(brlUsdLow) && brlUsdLow !== 0 ? 1 / brlUsdLow : usdBrl;
            const usdBrlLow = isValidNumber(brlUsdHigh) && brlUsdHigh !== 0 ? 1 / brlUsdHigh : usdBrl;
            const varPerc = isValidNumber(quote.regularMarketChangePercent)
                ? quote.regularMarketChangePercent
                : (isValidNumber(usdBrlPrev) ? toPercent(usdBrl, usdBrlPrev) : 0);

            results.push(normalizeDolarFuturoFinanceiroRow(contract.label, {
                price: usdBrl,
                varPerc,
                high: usdBrlHigh,
                low: usdBrlLow,
                previousClose: usdBrlPrev
            }));
        } catch (e) {
            logEvent('error', 'dolar_futuro_cme_fetch_failed', {
                cycleId: activeCycleStats?.cycleId || null,
                ticker,
                message: toSafeErrorMessage(e)
            });
        }
    }

    return results;
}

async function fetchUsdBrlSpotData() {
    return fetchAwesomePairData('USD-BRL', 'usd_brl_spot_fetch_failed');
}

async function fetchUsdEurData() {
    const eurUsd = await fetchAwesomePairData('EUR-USD', 'eur_usd_fetch_failed');
    return eurUsd ? normalizeEurUsdFinanceiroRow(eurUsd) : null;
}

async function fetchEurBrlData() {
    const eurBrl = await fetchAwesomePairData('EUR-BRL', 'eur_brl_fetch_failed');
    return eurBrl ? normalizeEurBrlFinanceiroRow(eurBrl) : null;
}

async function fetchXauBrlData() {
    const xauBrl = await fetchAwesomePairData('XAU-BRL', 'xau_brl_fetch_failed');
    return xauBrl ? normalizeXauBrlFinanceiroRow(xauBrl) : null;
}

async function fetchDolarFuturoFinanceiroRows(count = DOLAR_FUTURO_CONTRACT_COUNT) {
    return fetchDolarFuturoCme(count);
}

function buildPlannedYahooSymbols() {
    const financialSymbols = ['DX-Y.NYB'];
    const agriSpots = ['ZS=F', 'ZM=F', 'ZL=F'];
    const agriFutures = ['ZS', 'ZM', 'ZL']
        .flatMap(baseSymbol => getFutureTickers(baseSymbol, Math.max(0, AGRI_TOTAL_CONTRACTS - 1)).map(item => item.ticker));

    const dolarContracts = getNextFinancialContracts(Math.max(DOLAR_FUTURO_CONTRACT_COUNT * 3, DOLAR_FUTURO_CONTRACT_COUNT));
    const dolarCandidates = dolarContracts.map(contract => `6L${contract.code}${contract.year}.CME`);

    return Array.from(new Set([...agriSpots, ...agriFutures, ...financialSymbols, ...dolarCandidates]));
}

const updateCache = async () => {
    if (updateCache.isRunning) {
        const runningForMs = updateCache.startedAt ? Date.now() - updateCache.startedAt : null;
        logEvent('warn', 'cache_update_skipped_previous_running', {
            cycleId: updateCache.currentCycleId || null,
            runningForMs
        });
        return;
    }

    const cycleId = createCycleId();
    const startedAt = Date.now();
    const plannedYahooSymbols = buildPlannedYahooSymbols();

    updateCache.isRunning = true;
    updateCache.currentCycleId = cycleId;
    updateCache.startedAt = startedAt;
    activeCycleStats = {
        cycleId,
        yahooRequests: 0,
        yahooSuccess: 0,
        yahooFailures: 0,
        yahooRetries: 0,
        yahoo429: 0,
        yahooDedupHits: 0
    };
    activeCycleContext = {
        yahooQuoteMemo: new Map()
    };

    logEvent('info', 'cache_update_started', {
        cycleId,
        syncIntervalMinutes: SYNC_INTERVAL_MINUTES,
        agriTotalContracts: AGRI_TOTAL_CONTRACTS,
        dolarFuturoContractCount: DOLAR_FUTURO_CONTRACT_COUNT,
        plannedYahooSymbolsCount: plannedYahooSymbols.length,
        plannedYahooSymbols
    });

    try {
        const usdSpot = await fetchUsdBrlSpotData();
        const usdPtax = await fetchUsdBrlPtaxData(usdSpot);
        const sojaGrao = await fetchAgriData('ZS=F', 'ZS', AGRI_TOTAL_CONTRACTS);
        const fareloSoja = await fetchAgriData('ZM=F', 'ZM', AGRI_TOTAL_CONTRACTS);
        const oleoSoja = await fetchAgriData('ZL=F', 'ZL', AGRI_TOTAL_CONTRACTS);
        const dolarFuturo = await fetchDolarFuturoFinanceiroRows(DOLAR_FUTURO_CONTRACT_COUNT);
        const eurBrl = await fetchEurBrlData();
        const eurUsd = await fetchUsdEurData();
        const dxy = await fetchFinanceData('DX-Y.NYB', 'DXY');
        const xauBrl = await fetchXauBrlData();

        const usdFinanceRow = usdSpot
            ? normalizeUsdBrlFinanceiroRow(usdSpot)
            : null;

        const financeiro = [
            usdPtax ? normalizeUsdBrlPtaxFinanceiroRow(usdPtax) : null,
            usdFinanceRow,
            eurBrl,
            eurUsd,
            xauBrl,
            ...dolarFuturo,
            dxy
        ].filter(r => r !== null);

        const nextAgricola = {
            sojaGrao: sojaGrao.length ? sojaGrao : cache.agricola.sojaGrao,
            fareloSoja: fareloSoja.length ? fareloSoja : cache.agricola.fareloSoja,
            oleoSoja: oleoSoja.length ? oleoSoja : cache.agricola.oleoSoja
        };

        const nextFinanceiro = financeiro.length ? financeiro : cache.financeiro;

        const hasAllAgricolaData = nextAgricola.sojaGrao.length > 0
            && nextAgricola.fareloSoja.length > 0
            && nextAgricola.oleoSoja.length > 0;
        const hasFinanceiroData = nextFinanceiro.length > 0;
        const canCommitSnapshot = hasAllAgricolaData && hasFinanceiroData;

        if (canCommitSnapshot) {
            const now = new Date();
            cache.agricola = nextAgricola;
            cache.financeiro = nextFinanceiro;
            cache.lastValidSnapshotAt = now;
        } else {
            logEvent('warn', 'cache_snapshot_fallback_used', {
                cycleId,
                reason: 'incomplete_data',
                hasAllAgricolaData,
                hasFinanceiroData,
                lastValidSnapshotAt: cache.lastValidSnapshotAt ? cache.lastValidSnapshotAt.toISOString() : null
            });
        }

        logEvent('info', 'cache_update_finished', {
            cycleId,
            durationMs: Date.now() - startedAt,
            yahooRequests: activeCycleStats?.yahooRequests || 0,
            yahooSuccess: activeCycleStats?.yahooSuccess || 0,
            yahooFailures: activeCycleStats?.yahooFailures || 0,
            yahooRetries: activeCycleStats?.yahooRetries || 0,
            yahoo429: activeCycleStats?.yahoo429 || 0,
            yahooDedupHits: activeCycleStats?.yahooDedupHits || 0,
            financeiroRows: cache.financeiro.length,
            sojaContracts: cache.agricola.sojaGrao.length,
            fareloContracts: cache.agricola.fareloSoja.length,
            oleoContracts: cache.agricola.oleoSoja.length
        });
    } catch (e) {
        logEvent('warn', 'cache_snapshot_fallback_used', {
            cycleId,
            reason: 'provider_error',
            message: toSafeErrorMessage(e),
            lastValidSnapshotAt: cache.lastValidSnapshotAt ? cache.lastValidSnapshotAt.toISOString() : null
        });
        logEvent('error', 'cache_update_failed', {
            cycleId,
            durationMs: Date.now() - startedAt,
            message: toSafeErrorMessage(e),
            yahooRequests: activeCycleStats?.yahooRequests || 0,
            yahooRetries: activeCycleStats?.yahooRetries || 0,
            yahoo429: activeCycleStats?.yahoo429 || 0,
            yahooDedupHits: activeCycleStats?.yahooDedupHits || 0
        });
    } finally {
        activeCycleStats = null;
        activeCycleContext = null;
        updateCache.isRunning = false;
        updateCache.currentCycleId = null;
        updateCache.startedAt = null;
    }
};

updateCache.isRunning = false;
updateCache.currentCycleId = null;
updateCache.startedAt = null;

updateCache();
setInterval(updateCache, SYNC_INTERVAL_MINUTES * 60 * 1000);

app.get('/api/agricola', (req, res) => {
    res.json(cache.agricola);
});

app.get('/api/financeiro', (req, res) => {
    res.json(cache.financeiro);
});

app.get('/api/status', (req, res) => {
    res.json({
        lastUpdated: cache.lastValidSnapshotAt ? cache.lastValidSnapshotAt.toISOString() : null,
        syncIntervalMinutes: SYNC_INTERVAL_MINUTES
    });
});

app.listen(PORT, () => {
    logEvent('info', 'server_started', {
        port: PORT,
        syncIntervalMinutes: SYNC_INTERVAL_MINUTES,
        agriTotalContracts: AGRI_TOTAL_CONTRACTS,
        dolarFuturoContractCount: DOLAR_FUTURO_CONTRACT_COUNT,
        yahooMinRequestIntervalMs: YAHOO_MIN_REQUEST_INTERVAL_MS,
        yahooMaxRetries: YAHOO_MAX_RETRIES,
        yahooRetryBaseDelayMs: YAHOO_RETRY_BASE_DELAY_MS
    });
});