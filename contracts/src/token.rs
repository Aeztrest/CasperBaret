//! Cep18x402 — the demo CEP-18 token Baret uses for x402 settlement.
//!
//! Thin wrapper around the audited `odra_modules` CEP-18 so we can ship a
//! deployable token wasm for testnet. `init` mints the full initial supply to
//! the deployer, who then funds the PaymentGuard vault / x402 payers.
//!
//! Also implements `transfer_with_authorization`: an on-chain,
//! EIP-3009-style meta-transfer gated by an EIP-712 `TransferWithAuthorization`
//! signature (see `packages/casper-core/src/x402.ts`), so an x402 payment can
//! move tokens straight from payer to payee without a prior on-chain
//! `approve`. The contract independently re-derives the digest and the
//! signer's account hash — it never trusts a caller-supplied verdict.

use crate::eip712::{self, TransferAuthMessage};
use alloc::vec::Vec;
use odra::casper_types::{
    account::AccountHash,
    bytesrepr::{Bytes, FromBytes},
    crypto::verify as crypto_verify,
    PublicKey, Signature, U256,
};
use odra::prelude::*;
use odra_modules::cep18_token::Cep18;

#[odra::odra_error]
pub enum Cep18x402Error {
    /// The declared `public_key` does not hash to the claimed `from` account.
    InvalidSigner = 1,
    /// `public_key` bytes could not be decoded as a Casper public key.
    InvalidPublicKey = 2,
    /// `signature` bytes could not be decoded as a Casper signature.
    InvalidSignatureEncoding = 3,
    /// The EIP-712 signature does not verify against the rebuilt digest.
    InvalidSignature = 4,
    /// `now <= validAfter`.
    NotYetValid = 5,
    /// `now >= validBefore`.
    Expired = 6,
    /// This `(from, nonce)` authorization has already been settled.
    NonceAlreadyUsed = 7,
    /// `sig_scheme` was neither `"raw"` nor `"casperMessage"`.
    UnknownSigScheme = 8,
}

#[odra::event]
pub struct TransferWithAuthorizationSettled {
    pub from: Address,
    pub to: Address,
    pub amount: U256,
    pub nonce: [u8; 32],
}

#[odra::module]
pub struct Cep18x402 {
    token: SubModule<Cep18>,
    /// EIP-712 domain `chain_name`, e.g. "casper:casper-test".
    chain_name: Var<String>,
    /// EIP-712 domain `version`, e.g. "1".
    eip712_version: Var<String>,
    /// `(from account-hash ++ nonce)` -> settled, for TransferWithAuthorization replay protection.
    used_nonces: Mapping<Bytes, bool>,
}

#[odra::module]
impl Cep18x402 {
    pub fn init(
        &mut self,
        symbol: String,
        name: String,
        decimals: u8,
        initial_supply: U256,
        chain_name: String,
        eip712_version: String,
    ) {
        self.token.init(symbol, name, decimals, initial_supply);
        self.chain_name.set(chain_name);
        self.eip712_version.set(eip712_version);
    }

    pub fn transfer(&mut self, recipient: &Address, amount: &U256) {
        self.token.transfer(recipient, amount);
    }

    pub fn transfer_from(&mut self, owner: &Address, recipient: &Address, amount: &U256) {
        self.token.transfer_from(owner, recipient, amount);
    }

    pub fn approve(&mut self, spender: &Address, amount: &U256) {
        self.token.approve(spender, amount);
    }

    pub fn balance_of(&self, address: &Address) -> U256 {
        self.token.balance_of(address)
    }

    pub fn allowance(&self, owner: &Address, spender: &Address) -> U256 {
        self.token.allowance(owner, spender)
    }

    pub fn total_supply(&self) -> U256 {
        self.token.total_supply()
    }

    pub fn decimals(&self) -> u8 {
        self.token.decimals()
    }

    pub fn name(&self) -> String {
        self.token.name()
    }

    pub fn symbol(&self) -> String {
        self.token.symbol()
    }

    /// True if `(from, nonce)` has already been settled via
    /// `transfer_with_authorization`.
    pub fn authorization_state(&self, from: [u8; 32], nonce: [u8; 32]) -> bool {
        self.used_nonces.get(&nonce_key(&from, &nonce)).unwrap_or(false)
    }

