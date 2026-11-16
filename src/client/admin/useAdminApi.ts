import { useMemo } from 'react'
import { useAuthSession } from '../panel/auth/AuthContext'
import { createAdminApi, type AdminApi } from './api'

/** Cliente da Platform Admin ligado ao token do utilizador atual. */
export function useAdminApi(): AdminApi {
  const { getToken } = useAuthSession()
  return useMemo(() => createAdminApi(getToken), [getToken])
}
