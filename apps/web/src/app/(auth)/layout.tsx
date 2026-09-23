import { Brand } from '@/components/brand';
export const dynamic = 'force-dynamic';
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell"><div className="auth-main"><Brand /><main id="main" className="auth-form-wrap">{children}</main><footer className="auth-footer">A home begins with a considered plan.</footer></div>
    <aside className="auth-aside"><div className="eyebrow light">YOUR HOME, FROM THE BEGINNING</div>
      <div className="plan-illustration" aria-hidden="true"><div className="plan-outline"><span className="plan-room a" /><span className="plan-room b" /><span className="plan-room c" /><span className="plan-room d" /><span className="plan-cross" /></div><span className="north">N ↑</span><span className="plan-caption">SPACE FOR YOUR NEXT CHAPTER</span></div>
      <h2>One property.<br />A lasting record.</h2><p>A place to establish your project, keep a clear history, and control who has access.</p><span className="aside-foot">PROPERTY RECORD <span>01 / THE FOUNDATION</span></span>
    </aside></div>;
}
