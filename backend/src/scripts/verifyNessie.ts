/**
 * Probes the live Nessie API and reports what actually exists.
 *
 * The spec lists the endpoints Nessie "likely" has. Rather than trust that, this
 * script hits each one and records the status and the real field names, then
 * prints a report. Run with `npm run verify:nessie` from the project root.
 *
 * It creates a small probe customer + account, because most collection endpoints
 * return `[]` on a fresh key, which teaches us nothing about field names. Probe
 * records are named with a clear prefix so they are easy to spot.
 */
import { config } from '../config.js';
import { nessie, NessieError, redact } from '../nessie/client.js';

const PROBE_PREFIX = 'ZZ_FLOW_PROBE';

interface Finding {
  method: string;
  path: string;
  status: 'ok' | 'failed';
  detail: string;
  fields?: string[];
}

const findings: Finding[] = [];

/** Runs one probe, recording the outcome instead of throwing. */
async function probe<T>(
  method: string,
  path: string,
  run: () => Promise<T>,
): Promise<T | undefined> {
  try {
    const result = await run();
    findings.push({
      method,
      path,
      status: 'ok',
      detail: describe(result),
      fields: fieldNames(result),
    });
    return result;
  } catch (error) {
    const detail =
      error instanceof NessieError
        ? `HTTP ${error.status}${error.body ? ` — ${error.body}` : ''}`
        : redact(error instanceof Error ? error.message : String(error));
    findings.push({ method, path, status: 'failed', detail });
    return undefined;
  }
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === undefined) return 'empty body';
  if (value && typeof value === 'object') return 'object';
  return String(value);
}

