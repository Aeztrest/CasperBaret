//! Cep18x402 — the demo CEP-18 token Baret uses for x402 settlement.
//!
//! Thin wrapper around the audited `odra_modules` CEP-18 so we can ship a
//! deployable token wasm for testnet. `init` mints the full initial supply to
//! the deployer, who then funds the PaymentGuard vault / x402 payers.

use odra::casper_types::U256;
use odra::prelude::*;
use odra_modules::cep18_token::Cep18;

#[odra::module]
pub struct Cep18x402 {
    token: SubModule<Cep18>,
}

#[odra::module]
impl Cep18x402 {
    pub fn init(&mut self, symbol: String, name: String, decimals: u8, initial_supply: U256) {
        self.token.init(symbol, name, decimals, initial_supply);
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
}
