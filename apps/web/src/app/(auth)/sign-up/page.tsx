import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/forms';
import { currentUser } from '@/server/session';
export default async function SignUp() {
  if (await currentUser()) redirect('/projects');
  return <><p className="eyebrow">BEGIN WITH A STRONG FOUNDATION</p><h1>A place for your plans.</h1><p className="intro">Create an account to start your property record.</p><AuthForm mode="sign-up" /></>;
}
