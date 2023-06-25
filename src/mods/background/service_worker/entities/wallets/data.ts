import PairAbi from "@/assets/Pair.json"
import { Fixed, FixedInit } from "@/libs/bigints/bigints"
import { EthereumChain, PairInfo, chains, pairsByAddress, tokensByAddress } from "@/libs/ethereum/chain"
import { RpcRequestPreinit } from "@/libs/rpc"
import { Mutators } from "@/libs/xswr/mutators"
import { Option, Optional } from "@hazae41/option"
import { Cancel, Looped, Retry, tryLoop } from "@hazae41/piscine"
import { Ok, Result } from "@hazae41/result"
import { Data, FetchError, Fetched, FetcherMore, IDBStorage, NormalizerMore, createQuerySchema } from "@hazae41/xswr"
import { Contract, ContractRunner, TransactionRequest } from "ethers"
import { EthereumBrumes, EthereumSocket } from "../sessions/data"
import { User } from "../users/data"

export type Wallet =
  | WalletRef
  | WalletData

export interface WalletProps {
  readonly wallet: Wallet
}

export interface WalletDataProps {
  readonly wallet: WalletData
}

export interface WalletRef {
  readonly ref: true
  readonly uuid: string
}

export type WalletData =
  | EthereumPrivateKeyWallet

export type EthereumWalletData =
  | EthereumPrivateKeyWallet

export interface EthereumPrivateKeyWallet {
  readonly coin: "ethereum"
  readonly type: "privateKey"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly privateKey: string
  readonly address: string
}

export interface BitcoinPrivateKeyWallet {
  readonly coin: "bitcoin"
  readonly type: "privateKey"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly privateKey: string
  readonly compressedAddress: string
  readonly uncompressedAddress: string
}

export function getWallet(uuid: string, storage: IDBStorage) {
  return createQuerySchema<string, WalletData, never>(`wallet/${uuid}`, undefined, { storage })
}

export async function getWalletRef(wallet: Wallet, storage: IDBStorage, more: NormalizerMore) {
  if ("ref" in wallet) return wallet

  const schema = getWallet(wallet.uuid, storage)
  await schema?.normalize(new Data(wallet), more)

  return { ref: true, uuid: wallet.uuid } as WalletRef
}

export type EthereumQueryKey<T> = RpcRequestPreinit<T> & {
  version?: number
  chainId?: number
}

export interface EthereumSession {
  wallet: Wallet
  chain: EthereumChain
}

export function getEthereumSession(origin: string, storage: IDBStorage) {
  return createQuerySchema<string, EthereumSession, never>(`sessions/${origin}`, undefined, { storage })
}

export interface EthereumContext {
  user: User,
  origin: string
  wallet: Wallet
  chain: EthereumChain
  brumes: EthereumBrumes
}

export async function tryFetch<T>(ethereum: EthereumContext, request: RpcRequestPreinit<unknown>, more: FetcherMore = {}) {
  return await tryLoop(async (i) => {
    return await Result.unthrow<Result<Fetched<T, Error>, Looped<Error>>>(async t => {
      const brume = await ethereum.brumes.inner.tryGet(i).then(r => r.mapErrSync(Retry.new).throw(t))
      const socket = Option.wrap(brume.chains[ethereum.chain.chainId]).ok().mapErrSync(Cancel.new).throw(t)
      const response = await EthereumSocket.request<T>(socket, request).then(r => r.mapErrSync(Retry.new).throw(t))

      return new Ok(Fetched.rewrap(response))
    })
  }).then(r => r.mapErrSync(FetchError.from))
}

export function getEthereumUnknown(ethereum: EthereumContext, request: RpcRequestPreinit<unknown>, storage: IDBStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>) =>
    await tryFetch<unknown>(ethereum, request)

  return createQuerySchema<EthereumQueryKey<unknown>, any, Error>({
    chainId: ethereum.chain.chainId,
    method: request.method,
    params: request.params
  }, fetcher, { storage })
}

export function getTotalPricedBalance(user: User, coin: "usd", storage: IDBStorage) {
  return createQuerySchema<string, FixedInit, Error>(`totalPricedBalance/${user.uuid}/${coin}`, undefined, { storage })
}

export function getTotalPricedBalanceByWallet(user: User, coin: "usd", storage: IDBStorage) {
  const normalizer = async (fetched: Optional<Fetched<Record<string, FixedInit>, Error>>, more: NormalizerMore) =>
    await fetched?.map(async index => {
      const total = Object.values(index).reduce<Fixed>((x, y) => Fixed.from(y).add(x), new Fixed(0n, 0))

      const totalBalance = await getTotalPricedBalance(user, coin, storage).make(more.core)
      await totalBalance.mutate(Mutators.data<FixedInit, Error>(total))

      return index
    })

  return createQuerySchema<string, Record<string, FixedInit>, Error>(`totalPricedBalanceByWallet/${user.uuid}/${coin}`, undefined, { normalizer, storage })
}

