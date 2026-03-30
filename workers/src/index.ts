import { corsHeaders, handleOptions } from './middleware/cors'

export interface Env {
  DB: D1Database
  SCRIPTS_BUCKET: R2Bucket
  JWT_SECRET: string
  ENVIRONMENT: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request)
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      // Auth routes
      if (path.startsWith('/auth/')) {
        const { handleAuth } = await import('./routes/auth')
        return handleAuth(request, env)
      }

      // Protected routes — auth middleware applied inside each handler
      if (path.startsWith('/users')) {
        const { handleUsers } = await import('./routes/users')
        return handleUsers(request, env)
      }
      if (path.startsWith('/projects')) {
        const { handleProjects } = await import('./routes/projects')
        return handleProjects(request, env)
      }
      if (path.startsWith('/scripts')) {
        const { handleScripts } = await import('./routes/scripts')
        return handleScripts(request, env)
      }
      if (path.startsWith('/lines')) {
        const { handleLines } = await import('./routes/lines')
        return handleLines(request, env)
      }
      if (path.startsWith('/annotations')) {
        const { handleAnnotations } = await import('./routes/annotations')
        return handleAnnotations(request, env)
      }
      if (path.startsWith('/shots')) {
        const { handleShots } = await import('./routes/shots')
        return handleShots(request, env)
      }
      if (path.startsWith('/share/')) {
        const { handleShare } = await import('./routes/shots')
        return handleShare(request, env)
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (err) {
      console.error(err)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  },
}
