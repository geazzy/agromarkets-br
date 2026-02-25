import { useState, useEffect, useCallback, useRef } from 'react';
import { DataTable } from './DataTable';
import { ForwardCurveChart } from './ForwardCurveChart';
import type { ColumnDef } from './DataTable';

// Tipos para os dados
interface SojaData {
    contrato: string;
    ult: string;
    ultRaw?: number | null;
    max: string;
    maxRaw?: number | null;
    min: string;
    minRaw?: number | null;
    fec: string;
    fecRaw?: number | null;
    abe: string;
    abeRaw?: number | null;
    dif: string;
    difRaw?: number | null;
}

interface FinanceiroData {
    indice: string;
    ult: string;
    ultRaw?: number | null;
    varPerc: string;
    varPercRaw?: number | null;
    max: string;
    maxRaw?: number | null;
    min: string;
    minRaw?: number | null;
    fec: string;
    fecRaw?: number | null;
    ultGrama?: string;
    ultGramaRaw?: number | null;
    maxGrama?: string;
    maxGramaRaw?: number | null;
    minGrama?: string;
    minGramaRaw?: number | null;
    fecGrama?: string;
    fecGramaRaw?: number | null;
}

interface BackendStatus {
    lastUpdated: string | null;
    syncIntervalMinutes: number;
}

// Colunas
const sojaColumns: ColumnDef<SojaData>[] = [
    { key: 'contrato', header: 'DATA/CONTRATO' },
    { key: 'ult', header: 'ULT' },
    { key: 'max', header: 'MAX' },
    { key: 'min', header: 'MIN' },
    { key: 'fec', header: 'FEC' },
    { key: 'abe', header: 'ABE' },
    { key: 'dif', header: 'DIF' },
];

const financeiroColumns: ColumnDef<FinanceiroData>[] = [
    { key: 'indice', header: 'ÍNDICE' },
    { key: 'ult', header: 'ULT' },
    { key: 'varPerc', header: 'VAR. [%]' },
    { key: 'max', header: 'MAX' },
    { key: 'min', header: 'MIN' },
    { key: 'fec', header: 'FEC' },
];

const DEFAULT_SYNC_INTERVAL_MINUTES = 5;
const STATUS_POLL_MAX_MS = 30000;
const STATUS_POLL_MIN_MS = 10000;
const DEFAULT_API_BASE_URL = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : 'http://localhost:3001';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '');

type ApiAgriPayload = Partial<{
    sojaGrao: SojaData[];
    fareloSoja: SojaData[];
    oleoSoja: SojaData[];
    soja: SojaData[];
    farelo: SojaData[];
    oleo: SojaData[];
}>;

const toArray = <T,>(value: unknown): T[] => Array.isArray(value) ? (value as T[]) : [];

const normalizeFinanceiroData = (data: unknown): FinanceiroData[] => {
    return toArray<FinanceiroData>(data);
};

function normalizeAgricolaData(data: unknown): {
    sojaGrao: SojaData[];
    fareloSoja: SojaData[];
    oleoSoja: SojaData[];
} {
    const payload = data && typeof data === 'object' ? (data as ApiAgriPayload) : {};

    return {
        sojaGrao: toArray<SojaData>(payload.sojaGrao ?? payload.soja),
        fareloSoja: toArray<SojaData>(payload.fareloSoja ?? payload.farelo),
        oleoSoja: toArray<SojaData>(payload.oleoSoja ?? payload.oleo)
    };
}

const commoditySections = [
    {
        key: 'sojaGrao',
        dashboardTitle: 'SOJA GRÃO (ZS)',
        tableTitle: 'SOJA GRÃO (ZS)',
        chartTitle: 'CURVA FUTURA - SOJA GRÃO (ZS)'
    },
    {
        key: 'fareloSoja',
        dashboardTitle: 'FARELO DE SOJA (ZM)',
        tableTitle: 'FARELO DE SOJA (ZM)',
        chartTitle: 'CURVA FUTURA - FARELO DE SOJA (ZM)'
    },
    {
        key: 'oleoSoja',
        dashboardTitle: 'ÓLEO DE SOJA (ZL)',
        tableTitle: 'ÓLEO DE SOJA (ZL)',
        chartTitle: 'CURVA FUTURA - ÓLEO DE SOJA (ZL)'
    }
] as const;

