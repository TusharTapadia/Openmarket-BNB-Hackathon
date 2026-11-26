"use client";

import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatUnits, type Address, type Hex } from "viem";
import { useAccount, useReadContracts, useSwitchChain } from "wagmi";
import { readContract, sendTransaction, signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { bsc } from "wagmi/chains";
import { wagmiConfig } from "@/components/trade/providers";
import {
  bscClient, buildSwapCall, erc20Abi, MAX_UINT256, minimumOut, permit2Abi, permitTypedData, QuoteError,
  type PancakeQuote, type Side,
} from "@/lib/trade/pancakeswap";
import { JupiterError, type JupiterQuote } from "@/lib/trade/jupiter";
import {
  BSC_USDT, bscscanTx, jupiterSwapUrl, OPENSTOCKS_DECIMALS, PANCAKE, SOLANA_USDC,
} from "@/lib/trade/tokens";
import { parseAmount, QUOTE_REFRESH_MS, useDebounced, useJupiterQuote, usePancakeQuote } from "@/lib/trade/use-quote";

export type TradeTarget =
  | { venue: "pancakeswap"; symbol: string; address: Address }
  | { venue: "jupiter"; symbol: string; mint: string; pageUrl: string };

type Props = { target: TradeTarget; companyName: string; issuer: string; onClose: () => void };

const SLIPPAGE_PRESETS = [10, 50, 100];
const DEFAULT_SLIPPAGE_BPS = 50;

/* ---------- Formatting ---------- */

function fmt(value: number): string {
  if (!Number.isFinite(value)) { return "–"; }
  if (value === 0) { return "0"; }
  const abs = Math.abs(value);
  if (abs >= 1000) { return value.toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  if (abs >= 1) { return value.toLocaleString("en-US", { maximumFractionDigits: 4 }); }
  return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}
const fmtUnits = (value: bigint, decimals: number) => fmt(Number(formatUnits(value, decimals)));
const fmtPct = (fraction: number) => (fraction < 0.0001 ? "<0.01%" : `${(fraction * 100).toFixed(2)}%`);
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const impactTone = (fraction: number) => (fraction >= 0.05 ? "bad" : fraction >= 0.01 ? "warn" : "ok");

function errorText(error: unknown): string {
  if (error instanceof QuoteError || error instanceof JupiterError) { return error.message; }
  return "Could not fetch a quote. Try again in a moment.";
}

/** Wallet errors, said plainly. */
function walletError(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/UserRejected|User rejected|denied|4001/i.test(text)) { return "You declined the request in your wallet."; }
  if (/TooLittleReceived|0x39d35496|0x4e86d23a|slippage/i.test(text)) { return "The price moved past your slippage limit. Refresh the quote or raise slippage."; }
  if (/insufficient funds/i.test(text)) { return "Not enough BNB to pay the network fee."; }
  const short = error instanceof Error && "shortMessage" in error ? String((error as { shortMessage: unknown }).shortMessage) : null;
  return short ?? "The transaction failed. Nothing was swapped.";
}

/* ---------- Dialog shell ---------- */

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function TradeModal({ target, companyName, issuer, onClose }: Props) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // The portal needs document.body, which only exists after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    if (!mounted) { return; }
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>("input, [data-autofocus]") ?? dialog;
    first?.focus();
  }, [mounted]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) { return; }
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!mounted) { return null; }
  const network = target.venue === "pancakeswap" ? "BNB Chain" : "Solana";
  return createPortal(
    // Portalled events still bubble through React's tree, so a trade button inside a clickable row stays inert.
    <div className="trade-layer" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      <div className="trade-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        className="trade-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="trade-head">
          <div>
            <h2 id={titleId} className="trade-title">Trade <span className="trade-fig">{target.symbol}</span></h2>
            <p id={descId} className="trade-sub">{companyName} · {issuer} on {network}</p>
          </div>
          <button type="button" className="trade-close" onClick={onClose} aria-label="Close trade">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </header>
        {target.venue === "pancakeswap"
          ? <PancakePanel symbol={target.symbol} token={target.address} />
          : <JupiterPanel symbol={target.symbol} mint={target.mint} pageUrl={target.pageUrl} />}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Shared pieces ---------- */

function SideSwitch({ side, onChange, symbol }: { side: Side; onChange: (side: Side) => void; symbol: string }) {
  return (
    <div className="trade-sides" role="group" aria-label="Order side">
      <button type="button" className="trade-side" aria-pressed={side === "buy"} onClick={() => onChange("buy")}>Buy {symbol}</button>
      <button type="button" className="trade-side" aria-pressed={side === "sell"} onClick={() => onChange("sell")}>Sell {symbol}</button>
    </div>
  );
}

function AmountField({ id, label, unit, value, onChange, hint }: {
  id: string; label: string; unit: string; value: string; onChange: (value: string) => void; hint?: ReactNode;
}) {
  return (
    <div className="trade-field">
      <div className="trade-field-top">
        <label htmlFor={id} className="trade-label">{label}</label>
        {hint}
      </div>
      <div className="trade-input-row">
        <input
          id={id}
          className="trade-input"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0"
          value={value}
          onChange={(event) => {
            const next = event.target.value.replace(",", ".");
            if (/^\d*\.?\d*$/.test(next)) { onChange(next); }
          }}
        />
        <span className="trade-unit">{unit}</span>
      </div>
    </div>
  );
}

function ReceiveField({ label, unit, value, loading }: { label: string; unit: string; value: string; loading: boolean }) {
  return (
    <div className="trade-field trade-field-out">
      <div className="trade-field-top"><span className="trade-label">{label}</span></div>
      <div className="trade-input-row">
        <output className="trade-output" data-loading={loading || undefined} aria-live="polite">{value}</output>
        <span className="trade-unit">{unit}</span>
      </div>
    </div>
  );
}

function SlippageControl({ bps, onChange }: { bps: number; onChange: (bps: number) => void }) {
  const id = useId();
  const custom = !SLIPPAGE_PRESETS.includes(bps);
  const [text, setText] = useState(custom ? String(bps / 100) : "");
  return (
    <div className="trade-slippage" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="trade-label">Slippage</span>
      <div className="trade-slip-options">
        {SLIPPAGE_PRESETS.map((preset) => (
          <button key={preset} type="button" className="trade-chip" aria-pressed={bps === preset} onClick={() => { setText(""); onChange(preset); }}>
            {preset / 100}%
          </button>
        ))}
        <label className="trade-chip trade-chip-input" data-active={custom || undefined}>
          <span className="sr-only">Custom slippage, percent</span>
          <input
            inputMode="decimal"
            placeholder="Custom"
            value={text}
            onChange={(event) => {
              const next = event.target.value.replace(",", ".");
              if (!/^\d*\.?\d*$/.test(next)) { return; }
              setText(next);
              const pct = Number(next);
              if (next && Number.isFinite(pct) && pct > 0 && pct <= 50) { onChange(Math.round(pct * 100)); }
            }}
          />
          <span aria-hidden="true">%</span>
        </label>
      </div>
    </div>
  );
}

function Freshness({ updatedAt, fetching }: { updatedAt: number; fetching: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (fetching) { return <span className="trade-fresh">Refreshing quote…</span>; }
  if (!updatedAt) { return null; }
  const age = Math.max(0, Math.round((now - updatedAt) / 1000));
  const next = Math.max(0, Math.round(QUOTE_REFRESH_MS / 1000) - age);
  return <span className="trade-fresh">Quote {age}s old · refreshes in {next}s</span>;
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="trade-row">
      <dt>{label}</dt>
      <dd data-tone={tone}>{children}</dd>
    </div>
  );
}

/* ---------- PancakeSwap (OpenStocks, BNB Chain) ---------- */

type TxStep =
  | { kind: "idle" }
  | { kind: "wallet"; what: string }
  | { kind: "pending"; what: string; hash: Hex }
  | { kind: "done"; hash: Hex; summary: string }
  | { kind: "failed"; message: string; hash?: Hex };

function PancakePanel({ symbol, token }: { symbol: string; token: Address }) {
  const inputId = useId();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("100");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [step, setStep] = useState<TxStep>({ kind: "idle" });
  const busy = step.kind === "wallet" || step.kind === "pending";

  const payUnit = side === "buy" ? BSC_USDT.symbol : symbol;
  const getUnit = side === "buy" ? symbol : BSC_USDT.symbol;
  const decimalsIn = side === "buy" ? BSC_USDT.decimals : OPENSTOCKS_DECIMALS;
  const tokenIn = (side === "buy" ? BSC_USDT.address : token) as Address;
  const debounced = useDebounced(amount);
  const amountIn = parseAmount(debounced, decimalsIn);
  const quote = usePancakeQuote({ symbol, token, side, amountIn, paused: busy });
  // A previous quote stays on screen while the next loads, but never one for the other side.
  const data: PancakeQuote | undefined = quote.data?.side === side ? quote.data : undefined;
  const current = data !== undefined && !quote.isPlaceholderData && data.amountIn === amountIn;
  const typing = debounced !== amount;

  const { address, chainId, isConnected } = useAccount();
  const balances = useReadContracts({
    allowFailure: true,
    contracts: address ? [
      { address: tokenIn, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId: bsc.id },
      { address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [address, PANCAKE.permit2 as Address], chainId: bsc.id },
    ] : [],
    query: { enabled: Boolean(address), refetchInterval: 20_000 },
  });
  const balance = balances.data?.[0]?.result as bigint | undefined;
  const permit2Allowance = balances.data?.[1]?.result as bigint | undefined;

  const minOut = current ? minimumOut(data.amountOut, slippageBps) : null;
  const pricePerToken = data
    ? side === "buy"
      ? Number(formatUnits(data.amountIn, data.decimalsIn)) / Number(formatUnits(data.amountOut, data.decimalsOut))
      : Number(formatUnits(data.amountOut, data.decimalsOut)) / Number(formatUnits(data.amountIn, data.decimalsIn))
    : null;

  const changeSide = (next: Side) => {
    if (next === side) { return; }
    setSide(next);
    setAmount(next === "buy" ? "100" : "0.1");
    setStep({ kind: "idle" });
  };

  return (
    <div className="trade-body">
      <SideSwitch side={side} onChange={changeSide} symbol={symbol} />
      <AmountField
        id={inputId}
        label="You pay"
        unit={payUnit}
        value={amount}
        onChange={(value) => { setAmount(value); if (!busy) { setStep({ kind: "idle" }); } }}
        hint={balance !== undefined ? (
          <button type="button" className="trade-balance" onClick={() => setAmount(formatUnits(balance, decimalsIn))}>
            Balance <span className="trade-fig">{fmtUnits(balance, decimalsIn)}</span> · Max
          </button>
        ) : undefined}
      />
      <ReceiveField
        label="You receive"
        unit={getUnit}
        value={data && amountIn !== null ? fmtUnits(data.amountOut, data.decimalsOut) : quote.isFetching ? "…" : "–"}
        loading={!current && (quote.isFetching || typing)}
      />

      {quote.error && !quote.isFetching ? (
        <p className="trade-alert" role="alert">{errorText(quote.error)}</p>
      ) : null}

      <dl className="trade-details" aria-busy={quote.isFetching}>
        <Row label="Price">{pricePerToken !== null ? <span className="trade-fig">1 {symbol} = {fmt(pricePerToken)} USDT</span> : "–"}</Row>
        <Row label="Price impact" tone={data ? impactTone(data.priceImpact) : undefined}>
          {data ? <span className="trade-fig">{fmtPct(data.priceImpact)}</span> : "–"}
        </Row>
        <Row label={`Minimum received (${slippageBps / 100}% slippage)`}>
          {minOut !== null && data ? <span className="trade-fig">{fmtUnits(minOut, data.decimalsOut)} {getUnit}</span> : "–"}
        </Row>
        <Row label="Route">{data ? data.routeLabel : "–"}</Row>
      </dl>
      <SlippageControl bps={slippageBps} onChange={setSlippageBps} />
      <div className="trade-meta">
        <Freshness updatedAt={quote.dataUpdatedAt} fetching={quote.isFetching} />
        <button type="button" className="trade-link-btn" onClick={() => quote.refetch()} disabled={quote.isFetching || amountIn === null}>Refresh</button>
      </div>

      <BscAction
        symbol={symbol}
        quote={current ? data : undefined}
        minOut={minOut}
        payUnit={payUnit}
        getUnit={getUnit}
        balance={balance}
        permit2Allowance={permit2Allowance}
        address={address}
        chainId={chainId}
        isConnected={isConnected}
        step={step}
        setStep={setStep}
        onSettled={() => balances.refetch()}
      />
      {data && data.priceImpact >= 0.05 && current ? (
        <p className="trade-note" data-tone="bad">This trade moves the pool price by {fmtPct(data.priceImpact)}. Consider a smaller amount.</p>
      ) : null}
      <p className="trade-note">Swaps go through PancakeSwap&apos;s router on BNB Chain from your own wallet. Your wallet asks you to confirm every step.</p>
    </div>
  );
}

function BscAction(props: {
  symbol: string; quote: PancakeQuote | undefined; minOut: bigint | null; payUnit: string; getUnit: string;
  balance: bigint | undefined; permit2Allowance: bigint | undefined;
  address: Address | undefined; chainId: number | undefined; isConnected: boolean;
  step: TxStep; setStep: (step: TxStep) => void; onSettled: () => void;
}) {
  const { quote, minOut, payUnit, getUnit, balance, permit2Allowance, address, chainId, isConnected, step, setStep, onSettled } = props;
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const queryClient = useQueryClient();
  const busy = step.kind === "wallet" || step.kind === "pending";

  const run = useCallback(async () => {
    if (!quote || minOut === null || !address) { return; }
    const tokenIn = quote.tokenIn;
    let lastHash: Hex | undefined;
    try {
      // 1. Let Permit2 move the input token (once per token).
      const erc20Allowance = await readContract(wagmiConfig, { address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [address, PANCAKE.permit2 as Address], chainId: bsc.id });
      if (erc20Allowance < quote.amountIn) {
        setStep({ kind: "wallet", what: `Approve ${payUnit} in your wallet` });
        const hash = await writeContract(wagmiConfig, { address: tokenIn, abi: erc20Abi, functionName: "approve", args: [PANCAKE.permit2 as Address, MAX_UINT256], chainId: bsc.id });
        lastHash = hash;
        setStep({ kind: "pending", what: `Approving ${payUnit}`, hash });
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: bsc.id });
        if (receipt.status !== "success") { throw new Error("Approval reverted"); }
        onSettled();
      }

      // 2. A signed, gasless Permit2 allowance for exactly this amount, unless one is already in place.
      const [allowed, expiration, nonce] = await readContract(wagmiConfig, {
        address: PANCAKE.permit2 as Address, abi: permit2Abi, functionName: "allowance", args: [address, tokenIn, PANCAKE.universalRouter as Address], chainId: bsc.id,
      });
      const nowSeconds = Math.floor(Date.now() / 1000);
      let permit: Parameters<typeof buildSwapCall>[0]["permit"];
      if (allowed < quote.amountIn || expiration < nowSeconds + 120) {
        setStep({ kind: "wallet", what: `Sign to let PancakeSwap spend ${payUnit} (no gas)` });
        const message = {
          details: { token: tokenIn, amount: quote.amountIn, expiration: nowSeconds + 60 * 60 * 24 * 30, nonce },
          spender: PANCAKE.universalRouter as Address,
          sigDeadline: BigInt(nowSeconds + 30 * 60),
        };
        const signature = await signTypedData(wagmiConfig, permitTypedData(message));
        permit = { permit: message, signature };
      }

      // 3. The swap itself, checked against the chain before the wallet is asked.
      const call = buildSwapCall({ quote, minOut, recipient: address, deadline: BigInt(nowSeconds + 20 * 60), permit });
      await bscClient().call({ account: address, to: call.to, data: call.data });
      setStep({ kind: "wallet", what: "Confirm the swap in your wallet" });
      const hash = await sendTransaction(wagmiConfig, { to: call.to, data: call.data, chainId: bsc.id });
      lastHash = hash;
      setStep({ kind: "pending", what: "Swapping", hash });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: bsc.id });
      if (receipt.status !== "success") {
        setStep({ kind: "failed", message: "The swap reverted on-chain. Nothing was swapped.", hash });
      } else {
        setStep({ kind: "done", hash, summary: `Swapped ${fmtUnits(quote.amountIn, quote.decimalsIn)} ${payUnit} for at least ${fmtUnits(minOut, quote.decimalsOut)} ${getUnit}.` });
      }
    } catch (error) {
      setStep({ kind: "failed", message: walletError(error), hash: lastHash });
    } finally {
      onSettled();
      void queryClient.invalidateQueries({ queryKey: ["trade-quote"] });
    }
  }, [quote, minOut, address, payUnit, getUnit, setStep, onSettled, queryClient]);

  let action: ReactNode;
  if (!isConnected) {
    action = <button type="button" className="trade-cta" onClick={openConnectModal}>Connect wallet</button>;
  } else if (chainId !== bsc.id) {
    action = (
      <button type="button" className="trade-cta" disabled={switching} onClick={() => switchChain({ chainId: bsc.id })}>
        {switching ? "Switching…" : "Switch to BNB Chain"}
      </button>
    );
  } else {
    const short = quote && balance !== undefined && balance < quote.amountIn;
    const needsApproval = quote && permit2Allowance !== undefined && permit2Allowance < quote.amountIn;
    const label = busy ? (step.kind === "wallet" ? "Check your wallet…" : "Waiting for BNB Chain…")
      : !quote ? "Enter an amount"
        : short ? `Not enough ${payUnit}`
          : needsApproval ? `Approve ${payUnit} and swap` : "Swap";
    action = <button type="button" className="trade-cta" disabled={busy || !quote || Boolean(short)} onClick={run}>{label}</button>;
  }

  return (
    <div className="trade-action">
      {isConnected && address ? (
        <div className="trade-wallet">
          <span className="trade-dot" aria-hidden="true" />
          <span>Connected</span>
          <button type="button" className="trade-link-btn trade-fig" onClick={openAccountModal}>{shortAddress(address)}</button>
        </div>
      ) : null}
      {action}
      <TxStatus step={step} />
    </div>
  );
}

