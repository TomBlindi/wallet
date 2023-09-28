import Erc20Abi from "@/assets/Erc20.json"
import PairAbi from "@/assets/Pair.json"
import { Fixed, FixedInit } from "@/libs/bigints/bigints"
import { Errors } from "@/libs/errors/errors"
import { ContractTokenInfo, EthereumChain, PairInfo, chainByChainId, pairByAddress, tokenByAddress } from "@/libs/ethereum/mods/chain"
import { RpcRequestPreinit, TorRpc } from "@/libs/rpc"
import { AbortSignals } from "@/libs/signals/signals"
import { Mutators } from "@/libs/xswr/mutators"
import { Disposer } from "@hazae41/cleaner"
import { Data, Fetched, FetcherMore, IDBStorage, States, createQuerySchema } from "@hazae41/glacier"
import { None, Option, Some } from "@hazae41/option"
import { Cancel, Looped, Pool, Retry, tryLoop } from "@hazae41/piscine"
import { Err, Ok, Panic, Result } from "@hazae41/result"
import { Contract, ContractRunner, TransactionRequest } from "ethers"
import { EthBrume, RpcConnection } from "../brumes/data"
import { WalletsBySeed } from "../seeds/all/data"
import { SeedRef } from "../seeds/data"
import { SessionData } from "../sessions/data"
import { User } from "../users/data"
import { Wallets } from "./all/data"


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

export namespace WalletRef {

  export function from(wallet: Wallet): WalletRef {
    return { ref: true, uuid: wallet.uuid }
  }

}

export type WalletData =
  | EthereumWalletData

export type EthereumWalletData =
  | EthereumReadonlyWalletData
  | EthereumSignableWalletData

export type EthereumSignableWalletData =
  | EthereumPrivateKeyWalletData
  | EthereumSeededWalletData

export type EthereumPrivateKeyWalletData =
  | EthereumUnauthPrivateKeyWalletData
  | EthereumAuthPrivateKeyWalletData

export interface EthereumReadonlyWalletData {
  readonly coin: "ethereum"
  readonly type: "readonly"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly address: string
}

export interface EthereumUnauthPrivateKeyWalletData {
  readonly coin: "ethereum"
  readonly type: "privateKey"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly address: string

  readonly privateKey: string
}

export interface EthereumAuthPrivateKeyWalletData {
  readonly coin: "ethereum"
  readonly type: "authPrivateKey"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly address: string

  readonly privateKey: {
    readonly ivBase64: string,
    readonly idBase64: string
  }
}

export interface EthereumSeededWalletData {
  readonly coin: "ethereum"
  readonly type: "seeded"

  readonly uuid: string
  readonly name: string,

  readonly color: number,
  readonly emoji: string

  readonly address: string

  readonly seed: SeedRef
  readonly path: string
}

export namespace Wallet {

  export type Key = ReturnType<typeof key>

  export function key(uuid: string) {
    return `wallet/${uuid}`
  }

  export type Schema = ReturnType<typeof schema>

  export function schema(uuid: string, storage: IDBStorage) {
    const indexer = async (states: States<WalletData, never>) => {
      const { current, previous = current } = states

      const previousData = previous.real?.data
      const currentData = current.real?.data

      const walletsQuery = Wallets.schema(storage)

      await walletsQuery.mutate(Mutators.mapData((d = new Data([])) => {
        if (previousData != null)
          d = d.mapSync(p => p.filter(x => x.uuid !== previousData.inner.uuid))
        if (currentData != null)
          d = d.mapSync(p => [...p, WalletRef.from(currentData.inner)])
        return d
      }))

      if (currentData?.inner.type === "seeded") {
        const { seed } = currentData.inner

        const walletsBySeedQuery = WalletsBySeed.Background.schema(seed.uuid, storage)

        await walletsBySeedQuery.mutate(Mutators.mapData((d = new Data([])) => {
          if (previousData != null)
            d = d.mapSync(p => p.filter(x => x.uuid !== previousData.inner.uuid))
          if (currentData != null)
            d = d.mapSync(p => [...p, WalletRef.from(currentData.inner)])
          return d
        }))
      }
    }

    return createQuerySchema<Key, WalletData, never>({ key: key(uuid), storage, indexer })
  }

}

