//! Baret PaymentGuard — an on-chain spending-limit vault for x402 / agentic
//! micropayments on Casper.
//!
//! The on-chain counterpart of Baret's off-chain x402 firewall
//! (`packages/casper-guard`): the wallet owner deposits a CEP-18 token and
//! grants each merchant a per-transaction cap plus a rolling 24-hour cap. An
//! agent can then call [`PaymentGuard::pay`] to settle payments **without the
//! owner signing each one** — the caps ARE the firewall. Payments above a cap,
//! to an unregistered merchant, or to a paused/revoked merchant revert on-chain.

use odra::casper_types::U256;
use odra::prelude::*;
use odra::ContractRef;
use odra_modules::cep18_token::Cep18ContractRef;

/// Rolling window length: 24h in milliseconds (Casper block time is ms).
const DAY_MS: u64 = 86_400_000;

#[odra::odra_type]
pub enum Status {
    Active,
    Paused,
    Revoked,
}

#[odra::odra_type]
pub struct Allowance {
    /// Largest single payment allowed to this merchant (atomic units).
    pub cap_per_tx: U256,
    /// Cumulative spend allowed per rolling 24h window (atomic units).
    pub cap_per_day: U256,
    /// Spend recorded in the current rolling window.
    pub spent_day: U256,
    /// Block time (ms) the current rolling window started.
    pub day_start: u64,
    pub status: Status,
}

#[odra::odra_error]
pub enum Error {
    AlreadyInitialized = 1,
    NotOwner = 2,
    NoAllowance = 3,
    NotActive = 4,
    ExceedsPerTx = 5,
    ExceedsDailyCap = 6,
    InvalidAmount = 7,
    /// `pay` was called by an account that is neither the owner nor the
    /// designated agent.
    NotAuthorizedAgent = 8,
}

#[odra::event]
pub struct AllowanceSet {
    pub merchant: Address,
    pub cap_per_tx: U256,
    pub cap_per_day: U256,
}

#[odra::event]
pub struct Paid {
    pub merchant: Address,
    pub amount: U256,
}

#[odra::module]
pub struct PaymentGuard {
    owner: Var<Address>,
    token: Var<Address>,
    initialized: Var<bool>,
    allowances: Mapping<Address, Allowance>,
    /// The agent wallet the owner has delegated day-to-day `pay` calls to.
    /// Unset until `set_agent` is called — until then only the owner may
    /// call `pay`. Without this, any third party could force the vault to
    /// pay an already-approved merchant ahead of schedule, e.g. to grief the
    /// rolling daily cap before the real agent needs it.
    agent: Var<Address>,
}

#[odra::module]
impl PaymentGuard {
    /// One-time setup: record the owning account and the CEP-18 token
    /// (contract address) this vault spends in.
    pub fn init(&mut self, owner: Address, token: Address) {
        if self.initialized.get_or_default() {
            self.env().revert(Error::AlreadyInitialized);
        }
        self.owner.set(owner);
        self.token.set(token);
        self.initialized.set(true);
    }

    /// Grant or update a merchant's caps. Owner-only. Resets the merchant to
    /// `Active` and starts a fresh rolling window.
    pub fn set_allowance(&mut self, merchant: Address, cap_per_tx: U256, cap_per_day: U256) {
        self.require_owner();
        self.allowances.set(
            &merchant,
            Allowance {
                cap_per_tx,
                cap_per_day,
                spent_day: U256::zero(),
                day_start: self.env().get_block_time(),
                status: Status::Active,
            },
        );
        self.env().emit_event(AllowanceSet {
            merchant,
            cap_per_tx,
            cap_per_day,
        });
    }

    pub fn pause(&mut self, merchant: Address) {
        self.set_status(merchant, Status::Paused);
    }

    pub fn resume(&mut self, merchant: Address) {
        self.set_status(merchant, Status::Active);
    }

    pub fn revoke(&mut self, merchant: Address) {
        self.set_status(merchant, Status::Revoked);
    }

    /// Delegate day-to-day `pay` calls to `agent` (typically the agent's own
    /// hot wallet). Owner-only. Pass the owner's own address to revoke
    /// delegation and restrict `pay` back to the owner alone.
    pub fn set_agent(&mut self, agent: Address) {
        self.require_owner();
        self.agent.set(agent);
    }

    pub fn get_agent(&self) -> Option<Address> {
        self.agent.get()
    }

