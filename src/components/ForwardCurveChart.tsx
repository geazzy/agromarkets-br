
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

interface ForwardCurveChartProps {
    data?: { contrato: string; ult: string; ultRaw?: number | null }[];
}

export function ForwardCurveChart({ data }: ForwardCurveChartProps) {
    const safeData = Array.isArray(data) ? data : [];

    // Parse values for the chart
    const chartData = safeData.map(item => {
        let price = typeof item.ultRaw === 'number' ? item.ultRaw : 0;
        if (price === 0 && item.ult && item.ult !== '-') {
            // Convert localized string "1.153,75" to number 1153.75
            // Convert "59,34" to 59.34
            const cleanStr = item.ult.replace(/\./g, '').replace(',', '.');
            price = parseFloat(cleanStr);
        }

        // Extract just the month/year for the X axis, e.g. "Mar/26" or "Mar (Atual)"
        let label = item.contrato;
        if (label.includes('(Atual)')) {
            label = label.replace(' (Atual)', '');
        } else if (label.includes('(+18m)')) {
            label = label.replace(' (+18m)', '');
        }

        return {
            name: label,
            price: price,
            original: item
        };
    });

    if (chartData.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500">Sem dados para a curva</div>;
    }

    // Calculate min/max for Y axis scale based on parsed prices
    const prices = chartData.map(d => d.price).filter(p => !isNaN(p) && p > 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 100;

    // Add a bit of padding to the domain
    const padding = (maxPrice - minPrice) * 0.1 || 1;
    const domain = [Math.max(0, minPrice - padding), maxPrice + padding];

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d4a" vertical={false} />
                <XAxis
                    dataKey="name"
                    stroke="#8892b0"
                    tick={{ fill: '#8892b0', fontSize: 12 }}
                    tickMargin={15}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                />
                <YAxis
                    domain={domain}
                    stroke="#8892b0"
                    tick={{ fill: '#8892b0', fontSize: 12 }}
                    tickFormatter={(val) => val.toFixed(0)}
                    width={50}
                />
                <Tooltip
                    contentStyle={{ backgroundColor: '#112240', borderColor: '#1e2d4a', color: '#e6f1ff', borderRadius: '4px' }}
                    itemStyle={{ color: '#64ffda' }}
                    formatter={(value: unknown) => [`${Number(value).toFixed(2)}`, "Cotação"]}
                    labelStyle={{ color: '#8892b0', marginBottom: '8px', fontWeight: 'bold' }}
                />
                <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#64ffda"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#0a192f', stroke: '#64ffda', strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: '#64ffda', stroke: '#fff', strokeWidth: 2 }}
                    animationDuration={1500}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}
