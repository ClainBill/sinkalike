import { useState } from 'preact/hooks';

export default function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      class="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked: the code is still visible */
        }
      }}
    >
      <span style="font-family: var(--mono)">{code}</span>
      <span aria-live="polite">{copied ? 'Copied!' : 'Copy code'}</span>
    </button>
  );
}