    /// Settle an x402 `TransferWithAuthorization` payment on-chain: verify
    /// the EIP-712 signature and the signer's identity, then move `amount`
    /// from `from` to `to` — no prior `approve` required. Any caller may
    /// submit this (typically the facilitator paying gas); only a valid
    /// signature from `from`'s own key authorizes the transfer.
    ///
    /// `sig_scheme` is `"raw"` (Baret's own extension, signs the EIP-712
    /// digest directly) or `"casperMessage"` (wallets that only expose
    /// signMessage(string), e.g. the official Casper Wallet — confirmed to
    /// sign `"Casper Message:\n" + hex(digest)` as ASCII bytes; see
    /// `packages/casper-core/src/x402.ts`).
    #[allow(clippy::too_many_arguments)]
    pub fn transfer_with_authorization(
        &mut self,
        from: [u8; 32],
        to: [u8; 32],
        amount: U256,
        valid_after: U256,
        valid_before: U256,
        nonce: [u8; 32],
        public_key: Bytes,
        signature: Bytes,
        sig_scheme: String,
    ) {
        let (public_key, _) = <PublicKey as FromBytes>::from_bytes(public_key.as_slice())
            .unwrap_or_revert_with(&self.env(), Cep18x402Error::InvalidPublicKey);
        let (signature, _) = <Signature as FromBytes>::from_bytes(signature.as_slice())
            .unwrap_or_revert_with(&self.env(), Cep18x402Error::InvalidSignatureEncoding);

        // Bind the key to the claimed payer: a valid signature alone proves
        // nothing about who controls `from` unless it's also the account
        // this exact public key hashes to.
        if public_key.to_account_hash() != AccountHash::new(from) {
            self.env().revert(Cep18x402Error::InvalidSigner);
        }

        // `valid_after`/`valid_before` are unix seconds, as signed off-chain.
        let now_seconds = self.env().get_block_time_secs();
        if now_seconds <= u64_from_u256(valid_after) {
            self.env().revert(Cep18x402Error::NotYetValid);
        }
        if now_seconds >= u64_from_u256(valid_before) {
            self.env().revert(Cep18x402Error::Expired);
        }

        let key = nonce_key(&from, &nonce);
        if self.used_nonces.get(&key).unwrap_or(false) {
            self.env().revert(Cep18x402Error::NonceAlreadyUsed);
        }

        let mut from_tagged = [0u8; 33];
        from_tagged[1..].copy_from_slice(&from);
        let mut to_tagged = [0u8; 33];
        to_tagged[1..].copy_from_slice(&to);

        let package_hash = self.env().self_address().value();
        let domain = eip712::domain_separator(
            &self.token.name(),
            &self.eip712_version.get_or_default(),
            &self.chain_name.get_or_default(),
            &package_hash,
        );
        let message_hash = eip712::struct_hash(&TransferAuthMessage {
            from: &from_tagged,
            to: &to_tagged,
            value: amount,
            valid_after,
            valid_before,
            nonce: &nonce,
        });
        let digest = eip712::hash_typed_data(&domain, &message_hash);

        let signed_bytes: Vec<u8> = match sig_scheme.as_str() {
            "raw" => digest.to_vec(),
            "casperMessage" => eip712::casper_message_bytes(&digest),
            _ => self.env().revert(Cep18x402Error::UnknownSigScheme),
        };

        if crypto_verify(signed_bytes.as_slice(), &signature, &public_key).is_err() {
            self.env().revert(Cep18x402Error::InvalidSignature);
        }

        // Effects before the external-looking transfer (nonce marked used
        // first) — standard checks-effects-interactions ordering.
        self.used_nonces.set(&key, true);

        let from_addr = Address::from(AccountHash::new(from));
        let to_addr = Address::from(AccountHash::new(to));
        self.token.raw_transfer(&from_addr, &to_addr, &amount);

        self.env().emit_event(TransferWithAuthorizationSettled {
            from: from_addr,
            to: to_addr,
            amount,
            nonce,
        });
    }
}

