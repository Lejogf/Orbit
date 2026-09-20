import { describe, expect, test } from 'vitest';
import { agentFor, agentReply, callCode, estimateWaitMinutes, teamFor } from '../features/support.js';

describe('teamFor', () => {
  test('fraud topics go to a priority team', () => {
    expect(teamFor('A charge I don’t recognise')).toEqual({ team: 'Fraud & Security', priority: true });
    expect(teamFor('Possible scam').priority).toBe(true);
    expect(teamFor('Legal name change').team).toBe('Account Services');
  });
});

describe('estimateWaitMinutes', () => {
  const base = { channel: 'chat' as const, hourUtc: 16, queueDepth: 5, priority: false, needs: [] };

  test('priority topics wait at most a minute', () => {
    expect(estimateWaitMinutes({ ...base, priority: true })).toBeLessThanOrEqual(1);
  });

  test('nights are quieter than days', () => {
    expect(estimateWaitMinutes({ ...base, hourUtc: 6 })).toBeLessThan(estimateWaitMinutes(base));
  });

  test('interpreters add time, and messages are answered within hours', () => {
    expect(estimateWaitMinutes({ ...base, needs: ['asl'] })).toBeGreaterThan(estimateWaitMinutes(base));
    expect(estimateWaitMinutes({ ...base, channel: 'message' })).toBe(240);
  });
});

describe('agentFor', () => {
  test('is stable per case and bilingual when Spanish is needed', () => {
    expect(agentFor('case-1', [])).toBe(agentFor('case-1', []));
    expect(['Sofia', 'Luis']).toContain(agentFor('case-1', ['spanish']));
  });
});

describe('callCode', () => {
  test('is six digits, spaced for reading aloud', () => {
    expect(callCode(42)).toMatch(/^\d{3} \d{3}$/);
  });
});

describe('agentReply', () => {
  const base = { agent: 'Maya', firstName: 'Jordan', topic: 'Possible scam', needs: [], hadOriTranscript: true, customerMessage: '' };

  test('opens by confirming the transcript and verification', () => {
    const text = agentReply({ ...base, turn: 0 });
    expect(text).toContain("don't need to repeat");
    expect(text).toContain('already verified');
  });

  test('moves the conversation forward on each turn', () => {
    expect(agentReply({ ...base, turn: 1, customerMessage: 'yes' })).not.toBe(agentReply({ ...base, turn: 2, customerMessage: 'ok' }));
  });

  test('closes politely', () => {
    expect(agentReply({ ...base, turn: 3, customerMessage: 'thanks, that is all' })).toContain('24/7');
  });
});
