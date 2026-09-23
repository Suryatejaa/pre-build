import Link from 'next/link';
export function Brand() {
  return <Link href="/projects" className="brand" aria-label="Property Record home"><span className="brand-mark" aria-hidden="true">⌂</span><span>Property<span className="brand-light">Record</span></span></Link>;
}
