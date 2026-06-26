/**
 * PaymentGuard provisioning (Casper build) — STUBBED no-op.
 *
 * The Stellar build deployed a Passkey-kit smart-wallet contract per user.
 * On Casper the spending-cap vault is the deployed PaymentGuard contract
 * (see contracts/), which is optional for the demo. We treat the user's own
 * account as the "smart wallet" so flows that consume `smartWalletAddress`
 * resolve consistently, and record it in the keystore.
 *
 * TODO(casper): wire actual PaymentGuard vault provisioning (deploy + init).
 *
 * Idempotent — if a smart-wallet address already lives in the keystore row,
 * returns it without doing anything.
 */

import { readKeystore, writeKeystore, activeAccount } from "../db/keystore";

export interface ProvisionResult {
  smartWalletAddress: string;
  walletAddress: string;
  alreadyOnChain: boolean;
}

export async function provisionSmartWallet(): Promise<ProvisionResult> {
  const row = await readKeystore();
  if (!row) throw new Error("No wallet found.");

  // Provision the active account (each account has its own smart-wallet slot).
  const acct = activeAccount(row);
  if (acct.smartWalletAddress) {
    return {
      smartWalletAddress: acct.smartWalletAddress,
      walletAddress: acct.smartWalletAddress,
      alreadyOnChain: true,
    };
  }

  // No-op: the user's own account acts as the wallet until PaymentGuard lands.
  const smartWalletAddress = acct.authorityPubkey;
  await writeKeystore({
    ...row,
    accounts: row.accounts.map((a) =>
      a.index === acct.index ? { ...a, smartWalletAddress } : a,
    ),
  });

  return {
    smartWalletAddress,
    walletAddress: smartWalletAddress,
    alreadyOnChain: false,
  };
}
