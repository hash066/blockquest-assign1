use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("DboFn63MYFp8RgeAdYezYBn89V9jtWeGhwJYWACSuD62");

#[program]
pub mod piggy_bank {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let piggy_bank = &mut ctx.accounts.piggy_bank;
        piggy_bank.owner = ctx.accounts.user.key();
        piggy_bank.bump = ctx.bumps.piggy_bank;
        piggy_bank.deposit_count = 0;
        piggy_bank.withdraw_count = 0;
        piggy_bank.total_deposited = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let piggy_bank = &mut ctx.accounts.piggy_bank;
        
        require!(amount > 0, PiggyBankError::ZeroAmount);
        require!(
            piggy_bank.to_account_info().lamports() + amount <= 10_000_000_000,
            PiggyBankError::DepositExceedsCap
        );

        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: piggy_bank.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        piggy_bank.deposit_count += 1;
        piggy_bank.total_deposited += amount;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, PiggyBankError::ZeroAmount);
        require!(
            ctx.accounts.piggy_bank.to_account_info().lamports() >= amount + 890880,
            PiggyBankError::InsufficientFunds
        );

        let piggy_bank = &mut ctx.accounts.piggy_bank;
        let user = ctx.accounts.user.to_account_info();

        **piggy_bank.to_account_info().try_borrow_mut_lamports()? -= amount;
        **user.try_borrow_mut_lamports()? += amount;
        
        piggy_bank.withdraw_count += 1;

        Ok(())
    }

    pub fn close(_ctx: Context<Close>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = user,
        space = PiggyBank::LEN,
        seeds = [b"piggy-bank-v2", user.key().as_ref()],
        bump
    )]
    pub piggy_bank: Account<'info, PiggyBank>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"piggy-bank-v2", user.key().as_ref()],
        bump = piggy_bank.bump
    )]
    pub piggy_bank: Account<'info, PiggyBank>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        constraint = piggy_bank.owner == user.key(),
        seeds = [b"piggy-bank-v2", user.key().as_ref()],
        bump = piggy_bank.bump
    )]
    pub piggy_bank: Account<'info, PiggyBank>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(
        mut,
        close = user,
        constraint = piggy_bank.owner == user.key(),
        seeds = [b"piggy-bank-v2", user.key().as_ref()],
        bump = piggy_bank.bump
    )]
    pub piggy_bank: Account<'info, PiggyBank>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[account]
pub struct PiggyBank {
    pub owner: Pubkey,
    pub bump: u8,
    pub deposit_count: u64,
    pub withdraw_count: u64,
    pub total_deposited: u64,
}

impl PiggyBank {
    pub const LEN: usize = 8 + 32 + 1 + 8 + 8 + 8;
}

#[error_code]
pub enum PiggyBankError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Deposit would exceed 10 SOL maximum balance")]
    DepositExceedsCap,
    #[msg("Insufficient funds in piggy bank")]
    InsufficientFunds,
}
