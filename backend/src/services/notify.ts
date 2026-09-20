// Alerts that can't get lost.
//
// The complaint this fixes: charge notifications that sometimes never arrive, or
// vanish before they're read. So delivery is two-layered:
//
//   1. The inbox record is written FIRST, in the same request as the charge.
//      It is never deleted and never expires. If everything else fails, the
//      customer can still see every charge in Alerts.
//   2. Then a Web Push is attempted to every registered device. The outcome is
//      recorded on the alert (sent / failed / no device), dead endpoints are
//      pruned, and the Alerts page shows which alerts reached the phone.
//
// The web app also polls, so an open tab shows a toast for anything new even if
// push is blocked.

import type { PrismaClient } from '@prisma/client';
import webpush from 'web-push';
import { formatCents } from '../lib/utils.js';

let vapid: { publicKey: string; privateKey: string } | null = null;

/** Keys are generated once and kept in the database, so subscriptions survive restarts. */
export async function vapidKeys(prisma: PrismaClient) {
  if (vapid) return vapid;
  const stored = await prisma.appSecret.findUnique({ where: { key: 'vapid' } });
  if (stored) {
    vapid = JSON.parse(stored.value) as { publicKey: string; privateKey: string };
  } else {
    vapid = webpush.generateVAPIDKeys();
    await prisma.appSecret.create({ data: { key: 'vapid', value: JSON.stringify(vapid) } });
  }
  webpush.setVapidDetails('mailto:alerts@flow.example', vapid.publicKey, vapid.privateKey);
  return vapid;
}

export interface NewAlert {
  customerId: string;
  kind: string;
  title: string;
  body: string;
  amountCents?: number | null;
  href?: string | null;
  /** Informational alerts are resolved on creation; decisions stay pending. */
  status?: 'pending' | 'resolved';
  subscriptionId?: string | null;
}

async function push(prisma: PrismaClient, customerId: string, payload: { title: string; body: string; href: string; tag: string }) {
  const subscriptions = await prisma.pushSubscription.findMany({ where: { customerId } });
  if (subscriptions.length === 0) return 'no_device' as const;

  await vapidKeys(prisma);
  let delivered = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24, urgency: 'high' },
      );
      delivered += 1;
      await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSuccessAt: new Date(), failures: 0 } });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // 404/410: the browser unsubscribed. Anything else: count it and keep trying.
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
      } else {
        await prisma.pushSubscription.update({ where: { id: sub.id }, data: { failures: { increment: 1 } } });
        console.warn('[notify] push failed', status ?? '', (error as Error).message);
      }
    }
  }
  return delivered > 0 ? ('sent' as const) : ('failed' as const);
}

/** Writes the inbox copy, then attempts push. Never throws on a push failure. */
export async function raiseAlert(prisma: PrismaClient, alert: NewAlert) {
  const row = await prisma.alert.create({
    data: {
      customerId: alert.customerId,
      subscriptionId: alert.subscriptionId ?? null,
      kind: alert.kind,
      title: alert.title,
      body: alert.body,
      amountCents: alert.amountCents ?? null,
      href: alert.href ?? null,
      status: alert.status ?? 'resolved',
    },
  });

  const prefs = await prisma.preference.findUnique({ where: { customerId: alert.customerId } });
  const pushStatus = prefs && !prefs.alertsPush
    ? 'disabled'
    : await push(prisma, alert.customerId, {
        title: alert.title,
        body: alert.body,
        href: alert.href ?? '/alerts',
        tag: row.id,
      }).catch(() => 'failed' as const);

  return prisma.alert.update({
    where: { id: row.id },
    data: { pushStatus, deliveredAt: pushStatus === 'sent' ? new Date() : null },
  });
}

/**
 * Every card charge, however small, raises an alert unless the customer has
 * turned that off. Small charges matter most: fraudsters test cards with them.
 */
export async function notifyCharge(
  prisma: PrismaClient,
  input: { customerId: string; merchant: string; amountCents: number; accountLabel: string; href?: string },
) {
  const prefs = await prisma.preference.findUnique({ where: { customerId: input.customerId } });
  if (prefs && !prefs.alertEveryCharge) return null;
  return raiseAlert(prisma, {
    customerId: input.customerId,
    kind: 'charge_posted',
    title: `${formatCents(input.amountCents)} at ${input.merchant}`,
    body: `Charged to ${input.accountLabel}. Not you? Lock your card from this alert.`,
    amountCents: input.amountCents,
    href: input.href ?? '/alerts',
  });
}

/** Retries push for recent alerts that didn't reach a device. */
export async function retryUndelivered(prisma: PrismaClient, customerId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pending = await prisma.alert.findMany({
    where: { customerId, createdAt: { gte: since }, pushStatus: { in: ['failed', 'no_device'] } },
    take: 20,
    orderBy: { createdAt: 'desc' },
  });
  let sent = 0;
  for (const alert of pending) {
    const status = await push(prisma, customerId, { title: alert.title, body: alert.body, href: alert.href ?? '/alerts', tag: alert.id });
    if (status === 'sent') sent += 1;
    await prisma.alert.update({ where: { id: alert.id }, data: { pushStatus: status, deliveredAt: status === 'sent' ? new Date() : null } });
  }
  return { retried: pending.length, sent };
}
