'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/session'
import {
  deactivateAdminUser,
  normalizeAdminUserStatusFilter,
} from '@/lib/admin/service'

function value(formData: FormData, name: string) {
  const input = formData.get(name)
  return typeof input === 'string' ? input : ''
}

function finish(status: string, result: 'scheduled' | 'failed'): never {
  revalidatePath('/admin/users')
  redirect(
    `/admin/users?status=${encodeURIComponent(status)}&result=${result}`,
  )
}

export async function deactivateAdminUserAction(formData: FormData) {
  const admin = await requireAdmin()
  const status = normalizeAdminUserStatusFilter(value(formData, 'status'))

  try {
    await deactivateAdminUser({
      adminId: admin.userId,
      targetUserId: value(formData, 'targetUserId'),
      reason: value(formData, 'reason'),
      idempotencyKey: value(formData, 'idempotencyKey'),
    })
  } catch {
    finish(status, 'failed')
  }

  finish(status, 'scheduled')
}
