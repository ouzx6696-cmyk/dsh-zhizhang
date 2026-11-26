import React, { useState } from "react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Brand, Button } from "@zhizhang/ui/primitives";
import { loginWebPasscode } from "../../state/web-bridge";

export function WebPasscodeGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = passcode.trim();
    if (!trimmed) {
      setError(C.auth.required);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await loginWebPasscode(trimmed);
      if (result.ok) {
        onUnlocked();
      } else {
        setError(result.message || C.auth.invalid);
      }
    } catch {
      setError(C.auth.invalid);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="zz-auth-gate" data-testid="web-passcode-gate">
      <section className="zz-auth-card">
        <div className="zz-auth-card__head">
          <Brand label={COPY["app.name"]} />
          <h1>{C.auth.title}</h1>
          <p>{C.auth.hint}</p>
        </div>
        <form className="zz-auth-form" onSubmit={(e) => void submit(e)}>
          <input
            type="password"
            className="zz-input"
            autoComplete="current-password"
            autoFocus
            value={passcode}
            placeholder={C.auth.placeholder}
            aria-label={C.auth.title}
            data-testid="web-passcode-input"
            disabled={submitting}
            onChange={(e) => setPasscode(e.target.value)}
          />
          {error ? (
            <p className="zz-auth-error" role="alert" data-testid="web-passcode-error">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            data-testid="web-passcode-submit"
          >
            {C.auth.submit}
          </Button>
        </form>
      </section>
    </main>
  );
}
