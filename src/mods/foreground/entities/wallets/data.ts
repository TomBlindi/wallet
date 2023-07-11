import { BigInts, Fixed, FixedInit } from "@/libs/bigints/bigints"
import { EthereumChain, PairInfo } from "@/libs/ethereum/chain"
import { useObjectMemo } from "@/libs/react/memo"
import { RpcRequestPreinit, RpcResponse } from "@/libs/rpc"
import { WebAuthnStorage } from "@/libs/webauthn/webauthn"
import { EthereumQueryKey, EthereumWalletData, Wallet, WalletData } from "@/mods/background/service_worker/entities/wallets/data"
import { Bytes } from "@hazae41/bytes"
import { Optional } from "@hazae41/option"
import { Ok, Result } from "@hazae41/result"
import { Core, Data, FetchError, Fetched, FetcherMore, createQuerySchema, useCore, useError, useFallback, useFetch, useOnce, useQuery, useVisible } from "@hazae41/xswr"
import { ContractRunner, TransactionRequest } from "ethers"
import { useEffect, useMemo } from "react"
import { Background } from "../../background/background"
import { useBackground } from "../../background/context"
import { useUserStorage } from "../../storage/context"
import { UserStorage, useSubscribe } from "../../storage/storage"
import { useCurrentUser } from "../users/context"
import { User } from "../users/data"

export interface WalletProps {
  wallet: Wallet
}

export function getWallet(uuid: Optional<string>, background: Background) {
  if (uuid == null)
    return undefined

  const fetcher = async <T>(init: RpcRequestPreinit<unknown>, more: FetcherMore = {}) =>
    await background.tryRequest<T>(init).then(r => r.mapSync(x => Fetched.rewrap(x)).mapErrSync(FetchError.from))

  return createQuerySchema<RpcRequestPreinit<unknown>, WalletData, Error>({
    key: {
      method: "brume_getWallet",
      params: [uuid]
    },
    fetcher
  })
}

export function useWallet(uuid: Optional<string>, background: Background) {
  const query = useQuery(getWallet, [uuid, background])
  useOnce(query)
  return query
}

export namespace Wallets {

  export async function tryGetPrivateKey(wallet: EthereumWalletData, background: Background): Promise<Result<string, Error>> {
    return await Result.unthrow(async t => {
      if (wallet.type === "privateKey")
        return new Ok(wallet.privateKey)

      const { idBase64, ivBase64 } = wallet.privateKey

      const id = Bytes.fromBase64(idBase64)
      const cipher = await WebAuthnStorage.get(id).then(r => r.throw(t))
      const cipherBase64 = Bytes.toBase64(cipher)

      const plainBase64 = await background.tryRequest<string>({
        method: "brume_decrypt",
        params: [ivBase64, cipherBase64]
      }).then(r => r.throw(t).throw(t))

      const plain = Bytes.fromBase64(plainBase64)

      return new Ok(`0x${Bytes.toHex(plain)}`)
    })
  }

}

export interface EthereumContext {
  core: Core,
  user: User,
  background: Background
  wallet: Wallet,
  chain: EthereumChain,
}

export interface GeneralContext {
  core: Core,
  user: User,
  background: Background
}

export interface EthereumContextProps {
  context: EthereumContext
}

export function useGeneralContext() {
  const core = useCore().unwrap()
  const user = useCurrentUser()
  const background = useBackground()
  return useObjectMemo({ core, user, background })
}

export function useEthereumContext2(wallet: Optional<Wallet>, chain: Optional<EthereumChain>) {
  const core = useCore().unwrap()
  const user = useCurrentUser()
  const background = useBackground()

  return useMemo(() => {
    if (wallet == null)
      return
    if (chain == null)
      return
    return { core, user, background, wallet, chain }
  }, [core, user, background, wallet, chain])
}

export function useEthereumContext(wallet: Wallet, chain: EthereumChain): EthereumContext {
  const core = useCore().unwrap()
  const user = useCurrentUser()
  const background = useBackground()

  return useObjectMemo({ core, user, background, wallet, chain })
}

export async function tryFetch<T>(request: RpcRequestPreinit<unknown>, ethereum: EthereumContext): Promise<Result<Fetched<T, Error>, FetchError>> {
  const { background, wallet, chain } = ethereum

  const response = await background.tryRequest<T>({
    method: "brume_eth_fetch",
    params: [wallet.uuid, chain.chainId, request]
  })

  return response
    .mapSync(x => Fetched.rewrap(x))
    .mapErrSync(FetchError.from)
}

export async function tryIndex<T>(request: RpcRequestPreinit<unknown>, ethereum: EthereumContext): Promise<Result<RpcResponse<T>, Error>> {
  const { background, wallet, chain } = ethereum

  return await background.tryRequest<T>({
    method: "brume_eth_index",
    params: [wallet.uuid, chain.chainId, request]
  })
}

