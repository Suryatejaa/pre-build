import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getContainer } from './container';
export const currentUser = cache(async () => {
  const requestHeaders = await headers();
  return getContainer().auth.currentUser(requestHeaders);
});
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  return user;
}
