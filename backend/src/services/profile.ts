// Address and legal-name changes, verified rather than refused.
import { randomBytes } from 'node:crypto';
import type { Customer, PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import { nessie } from '../nessie/client.js';
import {
  CODE_TTL_MS,
  checkAddress,
  checkDocument,
  checkLegalName,
  generateCode,
  hashCode,
  maskPhone,
  verifyCode,
  type AddressInput,
  type NameChangeReason,
} from '../features/profileChange.js';
import { raiseAlert } from './notify.js';

function serializeRequest(r: {
  id: string; kind: string; status: string; payload: string; reason: string | null; documentName: string | null;
  documentType: string | null; reviewerNote: string | null; createdAt: Date; resolvedAt: Date | null;
}) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
    reason: r.reason,
    documentName: r.documentName,
    documentType: r.documentType,
    reviewerNote: r.reviewerNote,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  };
}

export async function listChangeRequests(prisma: PrismaClient, customerId: string) {
  const rows = await prisma.profileChangeRequest.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 20 });
  return rows.map(serializeRequest);
}

// --- address ---

export async function startAddressChange(prisma: PrismaClient, customer: Customer, input: AddressInput) {
  const check = checkAddress(input);
  if (!check.ok || !check.standardized) {
    throw new ApiError(400, 'INVALID_ADDRESS', check.errors[0]?.message ?? 'Check the address.', {
      field: check.errors[0]?.field,
      errors: check.errors,
    });
  }

  // One live request at a time: starting again replaces the last code.
  await prisma.profileChangeRequest.updateMany({
    where: { customerId: customer.id, kind: 'address', status: 'pending_verification' },
    data: { status: 'cancelled', resolvedAt: new Date() },
  });

  const code = generateCode();
  const salt = randomBytes(8).toString('hex');
  const request = await prisma.profileChangeRequest.create({
    data: {
      customerId: customer.id,
      kind: 'address',
      status: 'pending_verification',
      payload: JSON.stringify(check.standardized),
      codeHash: hashCode(code, salt),
      codeSalt: salt,
      codeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  const phone = maskPhone(customer.phone);
  return {
    requestId: request.id,
    standardized: check.standardized,
    changed: check.changed,
    sentTo: phone ? `your phone ending ${phone}` : `your email ${customer.email.replace(/^(.).*(@.*)$/, '$1•••$2')}`,
    // No SMS gateway in this build. The code is returned so the flow can be
    // completed; a real deployment sends it and never returns it.
    demoCode: code,
  };
}

function splitStreet(line1: string): { street_number: string; street_name: string } {
  const match = line1.match(/^(\d+[A-Za-z]?)\s+(.*)$/);
  return match ? { street_number: match[1]!, street_name: match[2]! } : { street_number: '', street_name: line1 };
}

export async function verifyAddressChange(prisma: PrismaClient, customer: Customer, requestId: string, code: string) {
  const request = await prisma.profileChangeRequest.findFirst({
    where: { id: requestId, customerId: customer.id, kind: 'address' },
  });
  if (!request || request.status !== 'pending_verification' || !request.codeHash || !request.codeSalt || !request.codeExpiresAt) {
    throw ApiError.notFound('Address change');
  }

  const outcome = verifyCode(code, { hash: request.codeHash, salt: request.codeSalt, expiresAt: request.codeExpiresAt, attempts: request.codeAttempts }, new Date());
  if (outcome !== 'ok') {
    await prisma.profileChangeRequest.update({ where: { id: request.id }, data: { codeAttempts: { increment: 1 } } });
    const messages = {
      wrong: 'That code doesn’t match. Check the latest text and try again.',
      expired: 'That code has expired. Start again and we’ll send a new one.',
      locked: 'Too many attempts. Start again for a new code, or talk to a specialist.',
    } as const;
    throw new ApiError(400, `CODE_${outcome.toUpperCase()}`, messages[outcome], { field: 'code' });
  }

  const address = JSON.parse(request.payload) as AddressInput;
  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customer.id },
      data: {
        addressLine1: address.line1,
        addressLine2: address.line2 ?? null,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
      },
    }),
    prisma.profileChangeRequest.update({ where: { id: request.id }, data: { status: 'approved', resolvedAt: new Date(), codeHash: null } }),
  ]);

  // Nessie customers carry an address, so a verified move is reflected there too.
  let inNessie = false;
  if (customer.nessieId) {
    try {
      await nessie.updateCustomer(customer.nessieId, {
        address: { ...splitStreet(address.line1), city: address.city, state: address.state, zip: address.postalCode.slice(0, 5) },
      });
      inNessie = true;
    } catch (error) {
      console.warn('[profile] Nessie address mirror failed:', (error as Error).message);
    }
  }

  // Security notice: an address change is a classic account-takeover step.
  await raiseAlert(prisma, {
    customerId: customer.id,
    kind: 'profile_changed',
    title: 'Your address was updated',
    body: `New address: ${address.line1}, ${address.city}, ${address.state}. If this wasn't you, contact us right away.`,
    href: '/settings',
  });

  return { address, inNessie };
}

