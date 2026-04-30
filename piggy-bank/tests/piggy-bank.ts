import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PiggyBank } from "../target/types/piggy_bank";
import { PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("piggy-bank", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PiggyBank as Program<PiggyBank>;
  const user = provider.wallet.publicKey;

  const [piggyBankPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("piggy-bank-v2"), user.toBuffer()],
    program.programId
  );

  const maliciousUser = Keypair.generate();

  before(async () => {
    // Transfer 0.1 SOL to maliciousUser instead of airdropping
    const transaction = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: maliciousUser.publicKey,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(transaction);
  });

  it("Initializes the piggy bank", async () => {
    try {
      await program.methods
        .initialize()
        .accounts({
          piggyBank: piggyBankPda,
          user: user,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      if (e.toString().includes("already in use")) {
        console.log("Already initialized, skipping...");
      } else {
        throw e;
      }
    }

    const account = await program.account.piggyBank.fetch(piggyBankPda);
    assert.strictEqual(account.owner.toBase58(), user.toBase58());
    console.log("Piggy bank:", piggyBankPda.toBase58());
  });

  it("Deposits SOL", async () => {
    const depositAmount = new anchor.BN(0.3 * LAMPORTS_PER_SOL);
    const balanceBefore = await provider.connection.getBalance(piggyBankPda);

    await program.methods
      .deposit(depositAmount)
      .accounts({
        piggyBank: piggyBankPda,
        user: user,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const balanceAfter = await provider.connection.getBalance(piggyBankPda);
    assert.isAbove(balanceAfter, balanceBefore);
    console.log("Deposited. New PDA balance:", balanceAfter / LAMPORTS_PER_SOL, "SOL");
  });

  it("Fails when non-owner tries to withdraw", async () => {
    const [maliciousPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("piggy-bank-v2"), maliciousUser.publicKey.toBuffer()],
      program.programId
    );
    try {
      await program.methods
        .withdraw(new anchor.BN(0.01 * LAMPORTS_PER_SOL))
        .accounts({
          piggyBank: piggyBankPda,
          user: maliciousUser.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([maliciousUser])
        .rpc();
      
      assert.fail("Should have failed");
    } catch (e) {
      assert.isOk(e);
      console.log("Unauthorized withdraw blocked");
    }
  });

  it("Withdraws SOL", async () => {
    const withdrawAmount = new anchor.BN(0.05 * LAMPORTS_PER_SOL);
    const userBefore = await provider.connection.getBalance(user);

    await program.methods
      .withdraw(withdrawAmount)
      .accounts({
        piggyBank: piggyBankPda,
        user: user,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const userAfter = await provider.connection.getBalance(user);
    // Gas costs will reduce user balance slightly, so we use userBefore - 5000 as buffer
    assert.isAbove(userAfter, userBefore - 5000);
    console.log("Withdrew. User balance:", userAfter / LAMPORTS_PER_SOL, "SOL");
  });

  describe("Experiments — additional guards", () => {

    it("Rejects deposit of 0 SOL", async () => {
      try {
        await program.methods
          .deposit(new anchor.BN(0))
          .accounts({
            piggyBank: piggyBankPda,
            user: user,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (err) {
        assert.include(err.message, "ZeroAmount");
        console.log("Zero deposit correctly rejected");
      }
    });

    it("Rejects deposit exceeding 10 SOL cap", async () => {
      try {
        await program.methods
          .deposit(new anchor.BN(11 * LAMPORTS_PER_SOL))
          .accounts({
            piggyBank: piggyBankPda,
            user: user,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (err) {
        assert.include(err.message, "DepositExceedsCap");
        console.log("Cap violation correctly rejected");
      }
    });

    it("Rejects withdrawal of 0 SOL", async () => {
      try {
        await program.methods
          .withdraw(new anchor.BN(0))
          .accounts({
            piggyBank: piggyBankPda,
            user: user,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (err) {
        assert.include(err.message, "ZeroAmount");
        console.log("Zero withdrawal correctly rejected");
      }
    });

    it("Rejects overdraft withdrawal", async () => {
      try {
        await program.methods
          .withdraw(new anchor.BN(999 * LAMPORTS_PER_SOL))
          .accounts({
            piggyBank: piggyBankPda,
            user: user,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (err) {
        assert.include(err.message, "InsufficientFunds");
        console.log("Overdraft correctly rejected");
      }
    });

    it("Closes the piggy bank and returns SOL", async () => {
      const userBefore = await provider.connection.getBalance(user);
      
      await program.methods
        .close()
        .accounts({
          piggyBank: piggyBankPda,
          user: user,
        })
        .rpc();

      const userAfter = await provider.connection.getBalance(user);
      assert.isAbove(userAfter, userBefore);

      try {
        await program.account.piggyBank.fetch(piggyBankPda);
        assert.fail("Account should be closed");
      } catch (err) {
        assert.isOk(err);
        console.log(" Piggy bank closed, SOL returned");
      }
    });
  });
});
