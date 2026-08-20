// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Team & organization (the managed edition's tenants entry).
 *
 * Membership IS authorization here — `authenticate` takes the caller's role
 * from their `tenant_member` row (workplan 0020 T1) — so this screen is where
 * access is granted, changed and revoked. It replaced a 14-line stub the nav
 * had linked to since the beginning (0026 T2, owner decision 2026-08-02: the
 * broken admin surface was deleted, this one was kept and built).
 *
 * The guards live on the SERVER (last-owner demotion/removal, owner grants
 * being owner-only, self-removal) and their refusals render VERBATIM — the
 * client only pre-empts what it can know for certain: an admin's role select
 * offers no owner option, your own row offers no remove button, and a
 * member/viewer sees a read-only list. Everything else is the server's call.
 *
 * Inviting creates the membership row and nothing more: invitation email is
 * still not a thing the product sends, so the form says out loud that no email
 * goes out, rather than letting the word "invite" promise one. (The channel
 * built by 0030 sends what a migration needs a decision about — it does not
 * send invitations, and saying so here is cheaper than the support ticket.)
 *
 * The email-summary card is 0030 T4: how often this organization is emailed a
 * summary of what is waiting, read every morning by the `managed-digest` task.
 * Owner/admin only, like every other change here.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, UserPlus } from 'lucide-react';
import {
  tenantApi,
  memberApi,
  type Member,
  type TenantNotificationPrefs,
} from '../services/mapping-service.ts';
// The SAME reader the API and the digest task use, so what this screen shows
// and what the morning job acts on cannot be two different defaults.
import { readTenantNotificationPrefs } from '@openmig/shared';
import { useAuthStore } from '../stores/auth-store.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/index.tsx';

const ROLES: ReadonlyArray<Member['role']> = ['owner', 'admin', 'member', 'viewer'];

/** For the self-demotion gate only: is the chosen role LOWER than the held
 *  one? (Access breadth, matching the server's own guard ordering.) */
const ROLE_RANK: Record<Member['role'], number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

const STATUS_STYLE: Record<Member['status'], string> = {
  active: 'bg-green-50 text-green-700',
  invited: 'bg-blue-50 text-blue-700',
  suspended: 'bg-amber-50 text-amber-700',
  removed: 'bg-gray-100 text-gray-500',
};

/**
 * The server's own words for a failed request, verbatim (the prose boundary:
 * "Cannot demote the last owner" is a finding, not a frame). The dictionary
 * fallback covers transport failures that never reached the server.
 */
function errorText(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: unknown } } })?.response?.data;
  if (data && typeof data.message === 'string' && data.message) return data.message;
  return fallback;
}

