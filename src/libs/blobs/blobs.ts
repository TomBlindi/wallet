import { Future } from "@hazae41/future"
import { Result } from "@hazae41/result"

export namespace Blobs {

  export async function tryReadAsDataUrl(blob: Blob) {
    return Result.runAndDoubleWrap(() => readAsDataUrlOrThrow(blob))
  }

  export async function readAsDataUrlOrThrow(blob: Blob) {
    const future = new Future<string>()
    const reader = new FileReader()

    const onLoad = () => {
      future.resolve(reader.result as string)
    }

    const onError = () => {
      future.reject(reader.error)
    }

    try {
      reader.addEventListener("load", onLoad, { passive: true })
      reader.addEventListener("error", onError, { passive: true })

      reader.readAsDataURL(blob)

      return await future.promise
    } finally {
      reader.removeEventListener("load", onLoad)
      reader.removeEventListener("error", onError)
    }
  }

}