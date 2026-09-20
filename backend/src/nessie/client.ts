// Typed wrapper over the Nessie REST API.
//
// The key is appended as the `key` query param here and nowhere else, and
// NessieError stores only the path, so the secret can't reach a log line.
import { config, readNessieKey } from '../config.js';
import type {
  NessieAccount,
  NessieBill,
  NessieBillCreate,
  NessieCreateResponse,
  NessieCustomer,
  NessieDeposit,
  NessieLoan,
  NessieLoanCreate,
  NessieMerchant,
  NessiePurchase,
  NessieTransfer,
  NessieTransferCreate,
  NessieUpdateResponse,
  NessieWithdrawal,
  NessieWithdrawalCreate,
} from './types.js';

export class NessieError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Path only — the query string carries the key. */
    readonly path: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'NessieError';
  }

  /** The signal to fall back to mock data. */
  get isUnreachable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

/** Strips the key from anything about to be logged. */
export function redact(input: string): string {
  return input.replace(/([?&]key=)[^&\s]+/gi, '$1REDACTED');
}

type Query = Record<string, string | number | undefined>;

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { query?: Query; body?: unknown } = {},
): Promise<T> {
  const url = new URL(config.nessie.baseUrl + path);
  url.searchParams.set('key', readNessieKey());
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.nessie.timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'unknown error';
    throw new NessieError(`Nessie unreachable: ${redact(reason)}`, 0, path);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new NessieError(
      `Nessie ${method} ${path} failed with ${response.status}`,
      response.status,
      path,
      redact(text).slice(0, 500),
    );
  }

  if (text.trim() === '') return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NessieError(
      `Nessie ${method} ${path} returned non-JSON`,
      response.status,
      path,
      redact(text).slice(0, 200),
    );
  }
}

/** Creations come back wrapped in `objectCreated`, but not on every endpoint. */
function unwrapCreated<T>(result: NessieCreateResponse<T> | T): T {
  if (result && typeof result === 'object' && 'objectCreated' in result) {
    return (result as NessieCreateResponse<T>).objectCreated;
  }
  return result as T;
}

/** Transfers answer an empty collection with 404 rather than []. */
async function listOrEmpty<T>(run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NessieError && error.status === 404) return [];
    throw error;
  }
}

