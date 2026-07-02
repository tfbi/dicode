import { z } from 'zod'
import { dicodeAuthService } from '../services/dicodeAuthService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

const ExchangeRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export async function handleDicodeAuthApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]

    if (action === 'start' && req.method === 'POST') {
      return Response.json({ authorizeUrl: dicodeAuthService.getLoginUrl() })
    }

    if (action === 'exchange' && req.method === 'POST') {
      const parsed = ExchangeRequestSchema.safeParse({
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
      })
      if (!parsed.success) {
        throw ApiError.badRequest('code and state query parameters are required')
      }
      await dicodeAuthService.exchangeCodeAndState(parsed.data)
      return Response.json(await dicodeAuthService.getStatus())
    }

    if ((action === undefined || action === 'me') && req.method === 'GET') {
      return Response.json(await dicodeAuthService.getStatus())
    }

    if (action === undefined && req.method === 'DELETE') {
      await dicodeAuthService.deleteTokens()
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Not Found' }, { status: 404 })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('IAM login failed')) {
      return errorResponse(ApiError.badRequest(error.message))
    }
    return errorResponse(error)
  }
}
