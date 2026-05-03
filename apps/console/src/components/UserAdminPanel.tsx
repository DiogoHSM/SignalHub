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
  const [error, setError] = useState<string | undefined>();

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
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) return;

    setError(undefined);

    try {
      const { user } = await client.createUser({
        email: trimmedEmail,
        password,
        isAdmin: false
      });
      setUsers((current) => [...current, user]);
      setEmail("");
      setPassword("");
    } catch {
      setError("Could not create user.");
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
              <strong>{user.email}</strong>
              <span>{user.isAdmin ? "Admin" : "User"}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="compact-form" onSubmit={submit}>
        <label>
          New user email
          <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>
        <label>
          Temporary password
          <input onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        <button type="submit">Create user</button>
      </form>
    </section>
  );
}
