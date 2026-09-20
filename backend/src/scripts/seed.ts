/**
 * Seeds the demo data.
 *
 * Run from the project root:  npm run seed
 *   --mock-only   skip Nessie entirely and populate only the local mirror
 *   --force       re-push every transaction, even ones already in Nessie
 *   --reset       wipe local subscriptions, plans, alerts and cards first
 *
 * SAFE TO RE-RUN. Nessie has no external-id field and no bulk delete, so
 * idempotency is by natural key:
 *   - the demo customer is matched on first + last name
 *   - accounts are matched on nickname within that customer
 *   - merchants are matched on name
 *   - transactions are matched on source + date + amount + description, so a
 *     re-run pushes only what is missing rather than duplicating history
 *
 * The local mirror is always rebuilt from scratch, so it converges regardless.
 */
import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { nessie, NessieError, redact } from '../nessie/client.js';
import { centsToDollars, dollarsToCents } from '../lib/utils.js';
import { generateDemoDataset, type DemoDataset } from '../data/demoDataset.js';
import { DEMO_CUSTOMER_FIRST_NAME, DEMO_CUSTOMER_LAST_NAME } from '../data/nessieProvider.js';
import {
  annotateWithNessieIds,
  createMockProvider,
  emptyIdMap,
  type NessieIdMap,
} from '../data/provider.js';
import { syncSnapshot } from '../data/sync.js';
import {
  mirrorBillToNessie,
  pruneDuplicateBills,
  refreshSubscriptions,
} from '../services/subscriptions.js';

const args = new Set(process.argv.slice(2));
const MOCK_ONLY = args.has('--mock-only');
const FORCE = args.has('--force');
const RESET = args.has('--reset');

const prisma = new PrismaClient();

function log(message: string): void {
  console.log(`[seed] ${message}`);
}

