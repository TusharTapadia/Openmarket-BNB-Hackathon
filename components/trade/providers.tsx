"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { connectorsForWallets, lightTheme, RainbowKitProvider, type Theme } from "@rainbow-me/rainbowkit";
import {
  binanceWallet, coinbaseWallet, injectedWallet, metaMaskWallet, okxWallet, rabbyWallet, trustWallet, walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createConfig, fallback, http, WagmiProvider } from "wagmi";
import { bsc } from "wagmi/chains";
import { BSC_RPCS } from "@/lib/trade/pancakeswap";

/**
 * Wallet plumbing for the trade flow: wagmi on BNB Chain, React Query, and
 * RainbowKit's connect modal. With a WalletConnect project id the usual mobile
 * and QR wallets are offered; without one only browser-extension wallets are,
 * since WalletConnect refuses to start without an id.
 */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";
const appName = "Markets";

const connectors = connectorsForWallets(
  projectId
    ? [
      { groupName: "Popular", wallets: [metaMaskWallet, rabbyWallet, binanceWallet, trustWallet, okxWallet, coinbaseWallet] },
      { groupName: "More", wallets: [walletConnectWallet, injectedWallet] },
    ]
    : [{ groupName: "Browser wallets", wallets: [injectedWallet, rabbyWallet, coinbaseWallet] }],
  { appName, projectId },
);

export const wagmiConfig = createConfig({
  chains: [bsc],
  connectors,
  transports: { [bsc.id]: fallback(BSC_RPCS.map((url) => http(url))) },
  ssr: true,
});

/**
 * RainbowKit's theme pointed at our tokens. Every value is a CSS variable, so
 * the modal follows <html data-mode> between the paper and graphite colourways
 * without a second theme.
 */
const base = lightTheme({ borderRadius: "small", overlayBlur: "none" });
const theme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    accentColor: "var(--color-ink)",
    accentColorForeground: "var(--color-paper-2)",
    actionButtonBorder: "var(--color-rule)",
    actionButtonBorderMobile: "var(--color-rule)",
    actionButtonSecondaryBackground: "var(--color-paper-3)",
    closeButton: "var(--color-muted)",
    closeButtonBackground: "var(--color-paper-3)",
    connectButtonBackground: "var(--color-paper-2)",
    connectButtonBackgroundError: "var(--color-bad)",
    connectButtonInnerBackground: "var(--color-paper-3)",
    connectButtonText: "var(--color-ink)",
    connectButtonTextError: "var(--color-paper-2)",
    connectionIndicator: "var(--color-ok)",
    downloadBottomCardBackground: "var(--color-paper-2)",
    downloadTopCardBackground: "var(--color-paper-3)",
    error: "var(--color-bad)",
    generalBorder: "var(--color-rule)",
    generalBorderDim: "var(--color-rule)",
    menuItemBackground: "var(--color-paper-3)",
    modalBackdrop: "var(--color-scrim)",
    modalBackground: "var(--color-paper-2)",
    modalBorder: "var(--color-rule)",
    modalText: "var(--color-ink)",
    modalTextDim: "var(--color-muted)",
    modalTextSecondary: "var(--color-muted)",
    profileAction: "var(--color-paper-3)",
    profileActionHover: "var(--color-rule)",
    profileForeground: "var(--color-paper-2)",
    selectedOptionBorder: "var(--color-cool)",
    standby: "var(--color-accent)",
  },
  fonts: { body: "var(--font-body)" },
  radii: {
    actionButton: "var(--radius-pill)",
    connectButton: "var(--radius-pill)",
    menuButton: "var(--radius-pill)",
    modal: "var(--radius-card)",
    modalMobile: "var(--radius-card)",
  },
  shadows: {
    ...base.shadows,
    connectButton: "none",
    dialog: "none",
    profileDetailsAction: "none",
    selectedOption: "none",
    selectedWallet: "none",
    walletLogo: "none",
  },
};

export function TradeProviders({ children }: { children: ReactNode }) {
  // One client per browser session; created in state so a server render never shares it.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact" appInfo={{ appName }} initialChain={bsc}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
