import { useState, useEffect } from 'react';
import { DataTable } from './DataTable';
import { ForwardCurveChart } from './ForwardCurveChart';
import type { ColumnDef } from './DataTable';

// Tipos para os dados
interface SojaData {
    contrato: string;
    ult: string;
    max: string;
    min: string;
    fec: string;
    abe: string;
    dif: string;
}

interface FinanceiroData {
    indice: string;
    ult: string;
    varPerc: string;
    max: string;
    min: string;
    fec: string;
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

    const fetchData = async () => {
        try {
            const [agriRes, finRes] = await Promise.all([
                fetch('http://localhost:3001/api/agricola'),
                fetch('http://localhost:3001/api/financeiro')
            ]);

            if (!agriRes.ok || !finRes.ok) {
                throw new Error('Failed to fetch data');
            }

            const agriData = await agriRes.json();
            const finData = await finRes.json();

            setAgricolaData(agriData);
            setFinanceiroData(finData);
            setError(null);
        } catch (err) {
            console.error(err);
            setError('Falha ao carregar os dados. Verifique se o backend está rodando.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // Polling a cada 5 minutos
        const interval = setInterval(fetchData, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

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
            </header>

            <main className="grid grid-cols-1 gap-12">
                {/* SOJA GRÃO */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    <DataTable
                        title="SOJA GRÃO"
                        data={agricolaData.sojaGrao}
                        columns={sojaColumns}
                        highlightColumn="dif"
                    />
                    <div className="w-full h-full min-h-[400px] bg-[#0a192f] rounded-lg shadow-xl overflow-hidden border border-[#1e2d4a] flex flex-col">
                        <div className="bg-[#112240] px-4 py-2 border-b border-[#1e2d4a]">
                            <h3 className="text-white font-bold text-center text-sm md:text-base tracking-wider uppercase">CURVA FUTURA - SOJA GRÃO</h3>
                        </div>
                        <div className="flex-grow p-4">
                            <ForwardCurveChart data={agricolaData.sojaGrao} />
                        </div>
                    </div>
                </section>

                {/* FARELO DE SOJA */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    <DataTable
                        title="FARELO DE SOJA"
                        data={agricolaData.fareloSoja}
                        columns={sojaColumns}
                        highlightColumn="dif"
                    />
                    <div className="w-full h-full min-h-[400px] bg-[#0a192f] rounded-lg shadow-xl overflow-hidden border border-[#1e2d4a] flex flex-col">
                        <div className="bg-[#112240] px-4 py-2 border-b border-[#1e2d4a]">
                            <h3 className="text-white font-bold text-center text-sm md:text-base tracking-wider uppercase">CURVA FUTURA - FARELO DE SOJA</h3>
                        </div>
                        <div className="flex-grow p-4">
                            <ForwardCurveChart data={agricolaData.fareloSoja} />
                        </div>
                    </div>
                </section>

                {/* ÓLEO DE SOJA */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    <DataTable
                        title="ÓLEO DE SOJA"
                        data={agricolaData.oleoSoja}
                        columns={sojaColumns}
                        highlightColumn="dif"
                    />
                    <div className="w-full h-full min-h-[400px] bg-[#0a192f] rounded-lg shadow-xl overflow-hidden border border-[#1e2d4a] flex flex-col">
                        <div className="bg-[#112240] px-4 py-2 border-b border-[#1e2d4a]">
                            <h3 className="text-white font-bold text-center text-sm md:text-base tracking-wider uppercase">CURVA FUTURA - ÓLEO DE SOJA</h3>
                        </div>
                        <div className="flex-grow p-4">
                            <ForwardCurveChart data={agricolaData.oleoSoja} />
                        </div>
                    </div>
                </section>

                <section className="mt-4">
                    <DataTable
                        title="INDICADORES FINANCEIROS"
                        data={financeiroData}
                        columns={financeiroColumns}
                        highlightColumn="varPerc"
                    />
                </section>
            </main>
        </div>
    );
}

