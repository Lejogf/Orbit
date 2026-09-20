// Live support cases: chat, callbacks and calls with a real person.
//
// Agent messages are written with a future timestamp and only returned once
// that time has passed. That gives the demo a believable queue and typing
// delay without timers on the server, and survives restarts.

import type { Customer, PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import {
  SUPPORT_PHONE,
  agentFor,
  agentReply,
  callCode,
  estimateWaitMinutes,
  teamFor,
  type AccessNeed,
  type SupportChannel,
} from '../features/support.js';
import { raiseAlert } from './notify.js';

/** The demo never makes anyone wait more than this for the agent to join. */
const DEMO_MAX_WAIT_MS = 6_000;
const TYPING_MS = 2_200;

export interface NewCase {
  channel: SupportChannel;
  topic: string;
  needs: AccessNeed[];
  transcript: { author: 'customer' | 'eno'; text: string }[];
  callbackAt?: string | null;
  phone?: string | null;
}

function parseNeeds(needs: string | null): AccessNeed[] {
  return needs ? (JSON.parse(needs) as AccessNeed[]) : [];
}

export async function createCase(prisma: PrismaClient, customer: Customer, input: NewCase) {
  const queueDepth = await prisma.supportCase.count({ where: { status: 'queued' } });
  const { team, priority } = teamFor(input.topic);
  const waitMinutes = estimateWaitMinutes({ channel: input.channel, hourUtc: new Date().getUTCHours(), queueDepth: queueDepth + 3, priority, needs: input.needs });

  if (input.channel === 'callback') {
    const at = input.callbackAt ? new Date(input.callbackAt) : null;
    if (!at || Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60_000) {
      throw new ApiError(400, 'INVALID_TIME', 'Choose a time for us to call you.', { field: 'callbackAt' });
    }
  }

  const count = await prisma.supportCase.count({ where: { customerId: customer.id } });
  const supportCase = await prisma.supportCase.create({
    data: {
      customerId: customer.id,
      channel: input.channel,
      topic: input.topic.slice(0, 120),
      status: input.channel === 'callback' ? 'scheduled' : 'queued',
      scheduledFor: input.channel === 'callback' && input.callbackAt ? new Date(input.callbackAt) : null,
      callbackPhone: input.phone ?? customer.phone,
      callCode: input.channel === 'call' ? callCode(Date.now() % 1_000_000 + count) : null,
      needs: JSON.stringify(input.needs),
    },
  });

  const now = Date.now();
  const messages = [
    ...input.transcript.slice(-20).map((m, i) => ({
      caseId: supportCase.id,
      author: m.author,
      body: m.text.slice(0, 1000),
      createdAt: new Date(now - (input.transcript.length - i) * 1000),
    })),
    {
      caseId: supportCase.id,
      author: 'system',
      body:
        input.channel === 'chat'
          ? `Connecting you to ${team}. Estimated wait: ${waitMinutes < 1 ? 'under a minute' : `about ${Math.ceil(waitMinutes)} minutes`}. Your conversation with Ori has been shared, so you won't need to repeat yourself.`
          : input.channel === 'call'
            ? `Call ${SUPPORT_PHONE}. When asked, say or enter your code — you'll be verified instantly and sent to ${team}.`
            : input.channel === 'callback'
              ? `${team} will call ${input.phone ?? customer.phone ?? 'you'} at the time you chose. Your conversation with Ori is attached.`
              : `Message received. ${team} replies within 4 hours, day or night.`,
      createdAt: new Date(now),
    },
  ];
  await prisma.supportMessage.createMany({ data: messages });

  return getCase(prisma, customer, supportCase.id);
}

export async function getCase(prisma: PrismaClient, customer: Customer, id: string) {
  const supportCase = await prisma.supportCase.findFirst({ where: { id, customerId: customer.id } });
  if (!supportCase) throw ApiError.notFound('Conversation');

  const needs = parseNeeds(supportCase.needs);
  const now = new Date();

  // The agent joins once the (short) demo wait has passed.
  if (supportCase.status === 'queued' && supportCase.channel === 'chat' && now.getTime() - supportCase.createdAt.getTime() >= DEMO_MAX_WAIT_MS) {
    const agent = agentFor(supportCase.id, needs);
    const hadOriTranscript = (await prisma.supportMessage.count({ where: { caseId: id, author: 'eno' } })) > 0;
    await prisma.$transaction([
      prisma.supportCase.update({ where: { id }, data: { status: 'active', agentName: agent } }),
      prisma.supportMessage.create({ data: { caseId: id, author: 'system', body: `${agent} joined the chat.`, createdAt: now } }),
      prisma.supportMessage.create({
        data: {
          caseId: id,
          author: 'agent',
          body: agentReply({ agent, firstName: customer.firstName, topic: supportCase.topic, turn: 0, needs, hadOriTranscript, customerMessage: '' }),
          createdAt: new Date(now.getTime() + 1500),
        },
      }),
    ]);
  }

  const fresh = await prisma.supportCase.findUniqueOrThrow({ where: { id } });
  const all = await prisma.supportMessage.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } });
  const visible = all.filter((m) => m.createdAt <= now);
  const waitingMs = fresh.status === 'queued' ? Math.max(0, DEMO_MAX_WAIT_MS - (now.getTime() - fresh.createdAt.getTime())) : 0;

  return {
    id: fresh.id,
    channel: fresh.channel,
    topic: fresh.topic,
    status: fresh.status,
    team: teamFor(fresh.topic).team,
    agentName: fresh.agentName,
    scheduledFor: fresh.scheduledFor?.toISOString() ?? null,
    callbackPhone: fresh.callbackPhone,
    callCode: fresh.callCode,
    phone: SUPPORT_PHONE,
    needs,
    waitingSeconds: Math.ceil(waitingMs / 1000),
    agentTyping: all.length > visible.length,
    messages: visible.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt.toISOString() })),
    createdAt: fresh.createdAt.toISOString(),
  };
}

