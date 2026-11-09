'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { restoreSession } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    restoreSession().then((ok) => router.replace(ok ? '/dashboard' : '/login'));
  }, [router]);
  return null;
}