export type EthereumQueryKey<T> = RpcRequestPreinit<T> & {
  version?: number
  chainId: number
}

export interface EthereumContext {
  user: User,
  wallet: Wallet
  chain: EthereumChain
  brume: EthBrume
  session?: SessionData
}

export async function tryEthereumFetch<T>(ethereum: EthereumContext, init: RpcRequestPreinit<unknown>, more: FetcherMore = {}) {
  return await Result.unthrow<Result<Fetched<T, Error>, Error>>(async t => {
    const { signal = AbortSignals.timeout(30_000) } = more
    const { brume } = ethereum

    const pools = Option.wrap(brume[ethereum.chain.chainId]).ok().throw(t)
    const allTriedPools = new Set<Pool<Disposer<RpcConnection>, Error>>()

    return await tryLoop(async (i) => {
      return await Result.unthrow<Result<Fetched<T, Error>, Looped<Error>>>(async t => {
        let pool: Pool<Disposer<RpcConnection>, Error>

        while (true) {
          pool = await pools.tryGetCryptoRandom().then(r => r.mapErrSync(Cancel.new).throw(t).result.get().inner)

          if (allTriedPools.has(pool))
            continue
          allTriedPools.add(pool)
          break
        }

        const conns = pool
        const allTriedConns = new Set<RpcConnection>()

        return await tryLoop(async (i) => {
          return await Result.unthrow<Result<Fetched<T, Error>, Looped<Error>>>(async t => {
            let conn: RpcConnection

            while (true) {
              conn = await conns.tryGetCryptoRandom().then(r => r.mapErrSync(Cancel.new).throw(t).result.get().inner)

              if (allTriedConns.has(conn))
                continue
              allTriedConns.add(conn)
              break
            }

            const { client, connection } = conn
            const request = client.prepare(init)

            if (connection.isURL()) {
              // console.log(`Fetching ${init.method} from ${connection.url.href} using ${connection.circuit.id}`)

              const result = await TorRpc.tryFetchWithCircuit<T>(connection.url, { ...request, circuit: connection.circuit })

              if (result.isErr())
                console.warn(`Could not fetch ${init.method} from ${connection.url.href} using ${connection.circuit.id}`, { result })

              return result.mapSync(x => Fetched.rewrap(x)).mapErrSync(Retry.new)
            }

            if (connection.isWebSocket()) {
              await connection.cooldown
              // console.log(`Fetching ${init.method} from ${connection.socket.url} using ${connection.circuit.id}`)

              const result = await TorRpc.tryFetchWithSocket<T>(connection.socket, request, signal)

              if (result.isErr())
                console.warn(`Could not fetch ${init.method} from ${connection.socket.url} using ${connection.circuit.id}`, { result })

              return result.mapSync(x => Fetched.rewrap(x)).mapErrSync(Retry.new)
            }

            connection satisfies never
            throw new Panic()
          })
        }, { base: 1, max: conns.capacity }).then(r => r.mapErrSync(Retry.new))
      })
    }, { base: 1, max: pools.capacity })
  }).then(r => r.inspectErrSync(Errors.log))
}

export function getEthereumUnknown(ethereum: EthereumContext, request: RpcRequestPreinit<unknown>, storage: IDBStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>) =>
    await tryEthereumFetch<unknown>(ethereum, request)

  return createQuerySchema<EthereumQueryKey<unknown>, any, Error>({
    key: {
      chainId: ethereum.chain.chainId,
      method: request.method,
      params: request.params
    },
    fetcher,
    storage
  })
}

export function getTotalPricedBalance(user: User, coin: "usd", storage: IDBStorage) {
  return createQuerySchema<string, FixedInit, Error>({
    key: `totalPricedBalance/${user.uuid}/${coin}`,
    storage
  })
}

