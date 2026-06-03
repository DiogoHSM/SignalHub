import { type FormEvent, useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { User } from "../api/types";

type Props = {
  client: ApiClient;
};

export function UserAdminPanel({ client }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingUser, setEditingUser] = useState<User | undefined>();
  const [archivingUserId, setArchivingUserId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void client
      .listUsers()
      .then(({ users }) => {
        if (cancelled) return;
        setUsers(users);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load users.");
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || (!editingUser && !password)) return;

    const temporaryPassword = password;
    setPassword("");
    setError(undefined);
    setIsSubmitting(true);

    try {
      if (editingUser) {
        const { user } = await client.updateUser(editingUser.id, {
          email: trimmedEmail,
          isAdmin,
          ...(temporaryPassword ? { password: temporaryPassword } : {})
        });
        setUsers((current) => current.map((currentUser) => (currentUser.id === user.id ? user : currentUser)));
        resetForm();
      } else {
        const { user } = await client.createUser({
          email: trimmedEmail,
          password: temporaryPassword,
          isAdmin: false
        });
        setUsers((current) => [...current, user]);
        resetForm();
      }
    } catch {
      setError(editingUser ? "Could not update user." : "Could not create user.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEditingUser(user: User) {
    setEditingUser(user);
    setEmail(user.email);
    setPassword("");
    setIsAdmin(user.isAdmin);
    setError(undefined);
  }

  function resetForm() {
    setEmail("");
    setPassword("");
    setIsAdmin(false);
    setEditingUser(undefined);
  }

  async function archiveUser(user: User) {
    const confirmed = window.confirm(`Archive user ${user.email}? They will no longer be able to access the console.`);
    if (!confirmed) return;

    setError(undefined);
    setArchivingUserId(user.id);

    try {
      await client.archiveUser(user.id);
      setUsers((current) => current.filter((currentUser) => currentUser.id !== user.id));
      if (editingUser?.id === user.id) {
        resetForm();
      }
    } catch {
      setError("Could not archive user.");
    } finally {
      setArchivingUserId(undefined);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Users</h2>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {users.length === 0 ? (
        <p className="muted-text">No users yet.</p>
      ) : (
        <ul className="key-list">
          {users.map((user) => (
            <li className="key-list-item" key={user.id}>
              <div>
                <strong>{user.email}</strong>
                <span>{user.isAdmin ? "Admin" : "User"}</span>
              </div>
              <div className="key-list-item__actions">
                <button aria-label={`Edit ${user.email}`} onClick={() => startEditingUser(user)} type="button">
                  Edit
                </button>
                <button
                  aria-label={`Archive ${user.email}`}
                  className="button-danger"
                  disabled={archivingUserId === user.id}
                  onClick={() => void archiveUser(user)}
                  type="button"
                >
                  Archive
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="compact-form" onSubmit={submit}>
        <label>
          {editingUser ? "User email" : "New user email"}
          <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>
        <label className="checkbox-field">
          <input checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} type="checkbox" />
          Administrator
        </label>
        <label>
          Temporary password
          <input onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        <div className="compact-form__actions">
          {editingUser ? (
            <button onClick={resetForm} type="button">
              Cancel
            </button>
          ) : null}
          <button disabled={isSubmitting} type="submit">
            {editingUser ? "Save user" : "Create user"}
          </button>
        </div>
      </form>
    </section>
  );
}
