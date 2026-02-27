import { useWindow } from '../hooks/useWindow'

const WindowControls = () => {
  const { minimize, close } = useWindow()

  return (
    <div className="absolute top-1.5 right-1.5 z-[9999] flex flex-row gap-1 [-webkit-app-region:no-drag]">
      <button
        type="button"
        className="flex items-center justify-center w-[23px] h-4 m-0 p-0 rounded-sm text-[9px] leading-none cursor-pointer [-webkit-app-region:no-drag] bg-[rgba(8,12,20,0.28)] text-text-secondary font-serif border border-[rgba(245,251,255,0.8)] transition-[background,color] duration-[160ms] ease-in-out hover:bg-[rgba(245,251,255,0.9)] hover:text-[rgba(15,20,32,0.95)]"
        onClick={minimize}
        aria-label="Minimize"
      >
        &#x2014;
      </button>
      <button
        type="button"
        className="flex items-center justify-center w-[23px] h-4 m-0 p-0 rounded-sm text-[9px] leading-none cursor-pointer [-webkit-app-region:no-drag] bg-[rgba(8,12,20,0.28)] text-text-secondary font-serif border border-[rgba(245,251,255,0.8)] transition-[background,color] duration-[160ms] ease-in-out hover:bg-[rgba(220,50,50,0.9)] hover:text-white"
        onClick={close}
        aria-label="Close"
      >
        &#x2715;
      </button>
    </div>
  )
}

export default WindowControls
