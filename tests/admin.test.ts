import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { User } from '../src/models';
import { baseUrl, stopTestServer, waitForServer } from './setup';

let superAdminToken: string;
let superAdminId: string;
let memberToken: string;
let memberId: string;
let memberEmail: string;
let memberPassword = 'MemberPass123';
let managedUserId: string;
let defaultChannelId: string;

const signup = async (params: { name: string; email: string; password: string }) => {
  const response = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  return {
    response,
    data: await response.json() as any,
  };
};

beforeAll(async () => {
  await waitForServer();

  const adminSignup = await signup({
    name: 'Super Admin Test',
    email: `super-admin-${Date.now()}@example.com`,
    password: 'AdminPass123',
  });

  superAdminToken = adminSignup.data.token;
  superAdminId = adminSignup.data.user.id;

  const adminUser = await User.findByPk(superAdminId);
  await adminUser!.update({
    role: 'super_admin',
    provisioningSource: 'bootstrap',
  });

  memberEmail = `member-${Date.now()}@example.com`;
  const memberSignup = await signup({
    name: 'Managed Member',
    email: memberEmail,
    password: memberPassword,
  });

  memberToken = memberSignup.data.token;
  memberId = memberSignup.data.user.id;
});

afterAll(async () => {
  await stopTestServer();
});

describe('Admin Endpoints', () => {
  it('returns admin overview for super admins', async () => {
    const response = await fetch(`${baseUrl}/admin/overview`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    const data = await response.json() as any;

    expect(response.status).toBe(200);
    expect(data.overview.users.byRole.super_admin).toBeGreaterThanOrEqual(1);
    expect(data.overview.channels.default).toBeGreaterThanOrEqual(1);
  });

  it('creates admin-managed users and auto-enrolls them into default channels', async () => {
    const response = await fetch(`${baseUrl}/admin/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Imported Teammate',
        email: `teammate-${Date.now()}@example.com`,
        role: 'member',
        team: 'Support',
        department: 'Operations',
      }),
    });

    const data = await response.json() as any;

    expect(response.status).toBe(201);
    expect(data.user.role).toBe('member');
    expect(data.user.team).toBe('Support');
    expect(typeof data.temporaryPassword).toBe('string');
    expect(data.defaultChannelsAdded).toBeGreaterThanOrEqual(1);

    managedUserId = data.user.id;
  });

  it('imports users from CSV and reports skips', async () => {
    const csv = [
      'name,email,role,team,department',
      `CSV User,csv-user-${Date.now()}@example.com,member,Sales,Revenue`,
      'Broken Row,not-an-email,member,Sales,Revenue',
    ].join('\n');

    const response = await fetch(`${baseUrl}/admin/users/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ csv }),
    });

    const data = await response.json() as any;

    expect(response.status).toBe(201);
    expect(data.summary.createdCount).toBe(1);
    expect(data.summary.skippedCount).toBe(1);
  });

  it('disables and reactivates users through admin endpoints', async () => {
    const disableResponse = await fetch(`${baseUrl}/admin/users/${memberId}/disable`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    expect(disableResponse.status).toBe(200);

    const blockedLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, password: memberPassword }),
    });

    expect(blockedLogin.status).toBe(403);

    const reactivateResponse = await fetch(`${baseUrl}/admin/users/${memberId}/reactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    expect(reactivateResponse.status).toBe(200);

    const restoredLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, password: memberPassword }),
    });

    const restoredData = await restoredLogin.json() as any;

    expect(restoredLogin.status).toBe(200);
    memberToken = restoredData.token;
  });

  it('resets sessions and invalidates old access tokens', async () => {
    const response = await fetch(`${baseUrl}/admin/users/${memberId}/reset-sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    expect(response.status).toBe(200);

    const staleTokenResponse = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(staleTokenResponse.status).toBe(401);

    const reloginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, password: memberPassword }),
    });

    const reloginData = await reloginResponse.json() as any;

    expect(reloginResponse.status).toBe(200);
    memberToken = reloginData.token;
  });

  it('creates forced-membership default channels from the admin API', async () => {
    const response = await fetch(`${baseUrl}/admin/channels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Announcements ${Date.now()}`,
        description: 'Default company-wide updates',
        isDefault: true,
      }),
    });

    const data = await response.json() as any;
    const totalUsers = await User.count();

    expect(response.status).toBe(201);
    expect(data.channel.isDefault).toBe(true);
    expect(data.channel.membershipPolicy).toBe('admin_managed');
    expect(data.channel.memberCount).toBe(totalUsers);

    defaultChannelId = data.channel.id;
  });

  it('blocks leaving or deleting protected default/system channels through regular routes', async () => {
    const channelsResponse = await fetch(`${baseUrl}/channels`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const channelsData = await channelsResponse.json() as any;
    const generalChannel = channelsData.channels.find((channel: any) => channel.name === 'General');

    expect(generalChannel).toBeDefined();
    expect(generalChannel.isSystem).toBe(true);
    expect(generalChannel.isDefault).toBe(true);

    const leaveGeneralResponse = await fetch(`${baseUrl}/channels/${generalChannel.id}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(leaveGeneralResponse.status).toBe(403);

    const deleteDefaultResponse = await fetch(`${baseUrl}/channels/${defaultChannelId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    expect(deleteDefaultResponse.status).toBe(403);
  });

  it('records audit logs for admin activity', async () => {
    const response = await fetch(`${baseUrl}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });

    const data = await response.json() as any;

    expect(response.status).toBe(200);
    expect(Array.isArray(data.auditLogs)).toBe(true);
    expect(data.auditLogs.length).toBeGreaterThan(0);
    expect(data.auditLogs.some((log: any) => log.action === 'user.created')).toBe(true);
  });
});
