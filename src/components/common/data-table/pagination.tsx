import { type Table } from '@tanstack/react-table'
import { cn, getPageNumbers } from '@/lib/utils'
import { Button } from '@/components/youtube-ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/youtube-ui/select'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react'
type DataTablePaginationProps<TData> = {
  table: Table<TData>
  pageSizeOptions?: number[]
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 20, 30, 40, 50]
}: DataTablePaginationProps<TData>) {
  const currentPage = table.getState().pagination.pageIndex + 1
  const totalPages = table.getPageCount()
  const pageNumbers = getPageNumbers(currentPage, totalPages)

  return (
    <div
      className={cn(
        'flex items-center justify-between px-2 gap-2',
        'max-2xl:flex-col-reverse max-2xl:gap-4'
      )}
      style={{ overflowClipMargin: 1 }}
    >
      <div className='flex items-center space-x-2'>
        <Button
          variant='outline'
          className='size-8 p-0 max-md:hidden'
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronsLeft className='h-4 w-4' />
        </Button>
        <Button
          variant='outline'
          className='size-8 p-0'
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronLeft className='h-4 w-4' />
        </Button>

        {/* Page number buttons */}
        {pageNumbers.map((pageNumber, index) => (
          <div key={`${pageNumber}-${index}`} className='flex items-center'>
            {pageNumber === '...' ? (
              <span className='text-muted-foreground px-1 text-sm'>...</span>
            ) : (
              <Button
                variant={currentPage === pageNumber ? 'default' : 'outline'}
                className='h-8 min-w-8 px-2'
                onClick={() => table.setPageIndex((pageNumber as number) - 1)}
              >
                <span className='sr-only'>Go to page {pageNumber}</span>
                {pageNumber}
              </Button>
            )}
          </div>
        ))}

        <Button
          variant='outline'
          className='size-8 p-0'
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          <ChevronRight className='h-4 w-4' />
        </Button>
        <Button
          variant='outline'
          className='size-8 p-0 max-md:hidden'
          onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          disabled={!table.getCanNextPage()}
        >
          <ChevronsRight className='h-4 w-4' />
        </Button>
      </div>
      <Select
        value={`${table.getState().pagination.pageSize}`}
        onValueChange={(value) => {
          table.setPageSize(Number(value))
        }}
      >
        <SelectTrigger className='h-8 w-[70px]'>
          <SelectValue placeholder={table.getState().pagination.pageSize} />
        </SelectTrigger>
        <SelectContent side='top'>
          {pageSizeOptions.map((pageSize) => (
            <SelectItem key={pageSize} value={`${pageSize}`}>
              {pageSize}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
