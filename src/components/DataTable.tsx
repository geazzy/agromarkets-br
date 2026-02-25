import React from 'react';
import classNames from 'classnames';

export interface ColumnDef<T> {
    key: keyof T | string;
    header: string;
    render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
    title: string;
    data: T[];
    columns: ColumnDef<T>[];
    highlightColumn?: string; // Coluna para destacar vermelho/verde
    freezeFirstColumn?: boolean;
}

export function DataTable<T>({ title, data, columns, highlightColumn, freezeFirstColumn = false }: DataTableProps<T>) {
    return (
        <div className="w-full mb-6 bg-[#0a192f] rounded-lg shadow-xl overflow-hidden border border-[#1e2d4a]">
            <div className="bg-[#112240] px-4 py-2 border-b border-[#1e2d4a]">
                <h3 className="text-white font-bold text-center text-sm md:text-base tracking-wider uppercase">{title}</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left rtl:text-right text-gray-300">
                    <thead className="text-xs text-gray-400 bg-[#0f1d35] border-b border-[#1e2d4a]">
                        <tr>
                            {columns.map((col, colIndex) => (
                                <th
                                    key={String(col.key)}
                                    className={classNames(
                                        "px-4 py-3 font-semibold text-center whitespace-nowrap",
                                        freezeFirstColumn && colIndex === 0 && "sticky left-0 z-30 bg-[#0f1d35] border-r border-[#1e2d4a]"
                                    )}
                                >
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, rowIndex) => (
                            <tr
                                key={rowIndex}
                                className={classNames(
                                    "border-b border-[#1e2d4a] hover:bg-[#1a2d50] transition-colors group",
                                    rowIndex % 2 === 0 ? "bg-[#0a192f]" : "bg-[#0d1f38]"
                                )}
                            >
                                {columns.map((col, colIndex) => {
                                    const rowRecord = row as Record<string, unknown>;
                                    const val = String(row[col.key as keyof T] ?? '');
                                    const rawKey = `${String(col.key)}Raw`;
                                    const rawValue = rowRecord[rawKey];
                                    const numVal = typeof rawValue === 'number'
                                        ? rawValue
                                        : parseFloat(val.replace(',', '.'));
                                    const isHighlighted = highlightColumn === col.key;
                                    let colorClass = "text-center";
                                    const rowBgClass = rowIndex % 2 === 0 ? "bg-[#0a192f]" : "bg-[#0d1f38]";

                                    if (isHighlighted && !isNaN(numVal)) {
                                        if (numVal < 0) {
                                            colorClass += " text-red-500 font-bold";
                                        } else if (numVal > 0) {
                                            colorClass += " text-green-500 font-bold";
                                        } else {
                                            colorClass += " font-bold";
                                        }
                                    }

                                    return (
                                        <td
                                            key={String(col.key)}
                                            className={classNames(
                                                `px-4 py-2 whitespace-nowrap ${colorClass}`,
                                                freezeFirstColumn && colIndex === 0 && `sticky left-0 z-20 ${rowBgClass} border-r border-[#1e2d4a]`
                                            )}
                                        >
                                            {col.render ? col.render(row) : val}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
