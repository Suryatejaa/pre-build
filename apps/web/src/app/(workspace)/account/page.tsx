import { requireUser } from '@/server/session';
export default async function AccountPage() {
  const user = await requireUser();
  return <><div className="page-heading"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>A place of your own.</h1><p className="intro">Your identity across your property projects.</p></div></div><section className="form-panel account-panel"><h2>Account details</h2><dl className="definition-list"><div><dt>Name</dt><dd>{user.name}</dd></div><div><dt>Email address</dt><dd>{user.email}</dd></div><div><dt>Email status</dt><dd>{user.emailVerified ? 'Verified' : 'Not yet verified'}</dd></div><div><dt>Account ID</dt><dd><code>{user.id}</code></dd></div></dl><p className="help">Share your account ID with a project owner when they need to give you access. Your account ID is not a password.</p></section></>;
}
