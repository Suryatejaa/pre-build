import { redirect } from 'next/navigation';
import { currentUser } from '@/server/session';
export const dynamic = 'force-dynamic';
export default async function Home() { redirect(await currentUser() ? '/projects' : '/sign-in'); }
