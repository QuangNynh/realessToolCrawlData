import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type Updater
} from '@tanstack/react-table'
import { useCallback, useMemo } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../youtube-ui/table'
import { DataTablePagination } from './pagination'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  pageSizeOptions?: number[]
  manualPagination?: boolean
  pageCount?: number
  pagination?: PaginationState
  onPaginationChange?: OnChangeFn<PaginationState>
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  getRowId?: (originalRow: TData, index: number, parent?: Row<TData>) => string
  selectedRowIds?: string[] | number[]
  onSelectedRowIdsChange?: (selectedRowIds: string[]) => void
}

export function DataTable<TData, TValue>({
  columns,
  data,
  pageSizeOptions = [10, 20, 30, 40, 50],
  manualPagination = false,
  pageCount,
  pagination,
  onPaginationChange,
  rowSelection: externalRowSelection,
  onRowSelectionChange: externalOnRowSelectionChange,
  getRowId,
  selectedRowIds,
  onSelectedRowIdsChange
}: DataTableProps<TData, TValue>) {
  const rowSelection = useMemo(() => {
    if (selectedRowIds) {
      return selectedRowIds.reduce((acc, id) => ({ ...acc, [id]: true }), {} as RowSelectionState)
    }
    return externalRowSelection
  }, [selectedRowIds, externalRowSelection])

  const onRowSelectionChange = useCallback(
    (updaterOrValue: Updater<RowSelectionState>) => {
      const nextSelection =
        typeof updaterOrValue === 'function' ? updaterOrValue(rowSelection || {}) : updaterOrValue

      if (externalOnRowSelectionChange) {
        externalOnRowSelectionChange(nextSelection)
      }

      if (onSelectedRowIdsChange) {
        const ids = Object.keys(nextSelection).filter((key) => nextSelection[key])
        onSelectedRowIdsChange(ids)
      }
    },
    [rowSelection, externalOnRowSelectionChange, onSelectedRowIdsChange]
  )

  const table = useReactTable({
    data,
    columns,
    pageCount: pageCount,
    state: {
      ...(pagination && { pagination }),
      ...(rowSelection && { rowSelection })
    },
    onPaginationChange: onPaginationChange,
    onRowSelectionChange: onRowSelectionChange,
    manualPagination: manualPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: getRowId
  })

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <Table className='border-b'>
        <TableHeader className='bg-sidebar-primary sticky top-0 z-10 '>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  colSpan={header.colSpan}
                  className='!px-0 !py-3 text-primary'
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className='h-24 text-center'>
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className='flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        {!manualPagination && table.getFilteredSelectedRowModel().rows.length > 0 && (
          <div className='text-sm text-muted-foreground'>
            {`${table.getFilteredSelectedRowModel().rows.length} of ${table.getFilteredRowModel().rows.length} row(s) selected.`}
          </div>
        )}
        <div className='min-w-0 w-full sm:ml-auto sm:w-auto'>
          <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
        </div>
      </div>
    </div>
  )
}
