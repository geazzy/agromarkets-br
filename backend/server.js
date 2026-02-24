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
const AGRI_TOTAL_CONTRACTS = Number(process.env.AGRI_TOTAL_CONTRACTS || 3);
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

        const atual = {
            contrato: `${currentContract.n}/${currentContract.year} (${currentContract.c}) (Atual)`,
            ult: formatValue(quote.regularMarketPrice),
            max: formatValue(quote.regularMarketDayHigh),
            min: formatValue(quote.regularMarketDayLow),
            fec: formatValue(quote.regularMarketPreviousClose),
            abe: formatValue(quote.regularMarketOpen),
            dif: formatValue(dif)
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
        logEvent('warn', 'ptax_fetch_failed', {
            cycleId: activeCycleStats?.cycleId || null,
            dateQuery,
            message: toSafeErrorMessage(error)
        });
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
    const lookupWindow = Math.max(monthsAhead * 2, monthsAhead);
    const contracts = getNextFinancialContracts(lookupWindow);
    const results = [];

    for (const contract of contracts) {
        if (results.length >= monthsAhead) {
            break;
        }

        const ticker = `DOL${contract.code}${contract.year}.SA`;

        try {
            const quote = await fetchYahooQuote(ticker);
            if (!quote) {
                continue;
            }

            const price = firstValidNumber(
                quote.regularMarketPrice,
                quote.postMarketPrice,
                quote.preMarketPrice,
                quote.regularMarketPreviousClose
            );

            if (!isValidNumber(price)) {
                logEvent('warn', 'dolar_futuro_no_usable_price', {
                    cycleId: activeCycleStats?.cycleId || null,
                    ticker,
                    regularMarketPrice: toNumberOrNull(quote.regularMarketPrice),
                    regularMarketPreviousClose: toNumberOrNull(quote.regularMarketPreviousClose)
                });
                continue;
            }

            const previousClose = firstValidNumber(
                quote.regularMarketPreviousClose,
                quote.regularMarketPrice,
                quote.postMarketPrice,
                quote.preMarketPrice
            );
            const high = firstValidNumber(quote.regularMarketDayHigh, price);
            const low = firstValidNumber(quote.regularMarketDayLow, price);
            const varPerc = isValidNumber(quote.regularMarketChangePercent)
                ? quote.regularMarketChangePercent
                : (isValidNumber(previousClose) && previousClose !== 0 ? toPercent(price, previousClose) : 0);

            results.push(normalizeDolarFuturoFinanceiroRow(contract.label, {
                price,
                varPerc,
                high,
                low,
                previousClose
            }));
        } catch (e) {
            logEvent('error', 'dolar_futuro_fetch_failed', {
                cycleId: activeCycleStats?.cycleId || null,
                ticker,
                message: toSafeErrorMessage(e)
            });
        }
    }

    return results;
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
        logEvent('error', 'usd_brl_fallback_failed', {
            cycleId: activeCycleStats?.cycleId || null,
            ticker: 'BRL=X',
            message: toSafeErrorMessage(e)
        });
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
        logEvent('error', 'usd_eur_fetch_failed', {
            cycleId: activeCycleStats?.cycleId || null,
            ticker: 'EURUSD=X',
            message: toSafeErrorMessage(e)
        });
        return null;
    }
}

async function fetchDolarFuturoFinanceiroRows(count = DOLAR_FUTURO_CONTRACT_COUNT) {
    return fetchDolarFuturoCme(count);
}

function buildPlannedYahooSymbols() {
    const financialSymbols = ['EURBRL=X', 'EURUSD=X', 'DX-Y.NYB', 'GC=F', 'BRL=X'];
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
        yahoo429: 0
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
        cache.lastUpdated = new Date();

        logEvent('info', 'cache_update_finished', {
            cycleId,
            durationMs: Date.now() - startedAt,
            yahooRequests: activeCycleStats?.yahooRequests || 0,
            yahooSuccess: activeCycleStats?.yahooSuccess || 0,
            yahooFailures: activeCycleStats?.yahooFailures || 0,
            yahooRetries: activeCycleStats?.yahooRetries || 0,
            yahoo429: activeCycleStats?.yahoo429 || 0,
            financeiroRows: cache.financeiro.length,
            sojaContracts: cache.agricola.sojaGrao.length,
            fareloContracts: cache.agricola.fareloSoja.length,
            oleoContracts: cache.agricola.oleoSoja.length
        });
    } catch (e) {
        logEvent('error', 'cache_update_failed', {
            cycleId,
            durationMs: Date.now() - startedAt,
            message: toSafeErrorMessage(e),
            yahooRequests: activeCycleStats?.yahooRequests || 0,
            yahooRetries: activeCycleStats?.yahooRetries || 0,
            yahoo429: activeCycleStats?.yahoo429 || 0
        });
    } finally {
        activeCycleStats = null;
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
        lastUpdated: cache.lastUpdated ? cache.lastUpdated.toISOString() : null,
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