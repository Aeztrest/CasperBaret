/**
 * casper-js-sdk interop shim.
 *
 * casper-js-sdk v5 ships as a CJS bundle with no statically-analyzable named
 * ESM exports. Under Node ESM (tsx) `import { PrivateKey } from "casper-js-sdk"`
 * fails at runtime, even though it typechecks. The reliable pattern is a
 * default import + destructure, which works in both Node ESM and Vite. This
 * module centralizes that interop so the rest of the codebase imports clean
 * named symbols from "@casper-baret/casper-core".
 */

import Casper from "casper-js-sdk";

export const {
  PrivateKey,
  PublicKey,
  KeyAlgorithm,
  HttpHandler,
  RpcClient,
  SpeculativeClient,
  Args,
  NamedArg,
  CLValue,
  CLTypeUInt8,
  CLValueUInt256,
  CLValueUInt512,
  CLValueString,
  ContractCallBuilder,
  SessionBuilder,
  NativeTransferBuilder,
  Transaction,
  TransactionV1,
  Deploy,
  Conversions,
  Hash,
  AccountHash,
  ContractHash,
  ContractPackageHash,
} = Casper as unknown as typeof import("casper-js-sdk");

// Transfer-builder helpers pull un-nameable internal param types into emitted
// d.ts files, so reach them through the default `Casper` export at call sites
// (e.g. `Casper.makeCep18TransferTransaction(...)`) instead of re-exporting.

export default Casper as unknown as typeof import("casper-js-sdk");
