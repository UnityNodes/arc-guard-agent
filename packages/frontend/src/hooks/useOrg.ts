'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useBackendAuth } from '@/hooks/useBackendAuth';

export interface Org {
  id: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'SIGNER' | 'VIEWER';
  members: number;
  approvalThresholdUsd: number;
  requiredApprovals: number;
}

export function useOrg() {
  const { ready } = useBackendAuth();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const d = await api.get<{ organizations: Org[] }>('/org');
      setOrgs(d.organizations);
      setOrg((prev) => d.organizations.find((o) => o.id === prev?.id) ?? d.organizations[0] ?? null);
    } catch {
      setOrgs([]);
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) refetch();
  }, [ready, refetch]);

  const createOrg = useCallback(async (name: string) => {
    await api.post('/org', { name });
    await refetch();
  }, [refetch]);

  return { orgs, org, setOrg, loading, refetch, createOrg };
}
