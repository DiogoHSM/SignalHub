import { useState, type FormEvent } from "react";
import { EmptyHint, Icon } from "../../../components/ui/v2";
import type { User } from "../../../api/types";
import type { UseSystemUsersResult } from "../useSystem";

export function ConsoleAccessSection({
  currentUser,
  users,
  pushToast,
}: {
  currentUser: User;
  users: UseSystemUsersResult;
  pushToast: (message: string) => void;
}) {
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);

  const reset = () => {
    setEditingUser(null);
    setEmail("");
    setPassword("");
    setMutationError(null);
  };

  const beginEdit = (user: User) => {
    setEditingUser(user);
    setEmail(user.email);
    setPassword("");
    setMutationError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail || (!editingUser && !password) || users.pendingUserId) return;

    const temporaryPassword = password;
    setPassword("");
    setMutationError(null);
    try {
      if (editingUser) {
        await users.update(editingUser.id, {
          email: normalizedEmail,
          ...(temporaryPassword ? { password: temporaryPassword } : {}),
        });
        pushToast("Console user updated.");
      } else {
        await users.create({ email: normalizedEmail, password: temporaryPassword, isAdmin: true });
        pushToast("Console user created.");
      }
      reset();
    } catch (error) {
      console.error(error);
      setMutationError(editingUser ? "Could not update console user." : "Could not create console user.");
    }
  };

  const archive = async (user: User) => {
    if (user.id === currentUser.id || users.pendingUserId) return;
    if (!window.confirm(`Archive ${user.email}? They will no longer be able to access this SignalMonitor console.`)) return;
    setMutationError(null);
    try {
      await users.archive(user.id);
      if (editingUser?.id === user.id) reset();
      pushToast("Console user archived.");
    } catch (error) {
      console.error(error);
      setMutationError("Could not archive console user.");
    }
  };

  return (
    <section className="sh-card" aria-labelledby="console-access-heading">
      <div className="sh-card__head" style={{ alignItems: "flex-start" }}>
        <div>
          <h2 className="sh-h2" id="console-access-heading">Console access</h2>
          <p className="sh-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            Installation-level administrators who can sign in to this SignalMonitor instance.
          </p>
        </div>
        <span className="sh-tag solid">Admin only</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16, padding: 16 }}>
        <div style={{ minWidth: 0 }}>
          {users.status === "loading" ? <EmptyHint icon="users" title="Loading users…" sub="Fetching console access." /> : null}
          {users.status === "error" ? (
            <div role="alert" style={{ display: "grid", gap: 10 }}>
              <span className="sh-error">{users.error}</span>
              <button className="sh-btn" type="button" onClick={users.reload}>Retry</button>
            </div>
          ) : null}
          {users.status === "ok" && users.users.length === 0 ? (
            <EmptyHint icon="users" title="No console users" sub="Create the first additional administrator." />
          ) : null}
          {users.status === "ok" && users.users.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              {users.users.map((user) => {
                const isCurrent = user.id === currentUser.id;
                const pending = users.pendingUserId === user.id;
                return (
                  <div className="sh-row" key={user.id} style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto", alignItems: "center", border: "1px solid var(--border-subtle)", borderRadius: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: "block", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</strong>
                      <span className="sh-faint" style={{ fontSize: 11 }}>Administrator{isCurrent ? " · You" : ""}</span>
                    </div>
                    <button className="sh-btn ghost" type="button" aria-label={`Edit ${user.email}`} disabled={Boolean(users.pendingUserId)} onClick={() => beginEdit(user)}>
                      <Icon name="edit" size={13} /> Edit
                    </button>
                    <button
                      className="sh-btn ghost"
                      type="button"
                      aria-label={`Archive ${user.email}`}
                      title={isCurrent ? "You cannot archive your own account." : "Archive console user"}
                      disabled={isCurrent || Boolean(users.pendingUserId)}
                      onClick={() => void archive(user)}
                    >
                      <Icon name="archive" size={13} /> {pending ? "Archiving…" : "Archive"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <form onSubmit={(event) => void submit(event)} style={{ display: "grid", alignContent: "start", gap: 12, padding: 16, background: "var(--bg-surface-2)", border: "1px solid var(--border-subtle)", borderRadius: 6 }}>
          <strong style={{ fontSize: 13 }}>{editingUser ? "Edit console user" : "Add console user"}</strong>
          <label style={{ display: "grid", gap: 5 }}>
            <span className="sh-label">{editingUser ? "User email" : "New user email"}</span>
            <input className="sh-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span className="sh-label">Temporary password{editingUser ? " (optional)" : ""}</span>
            <input className="sh-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required={!editingUser} />
          </label>
          <p className="sh-muted" style={{ margin: 0, fontSize: 11 }}>
            Console access currently grants installation administrator privileges.
          </p>
          {mutationError ? <span className="sh-error" role="alert">{mutationError}</span> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {editingUser ? <button className="sh-btn ghost" type="button" onClick={reset}>Cancel</button> : null}
            <button className="sh-btn primary" type="submit" disabled={Boolean(users.pendingUserId) || !email.trim() || (!editingUser && !password)}>
              <Icon name={editingUser ? "check" : "plus"} size={13} />
              {users.pendingUserId ? "Saving…" : editingUser ? "Save console user" : "Create console user"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

