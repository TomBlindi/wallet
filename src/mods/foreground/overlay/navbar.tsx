import { BrowserError, browser } from "@/libs/browser/browser"
import { Outline } from "@/libs/icons/icons"
import { Results } from "@/libs/results/results"
import { Button } from "@/libs/ui/button"
import { useCallback } from "react"
import { usePathContext } from "../router/path/context"

export function NavBar() {
  const { url } = usePathContext().unwrap()

  const onOpen = useCallback(async () => {
    await BrowserError.tryRun(async () => {
      return await browser.tabs.create({ url: `index.html#${url.pathname}` })
    }).then(Results.logAndAlert)
  }, [url])

  return <div className="w-full po-md border-b border-b-contrast">
    <div className="w-full max-w-[400px] m-auto flex items-center">
      <div className="bg-contrast rounded-xl po-sm grow flex items-center min-w-0">
        <div className="grow whitespace-nowrap overflow-hidden text-ellipsis text-sm">
          <span className="text-contrast">
            {`brume://`}
          </span>
          <span>
            {url.pathname.slice(1)}
          </span>
        </div>
        <div className="w-2" />
        <Button.Base className="text-contrast hovered-or-clicked-or-focused:scale-105 !transition"
          onClick={onOpen}>
          <div className={`${Button.Shrinker.className}`}>
            <Outline.ArrowTopRightOnSquareIcon className="size-4" />
          </div>
        </Button.Base>
      </div>
    </div>
  </div>
}