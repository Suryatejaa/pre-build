import Link from 'next/link';
import { CreateProjectForm } from '@/components/forms';
export default function NewProject() {
  return <><Link className="back-link" href="/projects">← All projects</Link><div className="page-heading"><div><p className="eyebrow">START YOUR PROPERTY RECORD</p><h1>Give your project a name.</h1><p className="intro">A simple beginning. A record that can grow with your home.</p></div></div><div className="split-layout"><section className="form-panel"><CreateProjectForm /></section><aside className="side-note"><span className="eyebrow">YOUR PROJECT FOUNDATION</span><h2>Yours, from day one.</h2><p>You will own this project and control who can access it. Changes to its details are saved as new versions, keeping previous records intact.</p><div className="note-rule" /><p className="help">Only people you add can see this project. You can manage access once it has been created.</p></aside></div></>;
}