export function Dashboard() {
    const [agricolaData, setAgricolaData] = useState<{
        sojaGrao: SojaData[];
        fareloSoja: SojaData[];
        oleoSoja: SojaData[];
    }>({
        sojaGrao: [],
        fareloSoja: [],
        oleoSoja: []
    });

    const [financeiroData, setFinanceiroData] = useState<FinanceiroData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
    const [syncIntervalMinutes, setSyncIntervalMinutes] = useState<number>(DEFAULT_SYNC_INTERVAL_MINUTES);
    const isFetchingRef = useRef(false);
    const lastSeenSnapshotIsoRef = useRef<string | null>(null);

    const fetchStatus = useCallback(async (): Promise<BackendStatus> => {
        const statusRes = await fetch(`${API_BASE_URL}/api/status`);

        if (!statusRes.ok) {
            throw new Error('Failed to fetch status');
        }

        return statusRes.json();
    }, []);

    const fetchData = useCallback(async () => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;

        try {
            const [agriRes, finRes, statusRes] = await Promise.all([
                fetch(`${API_BASE_URL}/api/agricola`),
                fetch(`${API_BASE_URL}/api/financeiro`),
                fetchStatus()
            ]);

            if (!agriRes.ok || !finRes.ok) {
                throw new Error('Failed to fetch data');
            }

            const agriData = await agriRes.json();
            const finData = await finRes.json();
            const statusData = statusRes;
            const latestSnapshotIso = statusData.lastUpdated || null;

            setAgricolaData(normalizeAgricolaData(agriData));
            setFinanceiroData(normalizeFinanceiroData(finData));
            setLastSyncAt(statusData.lastUpdated ? new Date(statusData.lastUpdated) : null);
            lastSeenSnapshotIsoRef.current = latestSnapshotIso;
            setSyncIntervalMinutes(
                Number.isFinite(statusData.syncIntervalMinutes) && statusData.syncIntervalMinutes > 0
                    ? statusData.syncIntervalMinutes
                    : DEFAULT_SYNC_INTERVAL_MINUTES
            );
            setError(null);
        } catch (err) {
            console.error(err);
            setError('Falha ao carregar os dados. Verifique se o backend está rodando.');
        } finally {
            isFetchingRef.current = false;
            setLoading(false);
        }
    }, [fetchStatus]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        const interval = setInterval(fetchData, syncIntervalMinutes * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchData, syncIntervalMinutes]);

    useEffect(() => {
        const pollMs = Math.max(
            STATUS_POLL_MIN_MS,
            Math.min(syncIntervalMinutes * 60 * 1000, STATUS_POLL_MAX_MS)
        );

        const checkForNewSnapshot = async () => {
            try {
                const statusData = await fetchStatus();
                const latestSnapshotIso = statusData.lastUpdated || null;

                setLastSyncAt(statusData.lastUpdated ? new Date(statusData.lastUpdated) : null);
                setSyncIntervalMinutes(
                    Number.isFinite(statusData.syncIntervalMinutes) && statusData.syncIntervalMinutes > 0
                        ? statusData.syncIntervalMinutes
                        : DEFAULT_SYNC_INTERVAL_MINUTES
                );

                if (
                    latestSnapshotIso
                    && latestSnapshotIso !== lastSeenSnapshotIsoRef.current
                ) {
                    await fetchData();
                }
            } catch (err) {
                console.error(err);
            }
        };

        const interval = setInterval(checkForNewSnapshot, pollMs);
        return () => clearInterval(interval);
    }, [fetchData, fetchStatus, syncIntervalMinutes]);

    if (loading) {
        return (
            <div className="container mx-auto p-4 md:p-8 max-w-5xl flex items-center justify-center min-h-[50vh]">
                <div className="text-[#64ffda] text-xl animate-pulse">Carregando dados em tempo real...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container mx-auto p-4 md:p-8 max-w-5xl">
                <div className="bg-red-900/50 border border-red-500 text-red-200 p-4 rounded text-center">
                    {error}
                </div>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4 md:p-8 max-w-5xl">
            <header className="mb-8 border-b-2 border-[#1e2d4a] pb-4">
                <h1 className="text-3xl font-extrabold text-[#64ffda]">Mercado Agrícola & Financeiro</h1>
                <p className="text-gray-400 mt-2">Acompanhamento contínuo de commodities e indicadores globais.</p>
                <div className="mt-3 text-sm text-gray-400 flex flex-col sm:flex-row sm:items-center sm:gap-6">
                    <span>
                        Última sincronização:{' '}
                        <strong className="text-gray-200 font-semibold">
                            {lastSyncAt ? lastSyncAt.toLocaleString('pt-BR') : 'N/A'}
                        </strong>
                    </span>
                    <span>
                        Intervalo de sincronização:{' '}
                        <strong className="text-gray-200 font-semibold">{syncIntervalMinutes} minutos</strong>
                    </span>
                </div>
            </header>

            <main className="grid grid-cols-1 gap-12">
                {commoditySections.map((section) => (
                    <section key={section.key} className="grid grid-cols-1 gap-4">
                        <h2 className="text-lg md:text-xl font-bold tracking-wider text-[#64ffda]">{section.dashboardTitle}</h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                            <DataTable
                                title={section.tableTitle}
                                data={agricolaData[section.key] ?? []}
                                columns={sojaColumns}
                                highlightColumn="dif"
                                freezeFirstColumn
                            />
                            <div className="w-full h-full min-h-[400px] bg-[#0a192f] rounded-lg shadow-xl overflow-hidden border border-[#1e2d4a] flex flex-col">
                                <div className="bg-[#112240] px-4 py-2 border-b border-[#1e2d4a]">
                                    <h3 className="text-white font-bold text-center text-sm md:text-base tracking-wider uppercase">{section.chartTitle}</h3>
                                </div>
                                <div className="flex-grow p-4">
                                    <ForwardCurveChart data={agricolaData[section.key] ?? []} />
                                </div>
                            </div>
                        </div>
                    </section>
                ))}

                <section className="mt-4">
                    <DataTable
                        title="INDICADORES FINANCEIROS"
                        data={financeiroData}
                        columns={financeiroColumns}
                        highlightColumn="varPerc"
                        freezeFirstColumn
                    />
                </section>
            </main>
        </div>
    );
}

