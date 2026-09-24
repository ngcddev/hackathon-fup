'use client';

import { useState, type ReactNode } from 'react';
import { useSession } from '@/components/app/SessionProvider';
import { CountBadge, Tabs } from '@/components/ui/Tabs';
import type { ImportTarget } from '@/lib/types/api';
import { importPermissionFor } from '@/lib/auth/permissions';
import { ImportPanel, useProblemBatches } from './import/ImportPanel';

type Tab = 'datos' | 'corregir';

interface EntityViewProps {
  target: ImportTarget | null; // tabla que se puede corregir desde esta pantalla
  note?: string;
  children: ReactNode; // pestaña "Estado y datos"
}

// Pantallas de datos con dos pestañas: el estado actual y la corrección/importación de datos.
export function EntityView({ target, note, children }: EntityViewProps) {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('datos');
  const canImport = target !== null && can(importPermissionFor(target));
  const problems = useProblemBatches(canImport ? target : null);

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'datos', label: 'Estado y datos' },
          { key: 'corregir', label: <>Corregir y actualizar datos{problems > 0 && <CountBadge n={problems} />}</> },
        ]}
      />
      {tab === 'datos' ? children : <ImportPanel target={target} note={note} />}
    </div>
  );
}
