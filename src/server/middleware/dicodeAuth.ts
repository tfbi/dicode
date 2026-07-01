import { dicodeAuthService } from '../services/dicodeAuthService.js'

function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return null
  return token
}

export function shouldRequireDicodeAuth(): boolean {
  return dicodeAuthService.isRequired()
}

export function isDicodeAuthPublicPath(pathname: string): boolean {
  return pathname === '/health' || pathname.startsWith('/api/dicode-auth')
}

export async function requireDicodeAuth(
  req: Request,
  tokenOverride?: string | null,
): Promise<Response | null> {
  if (!shouldRequireDicodeAuth()) return null
  const token = tokenOverride ?? parseBearerToken(req.headers.get('Authorization'))
  if (!token) {
    return Response.json(
      { error: 'Unauthorized', message: 'Dicode IAM login required' },
      { status: 401 },
    )
  }
  if (!await dicodeAuthService.validateAccessToken(token)) {
    return Response.json(
      { error: 'Unauthorized', message: 'Invalid or expired Dicode IAM token' },
      { status: 401 },
    )
  }
  return null
}
