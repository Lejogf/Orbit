// Reads Nessie and merges its four transaction collections into one signed list:
//   purchases/withdrawals -> negative, deposits -> positive,
//   transfers -> sign depends on whether this account is the payer.
//
// NOTE: amounts read back from Nessie are truncated to whole dollars (see
// annotateWithNessieIds in provider.ts). The seed does not use this path.
import { nessie } from '../nessie/client.js';
import { transferId } from '../nessie/types.js';
import { dollarsToCents } from '../lib/utils.js';
import type {
  DataProvider,
  DataSnapshot,
  SnapshotAccount,
  SnapshotMerchant,
  SnapshotTransaction,
} from './provider.js';
import type { AccountType } from '../domain/types.js';
import { RECURRING_MERCHANTS } from './demoDataset.js';

// Nessie has no external-id field, so the demo customer is found by name.
export const DEMO_CUSTOMER_FIRST_NAME = 'Jordan';
export const DEMO_CUSTOMER_LAST_NAME = 'Rivera';

// Nessie has no cancel-url field; re-attach ours by merchant name.
const CANCEL_URLS = new Map(RECURRING_MERCHANTS.map((m) => [m.name, m.cancelUrl]));

/** Nessie's category is sometimes a string, sometimes an array. */
function normaliseCategory(category: string | string[] | undefined): string {
  if (Array.isArray(category)) return category[0] ?? 'Other';
  return category ?? 'Other';
}


function toIsoTimestamp(date: string | undefined, fallback: string): string {
  if (!date) return fallback;
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function last4(accountNumber: string | undefined, fallback: string): string {
  if (!accountNumber || accountNumber.length < 4) return fallback;
  return accountNumber.slice(-4);
}

export function createNessieProvider(): DataProvider {
  return {
    mode: 'nessie',

    async fetchSnapshot(): Promise<DataSnapshot> {
      const customers = await nessie.listCustomers();
      const customer = customers.find(
        (c) => c.first_name === DEMO_CUSTOMER_FIRST_NAME && c.last_name === DEMO_CUSTOMER_LAST_NAME,
      );

      if (!customer) {
        throw new Error(
          `Demo customer ${DEMO_CUSTOMER_FIRST_NAME} ${DEMO_CUSTOMER_LAST_NAME} not found in Nessie. Run \`npm run seed\` first.`,
        );
      }

      const nessieAccounts = await nessie.listCustomerAccounts(customer._id);
      const nessieMerchants = await nessie.listMerchants();

      // /merchants is GLOBAL and shared across every API key, so narrow it to the
      // ones this customer actually used once transactions are known.
      const allMerchants: SnapshotMerchant[] = nessieMerchants.map((merchant) => ({
        key: null,
        nessieId: merchant._id,
        name: merchant.name,
        category: normaliseCategory(merchant.category),
        cancelUrl: CANCEL_URLS.get(merchant.name) ?? null,
        // Nessie has neither engagement data nor merchant pricing.
        lastUsedAt: null,
        trialConvertsToCents: null,
      }));

      const accounts: SnapshotAccount[] = nessieAccounts.map((account, index) => ({
        key: null,
        nessieId: account._id,
        type: account.type as AccountType,
        nickname: account.nickname,
        last4: last4(account.account_number, String(1000 + index).slice(-4)),
        balanceCents: dollarsToCents(account.balance),
        // Nessie has no credit-limit field; sync fills this in.
        creditLimitCents: null,
        rewardsCents: dollarsToCents(account.rewards ?? 0),
      }));

      const transactions: SnapshotTransaction[] = [];

      for (const account of nessieAccounts) {
        const [purchases, deposits, withdrawals, transfers] = await Promise.all([
          nessie.listPurchases(account._id),
          nessie.listDeposits(account._id),
          nessie.listWithdrawals(account._id),
          nessie.listTransfers(account._id),
        ]);

        const fallbackDate = new Date(0).toISOString();
        const merchantCategory = new Map(allMerchants.map((m) => [m.nessieId, m.category]));
        const merchantName = new Map(allMerchants.map((m) => [m.nessieId, m.name]));

        for (const purchase of purchases) {
          transactions.push({
            key: null,
            nessieId: purchase._id,
            accountRef: account._id,
            merchantRef: purchase.merchant_id ?? null,
            source: 'purchase',
            // Purchases are always money out.
            amountCents: -Math.abs(dollarsToCents(purchase.amount)),
            description:
              purchase.description || merchantName.get(purchase.merchant_id) || 'Card purchase',
            postedAt: toIsoTimestamp(purchase.purchase_date, fallbackDate),
            category: merchantCategory.get(purchase.merchant_id) ?? 'Other',
          });
        }

        for (const deposit of deposits) {
          transactions.push({
            key: null,
            nessieId: deposit._id,
            accountRef: account._id,
            merchantRef: null,
            source: 'deposit',
            amountCents: Math.abs(dollarsToCents(deposit.amount)),
            description: deposit.description || 'Deposit',
            postedAt: toIsoTimestamp(deposit.transaction_date, fallbackDate),
            category: 'Income',
          });
        }

        for (const withdrawal of withdrawals) {
          transactions.push({
            key: null,
            nessieId: withdrawal._id,
            accountRef: account._id,
            merchantRef: null,
            source: 'withdrawal',
            amountCents: -Math.abs(dollarsToCents(withdrawal.amount)),
            description: withdrawal.description || 'Withdrawal',
            postedAt: toIsoTimestamp(withdrawal.transaction_date, fallbackDate),
            category: 'Other',
          });
        }

        for (const transfer of transfers) {
          // Sign from the perspective of the account being read.
          const isOutgoing = transfer.payer_id === account._id;
          const magnitude = Math.abs(dollarsToCents(transfer.amount));
          transactions.push({
            key: null,
            // GET spells this `id`, POST spells it `_id`.
            nessieId: transferId(transfer),
            accountRef: account._id,
            merchantRef: null,
            source: 'transfer',
            amountCents: isOutgoing ? -magnitude : magnitude,
            description: transfer.description || (isOutgoing ? 'Transfer out' : 'Transfer in'),
            postedAt: toIsoTimestamp(transfer.transaction_date, fallbackDate),
            category: 'Transfer',
          });
        }
      }

      transactions.sort((a, b) => a.postedAt.localeCompare(b.postedAt));

      const usedMerchantIds = new Set(
        transactions.map((t) => t.merchantRef).filter((ref): ref is string => ref !== null),
      );
      const merchants = allMerchants.filter(
        (m) => m.nessieId !== null && usedMerchantIds.has(m.nessieId),
      );

      return {
        customer: {
          nessieId: customer._id,
          firstName: customer.first_name,
          lastName: customer.last_name,
        },
        accounts,
        merchants,
        transactions,
      };
    },
  };
}
