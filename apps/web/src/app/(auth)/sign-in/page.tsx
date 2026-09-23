import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/forms';
import { currentUser } from '@/server/session';
export default async function SignIn() {
  if (await currentUser()) redirect('/projects');
  return <><p className="eyebrow">YOUR PROPERTY WORKSPACE</p><h1>Welcome back.</h1><p className="intro">Sign in to continue with your property projects.</p><AuthForm mode="sign-in" /></>;
}