export const nessie = {
  // --- customers ---
  listCustomers: () => request<NessieCustomer[]>('GET', '/customers'),
  getCustomer: (id: string) => request<NessieCustomer>('GET', `/customers/${id}`),
  createCustomer: (body: Omit<NessieCustomer, '_id'>) =>
    request<NessieCreateResponse<NessieCustomer>>('POST', '/customers', { body }).then(unwrapCreated),

  // --- accounts ---
  listAccounts: () => request<NessieAccount[]>('GET', '/accounts'),
  getAccount: (id: string) => request<NessieAccount>('GET', `/accounts/${id}`),
  listCustomerAccounts: (customerId: string) =>
    request<NessieAccount[]>('GET', `/customers/${customerId}/accounts`),
  createAccount: (customerId: string, body: Omit<NessieAccount, '_id' | 'customer_id'>) =>
    request<NessieCreateResponse<NessieAccount>>('POST', `/customers/${customerId}/accounts`, {
      body,
    }).then(unwrapCreated),

  // --- merchants ---
  listMerchants: () => request<NessieMerchant[]>('GET', '/merchants'),
  createMerchant: (body: Omit<NessieMerchant, '_id'>) =>
    request<NessieCreateResponse<NessieMerchant>>('POST', '/merchants', { body }).then(unwrapCreated),

  // --- transaction-like collections ---
  listPurchases: (accountId: string) =>
    listOrEmpty(() => request<NessiePurchase[]>('GET', `/accounts/${accountId}/purchases`)),
  createPurchase: (accountId: string, body: Omit<NessiePurchase, '_id' | 'payer_id'>) =>
    request<NessieCreateResponse<NessiePurchase>>('POST', `/accounts/${accountId}/purchases`, {
      body,
    }).then(unwrapCreated),

  listDeposits: (accountId: string) =>
    listOrEmpty(() => request<NessieDeposit[]>('GET', `/accounts/${accountId}/deposits`)),
  createDeposit: (accountId: string, body: Omit<NessieDeposit, '_id' | 'payee_id'>) =>
    request<NessieCreateResponse<NessieDeposit>>('POST', `/accounts/${accountId}/deposits`, {
      body,
    }).then(unwrapCreated),

  listWithdrawals: (accountId: string) =>
    listOrEmpty(() => request<NessieWithdrawal[]>('GET', `/accounts/${accountId}/withdrawals`)),
  createWithdrawal: (accountId: string, body: NessieWithdrawalCreate) =>
    request<NessieCreateResponse<NessieWithdrawal>>('POST', `/accounts/${accountId}/withdrawals`, {
      body,
    }).then(unwrapCreated),

  listTransfers: (accountId: string) =>
    listOrEmpty(() => request<NessieTransfer[]>('GET', `/accounts/${accountId}/transfers`)),
  createTransfer: (accountId: string, body: NessieTransferCreate) =>
    request<NessieCreateResponse<NessieTransfer>>('POST', `/accounts/${accountId}/transfers`, {
      body,
    }).then(unwrapCreated),

  // --- by-id lookups ---
  // Nessie is inconsistent here: purchases and withdrawals are SINGULAR, while
  // deposits and transfers are plural. The wrong spelling 403s rather than 404s.
  getPurchase: (id: string) => request<NessiePurchase>('GET', `/purchase/${id}`),
  deletePurchase: (id: string) => request<void>('DELETE', `/purchase/${id}`),
  getWithdrawal: (id: string) => request<NessieWithdrawal>('GET', `/withdrawal/${id}`),
  getDeposit: (id: string) => request<NessieDeposit>('GET', `/deposits/${id}`),
  getTransfer: (id: string) => request<NessieTransfer>('GET', `/transfers/${id}`),

  // --- obligations ---
  listBills: (accountId: string) =>
    listOrEmpty(() => request<NessieBill[]>('GET', `/accounts/${accountId}/bills`)),
  listCustomerBills: (customerId: string) =>
    listOrEmpty(() => request<NessieBill[]>('GET', `/customers/${customerId}/bills`)),
  getBill: (id: string) => request<NessieBill>('GET', `/bills/${id}`),
  createBill: (accountId: string, body: NessieBillCreate) =>
    request<NessieCreateResponse<NessieBill>>('POST', `/accounts/${accountId}/bills`, { body }).then(
      unwrapCreated,
    ),
  /** Partial updates are fine, and never break the bill's readability. */
  updateBill: (id: string, body: Partial<NessieBillCreate>) =>
    request<NessieUpdateResponse<NessieBill>>('PUT', `/bills/${id}`, { body }),
  deleteBill: (id: string) => request<void>('DELETE', `/bills/${id}`),

  listLoans: (accountId: string) =>
    listOrEmpty(() => request<NessieLoan[]>('GET', `/accounts/${accountId}/loans`)),
  getLoan: (id: string) => request<NessieLoan>('GET', `/loans/${id}`),
  createLoan: (accountId: string, body: NessieLoanCreate) =>
    request<NessieCreateResponse<NessieLoan>>('POST', `/accounts/${accountId}/loans`, { body }).then(
      unwrapCreated,
    ),
  updateLoan: (id: string, body: Partial<NessieLoanCreate>) =>
    request<NessieUpdateResponse<NessieLoan>>('PUT', `/loans/${id}`, { body }),
  deleteLoan: (id: string) => request<void>('DELETE', `/loans/${id}`),

  /** Only `nickname` is accepted; anything else is rejected. */
  updateAccountNickname: (accountId: string, nickname: string) =>
    request<NessieUpdateResponse<NessieAccount>>('PUT', `/accounts/${accountId}`, {
      body: { nickname },
    }),

  /** Escape hatch for verify:nessie. */
  raw: request,
};