    /// Fund the vault. The caller must have `approve`d this contract for
    /// `amount` on the CEP-18 token first; this pulls the tokens in.
    pub fn deposit(&mut self, amount: U256) {
        if amount.is_zero() {
            self.env().revert(Error::InvalidAmount);
        }
        let caller = self.env().caller();
        let me = self.env().self_address();
        self.token_ref().transfer_from(&caller, &me, &amount);
    }

    /// Agentic spend. **No owner signature required for each payment** — the
    /// per-tx and rolling daily caps the owner set are the firewall. Only the
    /// owner or the owner-designated agent (`set_agent`) may call this;
    /// otherwise any third party could force the vault to pay an
    /// already-approved merchant ahead of schedule, exhausting the daily cap
    /// before the real agent needs it. Reverts if the caller isn't
    /// authorized, the merchant is unregistered, paused/revoked, or the
    /// payment would breach a cap.
    pub fn pay(&mut self, merchant: Address, amount: U256) {
        self.require_owner_or_agent();
        if amount.is_zero() {
            self.env().revert(Error::InvalidAmount);
        }
        let mut allowance = self
            .allowances
            .get(&merchant)
            .unwrap_or_revert_with(&self.env(), Error::NoAllowance);

        if allowance.status != Status::Active {
            self.env().revert(Error::NotActive);
        }
        if amount > allowance.cap_per_tx {
            self.env().revert(Error::ExceedsPerTx);
        }

        // Roll the 24h window forward if it has elapsed.
        let now = self.env().get_block_time();
        if now.saturating_sub(allowance.day_start) >= DAY_MS {
            allowance.spent_day = U256::zero();
            allowance.day_start = now;
        }
        if allowance.spent_day + amount > allowance.cap_per_day {
            self.env().revert(Error::ExceedsDailyCap);
        }

        // Settle from the vault to the merchant, then record the spend.
        self.token_ref().transfer(&merchant, &amount);
        allowance.spent_day += amount;
        self.allowances.set(&merchant, allowance);

        self.env().emit_event(Paid { merchant, amount });
    }

    /// Owner pulls funds back out of the vault.
    pub fn withdraw(&mut self, amount: U256) {
        let owner = self.require_owner();
        if amount.is_zero() {
            self.env().revert(Error::InvalidAmount);
        }
        self.token_ref().transfer(&owner, &amount);
    }

    /* ───────────── views ───────────── */

    pub fn get_owner(&self) -> Address {
        self.owner.get().unwrap_or_revert_with(&self.env(), Error::NoAllowance)
    }

    pub fn get_token(&self) -> Address {
        self.token.get().unwrap_or_revert_with(&self.env(), Error::NoAllowance)
    }

    pub fn get_allowance(&self, merchant: Address) -> Option<Allowance> {
        self.allowances.get(&merchant)
    }

    /// Remaining spendable amount for a merchant in the current window.
    pub fn available_today(&self, merchant: Address) -> U256 {
        match self.allowances.get(&merchant) {
            None => U256::zero(),
            Some(a) => {
                if a.status != Status::Active {
                    return U256::zero();
                }
                let now = self.env().get_block_time();
                let spent = if now.saturating_sub(a.day_start) >= DAY_MS {
                    U256::zero()
                } else {
                    a.spent_day
                };
                if a.cap_per_day > spent {
                    a.cap_per_day - spent
                } else {
                    U256::zero()
                }
            }
        }
    }

    /* ───────────── internals ───────────── */

    fn require_owner(&self) -> Address {
        let owner = self
            .owner
            .get()
            .unwrap_or_revert_with(&self.env(), Error::NotOwner);
        if self.env().caller() != owner {
            self.env().revert(Error::NotOwner);
        }
        owner
    }

    fn require_owner_or_agent(&self) {
        let owner = self
            .owner
            .get()
            .unwrap_or_revert_with(&self.env(), Error::NotOwner);
        let caller = self.env().caller();
        let is_agent = self.agent.get().map(|a| a == caller).unwrap_or(false);
        if caller != owner && !is_agent {
            self.env().revert(Error::NotAuthorizedAgent);
        }
    }

    fn set_status(&mut self, merchant: Address, status: Status) {
        self.require_owner();
        let mut a = self
            .allowances
            .get(&merchant)
            .unwrap_or_revert_with(&self.env(), Error::NoAllowance);
        a.status = status;
        self.allowances.set(&merchant, a);
    }

