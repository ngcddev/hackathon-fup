'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ROLE_LABEL, useSession } from '@/components/app/SessionProvider';
import { useToast } from '@/components/app/ToastProvider';
import { useApi } from '@/components/app/useApi';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { cn, fmtDate } from '@/components/ui/format';
import { apiPatch, apiPost, errorMessage } from '@/lib/api/client';
import { ROLES, type Role } from '@/lib/auth/permissions';
import type {
  CreateUserRequest,
  ListUsersResponse,
  ResetPasswordRequest,
  UpdateUserRequest,
  UserResponse,
  UserSummary,
} from '@/lib/types/api';

type Modal = { kind: 'create' } | { kind: 'role'; user: UserSummary } | { kind: 'reset'; user: UserSummary } | null;

const FIELD = 'h-12 rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 text-base text-ink';
const GHOST_BTN =
  'h-9 cursor-pointer rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold disabled:opacity-50';

// Contraseña temporal legible de 13 caracteres (el mínimo del contrato es 10).
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const letters = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  const digits = String(1000 + (crypto.getRandomValues(new Uint16Array(1))[0] % 9000));
  return `HSL-${letters}-${digits}`;
}

export function UsersView() {
  const { me } = useSession();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<ListUsersResponse>('/api/admin/users');
  const [modal, setModal] = useState<Modal>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const users = useMemo(() => data?.users ?? [], [data]);

  if (!data)
    return loading ? (
      <LoadingState label="los usuarios" />
    ) : (
      <ErrorState label="los usuarios" message={error ?? undefined} onRetry={reload} />
    );

  const toggleActive = async (user: UserSummary) => {
    setBusyId(user.user_id);
    try {
      await apiPatch<UserResponse>(`/api/admin/users/${user.user_id}`, {
        is_active: !user.is_active,
      } satisfies UpdateUserRequest);
      toast(`${user.full_name} ${user.is_active ? 'desactivado' : 'activado'}`);
      reload();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base text-muted">
          {users.length} usuarios · {users.filter((u) => u.is_active).length} activos
        </div>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          className="h-12 cursor-pointer rounded-lg border-0 bg-leaf px-[22px] text-base font-bold text-white hover:bg-forest"
        >
          + Nuevo usuario
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-card">
        <table className="w-full min-w-[900px] border-collapse text-[15px]">
          <thead>
            <tr className="bg-canvas text-left">
              {['Nombre', 'Correo', 'Rol', 'Estado', 'Creado', 'Acciones'].map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    'px-4 py-3 text-[13px] font-bold uppercase tracking-[0.05em] text-muted',
                    i === 5 && 'text-right',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id} className="border-t border-line">
                <td className="px-4 py-3 font-bold">
                  {u.full_name}
                  {u.must_change_password && (
                    <div className="text-[13px] font-medium text-muted">Debe cambiar su contraseña</div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700">{u.email}</td>
                <td className="px-4 py-3">{ROLE_LABEL[u.role]}</td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-bold',
                      u.is_active ? 'border-navy bg-white text-navy' : 'border-slate-300 bg-slate-100 text-muted',
                    )}
                  >
                    <span className={cn('size-2 rounded-full', u.is_active ? 'bg-navy' : 'bg-slate-300')} />
                    {u.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-700">{fmtDate(u.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => setModal({ kind: 'role', user: u })} className={GHOST_BTN}>
                      Editar rol
                    </button>
                    <button
                      type="button"
                      disabled={busyId === u.user_id || u.user_id === me.id}
                      title={u.user_id === me.id ? 'No puedes desactivar tu propia cuenta' : undefined}
                      onClick={() => void toggleActive(u)}
                      className={GHOST_BTN}
                    >
                      {u.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button type="button" onClick={() => setModal({ kind: 'reset', user: u })} className={GHOST_BTN}>
                      Restablecer contraseña
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <UserModal
          modal={modal}
          onClose={() => setModal(null)}
          onDone={(message) => {
            setModal(null);
            toast(message);
            reload();
          }}
        />
      )}
    </div>
  );
}

function UserModal({
  modal,
  onClose,
  onDone,
}: {
  modal: NonNullable<Modal>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const initialRole: Role = modal.kind === 'role' ? modal.user.role : 'director';
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(initialRole);
  const [password, setPassword] = useState(() => (modal.kind === 'role' ? '' : temporaryPassword()));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const title =
    modal.kind === 'create' ? 'Nuevo usuario' : modal.kind === 'role' ? 'Editar rol' : 'Restablecer contraseña';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (modal.kind === 'create' && (!fullName.trim() || !/^\S+@\S+\.\S+$/.test(email)))
      return setError('Escriba un nombre y un correo válido.');
    if (modal.kind !== 'role' && password.length < 10)
      return setError('La contraseña temporal debe tener al menos 10 caracteres.');
    setBusy(true);
    try {
      if (modal.kind === 'create') {
        await apiPost<UserResponse>('/api/admin/users', {
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          role,
          temporary_password: password,
        } satisfies CreateUserRequest);
        onDone('Usuario creado');
      } else if (modal.kind === 'role') {
        await apiPatch<UserResponse>(`/api/admin/users/${modal.user.user_id}`, { role } satisfies UpdateUserRequest);
        onDone('Rol actualizado');
      } else {
        await apiPost<UserResponse>(`/api/admin/users/${modal.user.user_id}/reset-password`, {
          temporary_password: password,
        } satisfies ResetPasswordRequest);
        onDone(`Contraseña temporal asignada a ${modal.user.full_name}`);
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-ink/55 p-4 sm:p-6">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        className="flex max-h-full w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-float sm:p-7"
      >
        <h3 className="m-0 text-2xl font-extrabold">{title}</h3>
        {modal.kind === 'create' ? (
          <>
            <label className="flex flex-col gap-1.5 text-[15px] font-semibold">
              Nombre
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5 text-[15px] font-semibold">
              Correo
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
            </label>
          </>
        ) : (
          <div className="rounded-lg bg-canvas px-3.5 py-3 text-[15px]">
            <div className="font-bold">{modal.user.full_name}</div>
            <div className="text-muted">{modal.user.email}</div>
          </div>
        )}
        {modal.kind !== 'reset' && (
          <label className="flex flex-col gap-1.5 text-[15px] font-semibold">
            Rol (un solo rol por usuario)
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={cn(FIELD, 'px-3')}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        )}
        {modal.kind !== 'role' && (
          <label className="flex flex-col gap-1.5 text-[15px] font-semibold">
            Contraseña temporal
            <input value={password} onChange={(e) => setPassword(e.target.value)} className={cn(FIELD, 'font-mono')} />
            <span className="text-[13px] font-medium text-muted">
              El usuario deberá cambiarla en su primer ingreso. Entréguesela por un canal seguro; después no se puede
              volver a ver.
            </span>
          </label>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-danger-line bg-danger-bg px-3.5 py-2.5 text-sm font-semibold text-danger"
          >
            {error}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-[46px] cursor-pointer rounded-lg border border-line bg-white px-5 text-[15px] font-semibold"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-[46px] cursor-pointer rounded-lg border-0 bg-leaf px-5 text-[15px] font-bold text-white disabled:opacity-60"
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