/** Pushes the dataset to Nessie and returns the ids it hands back. */
async function seedNessie(dataset: DemoDataset): Promise<NessieIdMap> {
  const ids = emptyIdMap();

  // --- customer ---
  const customers = await nessie.listCustomers();
  let customer = customers.find(
    (c) => c.first_name === DEMO_CUSTOMER_FIRST_NAME && c.last_name === DEMO_CUSTOMER_LAST_NAME,
  );

  if (customer) {
    log(`Reusing demo customer ${customer._id}.`);
  } else {
    customer = await nessie.createCustomer({
      first_name: dataset.customer.firstName,
      last_name: dataset.customer.lastName,
      address: dataset.customer.address,
    });
    log(`Created demo customer ${customer._id}.`);
  }
  ids.customerId = customer._id;

  // --- accounts, matched on nickname ---
  const existingAccounts = await nessie.listCustomerAccounts(customer._id);
  const accountIdByKey = ids.accountIdByKey;

  for (const blueprint of dataset.accounts) {
    const existing = existingAccounts.find((a) => a.nickname === blueprint.nickname);
    if (existing) {
      accountIdByKey.set(blueprint.key, existing._id);
      continue;
    }

    const created = await nessie.createAccount(customer._id, {
      type: blueprint.type,
      nickname: blueprint.nickname,
      rewards: centsToDollars(blueprint.rewardsCents ?? 0),
      balance: centsToDollars(blueprint.balanceCents),
    });
    accountIdByKey.set(blueprint.key, created._id);
    log(`Created account "${blueprint.nickname}".`);
  }

  // --- merchants, matched on name ---
  const existingMerchants = await nessie.listMerchants();
  const merchantIdByKey = ids.merchantIdByKey;

  for (const merchant of dataset.merchants) {
    const existing = existingMerchants.find((m) => m.name === merchant.name);
    if (existing) {
      merchantIdByKey.set(merchant.key, existing._id);
      continue;
    }

    const created = await nessie.createMerchant({
      name: merchant.name,
      category: merchant.category,
      address: dataset.customer.address,
    });
    merchantIdByKey.set(merchant.key, created._id);
  }
  log(`${merchantIdByKey.size} merchants present.`);

  // --- transactions ---
  const creditAccountId = accountIdByKey.get('credit');
  if (!creditAccountId) throw new Error('Credit account missing after seeding.');

  // Nessie has no external-id field, so a transaction is identified by its
  // natural signature and anything already present is skipped.
  const existing = new Set<string>();

  // Compared in WHOLE DOLLARS, because Nessie truncates cents on write: a $15.49
  // charge reads back as 15, so matching on cents would never hit and every
  // re-run would duplicate the entire history.
  const signature = (
    source: string,
    date: string,
    amountCents: number,
    description: string,
  ): string =>
    `${source}|${date.slice(0, 10)}|${Math.floor(Math.abs(amountCents) / 100)}|${description}`;

  for (const [, accountId] of accountIdByKey) {
    const [purchases, deposits, withdrawals, transfers] = await Promise.all([
      nessie.listPurchases(accountId),
      nessie.listDeposits(accountId),
      nessie.listWithdrawals(accountId),
      nessie.listTransfers(accountId),
    ]);

    for (const p of purchases) {
      existing.add(signature('purchase', p.purchase_date, dollarsToCents(p.amount), p.description ?? ''));
    }
    for (const d of deposits) {
      existing.add(signature('deposit', d.transaction_date, dollarsToCents(d.amount), d.description ?? ''));
    }
    for (const w of withdrawals) {
      existing.add(signature('withdrawal', w.transaction_date, dollarsToCents(w.amount), w.description ?? ''));
    }
    for (const t of transfers) {
      existing.add(signature('transfer', t.transaction_date, dollarsToCents(t.amount), t.description ?? ''));
    }
  }

  if (existing.size > 0) {
    log(`Nessie already holds ${existing.size} transactions — only missing ones will be pushed.`);
  }

  let created = 0;
  let failed = 0;
  let skipped = 0;

  for (const transaction of dataset.transactions) {
    const accountId = accountIdByKey.get(transaction.accountKey);
    if (!accountId) continue;

    const key = signature(
      transaction.source,
      transaction.date,
      transaction.amountCents,
      transaction.description,
    );
    if (existing.has(key) && !FORCE) {
      skipped++;
      continue;
    }

    // Nessie takes positive amounts; direction is implied by the endpoint.
    const amount = centsToDollars(Math.abs(transaction.amountCents));

    try {
      if (transaction.source === 'purchase') {
        const merchantId = transaction.merchantKey
          ? merchantIdByKey.get(transaction.merchantKey)
          : undefined;
        if (!merchantId) continue; // a purchase without a merchant is meaningless

        const made = await nessie.createPurchase(accountId, {
          merchant_id: merchantId,
          medium: 'balance',
          purchase_date: transaction.date,
          amount,
          status: 'completed',
          description: transaction.description,
        });
        if (made?._id) ids.transactionIdByKey.set(transaction.key, made._id);
      } else if (transaction.source === 'deposit') {
        const made = await nessie.createDeposit(accountId, {
          type: 'deposit',
          transaction_date: transaction.date,
          status: 'completed',
          medium: 'balance',
          amount,
          description: transaction.description,
        });
        if (made?._id) ids.transactionIdByKey.set(transaction.key, made._id);
      } else {
        // Everything that is not a deposit or purchase is a withdrawal or transfer.
        if (transaction.source === 'transfer') {
          // Nessie can't record a destination account, so this is the outbound leg only.
          await nessie.createTransfer(accountId, {
            transaction_date: transaction.date,
            status: 'completed',
            amount,
            description: transaction.description,
          });
        } else {
          await nessie.createWithdrawal(accountId, {
            transaction_date: transaction.date,
            status: 'completed',
            medium: 'balance',
            amount,
            description: transaction.description,
          });
        }
      }
      created++;
    } catch (error) {
      failed++;
      // One rejected record must not abort a 700-record seed; report and move on.
      if (failed <= 3) {
        const detail =
          error instanceof NessieError
            ? `HTTP ${error.status} ${error.body ?? ''}`
            : redact(error instanceof Error ? error.message : String(error));
        log(`  ! ${transaction.description} on ${transaction.date} rejected: ${detail}`);
      }
    }
  }

  log(
    `Pushed ${created} transactions to Nessie` +
      `${skipped ? `, skipped ${skipped} already present` : ''}` +
      `${failed ? `, ${failed} rejected` : ''}.`,
  );
  return ids;
}