fn nonce_key(from: &[u8; 32], nonce: &[u8; 32]) -> Bytes {
    let mut key = Vec::with_capacity(64);
    key.extend_from_slice(from);
    key.extend_from_slice(nonce);
    key.into()
}

/// `valid_after`/`valid_before` are unix-second timestamps that fit in a
/// `u64` in practice; saturate rather than panic on a pathological U256.
fn u64_from_u256(value: U256) -> u64 {
    if value > U256::from(u64::MAX) {
        u64::MAX
    } else {
        value.as_u64()
    }
}

#[cfg(test)]
mod tests {
    use super::{Cep18x402, Cep18x402Error, Cep18x402HostRef, Cep18x402InitArgs};
    use crate::eip712::{self, TransferAuthMessage};
    use odra::casper_types::bytesrepr::ToBytes;
    use odra::casper_types::crypto::{generate_ed25519_keypair, sign};
    use odra::casper_types::U256;
    use odra::host::{Deployer, HostEnv};
    use odra::prelude::{Address, Addressable};

    const DEC: u128 = 1_000_000_000; // 9 decimals
    const CHAIN_NAME: &str = "casper-net-1";
    const TOKEN_NAME: &str = "x402 USD";

    fn tokens(n: u128) -> U256 {
        U256::from(n * DEC)
    }

    fn setup() -> (HostEnv, Cep18x402HostRef) {
        let env = odra_test::env();
        let token = Cep18x402::deploy(
            &env,
            Cep18x402InitArgs {
                symbol: "X402".to_string(),
                name: TOKEN_NAME.to_string(),
                decimals: 9,
                initial_supply: U256::from(1_000_000u128 * DEC),
                chain_name: CHAIN_NAME.to_string(),
                eip712_version: "1".to_string(),
            },
        );
        (env, token)
    }

    /// Builds a valid `TransferWithAuthorization` signature for `(from, to,
    /// amount, nonce)` over the deployed token's own EIP-712 domain, using
    /// the given `sig_scheme` ("raw" or "casperMessage").
    #[allow(clippy::too_many_arguments)]
    fn sign_authorization(
        token: &Cep18x402HostRef,
        secret_key: &odra::casper_types::SecretKey,
        public_key: &odra::casper_types::PublicKey,
        from: [u8; 32],
        to: [u8; 32],
        amount: U256,
        valid_after: U256,
        valid_before: U256,
        nonce: [u8; 32],
        sig_scheme: &str,
    ) -> (odra::casper_types::bytesrepr::Bytes, odra::casper_types::bytesrepr::Bytes) {
        let package_hash = token.address().value();
        let domain = eip712::domain_separator(TOKEN_NAME, "1", CHAIN_NAME, &package_hash);

        let mut from_tagged = [0u8; 33];
        from_tagged[1..].copy_from_slice(&from);
        let mut to_tagged = [0u8; 33];
        to_tagged[1..].copy_from_slice(&to);

        let message_hash = eip712::struct_hash(&TransferAuthMessage {
            from: &from_tagged,
            to: &to_tagged,
            value: amount,
            valid_after,
            valid_before,
            nonce: &nonce,
        });
        let digest = eip712::hash_typed_data(&domain, &message_hash);
        let signed_bytes = match sig_scheme {
            "raw" => digest.to_vec(),
            "casperMessage" => eip712::casper_message_bytes(&digest),
            other => panic!("unknown sig_scheme in test helper: {other}"),
        };
        let signature = sign(signed_bytes, secret_key, public_key);

        (
            public_key.to_bytes().unwrap().into(),
            signature.to_bytes().unwrap().into(),
        )
    }

