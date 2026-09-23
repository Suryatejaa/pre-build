'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main id="main" className="fallback"><p className="eyebrow">SOMETHING NEEDS ATTENTION</p><h1>We couldn’t load this page.</h1><p>Please try again in a moment.</p><div className="form-actions"><button className="button primary" onClick={reset}>Try again</button><Link className="button quiet" href="/projects">Back to projects</Link></div></main>;
}
