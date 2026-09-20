// Data layer.
//
//   Nessie ─┐
//           ├─> DataProvider.fetchSnapshot() ─> sync() ─> SQLite mirror ─> API
//   Mock   ─┘
//
// The API always reads the mirror, never Nessie directly. Two reasons: Nessie has
// no single "transactions" endpoint (a statement means merging four collections),
// and detection needs fixed, fast data to run against.
import { config } from '../config.js';
import { nessie, NessieError, redact } from '../nessie/client.js';
import { generateDemoDataset } from './demoDataset.js';
import { createNessieProvider } from './nessieProvider.js';
import type { AccountType, DataSourceStatus, TransactionSource } from '../domain/types.js';

export interface SnapshotMerchant {
  key: string | null;
  nessieId: string | null;
  name: string;
  category: string;
  cancelUrl: string | null;
  /** ISO date, or null when there's no usage signal. */
  lastUsedAt: string | null;
  /** What a trial converts to, in cents. */
  trialConvertsToCents: number | null;
}

export interface SnapshotAccount {
  key: string | null;
  nessieId: string | null;
  type: AccountType;
  nickname: string;
  last4: string;
  balanceCents: number;
  creditLimitCents: number | null;
  rewardsCents: number | null;
}

export interface SnapshotTransaction {
  key: string | null;
  nessieId: string | null;
  /** SnapshotAccount.key, or its nessieId when key is null. */
  accountRef: string;
  merchantRef: string | null;
  source: TransactionSource;
  /** Signed cents; negative means money left the account. */
  amountCents: number;
  description: string;
  postedAt: string;
  category: string;
}

export interface DataSnapshot {
  customer: { nessieId: string | null; firstName: string; lastName: string };
  accounts: SnapshotAccount[];
  merchants: SnapshotMerchant[];
  transactions: SnapshotTransaction[];
}

export interface DataProvider {
  readonly mode: 'nessie' | 'mock';
  fetchSnapshot(): Promise<DataSnapshot>;
}

let status: DataSourceStatus = { mode: 'mock', forced: false, fallbackReason: null };

export function getDataSourceStatus(): DataSourceStatus {
  return status;
}

// --- mock provider ---
// Serves the same dataset the seeder pushes to Nessie, so a fallback mid-demo
// looks identical to the live path.

export function createMockProvider(now: Date = new Date()): DataProvider {
  return {
    mode: 'mock',

    async fetchSnapshot(): Promise<DataSnapshot> {
      const dataset = generateDemoDataset(now);

      return {
        customer: {
          nessieId: null,
          firstName: dataset.customer.firstName,
          lastName: dataset.customer.lastName,
        },
        accounts: dataset.accounts.map((account) => ({
          key: account.key,
          nessieId: null,
          type: account.type,
          nickname: account.nickname,
          last4: account.last4,
          balanceCents: account.balanceCents,
          creditLimitCents: account.creditLimitCents ?? null,
          rewardsCents: account.rewardsCents ?? null,
        })),
        merchants: dataset.merchants.map((merchant) => ({
          key: merchant.key,
          nessieId: null,
          name: merchant.name,
          category: merchant.category,
          cancelUrl: merchant.cancelUrl,
          lastUsedAt: merchant.lastUsedAt,
          trialConvertsToCents: merchant.trialConvertsToCents,
        })),
        transactions: dataset.transactions.map((transaction) => ({
          key: transaction.key,
          nessieId: null,
          accountRef: transaction.accountKey,
          merchantRef: transaction.merchantKey,
          source: transaction.source,
          amountCents: transaction.amountCents,
          postedAt: new Date(`${transaction.date}T00:00:00.000Z`).toISOString(),
          description: transaction.description,
          category: transaction.category,
        })),
      };
    },
  };
}

// --- picking a provider ---
// The demo must never break because the network did.

export async function resolveProvider(): Promise<DataProvider> {
  if (config.nessie.useMockData) {
    status = { mode: 'mock', forced: true, fallbackReason: null };
    console.log('[data] USE_MOCK_DATA=true — using local mock data.');
    return createMockProvider();
  }

  if (!config.nessie.hasKey) {
    const reason = 'NESSIE_API_KEY is not set in the root .env';
    status = { mode: 'mock', forced: false, fallbackReason: reason };
    console.warn(`[data] ${reason} — falling back to mock data.`);
    return createMockProvider();
  }

  try {
    await nessie.listCustomers(); // liveness probe
    status = { mode: 'nessie', forced: false, fallbackReason: null };
    console.log('[data] Connected to Nessie.');
    return createNessieProvider();
  } catch (error) {
    const reason =
      error instanceof NessieError
        ? error.status === 0
          ? 'Nessie is unreachable'
          : `Nessie returned HTTP ${error.status}`
        : redact(error instanceof Error ? error.message : String(error));
    status = { mode: 'mock', forced: false, fallbackReason: reason };
    console.warn(`[data] ${reason} — falling back to mock data.`);
    return createMockProvider();
  }
}

// --- linking mirror rows to Nessie records ---
//
// Nessie TRUNCATES money to whole dollars: 15.49 stores as 15, 0.99 as 0,
// 599.99 as 599. Cents are gone on write and unrecoverable on read. That would
// turn a $12.99 -> $15.49 price rise into $12 -> $15 and make every displayed
// amount wrong, so the mirror (not Nessie) is authoritative for AMOUNTS.
//
// The seed still pushes everything to Nessie and records the ids it gets back;
// these are attached here so the rows stay genuinely linked for bills and loans.

export interface NessieIdMap {
  customerId: string | null;
  accountIdByKey: Map<string, string>;
  merchantIdByKey: Map<string, string>;
  transactionIdByKey: Map<string, string>;
}

export function emptyIdMap(): NessieIdMap {
  return {
    customerId: null,
    accountIdByKey: new Map(),
    merchantIdByKey: new Map(),
    transactionIdByKey: new Map(),
  };
}

export function annotateWithNessieIds(snapshot: DataSnapshot, ids: NessieIdMap): DataSnapshot {
  return {
    customer: { ...snapshot.customer, nessieId: ids.customerId },
    accounts: snapshot.accounts.map((a) => ({
      ...a,
      nessieId: a.key ? (ids.accountIdByKey.get(a.key) ?? null) : a.nessieId,
    })),
    merchants: snapshot.merchants.map((m) => ({
      ...m,
      nessieId: m.key ? (ids.merchantIdByKey.get(m.key) ?? null) : m.nessieId,
    })),
    transactions: snapshot.transactions.map((t) => ({
      ...t,
      nessieId: t.key ? (ids.transactionIdByKey.get(t.key) ?? null) : t.nessieId,
    })),
  };
}