export function getTotalPricedBalanceByWallet(user: User, coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<Record<string, FixedInit>, Error>) => {
    const values = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr({})
    const total = Object.values(values).reduce<Fixed>((x, y) => Fixed.from(y).add(x), new Fixed(0n, 0))

    const totalBalance = getTotalPricedBalance(user, coin, storage)
    await totalBalance.mutate(Mutators.data<FixedInit, Error>(total))
  }

  return createQuerySchema<string, Record<string, FixedInit>, Error>({
    key: `totalPricedBalanceByWallet/${user.uuid}/${coin}`,
    indexer,
    storage
  })
}

export function getTotalWalletPricedBalance(user: User, account: string, coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<FixedInit, Error>) => {
    const value = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr(new Fixed(0n, 0))

    const indexQuery = getTotalPricedBalanceByWallet(user, coin, storage)
    await indexQuery.mutate(Mutators.mapInnerData(p => ({ ...p, [account]: value }), new Data({})))
  }

  return createQuerySchema<string, FixedInit, Error>({
    key: `totalWalletPricedBalance/${account}/${coin}`,
    indexer,
    storage
  })
}

export function getPricedBalanceByToken(user: User, account: string, coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<Record<string, FixedInit>, Error>) => {
    const values = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr({})
    const total = Object.values(values).reduce<Fixed>((x, y) => Fixed.from(y).add(x), new Fixed(0n, 0))

    const totalBalance = getTotalWalletPricedBalance(user, account, coin, storage)
    await totalBalance.mutate(Mutators.data<FixedInit, Error>(total))
  }

  return createQuerySchema<string, Record<string, FixedInit>, Error>({
    key: `pricedBalanceByToken/${account}/${coin}`,
    indexer,
    storage
  })
}

export function getPricedBalance(ethereum: EthereumContext, account: string, coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<FixedInit, Error>) => {
    const key = `${ethereum.chain.chainId}`
    const value = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr(new Fixed(0n, 0))

    const indexQuery = getPricedBalanceByToken(ethereum.user, account, coin, storage)
    await indexQuery.mutate(Mutators.mapInnerData(p => ({ ...p, [key]: value }), new Data({})))
  }

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      chainId: ethereum.chain.chainId,
      method: "eth_getPricedBalance",
      params: [account, coin]
    },
    indexer,
    storage
  })
}

export function getBalance(ethereum: EthereumContext, account: string, block: string, storage: IDBStorage) {
  const fetcher = async (request: RpcRequestPreinit<unknown>) =>
    await tryEthereumFetch<string>(ethereum, request).then(r => r.mapSync(d => d.mapSync(x => new FixedInit(x, ethereum.chain.token.decimals))))

  const indexer = async (states: States<FixedInit, Error>) => {
    if (block !== "pending")
      return

    const pricedBalance = await Option.wrap(states.current.real?.data?.get()).andThen(async balance => {
      if (ethereum.chain.token.pairs == null)
        return new None()

      let pricedBalance: Fixed = Fixed.from(balance)

      for (const pairAddress of ethereum.chain.token.pairs) {
        const pair = pairByAddress[pairAddress]
        const chain = chainByChainId[pair.chainId]

        const price = getPairPrice({ ...ethereum, chain }, pair, storage)
        const priceState = await price.state

        if (priceState.data == null)
          return new None()

        pricedBalance = pricedBalance.mul(Fixed.from(priceState.data.inner))
      }

      return new Some(pricedBalance)
    }).then(o => o.unwrapOr(new Fixed(0n, 0)))

    const pricedBalanceQuery = getPricedBalance(ethereum, account, "usd", storage)
    await pricedBalanceQuery.mutate(Mutators.set(new Data(pricedBalance)))
  }

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      version: 2,
      chainId: ethereum.chain.chainId,
      method: "eth_getBalance",
      params: [account, block]
    },
    fetcher,
    indexer,
    storage
  })
}

