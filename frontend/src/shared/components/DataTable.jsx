import { Fragment, useState } from 'react';
import { Loader2, Inbox, ChevronRight, ChevronDown } from 'lucide-react';

export default function DataTable({
  columns,
  rows,
  rowKey,
  loading,
  emptyMessage = 'No hay registros para mostrar',
  renderExpanded,
  rowClassName,
}) {
  const [expandidos, setExpandidos] = useState(() => new Set());
  const expandable = !!renderExpanded;

  function toggle(id) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalColumnas = columns.length + (expandable ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-white">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="bg-surface text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {expandable ? <th className="w-8 px-2 py-3" /> : null}
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-3 font-semibold">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading ? (
            <tr>
              <td colSpan={totalColumnas} className="px-4 py-10 text-center text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="animate-spin" size={20} />
                  Cargando...
                </div>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={totalColumnas} className="px-4 py-10 text-center text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <Inbox size={20} />
                  {emptyMessage}
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = row[rowKey];
              const abierto = expandidos.has(id);
              return (
                <Fragment key={id}>
                  <tr
                    onClick={expandable ? () => toggle(id) : undefined}
                    className={`hover:brightness-95 ${expandable ? 'cursor-pointer' : ''} ${
                      rowClassName ? rowClassName(row) : ''
                    }`}
                  >
                    {expandable ? (
                      <td className="px-2 py-3 text-slate-400">
                        {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </td>
                    ) : null}
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-slate-700">
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                  {expandable && abierto ? (
                    <tr className="bg-surface">
                      <td colSpan={totalColumnas} className="px-6 py-4">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