// --- legal name ---

export async function requestNameChange(
  prisma: PrismaClient,
  customer: Customer,
  input: {
    firstName: string;
    lastName: string;
    middleName?: string | null;
    reason: NameChangeReason;
    document: { name: string; type: string; size: number };
  },
) {
  const name = checkLegalName(input.firstName, input.lastName, input.middleName);
  if (!name.ok) {
    throw new ApiError(400, 'INVALID_NAME', name.errors[0]!.message, { field: name.errors[0]!.field, errors: name.errors });
  }
  const docError = checkDocument(input.document);
  if (docError) throw new ApiError(400, 'INVALID_DOCUMENT', docError, { field: 'document' });

  if (name.value.firstName === customer.firstName && name.value.lastName === customer.lastName && !name.value.middleName) {
    throw new ApiError(400, 'NO_CHANGE', 'That is already the name on your account.', { field: 'firstName' });
  }

  const open = await prisma.profileChangeRequest.findFirst({
    where: { customerId: customer.id, kind: 'legal_name', status: 'under_review' },
  });
  if (open) throw new ApiError(409, 'ALREADY_OPEN', 'You already have a name change under review. You can cancel it and start again.');

  const request = await prisma.profileChangeRequest.create({
    data: {
      customerId: customer.id,
      kind: 'legal_name',
      status: 'under_review',
      payload: JSON.stringify({ ...name.value, previous: { firstName: customer.firstName, lastName: customer.lastName } }),
      reason: input.reason,
      documentName: input.document.name,
      documentType: input.document.type,
      documentSize: input.document.size,
    },
  });

  await raiseAlert(prisma, {
    customerId: customer.id,
    kind: 'profile_request',
    title: 'Name change received',
    body: `We're reviewing your request to change your name to ${name.value.firstName} ${name.value.lastName}. Most are approved within one business day.`,
    href: '/settings?change=name',
  });

  return serializeRequest(request);
}

/**
 * Stands in for the back-office review. In the demo the customer can trigger it,
 * clearly labelled, so the whole journey can be shown end to end.
 */
export async function approveNameChange(prisma: PrismaClient, customer: Customer, requestId: string) {
  const request = await prisma.profileChangeRequest.findFirst({
    where: { id: requestId, customerId: customer.id, kind: 'legal_name', status: 'under_review' },
  });
  if (!request) throw ApiError.notFound('Name change');

  const next = JSON.parse(request.payload) as { firstName: string; lastName: string; middleName: string | null };
  await prisma.$transaction([
    prisma.customer.update({ where: { id: customer.id }, data: { firstName: next.firstName, lastName: next.lastName } }),
    prisma.profileChangeRequest.update({
      where: { id: request.id },
      data: { status: 'approved', resolvedAt: new Date(), reviewerNote: 'Document verified against the requested name.' },
    }),
  ]);

  if (customer.nessieId) {
    await nessie.updateCustomer(customer.nessieId, { first_name: next.firstName, last_name: next.lastName }).catch((error: Error) => {
      console.warn('[profile] Nessie name mirror failed:', error.message);
    });
  }

  await raiseAlert(prisma, {
    customerId: customer.id,
    kind: 'profile_changed',
    title: `Welcome, ${next.firstName} ${next.lastName}`,
    body: 'Your name change is approved. A new card with your name is on its way and arrives in 5–7 business days.',
    href: '/settings',
  });

  return serializeRequest((await prisma.profileChangeRequest.findUniqueOrThrow({ where: { id: request.id } })));
}

export async function cancelChangeRequest(prisma: PrismaClient, customerId: string, requestId: string) {
  const result = await prisma.profileChangeRequest.updateMany({
    where: { id: requestId, customerId, status: { in: ['pending_verification', 'under_review'] } },
    data: { status: 'cancelled', resolvedAt: new Date() },
  });
  if (result.count === 0) throw ApiError.notFound('Request');
  return listChangeRequests(prisma, customerId);
}