    #[test]
    fn transfer_with_authorization_moves_funds_with_a_valid_signature() {
        let (env, mut token) = setup();
        // MockVM genesis block time is 0; move forward so `now - 60` (validAfter)
        // doesn't saturate to 0 and collide with `now`.
        env.advance_block_time(120_000);
        let deployer = env.get_account(0);
        let merchant = env.get_account(1);

        let (secret_key, public_key) = generate_ed25519_keypair();
        let payer_hash = public_key.to_account_hash();
        let payer = Address::from(payer_hash);

        // Fund the payer address from the deployer's own balance (initial supply).
        env.set_caller(deployer);
        token.transfer(&payer, &tokens(100));

        let from = payer_hash.value();
        let to = merchant.as_account_hash().unwrap().value();
        let nonce = [7u8; 32];
        let now = env.block_time_secs();
        let valid_after = U256::from(now.saturating_sub(60));
        let valid_before = U256::from(now + 300);
        let amount = tokens(40);

        let (public_key_bytes, signature_bytes) = sign_authorization(
            &token, &secret_key, &public_key, from, to, amount, valid_after, valid_before, nonce, "raw",
        );

        // Anyone (e.g. the merchant paying gas) may relay a validly-signed authorization.
        env.set_caller(merchant);
        token.transfer_with_authorization(
            from,
            to,
            amount,
            valid_after,
            valid_before,
            nonce,
            public_key_bytes,
            signature_bytes,
            "raw".to_string(),
        );

        assert_eq!(token.balance_of(&payer), tokens(60));
        assert_eq!(token.balance_of(&merchant), tokens(40));
        assert!(token.authorization_state(from, nonce));
    }

    #[test]
    fn transfer_with_authorization_accepts_casper_message_scheme() {
        let (env, mut token) = setup();
        env.advance_block_time(120_000);
        let deployer = env.get_account(0);
        let merchant = env.get_account(1);

        let (secret_key, public_key) = generate_ed25519_keypair();
        let payer_hash = public_key.to_account_hash();
        let payer = Address::from(payer_hash);

        env.set_caller(deployer);
        token.transfer(&payer, &tokens(100));

        let from = payer_hash.value();
        let to = merchant.as_account_hash().unwrap().value();
        let nonce = [11u8; 32];
        let now = env.block_time_secs();
        let valid_after = U256::from(now.saturating_sub(60));
        let valid_before = U256::from(now + 300);
        let amount = tokens(25);

        let (public_key_bytes, signature_bytes) = sign_authorization(
            &token, &secret_key, &public_key, from, to, amount, valid_after, valid_before, nonce,
            "casperMessage",
        );

        env.set_caller(merchant);
        token.transfer_with_authorization(
            from,
            to,
            amount,
            valid_after,
            valid_before,
            nonce,
            public_key_bytes,
            signature_bytes,
            "casperMessage".to_string(),
        );

        assert_eq!(token.balance_of(&payer), tokens(75));
        assert_eq!(token.balance_of(&merchant), tokens(25));
    }

    #[test]
    fn transfer_with_authorization_rejects_unknown_sig_scheme() {
        let (env, mut token) = setup();
        env.advance_block_time(120_000);
        let deployer = env.get_account(0);
        let merchant = env.get_account(1);

        let (secret_key, public_key) = generate_ed25519_keypair();
        let payer_hash = public_key.to_account_hash();
        let payer = Address::from(payer_hash);

        env.set_caller(deployer);
        token.transfer(&payer, &tokens(100));

        let from = payer_hash.value();
        let to = merchant.as_account_hash().unwrap().value();
        let nonce = [13u8; 32];
        let now = env.block_time_secs();
        let valid_after = U256::from(now.saturating_sub(60));
        let valid_before = U256::from(now + 300);
        let amount = tokens(10);

        let (public_key_bytes, signature_bytes) = sign_authorization(
            &token, &secret_key, &public_key, from, to, amount, valid_after, valid_before, nonce, "raw",
        );

        env.set_caller(merchant);
        let res = token.try_transfer_with_authorization(
            from,
            to,
            amount,
            valid_after,
            valid_before,
            nonce,
            public_key_bytes,
            signature_bytes,
            "some-other-scheme".to_string(),
        );
        assert_eq!(res, Err(Cep18x402Error::UnknownSigScheme.into()));
    }

