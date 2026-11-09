'use client';

import { useEffect, useState } from 'react';
import { Alert, errorMessage, PageHeader, Spinner, Tx, TxList } from '@/components/ui';
import { api, CURRENCIES } from '@/lib/api';

export default function TransactionsPage() {
  const [items, setItems] = useState<Tx[] | null>(null);
  const [currency, setCurrency] = useState('');
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');

  const load = async (before?: string) => {
    const qs = new URLSearchParams({ limit: '30' });
    if (currency) qs.set('currency', currency);
    if (before) qs.set('before', before);
    try {
      const page: Tx[] = await api(`/wallets/transactions?${qs}`);
      setItems((prev) => (before && prev ? [...prev, ...page] : page));
      setMore(page.length === 30);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    setItems(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Every payment, top-up and conversion."
        action={
          <select aria-label="Filter by currency" className="input w-36" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">All currencies</option>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        }
      />
      {error && <Alert>{error}</Alert>}
      <section className="card">
        {items ? <TxList items={items} /> : <Spinner />}
        {items && more && items.length > 0 && (
          <button className="btn-ghost mt-4 w-full" onClick={() => load(items[items.length - 1].createdAt)}>Load more</button>
        )}
      </section>
    </>
  );
}
