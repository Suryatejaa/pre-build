'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const links = [
  { href: '/projects', label: 'Projects' },
  { href: '/account', label: 'Account' },
] as const;

function isCurrentPath(pathname: string | null, href: string) {
  if (href === '/projects') return pathname === '/projects' || pathname?.startsWith('/projects/') === true;
  return pathname === href || pathname?.startsWith(`${href}/`) === true;
}

export function WorkspaceNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="workspace-nav-toggle"
        aria-expanded={open}
        aria-controls="workspace-navigation"
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <span className="workspace-nav-toggle-icon" aria-hidden="true"><span /><span /><span /></span>
        <span>{open ? 'Close menu' : 'Menu'}</span>
      </button>
      <nav id="workspace-navigation" className={`workspace-nav${open ? ' is-open' : ''}`} aria-label="Main navigation">
        {links.map(link => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isCurrentPath(pathname, link.href) ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