const Tenants: React.FC = () => {
  const t = useT();
  const { dateTime } = useFormatters();
  const queryClient = useQueryClient();
  const { user, tenantId } = useAuthStore();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const isOwner = user?.role === 'owner';

  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<Member['role']>('member');
  const [inviteBusy, setInviteBusy] = React.useState(false);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});
  const [busyRow, setBusyRow] = React.useState<string | null>(null);
  const [armedRemove, setArmedRemove] = React.useState<string | null>(null);
  const [armedSelfDemotion, setArmedSelfDemotion] = React.useState<{
    memberId: string;
    role: Member['role'];
  } | null>(null);
  const [notifyBusy, setNotifyBusy] = React.useState(false);
  const [notifyError, setNotifyError] = React.useState<string | null>(null);
  const [notifySaved, setNotifySaved] = React.useState(false);
  const [notifyDraft, setNotifyDraft] = React.useState<TenantNotificationPrefs | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);

  const tenantQuery = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => tenantApi.get(tenantId as string),
    enabled: Boolean(tenantId),
  });

  const membersQuery = useQuery({
    queryKey: ['members', tenantId],
    queryFn: () => memberApi.list(tenantId as string),
    enabled: Boolean(tenantId),
  });

  if (!tenantId) {
    return <p className="text-gray-500">{t('tenants.noTenant')}</p>;
  }

  const refetchMembers = () =>
    queryClient.invalidateQueries({ queryKey: ['members', tenantId] });

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteBusy(true);
    setInviteError(null);
    try {
      await memberApi.invite(tenantId, { email: inviteEmail.trim(), role: inviteRole });
      setInviteEmail('');
      setInviteRole('member');
      await refetchMembers();
    } catch (err) {
      setInviteError(errorText(err, t('common.requestFailed')));
    } finally {
      setInviteBusy(false);
    }
  };

  const changeRole = async (member: Member, role: Member['role'], isSelf = false) => {
    // Lowering your OWN role is armed like the other access-revoking actions
    // (the Deletions pattern this file already uses for remove): you may not
    // be able to change it back yourself afterwards, which makes it one
    // un-undoable click — while removing someone else takes two (0039 T5).
    // Other-row changes and self-PROMOTION attempts stay single-click (the
    // server refuses what it refuses, verbatim, as before).
    if (isSelf && ROLE_RANK[role] < ROLE_RANK[member.role] && armedSelfDemotion?.role !== role) {
      setArmedSelfDemotion({ memberId: member.id, role });
      return;
    }
    setArmedSelfDemotion(null);
    setBusyRow(member.id);
    setRowErrors((errors) => ({ ...errors, [member.id]: '' }));
    try {
      await memberApi.updateRole(tenantId, member.id, role);
      await refetchMembers();
    } catch (err) {
      setRowErrors((errors) => ({
        ...errors,
        [member.id]: errorText(err, t('common.requestFailed')),
      }));
    } finally {
      setBusyRow(null);
    }
  };

  // Removal revokes access, so it is armed like the other destructive buttons
  // (the Deletions pattern): first click changes the label, second click acts.
  const remove = async (member: Member) => {
    if (armedRemove !== member.id) {
      setArmedRemove(member.id);
      return;
    }
    setArmedRemove(null);
    setBusyRow(member.id);
    setRowErrors((errors) => ({ ...errors, [member.id]: '' }));
    try {
      await memberApi.remove(tenantId, member.id);
      await refetchMembers();
    } catch (err) {
      setRowErrors((errors) => ({
        ...errors,
        [member.id]: errorText(err, t('common.requestFailed')),
      }));
    } finally {
      setBusyRow(null);
    }
  };

  const saveName = async () => {
    setRenameError(null);
    try {
      await tenantApi.update(tenantId, { name: nameDraft.trim() });
      setRenaming(false);
      await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
    } catch (err) {
      setRenameError(errorText(err, t('common.requestFailed')));
    }
  };

  const members = membersQuery.data ?? [];
  // A const binding so the rename button's closure keeps the narrowing below.
  const tenant = tenantQuery.data;

  /**
   * The stored preference, or the server's default while nothing is stored.
   *
   * The DRAFT wins once a save has answered, so the control shows what was
   * actually stored rather than snapping back to the cached tenant row while
   * the query refetches — a select that flickers to its old value looks like
   * a failed save.
   */
  const prefs: TenantNotificationPrefs =
    notifyDraft ?? readTenantNotificationPrefs(tenant?.settings);

  const saveNotifications = async (next: TenantNotificationPrefs) => {
    setNotifyBusy(true);
    setNotifyError(null);
    setNotifySaved(false);
    // Shown immediately, so the select does not sit on the old value while
    // the request is in flight; replaced by the server's answer below.
    setNotifyDraft(next);
    try {
      setNotifyDraft(await tenantApi.setNotifications(tenantId, next));
      setNotifySaved(true);
      await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
    } catch (err) {
      // Back to what is actually stored: leaving the new value on screen
      // after a failed save would show a setting nobody has.
      setNotifyDraft(null);
      setNotifyError(errorText(err, t('common.requestFailed')));
    } finally {
      setNotifyBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('tenants.title')}</h1>
        <p className="text-gray-500 mt-1">{t('tenants.intro')}</p>
      </div>

      {/* Organization */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">{t('tenants.org.heading')}</h2>
        {tenantQuery.isError ? (
          <p className="text-amber-700">{t('tenants.org.readError')}</p>
        ) : renaming ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              aria-label={t('tenants.org.heading')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
            <button
              onClick={saveName}
              disabled={!nameDraft.trim()}
              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {t('tenants.org.renameSave')}
            </button>
            <button
              onClick={() => setRenaming(false)}
              className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              {t('tenants.org.renameCancel')}
            </button>
            {renameError && <p className="w-full text-sm text-amber-700">{renameError}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-blue-600" />
            <span className="text-gray-900 font-medium">
              {tenant?.name ?? t('common.loading')}
            </span>
            {canManage && tenant && (
              <button
                onClick={() => {
                  setNameDraft(tenant.name);
                  setRenaming(true);
                }}
                className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                <Pencil className="w-3.5 h-3.5" />
                {t('tenants.org.rename')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Email summaries (workplan 0030 T4) */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          {t('tenants.notify.heading')}
        </h2>
        <p className="text-sm text-gray-500 mb-3">{t('tenants.notify.intro')}</p>
        {tenantQuery.isError ? (
          /* Disabled rather than defaulted: saving a value read from a failed
             request would overwrite a setting nobody has seen (rule 9). */
          <p className="text-amber-700">{t('tenants.notify.readError')}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              {t('tenants.notify.cadence')}
              <select
                value={prefs.digest}
                disabled={!canManage || notifyBusy || !tenantQuery.isSuccess}
                onChange={(e) =>
                  saveNotifications({
                    ...prefs,
                    digest: e.target.value as TenantNotificationPrefs['digest'],
                  })
                }
                className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="daily">{t('tenants.notify.daily')}</option>
                <option value="weekly">{t('tenants.notify.weekly')}</option>
                <option value="off">{t('tenants.notify.off')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              {t('tenants.notify.locale')}
              <select
                value={prefs.locale}
                disabled={!canManage || notifyBusy || !tenantQuery.isSuccess}
                onChange={(e) =>
                  saveNotifications({
                    ...prefs,
                    locale: e.target.value as TenantNotificationPrefs['locale'],
                  })
                }
                className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="en">English</option>
                <option value="nl">Nederlands</option>
              </select>
            </label>
            <p className="w-full text-sm text-gray-500">{t('tenants.notify.recipients')}</p>
            {notifySaved && <p className="w-full text-sm text-green-700">{t('tenants.notify.saved')}</p>}
            {/* The server's own words, verbatim — the prose boundary. */}
            {notifyError && <p className="w-full text-sm text-amber-700">{notifyError}</p>}
          </div>
        )}
      </div>

      {/* Members */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          {t('tenants.members.heading')}
        </h2>
        {!canManage && <p className="text-sm text-gray-500 mb-3">{t('tenants.readOnly')}</p>}
        {membersQuery.isError ? (
          <p className="text-amber-700">{t('tenants.members.readError')}</p>
        ) : membersQuery.isLoading ? (
          <p className="text-gray-500">{t('common.loading')}</p>
        ) : members.length === 0 ? (
          <p className="text-gray-500">{t('tenants.members.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4 font-medium">{t('tenants.members.emailHeader')}</th>
                  <th className="py-2 pr-4 font-medium">{t('tenants.members.roleHeader')}</th>
                  <th className="py-2 pr-4 font-medium">{t('tenants.members.statusHeader')}</th>
                  <th className="py-2 pr-4 font-medium">{t('tenants.members.invitedHeader')}</th>
                  <th className="py-2 pr-4 font-medium">{t('tenants.members.joinedHeader')}</th>
                  {canManage && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const isSelf = member.userId === user?.id;
                  return (
                    <React.Fragment key={member.id}>
                      <tr className="border-b border-gray-100">
                        <td className="py-3 pr-4 text-gray-900">
                          {member.email}
                          {isSelf && (
                            <span className="ml-2 text-xs text-gray-500">
                              ({t('tenants.members.you')})
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          {canManage ? (
                            <select
                              value={member.role}
                              aria-label={`${t('tenants.members.roleHeader')} ${member.email}`}
                              disabled={busyRow === member.id}
                              onChange={(e) =>
                                changeRole(member, e.target.value as Member['role'], isSelf)
                              }
                              className="px-2 py-1 border border-gray-300 rounded text-gray-900 bg-white"
                            >
                              {ROLES.map((role) => (
                                <option
                                  key={role}
                                  value={role}
                                  // Granting owner is owner-only (the server's
                                  // guard) — an admin's select says so up front.
                                  disabled={role === 'owner' && !isOwner}
                                >
                                  {t(`role.${role}` as StringKey)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-gray-900">
                              {t(`role.${member.role}` as StringKey)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[member.status]}`}
                          >
                            {t(`memberStatus.${member.status}` as StringKey)}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-gray-500">
                          {member.invitedAt ? dateTime(member.invitedAt) : '—'}
                        </td>
                        <td className="py-3 pr-4 text-gray-500">
                          {member.joinedAt ? dateTime(member.joinedAt) : '—'}
                        </td>
                        {canManage && (
                          <td className="py-3 text-right">
                            {!isSelf && (
                              <button
                                onClick={() => remove(member)}
                                disabled={busyRow === member.id}
                                className={`px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-50 ${
                                  armedRemove === member.id
                                    ? 'bg-red-600 text-white hover:bg-red-700'
                                    : 'text-red-700 hover:bg-red-50'
                                }`}
                              >
                                {armedRemove === member.id
                                  ? t('tenants.members.removeArmed')
                                  : t('tenants.members.remove')}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      {armedSelfDemotion?.memberId === member.id && (
                        <tr>
                          <td colSpan={canManage ? 6 : 5} className="pb-3 text-amber-700">
                            {t('tenants.selfDemotionArmed')}{' '}
                            <button
                              onClick={() => changeRole(member, armedSelfDemotion.role, true)}
                              disabled={busyRow === member.id}
                              className="ml-2 px-3 py-1 text-sm font-medium rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                            >
                              {t('tenants.selfDemotionConfirm')}
                            </button>
                          </td>
                        </tr>
                      )}
                      {rowErrors[member.id] && (
                        <tr>
                          <td colSpan={canManage ? 6 : 5} className="pb-3 text-amber-700">
                            {rowErrors[member.id]}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite */}
      {canManage && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {t('tenants.invite.heading')}
          </h2>
          <p className="text-sm text-gray-500 mb-4">{t('tenants.invite.hint')}</p>
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-sm text-gray-700">
              {t('tenants.invite.email')}
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="mt-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 w-72"
              />
            </label>
            <label className="flex flex-col text-sm text-gray-700">
              {t('tenants.invite.role')}
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Member['role'])}
                className="mt-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role} disabled={role === 'owner' && !isOwner}>
                    {t(`role.${role}` as StringKey)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={inviteBusy || !inviteEmail.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <UserPlus className="w-4 h-4" />
              {t('tenants.invite.submit')}
            </button>
            {inviteError && <p className="w-full text-amber-700">{inviteError}</p>}
          </form>
        </div>
      )}
    </div>
  );
};

export default Tenants;