export function getTotalWalletPricedBalance(user: User, address: string, coin: "usd", storage: IDBStorage) {
  const normalizer = async (fetched: Optional<Fetched<FixedInit, Error>>, more: NormalizerMore) =>
    await fetched?.map(async totalWalletPricedBalance => {
      const key = address
      const value = totalWalletPricedBalance

      const indexQuery = await getTotalPricedBalanceByWallet(user, coin, storage).make(more.core)
      await indexQuery.mutate(Mutators.mapInnerDataOr(p => ({ ...p, [key]: value }), new Data({})))

      return totalWalletPricedBalance
    })

  return createQuerySchema<string, FixedInit, Error>(`totalPricedBalance/${address}/${coin}`, undefined, { normalizer, storage })
}

export function getPricedBalanceByToken(user: User, address: string, coin: "usd", storage: IDBStorage) {
  const normalizer = async (fetched: Optional<Fetched<Record<string, FixedInit>, Error>>, more: NormalizerMore) =>
    await fetched?.map(async index => {
      const total = Object.values(index).reduce<Fixed>((x, y) => Fixed.from(y).add(x), new Fixed(0n, 0))

      const totalBalance = await getTotalWalletPricedBalance(user, address, coin, storage).make(more.core)
      await totalBalance.mutate(Mutators.data<FixedInit, Error>(total))

      return index
    })

  return createQuerySchema<string, Record<string, FixedInit>, Error>(`pricedBalanceByToken/${address}/${coin}`, undefined, { normalizer, storage })
}

export function getPricedEthereumBalance(ethereum: EthereumContext, address: string, coin: "usd", storage: IDBStorage) {
  const normalizer = async (fetched: Optional<Fetched<FixedInit, Error>>, more: NormalizerMore) =>
    await fetched?.map(async pricedBalance => {
      const key = ethereum.chain.chainId
      const value = pricedBalance

      const indexQuery = await getPricedBalanceByToken(ethereum.user, address, coin, storage).make(more.core)
      await indexQuery.mutate(Mutators.mapInnerDataOr(p => ({ ...p, [key]: value }), new Data({})))

      return pricedBalance
    })

  return createQuerySchema<string, FixedInit, Error>(`pricedBalance/${address}/${ethereum.chain.chainId}/${coin}`, undefined, { normalizer, storage })
}

export function getEthereumBalance(ethereum: EthereumContext, address: string, block: string, storage: IDBStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>) =>
    await tryFetch<string>(ethereum, request).then(r => r.mapSync(d => d.mapSync(x => new FixedInit(x, ethereum.chain.token.decimals))))

  const normalizer = async (fetched: Optional<Fetched<FixedInit, Error>>, more: NormalizerMore) =>
    await fetched?.map(async balance => {
      if (block !== "pending")
        return balance
      if (ethereum.chain.token.pairs === undefined)
        return balance

      let pricedBalance: Fixed = Fixed.from(balance)

      for (const pairAddress of ethereum.chain.token.pairs) {
        const pair = pairsByAddress[pairAddress]
        const chain = chains[pair.chainId]

        const price = await getPairPrice({ ...ethereum, chain }, pair, storage).make(more.core)

        if (price.data === undefined)
          return balance

        pricedBalance = pricedBalance.mul(Fixed.from(price.data.inner))
      }

      const pricedBalanceQuery = await getPricedEthereumBalance(ethereum, address, "usd", storage).make(more.core)
      await pricedBalanceQuery.mutate(Mutators.set(new Data(pricedBalance)))

      return balance
    })

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    version: 2,
    chainId: ethereum.chain.chainId,
    method: "eth_getBalance",
    params: [address, block]
  }, fetcher, { normalizer, storage })
}

export class BrumeProvider implements ContractRunner {
  provider = null

  constructor(
    readonly ethereum: EthereumContext
  ) { }

  async call(tx: TransactionRequest) {
    return await tryFetch<string>(this.ethereum, {
      method: "eth_call",
      params: [{
        to: tx.to,
        data: tx.data
      }, "pending"]
    }).then(r => r.unwrap().unwrap())
  }

}

export function getPairPrice(ethereum: EthereumContext, pair: PairInfo, storage: IDBStorage) {
  const fetcher = async () => {
    const provider = new BrumeProvider(ethereum)
    const contract = new Contract(pair.address, PairAbi, provider)
    const reserves = await contract.getReserves()
    const price = computePairPrice(pair, reserves)

    return new Ok(new Data(price))
  }

  return createQuerySchema<string, FixedInit, Error>(`pairs/${pair.address}/price`, fetcher, { storage })
}

export function computePairPrice(pair: PairInfo, reserves: [bigint, bigint]) {
  const decimals0 = tokensByAddress[pair.token0].decimals
  const decimals1 = tokensByAddress[pair.token1].decimals

  const [reserve0, reserve1] = reserves

  const quantity0 = new Fixed(reserve0, decimals0)
  const quantity1 = new Fixed(reserve1, decimals1)

  return quantity1.div(quantity0)
}