export async function listCases(prisma: PrismaClient, customerId: string) {
  const rows = await prisma.supportCase.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 10 });
  return rows.map((c) => ({
    id: c.id,
    channel: c.channel,
    topic: c.topic,
    status: c.status,
    agentName: c.agentName,
    scheduledFor: c.scheduledFor?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function postMessage(prisma: PrismaClient, customer: Customer, id: string, body: string) {
  const supportCase = await prisma.supportCase.findFirst({ where: { id, customerId: customer.id } });
  if (!supportCase) throw ApiError.notFound('Conversation');
  if (supportCase.status === 'resolved') throw ApiError.badRequest('This conversation has ended. Start a new one any time.');

  const now = new Date();
  await prisma.supportMessage.create({ data: { caseId: id, author: 'customer', body: body.slice(0, 2000), createdAt: now } });

  if (supportCase.status === 'active' && supportCase.agentName) {
    const turn = await prisma.supportMessage.count({ where: { caseId: id, author: 'agent' } });
    await prisma.supportMessage.create({
      data: {
        caseId: id,
        author: 'agent',
        body: agentReply({
          agent: supportCase.agentName,
          firstName: customer.firstName,
          topic: supportCase.topic,
          turn,
          needs: parseNeeds(supportCase.needs),
          hadOriTranscript: true,
          customerMessage: body,
        }),
        createdAt: new Date(now.getTime() + TYPING_MS),
      },
    });
  }

  return getCase(prisma, customer, id);
}

export async function closeCase(prisma: PrismaClient, customer: Customer, id: string) {
  const supportCase = await prisma.supportCase.findFirst({ where: { id, customerId: customer.id } });
  if (!supportCase) throw ApiError.notFound('Conversation');
  await prisma.supportCase.update({ where: { id }, data: { status: 'resolved' } });
  await raiseAlert(prisma, {
    customerId: customer.id,
    kind: 'support_summary',
    title: `Conversation summary: ${supportCase.topic}`,
    body: `${supportCase.agentName ?? 'Our team'} helped you today. The full transcript is saved in Help & Support.`,
    href: `/support?case=${id}`,
  });
  return getCase(prisma, customer, id);
}
