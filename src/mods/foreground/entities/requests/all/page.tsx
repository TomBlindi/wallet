/* eslint-disable @next/next/no-img-element */
import { Outline } from "@/libs/icons/icons"
import { useAsyncUniqueCallback } from "@/libs/react/callback"
import { OkProps } from "@/libs/react/props/promise"
import { Results } from "@/libs/results/results"
import { Button } from "@/libs/ui/button"
import { ImageWithFallback } from "@/libs/ui/image/image_with_fallback"
import { PageBody, UserPageHeader } from "@/libs/ui2/page/header"
import { Page } from "@/libs/ui2/page/page"
import { qurl } from "@/libs/url/url"
import { BlobbyData } from "@/mods/background/service_worker/entities/blobbys/data"
import { AppRequest } from "@/mods/background/service_worker/entities/requests/data"
import { useBackgroundContext } from "@/mods/foreground/background/context"
import { UserRejectedError } from "@/mods/foreground/errors/errors"
import { Paths } from "@/mods/foreground/router/path/context"
import { RpcErr } from "@hazae41/jsonrpc"
import { Nullable } from "@hazae41/option"
import { Err, Ok, Result } from "@hazae41/result"
import { useCallback, useEffect, useState } from "react"
import { useBlobby } from "../../blobbys/data"
import { useOrigin } from "../../origins/data"
import { useAppRequest, useAppRequests } from "../data"

export function RequestsPage() {
  const background = useBackgroundContext().unwrap()

  const requestsQuery = useAppRequests()
  const maybeRequests = requestsQuery.data?.get()

  const tryRejectAll = useAsyncUniqueCallback(async () => {
    return await Result.unthrow<Result<void, Error>>(async t => {
      if (maybeRequests == null)
        return Ok.void()
      if (!confirm(`Do you want to reject all requests?`))
        return Ok.void()

      for (const { id } of maybeRequests)
        await background.tryRequest({
          method: "brume_respond",
          params: [RpcErr.rewrap(id, new Err(new UserRejectedError()))]
        }).then(r => r.throw(t).throw(t))

      return Ok.void()
    }).then(Results.logAndAlert)
  }, [background, maybeRequests])

  const Body =
    <PageBody>
      <div className="flex flex-col gap-2">
        {maybeRequests?.map(request =>
          <RequestRow
            key={request.id}
            request={request} />)}
      </div>
    </PageBody>

  const Header = <>
    <UserPageHeader title="Requests">
      <Button.Base className="size-8 hovered-or-clicked-or-focused:scale-105 !transition"
        disabled={tryRejectAll.loading || !Boolean(maybeRequests?.length)}
        onClick={tryRejectAll.run}>
        <div className={`${Button.Shrinker.className}`}>
          <Outline.TrashIcon className="size-5" />
        </div>
      </Button.Base>
    </UserPageHeader>
    <div className="po-md flex items-center">
      <div className="text-contrast">
        {`Request allow you to approve various actions such as transactions and signatures. These requests are sent by applications through sessions.`}
      </div>
    </div>
  </>

  return <Page>
    {Header}
    {Body}
  </Page>
}

export function RequestRow(props: { request: AppRequest }) {
  const requestQuery = useAppRequest(props.request.id)
  const maybeRequestData = requestQuery.data?.get()

  const originQuery = useOrigin(maybeRequestData?.origin)
  const maybeOriginData = originQuery.data?.get()

  const [iconDatas, setIconDatas] = useState<Nullable<BlobbyData>[]>([])

  const onIconData = useCallback(([index, data]: [number, Nullable<BlobbyData>]) => {
    setIconDatas(iconDatas => {
      iconDatas[index] = data
      return [...iconDatas]
    })
  }, [])

  const open = useCallback(async () => {
    if (maybeRequestData == null)
      return

    const { id, method, params } = maybeRequestData
    Paths.go(qurl(`/${method}?id=${id}`, params))
  }, [maybeRequestData])

  if (maybeOriginData == null)
    return null

  return <div role="button" className="po-md rounded-xl flex items-center gap-4"
    onClick={open}>
    {maybeOriginData.icons?.map((x, i) =>
      <IndexedBlobbyLoader
        key={x.id}
        index={i}
        id={x.id}
        ok={onIconData} />)}
    <div className="shrink-0">
      <ImageWithFallback className="size-10"
        alt="icon"
        src={iconDatas.find(Boolean)?.data}>
        <Outline.CubeTransparentIcon className="size-10" />
      </ImageWithFallback>
    </div>
    <div className="grow">
      <div className="font-medium">
        {maybeOriginData.title}
      </div>
      <div className="text-contrast">
        {maybeOriginData.origin}
      </div>
    </div>
  </div>
}

function IndexedBlobbyLoader(props: OkProps<[number, Nullable<BlobbyData>]> & { id: string, index: number }) {
  const { index, id, ok } = props

  const { data } = useBlobby(id)

  useEffect(() => {
    ok([index, data?.inner])
  }, [index, data, ok])

  return null
}