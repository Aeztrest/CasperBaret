//! Minimal EIP-712 typed-data hashing for the `TransferWithAuthorization`
//! message used by Baret's x402 settlement.
//!
//! Mirrors `packages/casper-core/src/x402.ts` (which builds the digest via
//! `@casper-ecosystem/casper-eip-712`'s `hashTypedData`) byte-for-byte: same
//! keccak256 primitive, same domain fields (`CASPER_DOMAIN_TYPES`), same
//! `TransferWithAuthorization` struct layout. This lets the contract
//! independently re-derive the exact digest the off-chain payer signed,
//! instead of trusting whatever the caller (facilitator) claims it verified.

use alloc::string::String;
use alloc::vec::Vec;
use core::fmt::Write;
use odra::casper_types::U256;
use sha3::{Digest, Keccak256};

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    let out = hasher.finalize();
    let mut result = [0u8; 32];
    result.copy_from_slice(&out);
    result
}

/// EIP-712 `address` encoding for a 33-byte tagged Casper address
/// (`0x00`+account-hash or `0x01`+package-hash): keccak256 of the raw bytes,
/// matching casper-eip-712's `encodeAddress` for 33-byte inputs.
fn encode_address(tagged: &[u8; 33]) -> [u8; 32] {
    keccak256(tagged)
}

fn encode_uint256(value: &U256) -> [u8; 32] {
    let mut be = [0u8; 32];
    value.to_big_endian(&mut be);
    be
}

const DOMAIN_TYPE_STRING: &[u8] =
    b"EIP712Domain(string name,string version,string chain_name,bytes32 contract_package_hash)";
const STRUCT_TYPE_STRING: &[u8] = b"TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";

/// The fields of the `TransferWithAuthorization` EIP-712 message.
pub struct TransferAuthMessage<'a> {
    /// 33-byte tagged address (`0x00`+account-hash).
    pub from: &'a [u8; 33],
    /// 33-byte tagged address (`0x00`+account-hash).
    pub to: &'a [u8; 33],
    pub value: U256,
    pub valid_after: U256,
    pub valid_before: U256,
    pub nonce: &'a [u8; 32],
}

/// `hashDomainSeparator` for `CASPER_DOMAIN_TYPES`
/// (name, version, chain_name, contract_package_hash).
pub fn domain_separator(
    name: &str,
    version: &str,
    chain_name: &str,
    contract_package_hash: &[u8; 32],
) -> [u8; 32] {
    let type_hash = keccak256(DOMAIN_TYPE_STRING);

    let mut buf = Vec::with_capacity(32 * 5);
    buf.extend_from_slice(&type_hash);
    buf.extend_from_slice(&keccak256(name.as_bytes()));
    buf.extend_from_slice(&keccak256(version.as_bytes()));
    buf.extend_from_slice(&keccak256(chain_name.as_bytes()));
    buf.extend_from_slice(contract_package_hash);
    keccak256(&buf)
}

/// `hashStruct("TransferWithAuthorization", ...)`.
pub fn struct_hash(msg: &TransferAuthMessage) -> [u8; 32] {
    let type_hash = keccak256(STRUCT_TYPE_STRING);

    let mut buf = Vec::with_capacity(32 * 7);
    buf.extend_from_slice(&type_hash);
    buf.extend_from_slice(&encode_address(msg.from));
    buf.extend_from_slice(&encode_address(msg.to));
    buf.extend_from_slice(&encode_uint256(&msg.value));
    buf.extend_from_slice(&encode_uint256(&msg.valid_after));
    buf.extend_from_slice(&encode_uint256(&msg.valid_before));
    buf.extend_from_slice(msg.nonce);
    keccak256(&buf)
}

/// `hashTypedDataFromHashes`: `keccak256(0x1901 || domainSeparator || structHash)`.
pub fn hash_typed_data(domain_separator: &[u8; 32], struct_hash: &[u8; 32]) -> [u8; 32] {
    let mut buf = [0u8; 66];
    buf[0] = 0x19;
    buf[1] = 0x01;
    buf[2..34].copy_from_slice(domain_separator);
    buf[34..66].copy_from_slice(struct_hash);
    keccak256(&buf)
}

/// Lowercase hex encoding, e.g. for embedding a digest in a signed message.
pub fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        write!(s, "{:02x}", b).unwrap();
    }
    s
}

/// The exact bytes the official Casper Wallet signs for `sigScheme:
/// "casperMessage"` (confirmed against two live payments on 2026-07-05 —
/// see `packages/casper-core/src/x402.ts`): `"Casper Message:\n"` followed by
/// the ASCII bytes of the digest's lowercase hex string.
pub fn casper_message_bytes(digest: &[u8; 32]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(16 + 64);
    msg.extend_from_slice(b"Casper Message:\n");
    msg.extend_from_slice(to_hex(digest).as_bytes());
    msg
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden vector shared with `packages/casper-core/src/core.test.ts`
    /// ("matches the casper-eip-712 Go reference digest") — same domain,
    /// message and expected digest, computed independently here in Rust.
    #[test]
    fn matches_the_casper_core_golden_vector() {
        let mut from = [0u8; 33];
        from[1..].fill(0xaa);
        let mut to = [0u8; 33];
        to[1..].fill(0xbb);
        let mut nonce = [0u8; 32];
        nonce.fill(0xcc);
        let mut asset = [0u8; 32];
        asset.fill(0xff);

        let domain = domain_separator("Cep18x402", "1", "casper:casper-test", &asset);
        let msg = TransferAuthMessage {
            from: &from,
            to: &to,
            value: U256::from(10_000u64),
            valid_after: U256::from(1_700_000_000u64 - 600),
            valid_before: U256::from(1_700_000_000u64 + 60),
            nonce: &nonce,
        };
        let digest = hash_typed_data(&domain, &struct_hash(&msg));

        assert_eq!(
            to_hex(&digest),
            "42acff6d170133ed7bb5c73023048a3b4ab81f55535200634e72c4e5518eb8d3"
        );
    }
}
