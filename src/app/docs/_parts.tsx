import type { ReactNode } from 'react';

// Piezas mínimas de la página de documentación: solo estructura, sin estilo decorativo.

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-4">
      <h2 className="border-b pb-1 text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function Sub({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <div id={id} className="mt-6 scroll-mt-4">
      <h3 className="font-bold">{title}</h3>
      {children}
    </div>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-2">{children}</p>;
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-2 list-disc pl-6">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function C({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.9em]">{children}</code>;
}

export function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} className="border px-2 py-1 text-left align-top">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border px-2 py-1 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Toc({ title, items }: { title: string; items: { id: string; label: string }[] }) {
  return (
    <div>
      <h3 className="font-bold">{title}</h3>
      <ul className="mt-1 list-disc pl-6">
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className="underline">
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
