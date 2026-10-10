// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * DOWNLOAD THE INVOICE (workplan 0111, T6): Moneybird's own PDF of an invoice
 * it has numbered, fetched through the API and handed to the browser as a
 * file named after the legal number. Nothing keeps a copy: the server streams
 * it from the books, and the browser saves it.
 *
 * The format is in the file's name, not on the button, as for the report of
 * what arrived (0154 T5). A download that fails says why, beside the button.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '../i18n/index.tsx';
import { billingApi } from '../services/billing-service.ts';
import { serverMessage } from '../services/api.ts';

export const InvoiceDownload: React.FC<{ invoiceId: string }> = ({ invoiceId }) => {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const download = () => {
    setBusy(true);
    setFailed(null);
    billingApi
      .downloadInvoicePdf(invoiceId)
      .then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((err: unknown) => setFailed(serverMessage(err)))
      .finally(() => setBusy(false));
  };

  return (
    <p className="text-sm">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="inline-flex items-center gap-1 text-blue-700 hover:underline disabled:opacity-50"
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {t('billing.invoice.download')}
      </button>
      {failed && (
        <span className="ml-2 text-red-800" role="alert">
          <span className="font-medium">{t('billing.invoice.downloadFailed')}</span> {failed}
        </span>
      )}
    </p>
  );
};

export default InvoiceDownload;