    #[test]
    fn transfer_with_authorization_rejects_replay() {
        let (env, mut token) = setup();
        env.advance_block_time(120_000);
        let deployer = env.get_account(0);
        let merchant = env.get_account(1);

        let (secret_key, public_key) = generate_ed25519_keypair();
        let payer_hash = public_key.to_account_hash();
        let payer = Address::from(payer_hash);

        env.set_caller(deployer);
        token.transfer(&payer, &tokens(100));

        let from = payer_hash.value();
        let to = merchant.as_account_hash().unwrap().value();
        let nonce = [9u8; 32];
        let now = env.block_time_secs();
        let valid_after = U256::from(now.saturating_sub(60));
        let valid_before = U256::from(now + 300);
        let amount = tokens(10);

        let (public_key_bytes, signature_bytes) = sign_authorization(
            &token, &secret_key, &public_key, from, to, amount, valid_after, valid_before, nonce, "raw",
        );

        env.set_caller(merchant);
        token.transfer_with_authorization(
            from,
            to,
            amount,
            valid_after,
            valid_before,
            nonce,
            public_key_bytes.clone(),
            signature_bytes.clone(),
            "raw".to_string(),
        );

        let res = token.try_transfer_with_authorization(
            from,
            to,
            amount,
            valid_after,
            valid_before,
            nonce,
            public_key_bytes,
            signature_bytes,
            "raw".to_string(),
        );
        assert_eq!(res, Err(Cep18x402Error::NonceAlreadyUsed.into()));
        assert_eq!(token.balance_of(&payer), tokens(90));
    }

    #[test]
    fn transfer_with_authorization_rejects_signer_from_address_mismatch() {
        let (env, mut token) = setup();
        let deployer = env.get_account(0);
        let merchant = env.get_account(1);

        // Attacker signs with their own key, but claims a victim's account
        // as `from` — this must fail even though the signature itself is
        // cryptographically valid (over the wrong signer's key).
        let (attacker_secret, attacker_public) = generate_ed25519_keypair();
        let (_victim_secret, victim_public) = generate_ed25519_keypair();
        let victim_hash = victim_public.to_account_hash();
        let victim = Address::from(victim_hash);

        env.set_caller(deployer);
        token.transfer(&victim, &tokens(100));

        let from = victim_hash.value();
        let to = merchant.as_account_hash().unwrap().value();
        let nonce = [3u8; 32];
        let now = env.block_time_secs();
        let valid_after = U256::from(now.saturating_sub(60));
        let valid_before = U256::from(now + 300);
        let amount = tokens(10);

        let (public_key_bytes, signature_bytes) = sign_authorization(
            &token, &attacker_secret, &attacker_public, from, to, amount, valid_after,
            valid_before, nonce, "raw",
        );

        env.set_caller(merchant);
        let res = token.try_transfer_with_authorization(
            from,
            to,
            amount,
            valid_after,
            valid_before,
            nonce,
            public_key_bytes,
            signature_bytes,
            "raw".to_string(),
        );
        assert_eq!(res, Err(Cep18x402Error::InvalidSigner.into()));
        assert_eq!(token.balance_of(&victim), tokens(100));
    }

    #[test]
    fn transfer_with_authorization_rejects_before_valid_after() {
        let (env, mut token) = setup();
        let deployer = env.get_account(0);
        let merchant = env.get_account(1);

        let (secret_key, public_key) = generate_ed25519_keypair();
        let payer_hash = public_key.to_account_hash();
        let payer = Address::from(payer_hash);

        env.set_caller(deployer);
        token.transfer(&payer, &tokens(100));

        let from = payer_hash.value();
        let to = merchant.as_account_hash().unwrap().value();
        let nonce = [5u8; 32];
        let now = env.block_time_secs();
        // Not valid until an hour from now.
        let valid_after = U256::from(now + 3600);
        let valid_before = U256::from(now + 7200);
        let amount = tokens(10);

        let (public_key_bytes, signature_bytes) = sign_authorization(
            &token, &secret_key, &public_key, from, to, amount, valid_after, valid_before, nonce, "raw",
        );

        env.set_caller(merchant);
        let res = token.try_transfer_with_authorization(
            from,
            to,
            amount,
            valid_after,
            valid_before,
            nonce,
            public_key_bytes,
            signature_bytes,
            "raw".to_string(),
        );
        assert_eq!(res, Err(Cep18x402Error::NotYetValid.into()));
    }
}
