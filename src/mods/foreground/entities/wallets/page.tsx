/* eslint-disable @next/next/no-img-element */
import { Fixed, FixedInit } from "@/libs/bigints/bigints";
import { Colors } from "@/libs/colors/colors";
import { chains, pairsByAddress, pairsByName } from "@/libs/ethereum/chain";
import { Outline } from "@/libs/icons/icons";
import { useBooleanHandle } from "@/libs/react/handles/boolean";
import { UUIDProps } from "@/libs/react/props/uuid";
import { Option, Optional } from "@hazae41/option";
import { Ok, Result } from "@hazae41/result";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { PageHeader } from "../../components/page/header";
import { Page } from "../../components/page/page";
import { WalletDataProvider, useWalletData } from "./context";
import { useEthereumContext, usePairPrice, usePendingBalance, usePricedBalance } from "./data";
import { WalletDataCard } from "./row";
import { WalletDataSendDialog } from "./send";

export function WalletPage(props: UUIDProps) {
  const { uuid } = props

  return <WalletDataProvider uuid={uuid}>
    <WalletDataPage />
  </WalletDataProvider>
}

export function useDisplay(option: Optional<Result<FixedInit, Error>>) {
  return useMemo(() => {
    return Option.wrap(option).mapSync(result => result.mapSync(fixed => {
      return Number(Fixed.from(fixed).move(5).toString()).toLocaleString(undefined, {})
    }).mapErrSync(() => "Error").inner).unwrapOr("...")
  }, [option])
}

export function useDisplayUsd(option: Optional<Result<FixedInit, Error>>) {
  return useMemo(() => {
    return Option.wrap(option).mapSync(result => result.mapSync(fixed => {
      return Number(Fixed.from(fixed).toString()).toLocaleString(undefined, { style: "currency", currency: "USD" })
    }).mapErrSync(() => "Error").inner).unwrapOr("...")
  }, [option])
}

export function useCompactDisplayUsd(option: Optional<Result<FixedInit, Error>>) {
  return useMemo(() => {
    return Option.wrap(option).mapSync(result => result.mapSync(fixed => {
      return Number(Fixed.from(fixed).toString()).toLocaleString(undefined, { style: "currency", currency: "USD", notation: "compact" })
    }).mapErrSync(() => "Error").inner).unwrapOr("...")
  }, [option])
}

function WalletDataPage() {
  const wallet = useWalletData()

  const router = useRouter()

  const mainnet = useEthereumContext(wallet, chains[1])
  const goerli = useEthereumContext(wallet, chains[5])
  const polygon = useEthereumContext(wallet, chains[137])

  const color = Colors.get(wallet.color)
  const color2 = Colors.get(wallet.color + 1)

  usePairPrice(mainnet, pairsByAddress[pairsByName.WETH_USDT])
  usePairPrice(mainnet, pairsByAddress[pairsByName.MATIC_WETH])

  const mainnetBalanceQuery = usePendingBalance(wallet.address, mainnet)
  const mainnetBalanceDisplay = useDisplay(mainnetBalanceQuery.current)
  const mainnetSendDialog = useBooleanHandle(false)

  const goerliBalance = usePendingBalance(wallet.address, goerli)
  const goerliBalanceDisplay = useDisplay(goerliBalance.current)
  const goerliSendDialog = useBooleanHandle(false)

  const polygonBalanceQuery = usePendingBalance(wallet.address, polygon)
  const polygonBalanceDisplay = useDisplay(polygonBalanceQuery.current)
  const polygonSendDialog = useBooleanHandle(false)

  const ethBalanceUsdBigint = usePricedBalance(mainnet, wallet.address, "usd")
  const ethBalanceUsdDisplay = useDisplayUsd(ethBalanceUsdBigint.current)

  const goerliBalanceUsdDisplay = useDisplayUsd(new Ok(new Fixed(0n, 0)))

  const maticBalanceUsdBigint = usePricedBalance(polygon, wallet.address, "usd")
  const maticBalanceUsdDisplay = useDisplayUsd(maticBalanceUsdBigint.current)

  const Header =
    <PageHeader
      title="Wallet"
      back={router.back} />

  const Card =
    <div className="p-xmd flex justify-center">
      <div className="w-full max-w-sm">
        <WalletDataCard />
      </div>
    </div>

  const Apps =
    <div className="p-xmd flex items-center justify-center flex-wrap gap-12">
      <div className="flex flex-col items-center gap-2">
        <button className={`text-white bg-gradient-to-r from-${color} to-${color2} rounded-xl p-3 hovered-or-active-or-selected:scale-105 transition-transform`}
          onClick={mainnetSendDialog.enable}>
          <Outline.PaperAirplaneIcon className="icon-md" />
        </button>
        <div className="">
          {`Send`}
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <button className={`text-white bg-gradient-to-r from-${color} to-${color2} rounded-xl p-3 hovered-or-active-or-selected:scale-105 transition-transform`}>
          <Outline.QrCodeIcon className="icon-md" />
        </button>
        <div className="">
          {`Receive`}
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <button className={`text-white bg-gradient-to-r from-${color} to-${color2} rounded-xl p-3 hovered-or-active-or-selected:scale-105 transition-transform`}>
          <Outline.ArrowsRightLeftIcon className="icon-md" />
        </button>
        <div className="">
          {`Swap`}
        </div>
      </div>
    </div>

  return <Page>
    {mainnetSendDialog.current && mainnet &&
      <WalletDataSendDialog title="(Ethereum mainnet)"
        handle={mainnet}
        close={mainnetSendDialog.disable} />}
    {goerliSendDialog.current && goerli &&
      <WalletDataSendDialog title="(Goerli testnet)"
        handle={goerli}
        close={goerliSendDialog.disable} />}
    {polygonSendDialog.current && polygon &&
      <WalletDataSendDialog title="(Polygon mainnet)"
        handle={polygon}
        close={polygonSendDialog.disable} />}
    {Header}
    {Card}
    {Apps}
    <div className="p-xmd flex flex-col gap-2">
      <button className="w-full p-xmd flex flex-col rounded-xl border border-contrast"
        onClick={mainnetSendDialog.enable}>
        <div className="w-full flex justify-between items-center">
          <div className="">
            Ethereum
          </div>
          <div className="">
            {ethBalanceUsdDisplay}
          </div>
        </div>
        <div className="text-contrast">
          {`${mainnetBalanceDisplay} ETH`}
        </div>
      </button>
      <button className="w-full p-xmd flex flex-col rounded-xl border border-contrast"
        onClick={goerliSendDialog.enable}>
        <div className="w-full flex justify-between items-center">
          <div className="">
            Goerli
          </div>
          <div className="">
            {goerliBalanceUsdDisplay}
          </div>
        </div>
        <div className="text-contrast">
          {`${goerliBalanceDisplay} ETH`}
        </div>
      </button>
      <button className="w-full p-xmd flex flex-col rounded-xl border border-contrast"
        onClick={polygonSendDialog.enable}>
        <div className="w-full flex justify-between items-center">
          <div className="">
            Polygon
          </div>
          <div className="">
            {maticBalanceUsdDisplay}
          </div>
        </div>
        <div className="text-contrast">
          {`${polygonBalanceDisplay} MATIC`}
        </div>
      </button>
    </div>
  </Page>
}
