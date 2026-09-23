import Link from 'next/link';
export default function NotFound() { return <main id="main" className="fallback"><p className="eyebrow">PAGE UNAVAILABLE</p><h1>We couldn’t find that record.</h1><p>It may not exist, or you may not have access.</p><Link className="button primary" href="/projects">Back to projects</Link></main>; }