/** Field names of an object, or of the first element of an array. */
function fieldNames(value: unknown): string[] | undefined {
  const sample = Array.isArray(value) ? value[0] : value;
  if (!sample || typeof sample !== 'object') return undefined;
  return Object.keys(sample as object).sort();
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  console.log(`\nProbing Nessie at ${config.nessie.baseUrl}`);
  if (!config.nessie.hasKey) {
    console.error('No NESSIE_API_KEY found in the root .env — cannot probe.');
    process.exit(1);
  }

  // --- read-only collection probes ---
  const customers = await probe('GET', '/customers', () => nessie.listCustomers());
  await probe('GET', '/accounts', () => nessie.listAccounts());
  await probe('GET', '/merchants', () => nessie.listMerchants());

  // --- create a probe customer so the account-scoped endpoints have something to hit ---
  // Reuse an existing probe customer if one is already there, so re-runs don't pile up.
  let customerId = customers?.find((c) => c.last_name === PROBE_PREFIX)?._id;

  if (!customerId) {
    const created = await probe('POST', '/customers', () =>
      nessie.createCustomer({
        first_name: 'Probe',
        last_name: PROBE_PREFIX,
        address: {
          street_number: '1',
          street_name: 'Probe St',
          city: 'Richmond',
          state: 'VA',
          zip: '23220',
        },
      }),
    );
    customerId = created?._id;
  } else {
    console.log('Reusing existing probe customer.');
  }

  if (!customerId) {
    report();
    console.error('\nCould not create a probe customer — account-scoped probes skipped.');
    process.exit(1);
  }

  await probe('GET', '/customers/{id}/accounts', () => nessie.listCustomerAccounts(customerId));

  const account = await probe('POST', '/customers/{id}/accounts', () =>
    nessie.createAccount(customerId, {
      type: 'Credit Card',
      nickname: `${PROBE_PREFIX} card`,
      rewards: 0,
      balance: 1000,
    }),
  );

  const accountId = account?._id;
  if (!accountId) {
    report();
    console.error('\nCould not create a probe account — remaining probes skipped.');
    process.exit(1);
  }

  await probe('GET', '/accounts/{id}', () => nessie.getAccount(accountId));

  // A merchant is needed before a purchase can reference one.
  const merchant = await probe('POST', '/merchants', () =>
    nessie.createMerchant({
      name: `${PROBE_PREFIX} Merchant`,
      category: 'Streaming',
      address: {
        street_number: '2',
        street_name: 'Probe Ave',
        city: 'Richmond',
        state: 'VA',
        zip: '23220',
      },
    }),
  );

  if (merchant?._id) {
    await probe('POST', '/accounts/{id}/purchases', () =>
      nessie.createPurchase(accountId, {
        merchant_id: merchant._id,
        medium: 'balance',
        purchase_date: iso(new Date()),
        amount: 9.99,
        status: 'completed',
        description: 'probe purchase',
      }),
    );
  }
  await probe('GET', '/accounts/{id}/purchases', () => nessie.listPurchases(accountId));

  await probe('POST', '/accounts/{id}/deposits', () =>
    nessie.createDeposit(accountId, {
      type: 'deposit',
      transaction_date: iso(new Date()),
      status: 'completed',
      medium: 'balance',
      amount: 100,
      description: 'probe deposit',
    }),
  );
  await probe('GET', '/accounts/{id}/deposits', () => nessie.listDeposits(accountId));

  await probe('POST', '/accounts/{id}/withdrawals', () =>
    nessie.createWithdrawal(accountId, {
      // `type` is rejected here, unlike on deposits.
      transaction_date: iso(new Date()),
      status: 'completed',
      medium: 'balance',
      amount: 25,
      description: 'probe withdrawal',
    }),
  );
  await probe('GET', '/accounts/{id}/withdrawals', () => nessie.listWithdrawals(accountId));

  await probe('GET', '/accounts/{id}/transfers', () => nessie.listTransfers(accountId));

  // The two that matter most for our features — do bills recur, do loans score credit?
  //
  // Bills get their own throwaway account every run. A bill missing payment_date or
  // recurring_date is unreadable AND poisons the whole collection (400 forever), so
  // probing on the shared account would break it for later runs.
  const billAccount = await probe('POST', '/customers/{id}/accounts [for bills]', () =>
    nessie.createAccount(customerId, {
      type: 'Credit Card',
      nickname: `${PROBE_PREFIX} bills`,
      rewards: 0,
      balance: 1000,
    }),
  );

  if (billAccount?._id) {
    const billAccountId = billAccount._id;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 20);

    await probe('POST', '/accounts/{id}/bills', () =>
      nessie.createBill(billAccountId, {
        status: 'recurring',
        payee: `${PROBE_PREFIX} Merchant`,
        nickname: 'probe bill',
        payment_amount: 15.49,
        // Both of these are required for the bill to be readable afterwards.
        payment_date: iso(dueDate),
        recurring_date: 15,
      }),
    );
    await probe('GET', '/accounts/{id}/bills', () => nessie.listBills(billAccountId));
  }

  await probe('POST', '/accounts/{id}/loans', () =>
    nessie.createLoan(accountId, {
      type: 'home',
      status: 'pending',
      credit_score: 720,
      monthly_payment: 100,
      amount: 600,
      description: 'probe loan',
    }),
  );
  await probe('GET', '/accounts/{id}/loans', () => nessie.listLoans(accountId));

  report();
}

function report(): void {
  console.log('\n' + '='.repeat(78));
  console.log('NESSIE ENDPOINT FINDINGS');
  console.log('='.repeat(78));

  for (const f of findings) {
    const mark = f.status === 'ok' ? 'OK  ' : 'FAIL';
    console.log(`\n[${mark}] ${f.method.padEnd(4)} ${f.path}`);
    console.log(`       ${f.detail}`);
    if (f.fields?.length) {
      console.log(`       fields: ${f.fields.join(', ')}`);
    }
  }

  const ok = findings.filter((f) => f.status === 'ok').length;
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${ok}/${findings.length} probes succeeded.`);

  // Call out the two fields the spec was unsure about.
  const bills = findings.find((f) => f.path === '/accounts/{id}/bills' && f.method === 'GET');
  const loans = findings.find((f) => f.path === '/accounts/{id}/loans' && f.method === 'GET');
  console.log(
    `\nbills.recurring_date : ${bills?.fields?.includes('recurring_date') ? 'PRESENT' : 'not observed'}`,
  );
  console.log(
    `loans.credit_score   : ${loans?.fields?.includes('credit_score') ? 'PRESENT' : 'not observed'}`,
  );
  console.log('='.repeat(78) + '\n');
}

main().catch((error) => {
  console.error('verify:nessie crashed:', redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
