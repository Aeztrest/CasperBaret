/**
 * Casper keypair management on top of casper-js-sdk.
 *
 * Baret wallets are ed25519 by default (secp256k1 supported). A keypair gives
 * us: the algo-prefixed public-key hex, the bare account-hash, the x402 wire
 * address ("00"+accountHash), and EIP-712-compatible signing.
 */

import { PrivateKey, KeyAlgorithm } from "./sdk.js";
import type { PrivateKey as PrivateKeyT } from "casper-js-sdk";
import { toX402Address } from "./address.js";

export type CasperKeyAlgo = "ed25519" | "secp256k1";

export interface CasperKeypair {
  /** Underlying casper-js-sdk private key. */
  readonly privateKey: PrivateKeyT;
  readonly algo: CasperKeyAlgo;
  /** Algo-prefixed public key hex, e.g. "01<64hex>". */
  readonly publicKeyHex: string;
  /** Bare 64-hex account hash. */
  readonly accountHashHex: string;
  /** x402 wire address: "00"+accountHashHex (33 bytes). */
  readonly x402Address: string;
}

function algoEnum(algo: CasperKeyAlgo) {
  return algo === "secp256k1" ? KeyAlgorithm.SECP256K1 : KeyAlgorithm.ED25519;
}

function wrap(privateKey: PrivateKeyT, algo: CasperKeyAlgo): CasperKeypair {
  const pub = privateKey.publicKey;
  const accountHashHex = pub.accountHash().toHex();
  return {
    privateKey,
    algo,
    publicKeyHex: pub.toHex(),
    accountHashHex,
    x402Address: toX402Address(accountHashHex),
  };
}

export async function generateKeypair(algo: CasperKeyAlgo = "ed25519"): Promise<CasperKeypair> {
  const pk = await PrivateKey.generate(algoEnum(algo));
  return wrap(pk, algo);
}

export async function keypairFromHex(
  privateKeyHex: string,
  algo: CasperKeyAlgo = "ed25519",
): Promise<CasperKeypair> {
  const pk = await PrivateKey.fromHex(privateKeyHex.replace(/^0x/i, ""), algoEnum(algo));
  return wrap(pk, algo);
}

export async function keypairFromPem(pem: string, algo: CasperKeyAlgo = "ed25519"): Promise<CasperKeypair> {
  const pk = await PrivateKey.fromPem(pem, algoEnum(algo));
  return wrap(pk, algo);
}

/** Export the private key as bare hex (32 bytes for ed25519). */
export function privateKeyHex(kp: CasperKeypair): string {
  return Buffer.from(kp.privateKey.toBytes()).toString("hex");
}

/** Export the private key as a PEM string. */
export function privateKeyPem(kp: CasperKeypair): string {
  return kp.privateKey.toPem();
}

/** Sign a raw message; returns the 64-byte raw signature (no algo prefix). */
export async function signRaw(kp: CasperKeypair, message: Uint8Array): Promise<Uint8Array> {
  return kp.privateKey.sign(message);
}

/**
 * Sign a 32-byte EIP-712 digest and return the 65-byte Casper signature
 * (`[algo_byte] + [64 raw bytes]`), hex-encoded — the format the casper-x402
 * facilitator's `VerifySignature` expects. Uses the SDK's
 * `signAndAddAlgorithmBytes`, which prefixes the correct algo tag.
 */
export async function signEip712Digest(kp: CasperKeypair, digest: Uint8Array): Promise<string> {
  if (digest.length !== 32) throw new Error(`digest must be 32 bytes, got ${digest.length}`);
  const sig = await kp.privateKey.signAndAddAlgorithmBytes(digest);
  return Buffer.from(sig).toString("hex");
}
