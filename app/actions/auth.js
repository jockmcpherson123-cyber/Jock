'use server'

// Server Actions for logging in and out.
//
// "use server" means every function here runs ONLY on the server — the
// password is never handled in the browser. Forms call these directly.
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Called by the login form. `prevState` is required by React's useActionState
// (it holds the previous result so we can show error messages).
export async function login(prevState, formData) {
  const email = formData.get('email')
  const password = formData.get('password')

  if (!email || !password) {
    return { error: 'Please enter both your email and password.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: 'Those details did not match. Please try again.' }
  }

  // Clear any cached pages so the app re-renders as the logged-in user.
  revalidatePath('/', 'layout')
  redirect('/')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
