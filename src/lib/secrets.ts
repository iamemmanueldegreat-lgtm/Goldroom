import { createServerFn } from "@tanstack/react-start";
import type { Network } from "./types";

export type SecretGroup = "telegram" | "cards" | "data" | "wallets";

export type SecretRow = {
  key: string;
  label: string;
  group: SecretGroup;
  required: boolean;
  set: boolean;
};

export const getSecretStatus = createServerFn({ method: "POST" }).handler(
  async (): Promise<SecretRow[]> => {
    const { secretStatus } = await import("./secrets.server");
    return secretStatus();
  },
);

export const getLiveWallets = createServerFn({ method: "POST" }).handler(
  async (): Promise<Partial<Record<Network, string>>> => {
    const { liveWallets } = await import("./secrets.server");
    return liveWallets();
  },
);
