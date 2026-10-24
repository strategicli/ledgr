// The Mail & Calendar module's options on Build → Modules (its `settingsPanel`).
// Server component: reads which sign-ins this computer holds (never the
// secrets) and hands the forms to the client half.
//
// Two accounts, each set up once:
//   Outlook  → the IDs and secret of the hub-only Azure app (runbook §1w)
//   Gmail    → a Google app's client ID and secret, then "Connect Gmail"
import { mailAvailable } from "@/modules/mail/manifest";
import { accountStatus } from "@/modules/mail/lib/accounts";
import { CheckButton, ForgetButton, MicrosoftForm, GoogleForm } from "./MailAccountForms";

export default function MailSettingsPanel() {
  if (!mailAvailable()) {
    return <p className="text-ink-muted">Mail runs only on a Ledgr installed on your own computer.</p>;
  }
  const s = accountStatus();
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="ui-section-label text-ink-subtle">Outlook</p>
        {s.microsoft.configured ? (
          <p>
            Set up for <span className="text-ink">{s.microsoft.mailbox ?? "your mailbox"}</span>.{" "}
            <ForgetButton account="microsoft" label="Remove" />
          </p>
        ) : (
          <p className="text-ink-muted">
            Needs its own Microsoft app, separate from the one Ledgr already uses, because this one can send mail.
            The steps are in the runbook, section 1w.
          </p>
        )}
        <MicrosoftForm replacing={s.microsoft.configured} />
      </section>

      <section className="space-y-2 border-t border-line pt-3">
        <p className="ui-section-label text-ink-subtle">Gmail</p>
        {s.gmail.connected ? (
          <p>
            Connected as <span className="text-ink">{s.gmail.email ?? "your Gmail"}</span>.{" "}
            <ForgetButton account="gmail" label="Disconnect" />
          </p>
        ) : s.gmail.appConfigured ? (
          <p>
            <a href="/api/mail/google/start" className="underline underline-offset-2 hover:text-ink">
              Connect Gmail
            </a>{" "}
            <span className="text-ink-muted">
              (Google will warn that the app isn&apos;t verified. It&apos;s your own app: choose Advanced, then continue.)
            </span>
          </p>
        ) : (
          <p className="text-ink-muted">
            Needs a Google app of your own first. The steps are in the runbook, section 1w.
          </p>
        )}
        <GoogleForm replacing={s.gmail.appConfigured} />
      </section>

      {(s.microsoft.configured || s.gmail.connected) && (
        <section className="border-t border-line pt-3">
          <CheckButton />
        </section>
      )}
    </div>
  );
}