export class BrumeProvider implements ContractRunner {
  provider = null

  constructor(
    readonly ethereum: EthereumContext
  ) { }

  async call(tx: TransactionRequest) {
    return await tryEthereumFetch<string>(this.ethereum, {
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
    try {
      const provider = new BrumeProvider(ethereum)
      const contract = new Contract(pair.address, PairAbi, provider)
      const reserves = await contract.getReserves()
      const price = computePairPrice(pair, reserves)

      return new Ok(new Data(price))
    } catch (cause: unknown) {
      return new Err(new Error("Could not get pair price", { cause }))
    }
  }

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      chainId: ethereum.chain.chainId,
      method: "eth_getPairPrice",
      params: [pair.address]
    },
    fetcher,
    storage
  })
}

export function computePairPrice(pair: PairInfo, reserves: [bigint, bigint]) {
  const decimals0 = tokenByAddress[pair.token0].decimals
  const decimals1 = tokenByAddress[pair.token1].decimals

  const [reserve0, reserve1] = reserves

  const quantity0 = new Fixed(reserve0, decimals0)
  const quantity1 = new Fixed(reserve1, decimals1)

  if (pair.reversed)
    return quantity0.div(quantity1)
  return quantity1.div(quantity0)
}

export function getTokenPricedBalance(ethereum: EthereumContext, account: string, token: ContractTokenInfo, coin: "usd", storage: IDBStorage) {
  const indexer = async (states: States<FixedInit, Error>) => {
    const key = `${ethereum.chain.chainId}/${token.address}`
    const value = Option.wrap(states.current.real?.data).mapSync(d => d.inner).unwrapOr(new Fixed(0n, 0))

    const indexQuery = getPricedBalanceByToken(ethereum.user, account, coin, storage)
    await indexQuery.mutate(Mutators.mapInnerData(p => ({ ...p, [key]: value }), new Data({})))
  }

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      chainId: ethereum.chain.chainId,
      method: "eth_getTokenPricedBalance",
      params: [account, token.address, coin]
    },
    indexer,
    storage
  })
}

export function getTokenBalance(ethereum: EthereumContext, account: string, token: ContractTokenInfo, block: string, storage: IDBStorage) {
  const fetcher = async () => {
    try {
      const provider = new BrumeProvider(ethereum)
      const contract = new Contract(token.address, Erc20Abi, provider)
      const balance = await contract.balanceOf(account)
      const fixed = new Fixed(balance, token.decimals)

      return new Ok(new Data(fixed))
    } catch (cause: unknown) {
      return new Err(new Error("Could not get pair price", { cause }))
    }
  }

  const indexer = async (states: States<FixedInit, Error>) => {
    if (block !== "pending")
      return

    const pricedBalance = await Option.wrap(states.current.real?.data?.get()).andThen(async balance => {
      if (token.pairs == null)
        return new None()

      let pricedBalance: Fixed = Fixed.from(balance)

      for (const pairAddress of token.pairs) {
        const pair = pairByAddress[pairAddress]
        const chain = chainByChainId[pair.chainId]

        const price = getPairPrice({ ...ethereum, chain }, pair, storage)
        const priceState = await price.state

        if (priceState.data == null)
          return new None()

        pricedBalance = pricedBalance.mul(Fixed.from(priceState.data.inner))
      }

      return new Some(pricedBalance)
    }).then(o => o.unwrapOr(new Fixed(0n, 0)))

    const pricedBalanceQuery = getTokenPricedBalance(ethereum, account, token, "usd", storage)
    await pricedBalanceQuery.mutate(Mutators.set(new Data(pricedBalance)))
  }

  return createQuerySchema<EthereumQueryKey<unknown>, FixedInit, Error>({
    key: {
      chainId: ethereum.chain.chainId,
      method: "eth_getTokenBalance",
      params: [account, token.address, block]
    },
    fetcher,
    indexer,
    storage
  })
}