/**
 * Clears everything Orbit owns, so a demo can be run from a known state. Mirrors
 * of Nessie data are left alone — the sync rebuilds those anyway.
 */
async function resetLocalState(): Promise<void> {
  await prisma.alert.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.virtualCard.deleteMany();
  await prisma.subscriptionGuardRule.deleteMany();
  await prisma.installmentPayment.deleteMany();
  await prisma.installmentPlan.deleteMany();
  await prisma.subscription.deleteMany();
  log('Reset subscriptions, plans, alerts and virtual cards.');
}

async function main(): Promise<void> {
  if (RESET) await resetLocalState();

  const dataset = generateDemoDataset();
  log(
    `Generated dataset: ${dataset.accounts.length} accounts, ${dataset.merchants.length} merchants, ${dataset.transactions.length} transactions.`,
  );

  let ids = emptyIdMap();
  let pushedToNessie = false;

  if (MOCK_ONLY) {
    log('--mock-only: skipping Nessie.');
  } else if (config.nessie.useMockData) {
    log('USE_MOCK_DATA=true: skipping Nessie.');
  } else if (!config.nessie.hasKey) {
    log('No NESSIE_API_KEY: skipping Nessie.');
  } else {
    try {
      ids = await seedNessie(dataset);
      pushedToNessie = true;
    } catch (error) {
      const detail =
        error instanceof NessieError
          ? `HTTP ${error.status} ${error.body ?? ''}`
          : redact(error instanceof Error ? error.message : String(error));
      log(`Nessie seeding failed (${detail}) — the local mirror is still built below.`);
    }
  }

  // Always built from the exact dataset, never read back from Nessie, because
  // Nessie truncates money to whole dollars. See provider.ts.
  log('Building the local mirror from the exact dataset...');
  const snapshot = annotateWithNessieIds(await createMockProvider().fetchSnapshot(), ids);
  const result = await syncSnapshot(prisma, snapshot);

  if (pushedToNessie) {
    log(`Linked to Nessie: ${ids.accountIdByKey.size} accounts, ${ids.merchantIdByKey.size} merchants.`);
  }

  log(
    `Mirror ready: ${result.accounts} accounts, ${result.merchants} merchants, ${result.transactions} transactions.`,
  );

  // Run detection, then mirror each subscription into Nessie as a real recurring
  // bill. Doing it here rather than on first page load means the Nessie account
  // is fully populated the moment the seed finishes.
  const customer = await prisma.customer.findFirst({ where: { isDemoUser: true } });
  if (customer) {
    const detected = await refreshSubscriptions(prisma, customer.id);
    log(`Detected ${detected.length} subscriptions.`);

    if (pushedToNessie) {
      let mirrored = 0;
      for (const subscription of detected) {
        if (await mirrorBillToNessie(prisma, subscription.id)) mirrored++;
      }
      log(`Mirrored ${mirrored} subscriptions into Nessie as recurring bills.`);

      const card = await prisma.account.findFirst({
        where: { customerId: customer.id, type: 'Credit Card' },
      });
      if (card) {
        const pruned = await pruneDuplicateBills(prisma, card.id);
        if (pruned > 0) log(`Removed ${pruned} duplicate bills left by earlier seeds.`);
      }
    }
  }

  console.log('\nPlanted demo scenarios:');
  for (const { merchantKey, scenario } of dataset.scenarios) {
    if (scenario.kind === 'normal') continue;
    const merchant = dataset.merchants.find((m) => m.key === merchantKey);
    console.log(`  - ${merchant?.name}: ${scenario.kind.replace(/_/g, ' ')}`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error('[seed] failed:', redact(error instanceof Error ? error.stack ?? error.message : String(error)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