function TxStatus({ step }: { step: TxStep }) {
  if (step.kind === "idle") { return <div className="sr-only" role="status" aria-live="polite" />; }
  const link = (hash: Hex) => <a className="trade-link" href={bscscanTx(hash)} target="_blank" rel="noreferrer">View on BscScan<span className="sr-only"> (opens in new tab)</span></a>;
  return (
    <div className="trade-status" role="status" aria-live="polite" data-tone={step.kind === "done" ? "ok" : step.kind === "failed" ? "bad" : undefined}>
      {step.kind === "wallet" ? <p>{step.what}</p> : null}
      {step.kind === "pending" ? <p><span className="trade-spinner" aria-hidden="true" />{step.what}… {link(step.hash)}</p> : null}
      {step.kind === "done" ? <p>{step.summary} {link(step.hash)}</p> : null}
      {step.kind === "failed" ? <p>{step.message} {step.hash ? link(step.hash) : null}</p> : null}
    </div>
  );
}

/* ---------- Jupiter (PreStocks, Solana) ---------- */

function JupiterPanel({ symbol, mint, pageUrl }: { symbol: string; mint: string; pageUrl: string }) {
  const inputId = useId();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("100");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const debounced = useDebounced(amount);
  const parsed = Number(debounced);
  const amountIn = debounced && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const quote = useJupiterQuote({ symbol, mint, side, amountIn });
  const data: JupiterQuote | undefined = quote.data?.side === side ? quote.data : undefined;
  const current = data !== undefined && !quote.isPlaceholderData && data.amountIn === amountIn;
  const payUnit = side === "buy" ? SOLANA_USDC.symbol : symbol;
  const getUnit = side === "buy" ? symbol : SOLANA_USDC.symbol;
  const minOut = data ? data.amountOut * (1 - slippageBps / 10_000) : null;
  const pricePerToken = data && data.amountOut > 0
    ? side === "buy" ? data.amountIn / data.amountOut : data.amountOut / data.amountIn
    : null;
  const jupiterUrl = side === "buy" ? jupiterSwapUrl(SOLANA_USDC.mint, mint) : jupiterSwapUrl(mint, SOLANA_USDC.mint);

  return (
    <div className="trade-body">
      <SideSwitch side={side} onChange={(next) => { if (next !== side) { setSide(next); setAmount(next === "buy" ? "100" : "1"); } }} symbol={symbol} />
      <AmountField id={inputId} label="You pay" unit={payUnit} value={amount} onChange={setAmount} />
      <ReceiveField
        label="You receive"
        unit={getUnit}
        value={data && amountIn !== null ? fmt(data.amountOut) : quote.isFetching ? "…" : "–"}
        loading={!current && (quote.isFetching || debounced !== amount)}
      />
      {quote.error && !quote.isFetching ? <p className="trade-alert" role="alert">{errorText(quote.error)}</p> : null}
      <dl className="trade-details" aria-busy={quote.isFetching}>
        <Row label="Price">{pricePerToken !== null ? <span className="trade-fig">1 {symbol} = {fmt(pricePerToken)} USDC</span> : "–"}</Row>
        <Row label="Price impact" tone={data ? impactTone(data.priceImpact) : undefined}>
          {data ? <span className="trade-fig">{fmtPct(data.priceImpact)}</span> : "–"}
        </Row>
        <Row label={`Minimum received (${slippageBps / 100}% slippage)`}>
          {minOut !== null ? <span className="trade-fig">{fmt(minOut)} {getUnit}</span> : "–"}
        </Row>
        <Row label="Route">{data ? data.routeLabel : "–"}</Row>
        {data && data.transferFeeBps > 0 ? (
          <Row label="Token transfer fee"><span className="trade-fig">{(data.transferFeeBps / 100).toFixed(2)}%</span> set by PreStocks</Row>
        ) : null}
      </dl>
      <SlippageControl bps={slippageBps} onChange={setSlippageBps} />
      <div className="trade-meta">
        <Freshness updatedAt={quote.dataUpdatedAt} fetching={quote.isFetching} />
        <button type="button" className="trade-link-btn" onClick={() => quote.refetch()} disabled={quote.isFetching || amountIn === null}>Refresh</button>
      </div>
      <div className="trade-action">
        <a className="trade-cta" href={jupiterUrl} target="_blank" rel="noreferrer" data-autofocus>
          Open in Jupiter<span className="sr-only"> (opens in new tab)</span>
        </a>
        <a className="trade-secondary" href={pageUrl} target="_blank" rel="noreferrer">
          Trade on PreStocks<span className="sr-only"> (opens in new tab)</span>
        </a>
      </div>
      <p className="trade-note">PreStocks tokens live on Solana, so they trade from a Solana wallet such as Phantom or Solflare. The quote is Jupiter&apos;s live route; you confirm the swap on Jupiter or PreStocks.</p>
    </div>
  );
}
