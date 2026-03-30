import { handleOptions } from './middleware/cors'

export interface Env {
  DB: D1Database
  SCRIPTS_BUCKET: R2Bucket
  JWT_SECRET: string
  ENVIRONMENT: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_REDIRECT_URI: string
  WEBHOOK_SECRET: string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleOptions(request)
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      if (path.startsWith('/auth/')) {
        const { handleAuth } = await import('./routes/auth')
        return await handleAuth(request, env)
      }
      if (path.startsWith('/users')) {
        const { handleUsers } = await import('./routes/users')
        return await handleUsers(request, env)
      }
      if (path.startsWith('/projects')) {
        const { handleProjects } = await import('./routes/projects')
        return await handleProjects(request, env)
      }
      if (path.startsWith('/scripts')) {
        const { handleScripts } = await import('./routes/scripts')
        return await handleScripts(request, env)
      }
      if (path.startsWith('/lines')) {
        const { handleLines } = await import('./routes/lines')
        return await handleLines(request, env)
      }
      if (path.startsWith('/annotations')) {
        const { handleAnnotations } = await import('./routes/annotations')
        return await handleAnnotations(request, env)
      }
      if (path.startsWith('/invite')) {
        const { handleInvite } = await import('./routes/invite')
        return await handleInvite(request, env)
      }
      if (path.startsWith('/shots')) {
        const { handleShots } = await import('./routes/shots')
        return await handleShots(request, env, ctx)
      }
      if (path.startsWith('/scenes')) {
        const { handleScenes } = await import('./routes/scenes')
        return await handleScenes(request, env)
      }
      if (path.startsWith('/share/')) {
        const { handleShare } = await import('./routes/shots')
        return await handleShare(request, env)
      }
      if (path.startsWith('/google')) {
        const { handleGoogle } = await import('./routes/google')
        return await handleGoogle(request, env)
      }
      if (path.startsWith('/storyboard')) {
        const { handleStoryboard } = await import('./routes/storyboard')
        return await handleStoryboard(request, env)
      }
      if (path.startsWith('/webhook')) {
        const { handleWebhook } = await import('./routes/webhook')
        return await handleWebhook(request, env)
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    } catch (err) {
      // Auth middleware throws Response directly
      if (err instanceof Response) return err

      console.error(err)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }
  },
}
