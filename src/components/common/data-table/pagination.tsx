import { type Table } from '@tanstack/react-table'
import { getPageNumbers } from '@/lib/utils'
import { Button } from '@/components/youtube-ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/youtube-ui/select'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

type DataTablePaginationProps<TData> = {
  table: Table<TData>
  pageSizeOptions?: number[]
}

export function DataTablePagination<TData>({ table, pageSizeOptions = [10, 20, 30, 40, 50] }: DataTablePaginationProps<TData>) {
  const currentPage = table.getState().pagination.pageIndex + 1
  const totalPages = Math.max(1, table.getPageCount())
  const pageNumbers = getPageNumbers(currentPage, totalPages)

  return (
    <nav aria-label='Phân trang bảng' className='flex w-full min-w-0 flex-wrap items-center justify-between gap-3 sm:w-auto sm:justify-end'>
      <div className='flex shrink-0 items-center gap-2'>
        <span className='hidden text-sm text-muted-foreground lg:inline'>Dòng/trang</span>
        <Select value={`${table.getState().pagination.pageSize}`} onValueChange={value => table.setPageSize(Number(value))}>
          <SelectTrigger aria-label='Số dòng mỗi trang' className='h-8 w-[70px]'>
            <SelectValue placeholder={table.getState().pagination.pageSize} />
          </SelectTrigger>
          <SelectContent side='top'>
            {pageSizeOptions.map(pageSize => <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className='flex min-w-0 items-center gap-1 sm:gap-2'>
        <Button variant='outline' className='hidden size-8 shrink-0 p-0 sm:inline-flex' aria-label='Trang đầu' onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
          <ChevronsLeft className='h-4 w-4' />
        </Button>
        <Button variant='outline' className='size-8 shrink-0 p-0' aria-label='Trang trước' onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          <ChevronLeft className='h-4 w-4' />
        </Button>
        <span className='px-1 text-xs text-muted-foreground whitespace-nowrap sm:hidden'>Trang {currentPage}/{totalPages}</span>
        {pageNumbers.map((pageNumber, index) => (
          <div key={`${pageNumber}-${index}`} className='hidden items-center sm:flex'>
            {pageNumber === '...' ? <span className='text-muted-foreground px-1 text-sm'>...</span> : (
              <Button variant={currentPage === pageNumber ? 'default' : 'outline'} className='h-8 min-w-8 px-2' aria-label={`Trang ${pageNumber}`} aria-current={currentPage === pageNumber ? 'page' : undefined} onClick={() => table.setPageIndex(Number(pageNumber) - 1)}>
                {pageNumber}
              </Button>
            )}
          </div>
        ))}
        <Button variant='outline' className='size-8 shrink-0 p-0' aria-label='Trang sau' onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          <ChevronRight className='h-4 w-4' />
        </Button>
        <Button variant='outline' className='hidden size-8 shrink-0 p-0 sm:inline-flex' aria-label='Trang cuối' onClick={() => table.setPageIndex(totalPages - 1)} disabled={!table.getCanNextPage()}>
          <ChevronsRight className='h-4 w-4' />
        </Button>
      </div>
    </nav>
  )
}
