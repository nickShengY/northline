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
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--accent-cyan)] border-t-transparent rounded-full" />
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
                onClick={() => onRowClick?.(row)}
                className={clsx(
                  'border-b border-[var(--border-default)] last:border-b-0 transition-colors',
                  striped && rowIndex % 2 === 1 && 'bg-[var(--bg-secondary)]/30',
                  hoverable && 'hover:bg-[var(--bg-glass)] cursor-pointer',
                  isSelected && 'bg-[var(--accent-cyan)]/10',
                  onRowClick && 'cursor-pointer'
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
  const totalPages = totalItems ? Math.ceil(totalItems / pageSize) : 1;

  return (
    <div className="space-y-4">
      <Table {...tableProps} />

      {totalItems && totalPages > 1 && (
        <div className="flex items-center justify-between px-4">
          <span className="text-sm text-[var(--ink-muted)]">
            Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalItems)} of {totalItems}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange?.(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-3 py-1 rounded-[var(--radius-md)] text-sm bg-[var(--bg-glass)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--bg-elevated)]"
            >
              Previous
            </button>
            <span className="text-sm text-[var(--ink-secondary)]">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange?.(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1 rounded-[var(--radius-md)] text-sm bg-[var(--bg-glass)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--bg-elevated)]"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Table;