    fn token_ref(&self) -> Cep18ContractRef {
        Cep18ContractRef::new(
            self.env(),
            self.token.get().unwrap_or_revert_with(&self.env(), Error::NoAllowance),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{Error, PaymentGuard, PaymentGuardHostRef, PaymentGuardInitArgs, Status};
    use crate::token::{Cep18x402, Cep18x402HostRef, Cep18x402InitArgs};
    use odra::casper_types::U256;
    use odra::host::{Deployer, HostEnv, HostRef};
    use odra::prelude::Addressable;

    const DEC: u128 = 1_000_000_000; // 9 decimals
    const DAY_MS: u64 = 86_400_000;

    fn tokens(n: u128) -> U256 {
        U256::from(n * DEC)
    }

    fn setup() -> (HostEnv, Cep18x402HostRef, PaymentGuardHostRef) {
        let env = odra_test::env();
        let owner = env.get_account(0);
        let token = Cep18x402::deploy(
            &env,
            Cep18x402InitArgs {
                symbol: "X402".to_string(),
                name: "x402 USD".to_string(),
                decimals: 9,
                initial_supply: U256::from(1_000_000u128 * DEC),
                chain_name: "casper-net-1".to_string(),
                eip712_version: "1".to_string(),
            },
        );
        let guard = PaymentGuard::deploy(
            &env,
            PaymentGuardInitArgs {
                owner,
                token: token.address(),
            },
        );
        (env, token, guard)
    }

    /// Owner funds the vault with `amount` whole tokens.
    fn fund(env: &HostEnv, token: &mut Cep18x402HostRef, guard: &mut PaymentGuardHostRef, amount: u128) {
        let owner = env.get_account(0);
        env.set_caller(owner);
        token.approve(&guard.address(), &tokens(amount));
        guard.deposit(tokens(amount));
    }

    #[test]
    fn init_records_owner_and_token() {
        let (_env, token, guard) = setup();
        assert_eq!(guard.get_owner(), guard.env().get_account(0));
        assert_eq!(guard.get_token(), token.address());
    }

    #[test]
    fn double_init_reverts() {
        // Odra treats `init` as a constructor — the VM itself refuses a second
        // call. (The in-contract `AlreadyInitialized` guard is belt-and-suspenders.)
        let (_env, token, mut guard) = setup();
        let owner = guard.env().get_account(0);
        let res = guard.try_init(owner, token.address());
        assert!(res.is_err());
    }

    #[test]
    fn pay_within_caps_settles_and_records_spend() {
        let (env, mut token, mut guard) = setup();
        let merchant = env.get_account(1);
        fund(&env, &mut token, &mut guard, 1_000);

        env.set_caller(env.get_account(0));
        guard.set_allowance(merchant, tokens(100), tokens(250));
        guard.set_agent(env.get_account(2));

        // The designated agent (not the owner) settles a payment.
        env.set_caller(env.get_account(2));
        guard.pay(merchant, tokens(40));

        assert_eq!(token.balance_of(&merchant), tokens(40));
        assert_eq!(guard.available_today(merchant), tokens(210));
    }

    #[test]
    fn pay_above_per_tx_cap_reverts() {
        let (env, mut token, mut guard) = setup();
        let merchant = env.get_account(1);
        fund(&env, &mut token, &mut guard, 1_000);
        env.set_caller(env.get_account(0));
        guard.set_allowance(merchant, tokens(100), tokens(250));

        let res = guard.try_pay(merchant, tokens(150));
        assert_eq!(res, Err(Error::ExceedsPerTx.into()));
        assert_eq!(token.balance_of(&merchant), U256::zero());
    }

    #[test]
    fn cumulative_spend_past_daily_cap_reverts() {
        let (env, mut token, mut guard) = setup();
        let merchant = env.get_account(1);
        fund(&env, &mut token, &mut guard, 1_000);
        env.set_caller(env.get_account(0));
        guard.set_allowance(merchant, tokens(100), tokens(250));

        guard.pay(merchant, tokens(100));
        guard.pay(merchant, tokens(100));
        // 200 spent, cap 250 → a third 100 would hit 300 > 250.
        let res = guard.try_pay(merchant, tokens(100));
        assert_eq!(res, Err(Error::ExceedsDailyCap.into()));
        assert_eq!(token.balance_of(&merchant), tokens(200));
    }

    #[test]
    fn rolling_window_resets_after_24h() {
        let (env, mut token, mut guard) = setup();
        let merchant = env.get_account(1);
        fund(&env, &mut token, &mut guard, 1_000);
        env.set_caller(env.get_account(0));
        guard.set_allowance(merchant, tokens(100), tokens(250));

        guard.pay(merchant, tokens(100));
        guard.pay(merchant, tokens(100));
        assert_eq!(guard.available_today(merchant), tokens(50));

        env.advance_block_time(DAY_MS + 1);
        // Window rolled over → full daily cap available again.
        guard.pay(merchant, tokens(100));
        assert_eq!(token.balance_of(&merchant), tokens(300));
    }

    #[test]
    fn pay_to_unregistered_merchant_reverts() {
        let (env, _token, mut guard) = setup();
        let merchant = env.get_account(3);
        let res = guard.try_pay(merchant, tokens(1));
        assert_eq!(res, Err(Error::NoAllowance.into()));
    }

    #[test]
    fn pay_to_revoked_merchant_reverts() {
        let (env, mut token, mut guard) = setup();
        let merchant = env.get_account(1);
        fund(&env, &mut token, &mut guard, 1_000);
        env.set_caller(env.get_account(0));
        guard.set_allowance(merchant, tokens(100), tokens(250));
        guard.revoke(merchant);

        let res = guard.try_pay(merchant, tokens(10));
        assert_eq!(res, Err(Error::NotActive.into()));

        // Owner can resume and then it works again.
        env.set_caller(env.get_account(0));
        guard.resume(merchant);
        guard.pay(merchant, tokens(10));
        assert_eq!(token.balance_of(&merchant), tokens(10));
    }

    #[test]
    fn only_owner_can_set_allowance() {
        let (env, _token, mut guard) = setup();
        let merchant = env.get_account(1);
        env.set_caller(env.get_account(5));
        let res = guard.try_set_allowance(merchant, tokens(100), tokens(250));
        assert_eq!(res, Err(Error::NotOwner.into()));
    }

    #[test]
    fn pay_rejects_unauthorized_caller() {
        // A third party — not the owner, and no agent has been designated —
        // must not be able to force the vault to pay an approved merchant.
        let (env, mut token, mut guard) = setup();
        let merchant = env.get_account(1);
        fund(&env, &mut token, &mut guard, 1_000);
        env.set_caller(env.get_account(0));
        guard.set_allowance(merchant, tokens(100), tokens(250));

        env.set_caller(env.get_account(5));
        let res = guard.try_pay(merchant, tokens(10));
        assert_eq!(res, Err(Error::NotAuthorizedAgent.into()));
        assert_eq!(token.balance_of(&merchant), U256::zero());
    }

    #[test]
    fn pay_rejects_stale_agent_after_reassignment() {
        let (env, mut token, mut guard) = setup();
        let merchant = env.get_account(1);
        fund(&env, &mut token, &mut guard, 1_000);
        env.set_caller(env.get_account(0));
        guard.set_allowance(merchant, tokens(100), tokens(250));
        guard.set_agent(env.get_account(2));
        guard.set_agent(env.get_account(3));

        // The previously-designated agent is no longer authorized.
        env.set_caller(env.get_account(2));
        let res = guard.try_pay(merchant, tokens(10));
        assert_eq!(res, Err(Error::NotAuthorizedAgent.into()));

        // The newly-designated agent is.
        env.set_caller(env.get_account(3));
        guard.pay(merchant, tokens(10));
        assert_eq!(token.balance_of(&merchant), tokens(10));
    }

    #[test]
    fn only_owner_can_set_agent() {
        let (env, _token, mut guard) = setup();
        env.set_caller(env.get_account(5));
        let res = guard.try_set_agent(env.get_account(5));
        assert_eq!(res, Err(Error::NotOwner.into()));
    }

    #[test]
    fn owner_can_withdraw() {
        let (env, mut token, mut guard) = setup();
        fund(&env, &mut token, &mut guard, 1_000);
        let owner = env.get_account(0);
        let before = token.balance_of(&owner);
        env.set_caller(owner);
        guard.withdraw(tokens(400));
        assert_eq!(token.balance_of(&owner), before + tokens(400));
    }

    #[test]
    fn pause_blocks_then_status_reflected() {
        let (env, mut token, mut guard) = setup();
        let merchant = env.get_account(1);
        fund(&env, &mut token, &mut guard, 1_000);
        env.set_caller(env.get_account(0));
        guard.set_allowance(merchant, tokens(100), tokens(250));
        guard.pause(merchant);
        let a = guard.get_allowance(merchant).unwrap();
        assert!(a.status == Status::Paused);
        let res = guard.try_pay(merchant, tokens(1));
        assert_eq!(res, Err(Error::NotActive.into()));
    }
}
