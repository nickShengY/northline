import React from 'react';
import { clsx } from 'clsx';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (value: T[keyof T], row: T, index: number) => React.ReactNode;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: keyof T | ((row: T) => string);
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  striped?: boolean;
  hoverable?: boolean;
}

const sizeClasses: Record<string, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

const cellPadding: Record<string, string> = {
  sm: 'px-3 py-2',
  md: 'px-4 py-3',
  lg: 'px-5 py-4',
};

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  onRowClick,
  selectedKey,
  loading = false,
  emptyMessage = 'No data available',
  className,
  size = 'md',
  striped = false,
  hoverable = true,
}: TableProps<T>) {
  const getRowKey = (row: T): string => {
    if (typeof rowKey === 'function') {
      return rowKey(row);
    }
    return String(row[rowKey]);
  };

  const getCellValue = (row: T, key: keyof T | string): unknown => {
    if (typeof key === 'string' && key.includes('.')) {
      const keys = key.split('.');
      let value: unknown = row;
      for (const k of keys) {
        value = (value as Record<string, unknown>)?.[k];
      }
      return value;
    }
    return row[key as keyof T];
  };

  if (loading) {
    return (
      <div role="status" className="flex items-center justify-center py-12">
        <div aria-hidden="true" className="animate-spin w-8 h-8 border-2 border-[var(--accent-cyan)] border-t-transparent rounded-full" />
        <span className="sr-only">Loading table data</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--ink-muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={clsx('overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border-default)]', className)}>
      <table className={clsx('w-full', sizeClasses[size])}>
        <thead>
          <tr className="bg-[var(--bg-secondary)] border-b border-[var(--border-default)]">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                scope="col"
                className={clsx(
                  cellPadding[size],
                  'font-semibold text-[var(--ink-secondary)] text-left',
                  col.align === 'center' && 'text-center',
                  col.align === 'right' && 'text-right'
                )}
                style={{ width: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => {
            const key = getRowKey(row);
            const isSelected = selectedKey === key;

            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                data-selected={isSelected || undefined}
                className={clsx(
                  'border-b border-[var(--border-default)] last:border-b-0 transition-colors',
                  striped && rowIndex % 2 === 1 && 'bg-[var(--bg-secondary)]/30',
                  hoverable && onRowClick && 'hover:bg-[var(--bg-glass)] cursor-pointer',
                  isSelected && 'bg-[var(--accent-cyan)]/10'
                )}
              >
                {columns.map((col) => {
                  const value = getCellValue(row, col.key);
                  return (
                    <td
                      key={String(col.key)}
                      className={clsx(
                        cellPadding[size],
                        'text-[var(--ink-primary)]',
                        col.align === 'center' && 'text-center',
                        col.align === 'right' && 'text-right'
                      )}
                    >
                      {col.render
                        ? col.render(value as T[keyof T], row, rowIndex)
                        : String(value ?? '-')}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// DataTable with pagination
export interface DataTableProps<T> extends TableProps<T> {
  pageSize?: number;
  currentPage?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
}

export function DataTable<T extends Record<string, unknown>>({
  pageSize = 10,
  currentPage = 1,
  totalItems,
  onPageChange,
  ...tableProps
}: DataTableProps<T>) {
  // When totalItems is provided the caller paginates server-side; otherwise
  // slice the supplied data client-side.
  const effectiveTotal = totalItems ?? tableProps.data.length;
  const totalPages = effectiveTotal > 0 ? Math.ceil(effectiveTotal / pageSize) : 1;
  const pageData =
    totalItems !== undefined
      ? tableProps.data
      : tableProps.data.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-4">
      <Table {...tableProps} data={pageData} />

      {effectiveTotal > 0 && totalPages > 1 && (
        <nav aria-label="Table pagination" className="flex items-center justify-between px-4">
          <span className="text-sm text-[var(--ink-muted)]">
            Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, effectiveTotal)} of {effectiveTotal}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange?.(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-3 py-1 rounded-[var(--radius-md)] text-sm bg-[var(--bg-glass)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--bg-elevated)]"
            >
              Previous
            </button>
            <span aria-live="polite" className="text-sm text-[var(--ink-secondary)]">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => onPageChange?.(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1 rounded-[var(--radius-md)] text-sm bg-[var(--bg-glass)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--bg-elevated)]"
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

export default Table;
