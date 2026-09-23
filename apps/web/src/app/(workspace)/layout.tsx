import { Brand } from '@/components/brand';
import { SignOutButton } from '@/components/forms';
import { WorkspaceNav } from '@/components/workspace-nav';
import { requireUser } from '@/server/session';
export const dynamic = 'force-dynamic';
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <><header className="site-header"><div className="header-inner"><Brand /><WorkspaceNav /><div className="header-account"><span className="avatar" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span><SignOutButton /></div></div></header>
    <main id="main" className="workspace">{children}</main><footer className="site-footer"><span>Property Record</span><span>Built around your home.</span></footer></>;
}