export function getTotalPricedBalance(context: GeneralContext, coin: "usd", storage: UserStorage) {
  return createQuerySchema<string, FixedInit, Error>({ key: `totalPricedBalance/${context.user.uuid}/${coin}`, storage })
}

export function useTotalPricedBalance(coin: "usd") {
  const context = useGeneralContext()
  const storage = useUserStorage().unwrap()
  const query = useQuery(getTotalPricedBalance, [context, coin, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  useFallback(query, () => new Data(new Fixed(0n, 0)))
  return query
}

export function getTotalWalletPricedBalance(context: GeneralContext, address: string, coin: "usd", storage: UserStorage) {
  return createQuerySchema<string, FixedInit, Error>({ key: `totalPricedBalance/${address}/${coin}`, storage })
}

export function useTotalWalletPricedBalance(address: string, coin: "usd") {
  const context = useGeneralContext()
  const storage = useUserStorage().unwrap()
  const query = useQuery(getTotalWalletPricedBalance, [context, address, coin, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}

export function getPricedBalance(context: EthereumContext, address: string, coin: "usd", storage: UserStorage) {
  return createQuerySchema<string, FixedInit, Error>({ key: `pricedBalance/${address}/${context.chain.chainId}/${coin}`, storage })
}

export function usePricedBalance(context: EthereumContext, address: string, coin: "usd") {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getPricedBalance, [context, address, coin, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}

export function getPendingBalance(address: string, context: EthereumContext, storage: UserStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>, more: FetcherMore = {}) =>
    await tryFetch<FixedInit>(request, context)

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      version: 2,
      chainId: context.chain.chainId,
      method: "eth_getBalance",
      params: [address, "pending"]
    },
    fetcher,
    storage
  })
}

export function usePendingBalance(address: string, context: EthereumContext, ...prices: Optional<Data<FixedInit>>[]) {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getPendingBalance, [address, context, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)

  useEffect(() => {
    tryIndex(query.key, context)
      .then(r => r.ignore())
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...prices])

  return query
}

export function getNonceSchema(address: Optional<string>, context: Optional<EthereumContext>, storage: UserStorage) {
  if (address == null)
    return undefined
  if (context == null)
    return undefined

  const fetcher = async (request: RpcRequestPreinit<unknown>, more: FetcherMore = {}) =>
    await tryFetch<string>(request, context).then(r => r.mapSync(r => r.mapSync(BigInt)))

  return createQuerySchema<EthereumQueryKey<unknown>, bigint, Error>({
    key: {
      chainId: context.chain.chainId,
      method: "eth_getTransactionCount",
      params: [address, "pending"]
    },
    fetcher,
    storage,
    dataSerializer: BigInts
  })
}

export function useNonce(address: Optional<string>, context: Optional<EthereumContext>) {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getNonceSchema, [address, context, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}

export function getGasPriceSchema(context: Optional<EthereumContext>, storage: UserStorage) {
  if (context == null)
    return undefined

  const fetcher = async (request: RpcRequestPreinit<unknown>) =>
    await tryFetch<string>(request, context).then(r => r.mapSync(r => r.mapSync(BigInt)))

  return createQuerySchema<EthereumQueryKey<unknown>, bigint, Error>({
    key: {
      chainId: context.chain.chainId,
      method: "eth_gasPrice",
      params: []
    },
    fetcher,
    storage,
    dataSerializer: BigInts
  })
}

export function useGasPrice(ethereum: Optional<EthereumContext>) {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getGasPriceSchema, [ethereum, storage])
  useFetch(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}

export class BrumeProvider implements ContractRunner {
  provider = null

  constructor(
    readonly ethereum: EthereumContext
  ) { }

  async call(tx: TransactionRequest) {
    return await tryFetch<string>({
      method: "eth_call",
      params: [{
        to: tx.to,
        data: tx.data
      }, "pending"]
    }, this.ethereum).then(r => r.unwrap().unwrap())
  }

}

export function getPairPrice(context: EthereumContext, pair: PairInfo, storage: UserStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>, more: FetcherMore = {}) =>
    await tryFetch<FixedInit>(request, context)

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      method: "eth_getPairPrice",
      params: [pair.address]
    },
    fetcher,
    storage
  })
}

export function usePairPrice(ethereum: EthereumContext, pair: PairInfo) {
  const storage = useUserStorage().unwrap()
  const query = useQuery(getPairPrice, [ethereum, pair, storage])
  useFetch(query)
  useVisible(query)
  useSubscribe(query, storage)
  useError(query, console.error)
  return query
}
